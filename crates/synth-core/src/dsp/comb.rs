//! Feedback comb filter — the synth's "resonator" filter type.
//!
//! A short delay fed back on itself with damping: tune the delay to the cutoff
//! (i.e. one wavelength per delay) and it rings at that pitch, which is what
//! gives plucked, metallic and robot-voice tones their character. The buffer is
//! allocated once when the sample rate is set, never in the render loop.

/// Lowest comb frequency we allow, which sets the buffer size: at 96 kHz a
/// 30 Hz comb needs 3200 samples.
pub const MIN_FREQ_HZ: f32 = 30.0;
pub const MAX_SR: f32 = 96_000.0;
pub const MAX_LEN: usize = (MAX_SR / MIN_FREQ_HZ) as usize + 4;

pub struct CombFilter {
    buf: Vec<f32>,
    len: usize,
    index: usize,
    /// One-pole damping in the feedback path (keeps the ring from turning into
    /// a buzz at high feedback).
    damp_state: f32,
    damp: f32,
    feedback: f32,
    dc: f32,
}

impl CombFilter {
    pub const fn new() -> Self {
        Self {
            buf: Vec::new(),
            len: 1,
            index: 0,
            damp_state: 0.0,
            damp: 0.3,
            feedback: 0.7,
            dc: 0.0,
        }
    }

    /// Allocate the delay line for `sample_rate`. Called from `Engine::init`.
    pub fn prepare(&mut self, sample_rate: f32) {
        let max = ((sample_rate.min(MAX_SR) / MIN_FREQ_HZ) as usize + 4).min(MAX_LEN);
        if self.buf.len() < max {
            self.buf = vec![0.0; max];
        }
        self.len = 1;
        self.index = 0;
        self.buf.fill(0.0);
        self.damp_state = 0.0;
        self.dc = 0.0;
    }

    pub fn reset(&mut self) {
        let len = self.buf.len();
        self.buf[..len].fill(0.0);
        self.index = 0;
        self.damp_state = 0.0;
        self.dc = 0.0;
    }

    /// `freq` is the comb pitch in Hz, `res` (0..1) the feedback amount.
    pub fn set(&mut self, sample_rate: f32, freq: f32, res: f32) {
        let sr = sample_rate.max(1000.0);
        let f = freq.clamp(MIN_FREQ_HZ, sr * 0.45);
        let len = (sr / f).round() as usize;
        self.len = len.clamp(2, self.buf.len().max(2));
        // 0.98 is the stability limit for a plain comb; damping keeps it below.
        self.feedback = (res.clamp(0.0, 1.0) * 0.96).min(0.96);
        self.damp = 0.15 + res.clamp(0.0, 1.0) * 0.5;
    }

    pub fn feedback_for_debug(&self) -> f32 {
        self.feedback
    }

    pub fn damp_for_debug(&self) -> f32 {
        self.damp
    }

    pub fn index_for_debug(&self) -> usize {
        self.index
    }

    pub fn len_for_debug(&self) -> usize {
        self.len
    }

    pub fn buf_len_for_debug(&self) -> usize {
        self.buf.len()
    }

    #[inline]
    pub fn process(&mut self, input: &[f32], out: &mut [f32]) {
        let len = self.len.max(2);
        for (i, sample) in input.iter().enumerate() {
            let delayed = self.buf[self.index];
            // Damped feedback: one-pole low-pass in the loop.
            self.damp_state = delayed * (1.0 - self.damp) + self.damp_state * self.damp;
            // Slight DC blocking on the way in: a comb has unity gain at DC, so
            // without this a patch with a DC offset would walk the loop up.
            self.dc += (*sample - self.dc) * 0.0005;
            let x = *sample - self.dc;
            self.buf[self.index] = x + self.damp_state * self.feedback;
            self.index += 1;
            if self.index >= len {
                self.index = 0;
            }
            out[i] = delayed;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed a short tone burst and measure what is left 0.7 s later: a comb
    /// tuned to that frequency sustains it, a detuned one does not.
    fn tail_after_burst(comb_freq: f32, tone_freq: f32) -> f32 {
        let sr = 48_000.0;
        let mut comb = CombFilter::new();
        comb.prepare(sr);
        comb.set(sr, comb_freq, 0.95);
        let n = 48_000;
        let mut input = vec![0.0f32; n];
        // 0.3 s of tone, then silence.
        for (i, sample) in input.iter_mut().take(14_400).enumerate() {
            *sample = (core::f32::consts::TAU * tone_freq * i as f32 / sr).sin() * 0.5;
        }
        let mut out = vec![0.0f32; n];
        comb.process(&input, &mut out);
        assert!(out.iter().all(|v| v.is_finite()), "comb produced non-finite output");
        // 0.45–0.55 s: a few dozen round trips after the burst ended, where a
        // tuned comb is clearly still ringing.
        let tail = &out[21_600..26_400];
        (tail.iter().map(|v| v * v).sum::<f32>() / tail.len() as f32).sqrt()
    }

    #[test]
    fn rings_at_its_tuned_frequency() {
        let tuned = tail_after_burst(200.0, 200.0);
        let detuned = tail_after_burst(200.0, 311.0);
        assert!(tuned > 0.02, "comb did not ring at all: {tuned}");
        assert!(
            tuned > detuned * 3.0,
            "comb did not favour its tuned frequency: {tuned} vs {detuned}"
        );
    }

    #[test]
    fn stays_bounded_at_full_feedback() {
        let sr = 44_100.0;
        let mut comb = CombFilter::new();
        comb.prepare(sr);
        comb.set(sr, MIN_FREQ_HZ, 1.0);
        let input = vec![0.5f32; 44_100];
        let mut out = vec![0.0f32; input.len()];
        comb.process(&input, &mut out);
        assert!(out.iter().all(|v| v.is_finite() && v.abs() < 8.0));
    }
}

#[cfg(test)]
mod noise_tests {
    use super::*;

    #[test]
    fn noise_becomes_periodic() {
        let sr = 48_000.0;
        let mut comb = CombFilter::new();
        comb.prepare(sr);
        comb.set(sr, 200.0, 0.9);
        // Deterministic white noise.
        let mut state = 0x1234_5678u32;
        let n = 24_000;
        let input: Vec<f32> = (0..n)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state as f32 / u32::MAX as f32) * 2.0 - 1.0
            })
            .collect();
        // Drive it the way the engine does: 128-sample blocks with the state
        // carried between calls.
        let mut out = vec![0.0f32; n];
        for start in (0..n).step_by(128) {
            let end = (start + 128).min(n);
            let (inp, oup) = (&input[start..end], &mut out[start..end]);
            comb.process(inp, oup);
        }
        let lag = 240;
        let mut num = 0.0f64;
        let mut den = 0.0f64;
        for i in 0..n - lag {
            num += (out[i] as f64) * (out[i + lag] as f64);
        }
        for v in out.iter() {
            den += (*v as f64) * (*v as f64);
        }
        let r = num / den.max(1e-12);
        // Input correlation for reference.
        let mut num_in = 0.0f64;
        let mut den_in = 0.0f64;
        for i in 0..n - lag {
            num_in += (input[i] as f64) * (input[i + lag] as f64);
        }
        for v in input.iter() {
            den_in += (*v as f64) * (*v as f64);
        }
        // The input is white noise (no correlation at this lag) while the comb
        // output is periodic.
        assert!(num_in / den_in < 0.1, "test input was not white noise");
        assert!(r > 0.3, "comb did not make the noise periodic: {r}");
        assert!(out.iter().all(|v| v.is_finite()));
    }
}
