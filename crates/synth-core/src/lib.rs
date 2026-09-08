//! GROOVE SYNTH GS-1 — real-time DSP core.
//!
//! Layout:
//!   * [`alloc_arena`] — fixed arena allocator shared by Rust and vendored C
//!   * [`shim`]        — freestanding libc surface for the vendored C/C++
//!   * [`engine`]      — voice manager, modulation and the block render loop
//!   * [`abi`]         — the `extern "C"` surface consumed by the AudioWorklet
//!
//! The C/C++ DSP (vendored DaisySP + Soundpipe) is compiled by `build.rs` and
//! reached through the block-level ABI declared in `c_bridge/gs_*.h`.

pub mod alloc_arena;
pub mod engine;

mod shim;

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static GLOBAL_ALLOC: alloc_arena::ArenaAlloc = alloc_arena::ArenaAlloc;

extern "C" {
    fn gs_daisy_init(sample_rate: f32);
    fn gs_sp_init(sample_rate: f32);
}

/// Smoke test hook used by the wasm build to guarantee the vendored objects are
/// linked in. Returns the sample rate it was handed.
#[no_mangle]
pub extern "C" fn gs_link_selftest(sample_rate: f32) -> f32 {
    unsafe {
        gs_daisy_init(sample_rate);
        gs_sp_init(sample_rate);
    }
    sample_rate
}
