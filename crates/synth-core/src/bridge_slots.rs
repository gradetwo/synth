//! Process-wide allocation of the C++ bridge's shared state across `Engine`
//! instances (phase 2, true multi-instance).
//!
//! The vendored C/C++ DSP keeps its state in process-global arrays: 32 voice
//! slots (`g_voice`) and 6 effect slots per effect kind (`g_chorus`,
//! `g_flanger`, `g_phaser`, `g_overdrive`). Two `Engine` instances in one
//! process must never touch the same slot, or they bleed into each other.
//! This allocator hands out disjoint voice ranges and effect-instance ids,
//! and pins one sample rate per process: the C++ `g_sample_rate` is global,
//! and `gs_voice_reset` re-inits oscillators against it, so a second rate
//! would silently retune the first instance.
//!
//! Allocation is dynamic, not fixed halves: an instance claims the voice
//! range its polyphony needs (the plugin claims 16, the offline render
//! claims 32), so a lone engine keeps the full pool and a second instance
//! only fits when the first left room. A claim fails loudly (`None`) when
//! no contiguous range or no effect instance is free — never by aliasing.
//!
//! The Rust side of an `Engine` (params, envelopes, reverbs, delays,
//! convolvers) is already per-instance; only the C++ bridge is shared, so
//! only the bridge needs this allocator. The Soundpipe bridge (`gs_sp_*`)
//! has no callers and is not allocated here.

use std::sync::Mutex;

/// How many engine instances may live at once. The effect slots are
/// dimensioned by this number in the C++ bridge. Two is what the plugin
/// needs (two 16-voice instances use all 32 voice slots exactly); four
/// leaves headroom for the process singleton, which claims one instance
/// and — being a `static` — never releases it, plus test engines. The
/// voice pool (32 slots) stays the real limit: three 16-voice engines
/// cannot fit no matter the cap, so holders must drop engines they no
/// longer need instead of shadowing them.
pub const MAX_BRIDGE_INSTANCES: usize = 4;

/// Total C++ voice slots (`GS_MAX_VOICES`).
pub const BRIDGE_VOICE_SLOTS: usize = 32;

struct State {
    sample_rate: Option<f32>,
    /// Bitmask over the 32 C++ voice slots.
    voice_used: u32,
    fx_used: [bool; MAX_BRIDGE_INSTANCES],
}

static STATE: Mutex<State> = Mutex::new(State {
    sample_rate: None,
    voice_used: 0,
    fx_used: [false; MAX_BRIDGE_INSTANCES],
});

fn lock_state() -> std::sync::MutexGuard<'static, State> {
    STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A claimed slice of the bridge: a contiguous voice range plus one
/// effect-instance id. Dropping releases both; the sample rate is cleared
/// once nothing is live, so a later engine may start at another rate.
pub struct BridgeReservation {
    /// Index into the C++ effect-state arrays (`g_chorus[inst]`, ...).
    pub fx_instance: usize,
    /// First C++ voice slot this engine may touch.
    pub voice_base: usize,
    /// How many consecutive C++ voice slots this engine owns.
    pub voice_count: usize,
}

impl Drop for BridgeReservation {
    fn drop(&mut self) {
        let mut state = lock_state();
        let window = ((1u64 << self.voice_count) - 1) as u32;
        state.voice_used &= !(window << self.voice_base);
        state.fx_used[self.fx_instance] = false;
        if state.voice_used == 0 {
            state.sample_rate = None;
        }
    }
}

/// Claim a voice range of `voice_count` slots plus one effect instance at
/// `sample_rate`. Returns `None` (and claims nothing) when the rate
/// conflicts with a live instance, when no contiguous voice range fits, or
/// when no effect instance is free.
pub fn claim(sample_rate: f32, voice_count: usize) -> Option<BridgeReservation> {
    let voice_count = voice_count.clamp(1, BRIDGE_VOICE_SLOTS);
    let mut state = lock_state();
    if let Some(rate) = state.sample_rate {
        if rate != sample_rate {
            return None;
        }
    }
    let window = ((1u64 << voice_count) - 1) as u32;
    let mut voice_base = None;
    for base in 0..=(BRIDGE_VOICE_SLOTS - voice_count) {
        if (state.voice_used >> base) & window == 0 {
            voice_base = Some(base);
            break;
        }
    }
    let voice_base = voice_base?;
    let fx_instance = state.fx_used.iter().position(|used| !used)?;
    state.voice_used |= window << voice_base;
    state.fx_used[fx_instance] = true;
    if state.sample_rate.is_none() {
        state.sample_rate = Some(sample_rate);
    }
    Some(BridgeReservation {
        fx_instance,
        voice_base,
        voice_count,
    })
}

/// How many reservations are live right now.
pub fn live_count() -> usize {
    lock_state().fx_used.iter().filter(|used| **used).count()
}

/// Change the process sample rate. Only allowed when at most one instance
/// is live (the caller itself); otherwise the other instances would be
/// retuned behind their backs. Returns false when refused.
pub fn retune(new_rate: f32) -> bool {
    let mut state = lock_state();
    if live_count_locked(&state) > 1 {
        return false;
    }
    state.sample_rate = Some(new_rate);
    true
}

fn live_count_locked(state: &State) -> usize {
    state.fx_used.iter().filter(|used| **used).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests mutate process-global allocator state, so they must run
    /// serialized — the same convention as the engine tests (`ENGINE_LOCK`
    /// plus `--test-threads=1` in `test:rust`).
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn reset_for_test() -> std::sync::MutexGuard<'static, ()> {
        let guard = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let mut state = lock_state();
        *state = State {
            sample_rate: None,
            voice_used: 0,
            fx_used: [false; MAX_BRIDGE_INSTANCES],
        };
        drop(state);
        guard
    }

    #[test]
    fn two_sixteen_voice_claims_fit_and_a_third_fails() {
        let _guard = reset_for_test();
        let a = claim(48000.0, 16).expect("first claim");
        assert_eq!(a.voice_base, 0);
        assert_eq!(a.fx_instance, 0);
        let b = claim(48000.0, 16).expect("second claim");
        assert_eq!(b.voice_base, 16);
        assert_eq!(b.fx_instance, 1);
        assert!(claim(48000.0, 16).is_none(), "no room for a third");
        drop(a);
        drop(b);
        assert_eq!(live_count(), 0);
    }

    #[test]
    fn a_lone_32_voice_claim_takes_the_whole_pool() {
        let _guard = reset_for_test();
        let a = claim(48000.0, 32).expect("32-voice claim");
        assert_eq!((a.voice_base, a.voice_count), (0, 32));
        assert!(claim(48000.0, 1).is_none(), "nothing left beside it");
        drop(a);
        assert!(claim(44100.0, 16).is_some(), "rate resets once empty");
    }

    #[test]
    fn rate_conflict_fails_and_drop_releases() {
        let _guard = reset_for_test();
        let a = claim(48000.0, 16).expect("first claim");
        assert!(claim(44100.0, 16).is_none(), "second rate refused");
        drop(a);
        assert!(claim(44100.0, 16).is_some(), "rate free after drop");
    }
}
