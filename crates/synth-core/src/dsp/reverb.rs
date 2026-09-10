//! Stereo reverb — Freeverb topology with the controls a synth patch needs.
//!
//! Eight damped comb filters and four allpass diffusers per channel, with the
//! classic stereo spread, plus three things the previous Soundpipe reverb did
//! not offer: high-frequency **damping**, a **pre-delay**, and slow **delay
//! modulation** that breaks up the metallic ringing a static comb bank has.
//!
//! The delay lines are allocated once from the shared arena (on wasm) when the
//! sample rate is set, so the render loop itself never allocates.

/// Comb tunings in samples at 44.1 kHz (Freeverb's numbers).
const COMB_TUNING: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING: [usize; 4] = [556, 441, 341, 225];
/// Right-channel offset that widens the stereo image.
const STEREO_SPREAD: usize = 23;
/// Longest comb delay after 96 kHz scaling and modulation headroom.
const COMB_MAX: usize = 4096;
const ALLPASS_MAX: usize = 1536;
/// Pre-delay buffer: 100 ms at 96 kHz.
const PREDELAY_MAX: usize = 9600;
/// Scale factor from the 44.1 kHz tunings to the highest supported rate.
const SR_SCALE_MAX: f32 = 96_000.0 / 44_100.0;

struct Comb {
    /// Allocated once in [`Reverb::set_sample_rate`] (from the shared arena on
    /// wasm), never touched from the render loop.
    buf: Vec<f32>,
    len: usize,
    index: usize,
    store: f32,
    damp: f32,
    feedback: f32,
    lfo_phase: f32,
    lfo_inc: f32,
    mod_depth: f32,
}

impl Comb {
    const fn new() -> Self {
        Self {
            buf: Vec::new(),
            len: 1,
            index: 0,
            store: 0.0,
            damp: 0.2,
            feedback: 0.84,
            lfo_phase: 0.0,
            lfo_inc: 0.0,
            mod_depth: 0.0,
        }
    }

    fn setup(&mut self, base_len: usize, sr_scale: f32, lfo_inc: f32, phase: f32) {
        let scaled = (base_len as f32 * sr_scale) as usize;
        self.len = scaled.clamp(64, COMB_MAX - 8);
        if self.buf.len() != self.len {
            self.buf = vec![0.0; self.len];
        } else {
            self.buf.fill(0.0);
        }
        self.index = 0;
        self.store = 0.0;
        self.lfo_inc = lfo_inc;
        self.lfo_phase = phase;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        // Modulated read position: a couple of samples of slow drift is enough
        // to stop the combs from ringing on a fixed pitch.
        self.lfo_phase += self.lfo_inc;
        if self.lfo_phase >= 1.0 {
            self.lfo_phase -= 1.0;
        }
        let offset = if self.mod_depth > 0.0 {
            (self.lfo_phase * core::f32::consts::TAU).sin() * self.mod_depth
        } else {
            0.0
        };
        let read_pos = self.index as f32 - offset;
        let wrapped = if read_pos < 0.0 {
            read_pos + self.len as f32
        } else {
            read_pos
        };
        let i0 = wrapped as usize % self.len;
        let i1 = (i0 + 1) % self.len;
        let frac = wrapped - i0 as f32;
        let out = self.buf[i0] * (1.0 - frac) + self.buf[i1] * frac;

        // One-pole damping inside the feedback path.
        self.store = out * (1.0 - self.damp) + self.store * self.damp;
        self.buf[self.index] = input + self.store * self.feedback;
        self.index += 1;
        if self.index >= self.len {
            self.index = 0;
        }
        out
    }
}

struct Allpass {
    buf: Vec<f32>,
    len: usize,
    index: usize,
}

impl Allpass {
    const fn new() -> Self {
        Self { buf: Vec::new(), len: 1, index: 0 }
    }

    fn setup(&mut self, base_len: usize, sr_scale: f32) {
        self.len = ((base_len as f32 * sr_scale) as usize).clamp(32, ALLPASS_MAX - 1);
        if self.buf.len() != self.len {
            self.buf = vec![0.0; self.len];
        } else {
            self.buf.fill(0.0);
        }
        self.index = 0;
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        const FEEDBACK: f32 = 0.5;
        let buffered = self.buf[self.index];
        let out = -input + buffered;
        self.buf[self.index] = input + buffered * FEEDBACK;
        self.index += 1;
        if self.index >= self.len {
            self.index = 0;
        }
        out
    }
}

/// Parameters, all normalised 0..1 unless noted.
#[derive(Clone, Copy)]
pub struct ReverbParams {
    /// Decay length: maps to a comb feedback of 0.72…0.985.
    pub size: f32,
    /// High-frequency damping in the tail.
    pub damp: f32,
    /// Wet/dry balance.
    pub mix: f32,
    /// Stereo width of the wet signal.
    pub width: f32,
    /// Pre-delay in seconds (0…0.1).
    pub predelay: f32,
}

impl Default for ReverbParams {
    fn default() -> Self {
        Self { size: 0.45, damp: 0.35, mix: 0.25, width: 0.8, predelay: 0.012 }
    }
}

pub struct Reverb {
    combs: [[Comb; 8]; 2],
    allpass: [[Allpass; 4]; 2],
    pre: [Vec<f32>; 2],
    pre_len: usize,
    pre_index: usize,
    /// Slow modulation shared by every comb, with per-comb phase offsets.
    lfo_inc: f32,
    sr_scale: f32,
    params: ReverbParams,
    configured: bool,
}

impl Reverb {
    pub const fn new() -> Self {
        Self {
            // Written out so the whole engine can stay in a `static`.
            combs: [
                [
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                ],
                [
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                    Comb::new(),
                ],
            ],
            allpass: [
                [Allpass::new(), Allpass::new(), Allpass::new(), Allpass::new()],
                [Allpass::new(), Allpass::new(), Allpass::new(), Allpass::new()],
            ],
            pre: [Vec::new(), Vec::new()],
            pre_len: 1,
            pre_index: 0,
            lfo_inc: 0.0,
            sr_scale: 1.0,
            params: ReverbParams {
                size: 0.45,
                damp: 0.35,
                mix: 0.25,
                width: 0.8,
                predelay: 0.012,
            },
            configured: false,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        let sr = sample_rate.max(8000.0);
        self.sr_scale = (sr / 44_100.0).clamp(0.5, SR_SCALE_MAX);
        // One modulation cycle every ~6 seconds.
        self.lfo_inc = 1.0 / (6.0 * sr);
        self.pre_len = ((self.params.predelay * sr) as usize).clamp(1, PREDELAY_MAX - 1);
        if self.pre[0].len() != PREDELAY_MAX {
            self.pre = [vec![0.0; PREDELAY_MAX], vec![0.0; PREDELAY_MAX]];
        } else {
            self.pre[0].fill(0.0);
            self.pre[1].fill(0.0);
        }
        self.pre_index = 0;
        for channel in 0..2 {
            for (i, comb) in self.combs[channel].iter_mut().enumerate() {
                let spread = if channel == 1 { STEREO_SPREAD } else { 0 };
                comb.setup(COMB_TUNING[i] + spread, self.sr_scale, self.lfo_inc, i as f32 / 8.0);
            }
            for (i, ap) in self.allpass[channel].iter_mut().enumerate() {
                let spread = if channel == 1 { STEREO_SPREAD } else { 0 };
                ap.setup(ALLPASS_TUNING[i] + spread, self.sr_scale);
            }
        }
        self.configured = true;
    }

    pub fn set_params(&mut self, params: ReverbParams) {
        self.params = params;
        let feedback = 0.72 + params.size.clamp(0.0, 1.0) * 0.265;
        // Damping 0…0.75 keeps the tail bright when open and dark when closed.
        let damp = params.damp.clamp(0.0, 1.0) * 0.75;
        // Under 3 kHz the comb bank rings too much, over it the tail dies.
        let mod_depth = 1.0 + params.size.clamp(0.0, 1.0) * 3.0;
        for channel in 0..2 {
            for comb in self.combs[channel].iter_mut() {
                comb.feedback = feedback;
                comb.damp = damp;
                comb.mod_depth = mod_depth;
            }
        }
        if self.configured {
            // Never clear the pre-delay line here: the parameter is smoothed, so
            // a knob drag would otherwise wipe the tail on every block.
            let sr = 44_100.0 * self.sr_scale;
            self.pre_len =
                ((params.predelay.clamp(0.0, 0.1) * sr) as usize).clamp(1, PREDELAY_MAX - 1);
            if self.pre_index >= self.pre_len {
                self.pre_index = 0;
            }
        }
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.params.mix > 1e-4
    }

    /// In-place wet/dry mix over a stereo block.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let mix = self.params.mix.clamp(0.0, 1.0);
        if mix <= 1e-4 {
            return;
        }
        let dry = 1.0 - mix;
        let width = self.params.width.clamp(0.0, 1.0);
        for i in 0..left.len() {
            let l = left[i];
            let r = right[i];

            // Pre-delay (a plain ring buffer, same length on both channels).
            let dl = self.pre[0][self.pre_index];
            let dr = self.pre[1][self.pre_index];
            self.pre[0][self.pre_index] = l;
            self.pre[1][self.pre_index] = r;
            self.pre_index += 1;
            if self.pre_index >= self.pre_len {
                self.pre_index = 0;
            }

            // Freeverb sums both channels into each tank (mono-ish input), which
            // is what gives the algorithm its stable, dense tail.
            let input = (dl + dr) * 0.5 * 0.015;
            let mut wet_l = 0.0;
            let mut wet_r = 0.0;
            for comb in self.combs[0].iter_mut() {
                wet_l += comb.process(input);
            }
            for comb in self.combs[1].iter_mut() {
                wet_r += comb.process(input);
            }
            for ap in self.allpass[0].iter_mut() {
                wet_l = ap.process(wet_l);
            }
            for ap in self.allpass[1].iter_mut() {
                wet_r = ap.process(wet_r);
            }

            // Width: 0 collapses to mono, 1 keeps the tanks fully separate.
            let mid = (wet_l + wet_r) * 0.5;
            let side = (wet_l - wet_r) * 0.5 * width;
            let out_l = mid + side;
            let out_r = mid - side;

            left[i] = l * dry + out_l * mix;
            right[i] = r * dry + out_r * mix;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn impulse_response(params: ReverbParams, seconds: f32) -> (Vec<f32>, Vec<f32>, f32) {
        let sr = 48_000.0;
        let mut verb = Reverb::new();
        verb.set_sample_rate(sr);
        verb.set_params(params);
        let n = (seconds * sr) as usize;
        let mut l = vec![0.0f32; n];
        let mut r = vec![0.0f32; n];
        l[0] = 1.0;
        r[0] = 1.0;
        verb.process(&mut l, &mut r);
        let peak = l.iter().chain(r.iter()).fold(0.0f32, |m, v| m.max(v.abs()));
        (l, r, peak)
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn impulse_tail_decays_and_stays_bounded() {
        let (l, _, peak) = impulse_response(ReverbParams { mix: 1.0, ..Default::default() }, 4.0);
        assert!(peak <= 1.0, "reverb overshot: {peak}");
        let head = rms(&l[4800..9600]); // 0.1–0.2 s
        let tail = rms(&l[l.len() - 4800..]); // 3.9–4.0 s
        assert!(head > 0.0, "no tail at all");
        assert!(tail < head * 0.5, "tail did not decay: {head} -> {tail}");
        assert!(l.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn damping_darkens_the_tail() {
        let bright = impulse_response(
            ReverbParams { mix: 1.0, damp: 0.0, size: 0.8, ..Default::default() },
            2.0,
        )
        .0;
        let dark = impulse_response(
            ReverbParams { mix: 1.0, damp: 1.0, size: 0.8, ..Default::default() },
            2.0,
        )
        .0;
        // Mean absolute slope is a cheap brightness proxy: a darker tail moves
        // less between neighbouring samples.
        let slope = |buf: &[f32]| {
            buf.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / buf.len() as f32
        };
        assert!(
            slope(&dark[24_000..]) < slope(&bright[24_000..]),
            "damping did not darken the tail"
        );
    }

    #[test]
    fn width_controls_the_stereo_spread() {
        let (l, r, _) = impulse_response(
            ReverbParams { mix: 1.0, width: 1.0, ..Default::default() },
            1.0,
        );
        let diff: f32 = l.iter().zip(&r).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff > 0.01, "stereo tanks are identical");
        let (l0, r0, _) = impulse_response(
            ReverbParams { mix: 1.0, width: 0.0, ..Default::default() },
            1.0,
        );
        let diff0: f32 = l0.iter().zip(&r0).map(|(a, b)| (a - b).abs()).sum();
        assert!(diff0 < diff * 0.1, "width 0 should collapse to mono");
    }

    #[test]
    fn pre_delay_holds_the_tail_back() {
        let (early, _, _) = impulse_response(
            ReverbParams { mix: 1.0, predelay: 0.0, size: 0.5, ..Default::default() },
            1.0,
        );
        let (late, _, _) = impulse_response(
            ReverbParams { mix: 1.0, predelay: 0.05, size: 0.5, ..Default::default() },
            1.0,
        );
        let first_ms = |buf: &[f32]| {
            buf.iter()
                .position(|s| s.abs() > 1e-4)
                .map(|i| i as f32 / 48.0)
                .unwrap_or(f32::MAX)
        };
        assert!(first_ms(&late) > first_ms(&early) + 20.0);
    }

    #[test]
    fn long_input_never_blows_up() {
        let mut verb = Reverb::new();
        verb.set_sample_rate(48_000.0);
        verb.set_params(ReverbParams { mix: 1.0, size: 1.0, damp: 0.0, ..Default::default() });
        let mut l = vec![0.3f32; 48_000];
        let mut r = vec![-0.3f32; 48_000];
        verb.process(&mut l, &mut r);
        assert!(l.iter().all(|s| s.is_finite() && s.abs() < 4.0));
        assert!(r.iter().all(|s| s.is_finite() && s.abs() < 4.0));
    }
}
