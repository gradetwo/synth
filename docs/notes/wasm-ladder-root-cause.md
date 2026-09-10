# wasm ladder-filter block-boundary dropout — root cause

Investigated: 2026-09-10. Scope: research only; shipped DSP is unchanged.

## TL;DR

The bug is **not** in `ladder.cpp` and **not** a clang/LLVM optimisation bug. It is a
link/execution-model issue:

1. `daisysp::LadderFilter` has **in-class member initialisers (NSDMIs)**:

   ```cpp
   float beta_[4] = {0.0, 0.0, 0.0, 0.0};
   float z0_[4]   = {0.0, 0.0, 0.0, 0.0};
   float z1_[4]   = {0.0, 0.0, 0.0, 0.0};
   ```

   These make the class non-trivially default-constructible, so the namespace-scope
   array `VoiceDsp g_voice[GS_MAX_VOICES]` in `crates/synth-core/c_bridge/gs_daisy.cpp`
   requires **dynamic initialization**. clang emits `_GLOBAL__sub_I_gs_daisy.cpp` and
   registers it in `.init_array`; `wasm-ld` folds that into `__wasm_call_ctors`.

2. The wasm module is built as a **command** module (`--no-entry`, no `start`
   section, `__wasm_call_ctors` not exported). In that model `wasm-ld` wraps **every
   exported function** in a `<name>.command_export` shim whose body is
   `call __wasm_call_ctors; <forward args>; call <name>`. `__wasm_call_ctors` is
   **not idempotent**.

3. Therefore **every call to any `gs_*` export re-runs the C++ global constructor**.
   `_GLOBAL__sub_I_gs_daisy.cpp` zeroes `beta_`/`z0_`/`z1_` of the ladder in all 32
   voice slots. At the first sample of every `gs_voice_filter_block(...)` call the
   ladder state is therefore exactly zero, so the output collapses and then rebuilds
   from the input — the observed one-sample dropout / click train at the block rate.

Natively the ELF `.init_array` runs exactly once at process start, so the identical
C++ is clean. The shipped engine is currently unaffected only because
`crates/synth-core/src/dsp/ladder.rs` (hand-written Rust) replaced the C++ ladder;
the underlying hazard is generic to any dynamically-initialised C++ global linked
into this wasm module.

## Evidence (all reproduced locally)

Environment: clang 22.1.8, rustc 1.98.1, wasm-ld (LLVM 22), Node 22.22.3.

### 1. Same module, same code: only the call granularity differs

`gs_dbg_ladder_block` was driven from Node with a 440 Hz sine, 4096 samples, once in
128-sample chunks and once in a single call (two different, never-used voice slots so
both start from the same zero state — `Init()` does **not** clear `z0_`/`z1_`):

| chunk | max &#124;chunked − single&#124; |
|------:|----------------------------------:|
|    32 | `6.732e-1` |
|    64 | `6.732e-1` |
|   128 | `6.730e-1` |
|   256 | `6.729e-1` |
|  1024 | `6.558e-1` |

At `chunk=128`, the first sample of block 1 is `1.45e-5` in the chunked run versus
`3.855e-1` for the correct single-call trajectory. The exact depth and recovery
length depend on cutoff/resonance: at `freq=1200, res=0.4` the first sample collapses
to almost zero and the next few samples rebuild the state (the ~375 Hz click train);
across tested settings `max |chunked − single|` ranged `0.31 … 0.75`. Calling the
parameter setters every block versus once changes nothing, so the setters are not
involved.

### 2. The state really is zero at every block start

For each `b`, `chunked[b*128]` was compared with a **fresh zero-state filter** fed
only that one input sample (the first oversampled step has `interp == 0`, so it does
not depend on `oldinput_`):

```
block 1@128: chunked=1.45188e-5   freshZeroState=1.40143e-5
block 2@256: chunked=1.44001e-5   freshZeroState=1.38025e-5
block 3@384: chunked=-3.97262e-6  freshZeroState=-3.72162e-6
```

The block-start output is (to within the small residual from voice reuse in the
probe) exactly what a state-less filter produces, i.e. `z0_`/`z1_` are wiped.

### 3. Disassembly of the unstripped wasm

```
(func $__wasm_call_ctors
  call $_GLOBAL__sub_I_gs_daisy.cpp)

(func $gs_dbg_ladder_block.command_export (param i32 i32 i32 i32 i32)
  call $__wasm_call_ctors        ;; <-- re-runs the C++ global ctor on EVERY call
  local.get 0
  ...
  call $gs_dbg_ladder_block)

(func $_GLOBAL__sub_I_gs_daisy.cpp
  ;; loop over the 32 voices (stride 1456), v128 zero-stores into
  ;; beta_/z0_/z1_ of ladder[0] and ladder[1]
  v128.const i32x4 0 0 0 0 ...)
```

`wasm-objdump -x` on the unstripped build also shows the exports are literally the
`*.command_export` symbols, and `_GLOBAL__sub_I_gs_daisy.cpp` is the **only**
dynamic initializer in the module (one object, `gs_daisy.o`; the ladder NSDMIs are
its only non-trivial content — the other five calls are `__cxa_atexit`
registrations).

### 4. The discriminating experiment: change only the link

Rebuild the real crate with one extra linker flag and nothing else:

```
RUSTFLAGS="-C target-feature=+simd128 -C link-arg=--export=__wasm_call_ctors"
```

Result: `max |chunked − single| = 0.000e+0` for every chunk size; block-start values
match the single-call trajectory. Exporting `__wasm_call_ctors` is exactly the
condition under which `wasm-ld` suppresses the `.command_export` wrappers (the same
trick is what LLVM's `command-exports.s` test checks). With that flag the ctors never
run automatically, which is fine here because the objects are zero-initialised in wasm
memory and `Init()`/`gs_init` set the rest.

### 5. Ruled out (measured, not assumed)

| Candidate | Result |
|---|---|
| clang codegen / optimisation level | Pure C++ + `wasm-ld` repro is broken at `-O0`, `-O1`, `-O2`, `-O3` identically |
| SIMD | scalar build (`GS_SIMD=0`, `-C target-feature=-simd128`) has the identical dropout (`6.730e-1`) |
| auto-vectorisation | irrelevant: the trigger is in the linker, and it reproduces at `-O0` |
| UB in `ladder.cpp` (strict aliasing, OOB `std::array`, uninitialised members) | Same source, same chunking compiled natively is bit-clean; the C++ object code is correct, only the global constructor is re-run |
| `memset`/`memcpy`/`tanhf` from the shim/compiler_builtins | Not called by this path; the zeroing is clang-emitted NSDMI stores in `_GLOBAL__sub_I_gs_daisy.cpp` |
| `-ffreestanding -fno-builtin -nostdinc`, 16-byte alignment, stack/ABI | Native build uses the same shim headers and is clean; the fault is the repeated ctor call, not the freestanding layer |
| parameter setters, `Init()` re-run | Setters every block vs once makes no difference; `Init()` does not clear `z0_/z1_` |

### 6. Minimal reproduction, without Rust

`docs/notes/wasm-ladder-repro/` reproduces the whole thing with only `clang++`,
`wasm-ld` and Node:

```bash
cd docs/notes/wasm-ladder-repro
./build.sh                 # buggy link (command_export wrappers)
./build.sh guarded         # same C++, but --export=__wasm_call_ctors
./build.sh native          # native control
node run.mjs repro.wasm           # -> BROKEN, sample 128 = 0.000005 (correct 0.085341)
node run.mjs repro_guarded.wasm   # -> CLEAN,   sample 128 = 0.085341
./repro_native                    # -> max |chunked - single| = 0
```

The reproducer's `repro.cpp` is exactly the shape of `gs_daisy.cpp`: a
`daisysp::LadderFilter g_voice[32]` at namespace scope plus a block-processing
forwarder. Note that a **single** global (not an array) is enough to be
constant-folded into `.bss` by clang and does *not* reproduce; the array forces the
dynamic initializer. That is why `VoiceDsp g_voice[32]` triggers it and a scratch
`static LadderFilter f;` would not.

## Why native is clean

`LadderFilter::LadderFilter()` is non-trivial because of the NSDMIs, so `g_voice` has
dynamic initialization on every platform. On ELF the `.init_array` entry runs once at
program startup, so `z0_/z1_` are zeroed once, before `Init()`, and never again. The
wasm link turns that same `.init_array` entry into `__wasm_call_ctors` and then
re-invokes it per export.

## Recommended guard

1. **Preferred (root fix): do not let wasm-linked C++ globals require dynamic
   initialization.** Give `LadderFilter` a trivial default constructor by dropping the
   NSDMIs — static storage is already zero-initialised:

   ```cpp
   float beta_[4];
   float z0_[4];
   float z1_[4];
   ```

   `Init()` sets everything else, and `mode_` only matters after `SetFilterMode`.
   Verify: the unstripped module must contain no `_GLOBAL__sub_I_*` symbol and
   `__wasm_call_ctors` must be empty. Apply the same rule to any other C++ class linked
   into the wasm.

2. **Defence in depth at link time:** add
   `-C link-arg=--export=__wasm_call_ctors` to the wasm `RUSTFLAGS` in
   `scripts/build-wasm.mjs`, then call `instance.exports.__wasm_call_ctors?.()` once
   right after instantiation (worklet + tests). This suppresses the per-export
   wrappers for the whole module. Caveat: with this flag ctors are no longer run
   automatically anywhere, so the explicit one-time call matters if a future C++ TU
   really needs a constructor.

3. **Regression test:** run the minimal reproducer in CI and assert
   `max |chunked − single| == 0` on the wasm build with the native binary as the
   control (an npm script such as `test:wasm-ctors` invoking
   `docs/notes/wasm-ladder-repro/build.sh` + `run.mjs` is enough). A *native* Rust
   `#[test]` alone would **not** catch this, because native is always clean.

## References

- LLVM, `[wasm-ld] Add support for calling constructors in reactors` — documents that
  wasm-ld historically inserted `__wasm_call_ctors` calls on every command export:
  <https://reviews.llvm.org/D135903>
- Stack Overflow, "How to prevent wasi-sdk clang++ from inserting `__wasm_call_ctors`
  call to every exported function?":
  <https://stackoverflow.com/questions/76484993/>
- wasm-ld test `lld/test/wasm/command-exports.s` (`--export=__wasm_call_ctors`
  suppresses the wrappers).

## Files

- Reproducer: `docs/notes/wasm-ladder-repro/` (`build.sh`, `repro.cpp`, `run.mjs`).
- Diagnostic driver used against the real crate (temporary, not committed):
  `gs_dbg_*` exports added to `crates/synth-core/src/abi.rs`.
