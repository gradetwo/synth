//! GROOVE SYNTH GS-1 — real-time DSP core.
//!
//! Layout:
//!   * [`alloc_arena`] — fixed arena allocator shared by Rust and vendored C
//!   * [`shim`]        — freestanding libc surface for the vendored C/C++
//!   * [`params`]      — parameter model mirrored by the TypeScript UI
//!   * [`voice`]       — polyphony, smooth stealing, elastic downgrade
//!   * [`engine`]      — the block render loop
//!   * [`fft`]         — spectrum analysis for the on-screen analyser
//!   * [`abi`]         — the `extern "C"` surface consumed by the AudioWorklet
//!
//! The C/C++ DSP (vendored DaisySP + Soundpipe) is compiled by `build.rs` and
//! reached through the block-level ABI declared in `c_bridge/gs_*.h`.

pub mod abi;
pub mod alloc_arena;
pub mod dsp;
pub mod engine;
pub mod fft;
pub mod params;
pub mod voice;

/// Tests for the second filter stage (P6.3b). Compiled away outside `cfg(test)`.
#[cfg(test)]
mod dual_filter;

/// Bit-crusher and shaping EQ (P6.4), with their own measurement rig.
mod fx_shaping;

mod shim;

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static GLOBAL_ALLOC: alloc_arena::ArenaAlloc = alloc_arena::ArenaAlloc;
