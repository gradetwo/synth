# Minimal wasm reproducer — LadderFilter block-boundary state loss

See `../wasm-ladder-root-cause.md` for the analysis.

## What it shows

The DaisySP `LadderFilter` has in-class member initialisers (`z0_`/`z1_`/`beta_`), so a
namespace-scope array of them needs a C++ dynamic initializer. In the `synth-core`
wasm link (`wasm-ld`, command execution model, `__wasm_call_ctors` not exported),
wasm-ld wraps every export in a `<name>.command_export` shim that re-runs
`__wasm_call_ctors` — and therefore re-runs the global constructor — on **every**
exported call. Every block boundary therefore starts with zeroed filter state.

## Commands

```bash
./build.sh                 # buggy link
./build.sh guarded         # same C++, linked with --export=__wasm_call_ctors
./build.sh native          # native control
OPT=-O0 ./build.sh         # demonstrates it is not an optimisation issue

node run.mjs repro.wasm           # BROKEN: sample 128 = 0.000005 (correct 0.085341)
node run.mjs repro_guarded.wasm   # CLEAN
./repro_native                    # CLEAN: max |chunked - single| = 0
```

`repro.wasm` is only ~5 KB and needs nothing but `clang++`, `wasm-ld` and Node.
