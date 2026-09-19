//! Global low-frequency oscillator.
//!
//! One LFO is shared by all voices (as in the reference UI). It is evaluated
//! once per block into a scratch buffer, so per-sample targets such as tremolo
//! stay click-free while per-block targets such as cutoff cost nothing extra.

use crate::params::LfoWave;

#[derive(Clone, Copy, Debug)]
pub struct Lfo {
    phase: f32,
    pub value: f32,
    /// One-shot mode stops after a single cycle instead of looping.
    pub one_shot: bool,
}

impl Lfo {
    pub const fn new() -> Self {
        Self {
            phase: 0.0,
            value: 0.0,
            one_shot: false,
        }
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.value = 0.0;
    }

    /// Restart the cycle (used by the per-note retrigger mode).
    pub fn retrigger(&mut self) {
        self.phase = 0.0;
    }

    #[inline]
    fn shape(wave: LfoWave, phase: f32) -> f32 {
        match wave {
            LfoWave::Sine => (phase * core::f32::consts::TAU).sin(),
            LfoWave::Triangle => {
                if phase < 0.25 {
                    phase * 4.0
                } else if phase < 0.75 {
                    2.0 - phase * 4.0
                } else {
                    phase * 4.0 - 4.0
                }
            }
            LfoWave::Square => {
                if phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            LfoWave::Saw => phase * 2.0 - 1.0,
        }
    }

    /// Fill `out` with the LFO shape over `frames` samples and remember the last
    /// value so per-block consumers can read `self.value`.
    pub fn render(&mut self, wave: LfoWave, rate_hz: f32, sample_rate: f32, out: &mut [f32]) {
        let inc = (rate_hz / sample_rate).clamp(0.0, 0.5);
        let mut phase = self.phase;
        let mut last = self.value;
        for sample in out.iter_mut() {
            last = Self::shape(wave, phase);
            *sample = last;
            phase += inc;
            if phase >= 1.0 {
                // A one-shot LFO parks at the end of its cycle and holds the
                // value there, so it behaves like an extra envelope.
                phase = if self.one_shot { 1.0 } else { phase - 1.0 };
            }
        }
        self.phase = phase;
        self.value = last;
    }
}

impl Default for Lfo {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_stays_in_range_and_advances_phase() {
        let mut lfo = Lfo::new();
        let mut buf = [0.0f32; 512];
        lfo.render(LfoWave::Sine, 1.0, 48000.0, &mut buf);
        for v in buf {
            assert!((-1.0..=1.0).contains(&v));
        }
        // One second at 1 Hz should complete roughly one cycle.
        assert!(lfo.phase > 0.0 && lfo.phase < 0.05);
    }

    #[test]
    fn square_is_bipolar() {
        let mut lfo = Lfo::new();
        let mut buf = [0.0f32; 4];
        lfo.render(LfoWave::Square, 2.0, 8.0, &mut buf);
        assert_eq!(buf, [1.0, 1.0, -1.0, -1.0]);
    }
}
