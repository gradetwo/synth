//! Per-voice ADSR envelope.
//!
//! Implemented natively in Rust rather than forwarding to DaisySP's `Adsr`.
//! The engine needs one envelope *instance per voice* with an independent,
//! overridable release (for smooth voice stealing), which a shared-parameter
//! wrapper cannot express cleanly. The algorithm is a linear attack followed by
//! one-pole decay/release segments — allocation free and fully unit-tested.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Copy, Debug)]
pub struct Adsr {
    stage: Stage,
    value: f32,
    attack_inc: f32,
    decay_coef: f32,
    release_coef: f32,
    attack_s: f32,
    decay_s: f32,
    sustain: f32,
    release_s: f32,
    sample_rate: f32,
}

impl Adsr {
    pub const fn new() -> Self {
        Self {
            stage: Stage::Idle,
            value: 0.0,
            attack_inc: 1.0,
            decay_coef: 0.0,
            release_coef: 0.0,
            attack_s: 0.01,
            decay_s: 0.2,
            sustain: 0.8,
            release_s: 0.3,
            sample_rate: 48000.0,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate.max(1000.0);
        self.recompute();
    }

    /// Update the segment times. Coefficients are only recomputed when a value
    /// actually changes, so this is cheap to call defensively.
    pub fn set_params(&mut self, attack_s: f32, decay_s: f32, sustain: f32, release_s: f32) {
        if (attack_s - self.attack_s).abs() > 1e-9
            || (decay_s - self.decay_s).abs() > 1e-9
            || (sustain - self.sustain).abs() > 1e-9
            || (release_s - self.release_s).abs() > 1e-9
        {
            self.attack_s = attack_s.max(0.0);
            self.decay_s = decay_s.max(0.0);
            self.sustain = sustain.clamp(0.0, 1.0);
            self.release_s = release_s.max(0.0);
            self.recompute();
        }
    }

    pub fn set_release(&mut self, release_s: f32) {
        let release_s = release_s.max(0.0);
        if (release_s - self.release_s).abs() > 1e-9 {
            self.release_s = release_s;
            self.recompute();
        }
    }

    fn recompute(&mut self) {
        let sr = self.sample_rate;
        self.attack_inc = if self.attack_s <= 1e-5 {
            1.0
        } else {
            1.0 / (self.attack_s * sr)
        };
        self.decay_coef = time_coefficient(self.decay_s, sr);
        self.release_coef = time_coefficient(self.release_s, sr);
    }

    /// Restart the envelope from silence.
    pub fn reset(&mut self) {
        self.stage = Stage::Idle;
        self.value = 0.0;
    }

    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
    }

    pub fn gate_off(&mut self) {
        if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }

    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    pub fn value(&self) -> f32 {
        self.value
    }

    pub fn stage(&self) -> Stage {
        self.stage
    }

    #[inline]
    pub fn process(&mut self, gate: bool) -> f32 {
        // A note begins only through `gate_on()`; this prevents a zero-sustain
        // voice from re-attacking itself while the key is still held.
        if !gate && self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }

        match self.stage {
            Stage::Attack => {
                self.value += self.attack_inc;
                if self.value >= 1.0 {
                    self.value = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay => {
                self.value = self.sustain + (self.value - self.sustain) * self.decay_coef;
                if (self.value - self.sustain).abs() < 1e-4 {
                    self.value = self.sustain;
                    // A zero-sustain voice is finished as soon as it decays,
                    // even while the key is still held (pluck/bell behaviour).
                    self.stage = if self.sustain <= 1e-4 {
                        Stage::Idle
                    } else {
                        Stage::Sustain
                    };
                    if self.stage == Stage::Idle {
                        self.value = 0.0;
                    }
                }
            }
            Stage::Sustain => {
                self.value = self.sustain;
            }
            Stage::Release => {
                self.value *= self.release_coef;
                if self.value < 1e-4 {
                    self.value = 0.0;
                    self.stage = Stage::Idle;
                }
            }
            Stage::Idle => {
                self.value = 0.0;
            }
        }
        self.value
    }
}

/// One-pole coefficient whose segment covers ~99.8% of its span in `time_s`
/// seconds (so "release = 0.3 s" sounds like a 0.3 s release, not 3 s).
fn time_coefficient(time_s: f32, sample_rate: f32) -> f32 {
    const K: f32 = 6.0;
    if time_s <= 1e-5 {
        0.0
    } else {
        (-K / (time_s * sample_rate)).exp()
    }
}

impl Default for Adsr {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(env: &mut Adsr, gate: bool, samples: usize) -> f32 {
        let mut last = 0.0;
        for _ in 0..samples {
            last = env.process(gate);
        }
        last
    }

    #[test]
    fn attack_reaches_peak_then_decays_to_sustain() {
        let mut env = Adsr::new();
        env.set_sample_rate(48000.0);
        env.set_params(0.01, 0.05, 0.5, 0.1);
        env.gate_on();
        let peak = render(&mut env, true, 480);
        assert!(peak >= 0.99, "attack did not reach peak: {peak}");
        let sustain = render(&mut env, true, 48000 / 4);
        assert!((sustain - 0.5).abs() < 0.01, "sustain wrong: {sustain}");
    }

    #[test]
    fn release_decays_to_idle_and_reports_inactive() {
        let mut env = Adsr::new();
        env.set_sample_rate(48000.0);
        env.set_params(0.001, 0.01, 0.8, 0.02);
        env.gate_on();
        render(&mut env, true, 4800);
        env.gate_off();
        render(&mut env, false, 48000);
        assert!(!env.is_active());
        assert_eq!(env.value(), 0.0);
    }

    #[test]
    fn zero_sustain_voice_finishes_while_key_held() {
        let mut env = Adsr::new();
        env.set_sample_rate(48000.0);
        env.set_params(0.001, 0.02, 0.0, 0.1);
        env.gate_on();
        render(&mut env, true, 48000);
        assert!(!env.is_active(), "pluck should finish after decay");
        assert_eq!(env.value(), 0.0);
        // The held key must not silently restart the envelope.
        assert_eq!(render(&mut env, true, 128), 0.0);
    }

    #[test]
    fn retrigger_during_release_restarts_attack() {
        let mut env = Adsr::new();
        env.set_sample_rate(48000.0);
        env.set_params(0.01, 0.1, 0.6, 0.5);
        env.gate_on();
        render(&mut env, true, 2400);
        env.gate_off();
        render(&mut env, false, 1200);
        let mid_release = env.value();
        assert!(mid_release > 0.0);
        // An explicit retrigger (note-on) restarts the attack.
        env.gate_on();
        let after = render(&mut env, true, 240);
        assert!(after > mid_release, "retrigger should climb again");
    }

    #[test]
    fn release_override_is_used_for_stealing() {
        let mut env = Adsr::new();
        env.set_sample_rate(48000.0);
        env.set_params(0.001, 0.01, 1.0, 5.0);
        env.gate_on();
        render(&mut env, true, 2400);
        env.set_release(0.004);
        env.gate_off();
        render(&mut env, false, 2400);
        assert!(!env.is_active(), "short release should finish quickly");
    }
}
