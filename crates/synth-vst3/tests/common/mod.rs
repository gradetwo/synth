#![allow(dead_code)]
//! Shared helpers for the synth-vst3 integration tests.
//!
//! Each test binary includes this file with `#[path]`, and each binary only
//! uses a subset of the helpers, so per-target dead code is expected.
//!
//! The engine behind synth-core is a process singleton with global C++
//! voice state, so every test that touches the engine must hold
//! [`ENGINE_LOCK`] for its whole duration. Tests in different files run in
//! different processes and cannot interfere; tests in one file share the
//! lock.

use std::sync::{Mutex, MutexGuard};

pub static ENGINE_LOCK: Mutex<()> = Mutex::new(());

/// Hold the engine for a whole test. Recover from poisoning: a test that
/// panics while holding the lock must not fail every later test.
pub fn lock_engine() -> MutexGuard<'static, ()> {
    ENGINE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

pub const SR: f32 = 48000.0;

/// dB conversion exactly as scripts/verify-presets.mjs: 20*log10(v + 1e-12).
pub fn db(value: f64) -> f64 {
    20.0 * (value + 1e-12).log10()
}

/// RMS energy exactly as scripts/verify-presets.mjs: sqrt(mean(x^2)).
pub fn rms(data: &[f32]) -> f64 {
    let sum: f64 = data.iter().map(|x| (*x as f64) * (*x as f64)).sum();
    (sum / data.len() as f64).sqrt()
}

/// Goertzel magnitude exactly as scripts/verify-presets.mjs (f64
/// accumulation; the script runs in f64, so this matches to ~1e-6).
pub fn goertzel(data: &[f32], freq: f64) -> f64 {
    let k = 2.0 * std::f64::consts::PI * freq / SR as f64;
    let coeff = 2.0 * k.cos();
    let mut s1 = 0.0f64;
    let mut s2 = 0.0f64;
    for &x in data {
        let s0 = x as f64 + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    ((s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0)).sqrt() / data.len() as f64
}
