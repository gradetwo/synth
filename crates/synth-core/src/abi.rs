//! The `extern "C"` surface consumed by `synth-processor.js`.
//!
//! All functions are designed for the AudioWorklet render thread: no panics on
//! bad input (values are clamped in [`crate::params`]), no allocation in
//! `gs_process`, and raw pointers only into statically allocated buffers.

use crate::alloc_arena;
use crate::engine::engine;
use crate::params::{MAX_BLOCK_SIZE, MAX_VOICES, SPECTRUM_BINS};

pub const ABI_VERSION: u32 = 1;

/// Initialise the engine. Returns 1 on success.
#[no_mangle]
pub extern "C" fn gs_init(sample_rate: f32, max_polyphony: u32) -> u32 {
    engine().init(sample_rate, max_polyphony as usize);
    1
}

/// Reset voices, LFO and FX without recreating the module.
#[no_mangle]
pub extern "C" fn gs_reset() {
    let e = engine();
    let sr = e.sample_rate;
    let poly = e.vm.max_polyphony;
    e.init(sr, poly);
}

/// Render `frames` samples (clamped to [`MAX_BLOCK_SIZE`]). Returns the number
/// of voices that were active during the block.
#[no_mangle]
pub extern "C" fn gs_process(frames: u32) -> u32 {
    engine().process(frames as usize)
}

#[no_mangle]
pub extern "C" fn gs_left_ptr() -> *const f32 {
    engine().left_ptr()
}

#[no_mangle]
pub extern "C" fn gs_right_ptr() -> *const f32 {
    engine().right_ptr()
}

#[no_mangle]
pub extern "C" fn gs_spectrum_ptr() -> *const f32 {
    engine().spectrum_ptr()
}

#[no_mangle]
pub extern "C" fn gs_spectrum_bins() -> u32 {
    SPECTRUM_BINS as u32
}

#[no_mangle]
pub extern "C" fn gs_max_block_size() -> u32 {
    MAX_BLOCK_SIZE as u32
}

#[no_mangle]
pub extern "C" fn gs_max_voices() -> u32 {
    MAX_VOICES as u32
}

#[no_mangle]
pub extern "C" fn gs_abi_version() -> u32 {
    ABI_VERSION
}

// ------------------------------------------------------------------- controls

#[no_mangle]
pub extern "C" fn gs_set_param(id: u32, value: f32) {
    engine().set_param(id, value);
}

#[no_mangle]
pub extern "C" fn gs_set_mod_route(index: u32, src: u32, dst: u32, amount: f32, enabled: u32) {
    engine().set_route(index as usize, src, dst, amount, enabled != 0);
}

#[no_mangle]
pub extern "C" fn gs_set_max_polyphony(n: u32) {
    engine().set_max_polyphony(n as usize);
}

#[no_mangle]
pub extern "C" fn gs_trigger_smooth_downgrade() {
    engine().trigger_smooth_downgrade();
}

// --------------------------------------------------------------------- events

#[no_mangle]
pub extern "C" fn gs_note_on(note: u32, velocity: f32) {
    engine().note_on(note.min(127) as u8, velocity);
}

#[no_mangle]
pub extern "C" fn gs_note_off(note: u32) {
    engine().note_off(note.min(127) as u8);
}

#[no_mangle]
pub extern "C" fn gs_all_notes_off() {
    engine().all_notes_off();
}

#[no_mangle]
pub extern "C" fn gs_pitch_bend(semitones: f32) {
    engine().pitch_bend(semitones);
}

#[no_mangle]
pub extern "C" fn gs_mod_wheel(value: f32) {
    engine().mod_wheel(value);
}

// ---------------------------------------------------------------- diagnostics

#[no_mangle]
pub extern "C" fn gs_peak_l() -> f32 {
    engine().peak_l()
}

#[no_mangle]
pub extern "C" fn gs_peak_r() -> f32 {
    engine().peak_r()
}

#[no_mangle]
pub extern "C" fn gs_active_voices() -> u32 {
    engine().active_voices()
}

#[no_mangle]
pub extern "C" fn gs_alloc_count() -> u32 {
    alloc_arena::alloc_count() as u32
}

#[no_mangle]
pub extern "C" fn gs_alloc_violations() -> u32 {
    alloc_arena::violations() as u32
}

#[no_mangle]
pub extern "C" fn gs_reset_alloc_violations() {
    alloc_arena::reset_violations();
}

#[no_mangle]
pub extern "C" fn gs_arena_free_bytes() -> u32 {
    alloc_arena::free_bytes() as u32
}
