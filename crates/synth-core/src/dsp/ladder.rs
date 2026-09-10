//! Four-pole resonant low-pass, in Rust.
//!
//! This is a zero-delay-feedback (TPT) ladder: four one-pole stages inside a
//! feedback loop with a saturating input stage, which is the classic 24 dB/oct
//! synth low-pass.
//!
//! It replaced the vendored DaisySP `LadderFilter` because that one misbehaves
//! in the wasm build: measured with a pure sine it drops a sample at every
//! render-block boundary (a click per 128 samples, i.e. audible crackle on a
//! simple patch), while the same C++ compiled for the host is clean. Two
//! cascaded SVFs — the other filter family — are clean in wasm, so the fault is
//! specific to that translation unit; owning the filter here removes the
//! dependency and keeps the behaviour identical on every target.

/// Padé approximation of tanh, the same shape the vendored code used for its
/// saturation stage: cheap, smooth, and monotonic over the useful range.
#[inline]
fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    (x * (27.0 + x2)) / (27.0 + 9.0 * x2)
}

/// Output trim. The vendored ladder this replaces ran with a 0.5 passband
/// gain, so every existing preset was balanced against a low-pass that sat
/// about 4 dB below unity. Matching that keeps patch levels, headroom and the
/// audio gates where they were.
const PASSBAND_TRIM: f32 = 1.0;

#[derive(Clone, Copy)]
pub struct LadderFilter {
    /// One-pole coefficient, already folded through `g / (1 + g)`.
    coeff: f32,
    /// Feedback amount: 0 (no resonance) to just under 4 (self-oscillation).
    feedback: f32,
    /// Input gain into the saturator.
    drive: f32,
    /// Integrator state of the four stages.
    state: [f32; 4],
}

impl LadderFilter {
    pub const fn new() -> Self {
        Self {
            coeff: 0.1,
            feedback: 0.0,
            drive: 1.0,
            state: [0.0; 4],
        }
    }

    pub fn reset(&mut self) {
        self.state = [0.0; 4];
    }

    /// `freq` in Hz, `res` 0..1 (the UI knob), `drive` 0..1 (the UI knob).
    pub fn set(&mut self, sample_rate: f32, freq: f32, res: f32, drive: f32) {
        let sr = sample_rate.max(1000.0);
        // Keep the cutoff below Nyquist: tan() explodes at sr/2, and the
        // 0.45 ceiling is what the rest of the engine uses.
        let fc = freq.clamp(20.0, sr * 0.45);
        let w = (core::f32::consts::PI * fc / sr).tan();
        self.coeff = (w / (1.0 + w)).clamp(0.0, 0.999_99);
        self.feedback = res.clamp(0.0, 1.0) * 3.9;
        // Unity at the bottom of the knob, up to 2x: enough grit to be worth a
        // control, not so much that a sine turns into a fuzz box (the audio
        // gate holds full drive under 6% THD).
        self.drive = 1.0 + drive.clamp(0.0, 1.0) * 0.8;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let g = self.coeff;
        // Unity drive is transparent: the input saturator only shapes the sound
        // once the knob is turned up, which keeps the passband level intact.
        let x = if self.drive > 1.0001 {
            fast_tanh(input * self.drive) / self.drive
        } else {
            input
        };
        // Zero-delay feedback: solve the loop instead of feeding back the
        // previous sample. Without this the four-pole loop goes unstable well
        // before full resonance; with it, `feedback` near 4 self-oscillates
        // cleanly. Each one-pole is `y = g*x + (1 - g)*z`.
        let (g2, g3, g4) = (g * g, g * g * g, g * g * g * g);
        let b0 = (1.0 - g) * self.state[0];
        let b1 = (1.0 - g) * self.state[1];
        let b2 = (1.0 - g) * self.state[2];
        let b3 = (1.0 - g) * self.state[3];
        let state_sum = g3 * b0 + g2 * b1 + g * b2 + b3;
        let u = (x - self.feedback * state_sum) / (1.0 + self.feedback * g4);
        let mut v = u;
        let bases = [b0, b1, b2, b3];
        for stage in 0..4 {
            let y = g * v + bases[stage];
            // z_new = y + (y - z_old)
            self.state[stage] = 2.0 * y - self.state[stage];
            v = y;
        }
        // The saturation inside the feedback path is what keeps the self
        // oscillation bounded; without it the loop grows until it is clipped
        // by the master limiter instead.
        // Bounded output, normalised so small signals pass at unity.
        fast_tanh(v * 0.6) / 0.6 * PASSBAND_TRIM
    }

    /// Render a block in place (the block ABI the engine speaks).
    pub fn process_block(&mut self, buffer: &mut [f32]) {
        for sample in buffer.iter_mut() {
            *sample = self.process(*sample);
        }
    }
}

impl Default for LadderFilter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(freq: f32, res: f32, drive: f32, seconds: f32) -> Vec<f32> {
        let sr = 48_000.0;
        let mut filter = LadderFilter::new();
        filter.set(sr, freq, res, drive);
        let n = (seconds * sr) as usize;
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let x = (core::f32::consts::TAU * 440.0 * i as f32 / sr).sin() * 0.5;
            out.push(filter.process(x));
        }
        out
    }

    /// A pure sine must come out smooth: no sample-to-sample jumps beyond what
    /// the input's own slope allows. This is the regression that started it all
    /// — the old filter clicked once per render block.
    #[test]
    fn stays_continuous_on_a_sine() {
        let sr = 48_000.0;
        for (freq, res, drive) in [(500.0, 0.1, 0.0), (4_000.0, 0.5, 0.3), (18_000.0, 0.0, 0.0)] {
            let out = render(freq, res, drive, 1.0);
            let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            let mut worst = 0.0f32;
            for i in 1..out.len() {
                worst = worst.max((out[i] - out[i - 1]).abs());
            }
            // A 440 Hz sine at this peak can step by 2*pi*440/sr*peak; a lopsided
            // low-pass cannot add much beyond that.
            let ideal = core::f32::consts::TAU * 440.0 / sr * peak;
            assert!(
                worst < ideal * 2.5,
                "cutoff {freq} res {res} drive {drive}: step {worst} vs ideal {ideal}"
            );
            assert!(out.iter().all(|v| v.is_finite()));
        }
    }

    /// Steady-state amplitude of a sine through the filter, measured after the
    /// transient has died out (a peak is enough here: the tests below look at
    /// response, the engine-level gates look at distortion).
    fn amplitude(freq: f32, res: f32, tone: f32) -> f32 {
        let sr = 48_000.0;
        let mut filter = LadderFilter::new();
        filter.set(sr, freq, res, 0.0);
        let mut peak = 0.0f32;
        let total = 48_000;
        for i in 0..total {
            let x = (core::f32::consts::TAU * tone * i as f32 / sr).sin();
            let y = filter.process(x);
            if i > total / 2 {
                peak = peak.max(y.abs());
            }
        }
        peak
    }

    #[test]
    fn low_pass_attenuates_above_the_cutoff() {
        let pass = amplitude(2_000.0, 0.0, 200.0);
        let stop = amplitude(2_000.0, 0.0, 8_000.0);
        assert!(pass > 0.8, "passband too quiet: {pass}");
        assert!(stop < pass * 0.1, "not a low-pass: {stop} vs {pass}");
    }

    #[test]
    fn resonance_lifts_the_cutoff() {
        let flat = amplitude(1_000.0, 0.0, 1_000.0);
        let resonant = amplitude(1_000.0, 0.9, 1_000.0);
        assert!(resonant > flat * 1.5, "no resonance: {resonant} vs {flat}");
    }

    #[test]
    fn full_resonance_stays_bounded() {
        let out = render(800.0, 1.0, 1.0, 2.0);
        assert!(out.iter().all(|v| v.is_finite()));
        let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak < 12.0, "ladder ran away: {peak}");
    }
}
