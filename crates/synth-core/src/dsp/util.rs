//! DSP helpers: pitch math, soft clipping and a small deterministic RNG.

/// Equal-tempered MIDI note (fractional allowed) to Hz. A4 = 440 Hz.
#[inline]
pub fn note_to_hz(note: f32) -> f32 {
    440.0 * exp2((note - 69.0) / 12.0)
}

/// Frequency multiplier for a detune/pitch offset in semitones.
#[inline]
pub fn semitone_ratio(semitones: f32) -> f32 {
    exp2(semitones / 12.0)
}

#[inline]
pub fn exp2(x: f32) -> f32 {
    // `f32::exp2` is a single instruction on wasm with libm-free std builds.
    x.exp2()
}

/// Soft limiter with a linear region.
///
/// `soft_clip` colours everything above ~0.3, which is audible on a loud
/// polyphonic bus; this one is bit-transparent below `KNEE` and only bends the
/// last few dB before the hard ceiling, so normal playing stays clean and
/// transients are caught without crackle.
#[inline]
pub fn soft_limit(x: f32) -> f32 {
    const KNEE: f32 = 0.82;
    let a = x.abs();
    if a <= KNEE {
        return x;
    }
    let over = (a - KNEE) / (1.0 - KNEE);
    let shaped = KNEE + (1.0 - KNEE) * (1.0 - (-over).exp());
    if shaped >= 1.0 {
        x.signum()
    } else {
        shaped.copysign(x)
    }
}

/// xorshift32 — allocation free, deterministic across runs.
#[derive(Clone, Copy, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub const fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 0x9e37_79b9 } else { seed },
        }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// Uniform in [-1, 1).
    #[inline]
    pub fn next_bipolar(&mut self) -> f32 {
        (self.next_u32() as f32 / u32::MAX as f32) * 2.0 - 1.0
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn next_unit(&mut self) -> f32 {
        self.next_u32() as f32 / u32::MAX as f32
    }
}

/// Linear interpolation, used for glide between note frequencies.
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// In-place iterative radix-2 complex transform (forward or inverse).
///
/// Shared by the two places that need a transform away from the render loop:
/// wavetable import analysis and convolution reverb. `f64` and a straightforward
/// implementation are fine there — it is not audio-rate code — and `n` must be a
/// power of two.
pub fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    if n < 2 {
        return;
    }

    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut half = 1usize;
    while half < n {
        let span = half * 2;
        let angle = core::f64::consts::TAU / span as f64 * if inverse { 1.0 } else { -1.0 };
        let (tw_re, tw_im) = (angle.cos(), angle.sin());
        let mut base = 0usize;
        while base < n {
            let (mut wr, mut wi) = (1.0f64, 0.0f64);
            for k in 0..half {
                let (ar, ai) = (re[base + k], im[base + k]);
                let (br, bi) = (re[base + k + half], im[base + k + half]);
                let (vr, vi) = (br * wr - bi * wi, br * wi + bi * wr);
                re[base + k] = ar + vr;
                im[base + k] = ai + vi;
                re[base + k + half] = ar - vr;
                im[base + k + half] = ai - vi;
                let next_wr = wr * tw_re - wi * tw_im;
                wi = wr * tw_im + wi * tw_re;
                wr = next_wr;
            }
            base += span;
        }
        half = span;
    }

    if inverse {
        let scale = 1.0 / n as f64;
        for value in re.iter_mut() {
            *value *= scale;
        }
        for value in im.iter_mut() {
            *value *= scale;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_to_hz_matches_concert_pitch() {
        assert!((note_to_hz(69.0) - 440.0).abs() < 1e-3);
        assert!((note_to_hz(60.0) - 261.6256).abs() < 1e-2);
        assert!((note_to_hz(81.0) - 880.0).abs() < 1e-2);
    }

    #[test]
    fn soft_limit_is_transparent_then_bounded() {
        // Bit-transparent inside the linear region…
        for x in [0.0f32, 0.1, 0.5, 0.82, -0.7] {
            assert_eq!(soft_limit(x), x);
        }
        // …then compresses smoothly, monotonically, and never exceeds unity.
        assert!(soft_limit(0.9) > 0.82 && soft_limit(0.9) < 0.9);
        assert!(soft_limit(0.9) < soft_limit(0.95));
        assert!(soft_limit(0.95) < soft_limit(1.0));
        assert!(soft_limit(1.0) < soft_limit(2.0));
        assert!(soft_limit(10.0) <= 1.0 && soft_limit(-10.0) >= -1.0);
        assert!(soft_limit(f32::INFINITY) <= 1.0);
        for x in [0.9f32, 1.2, 3.0, 1e6] {
            assert!((soft_limit(x) + soft_limit(-x)).abs() < 1e-6);
        }
    }

    #[test]
    fn the_shared_fft_round_trips() {
        let mut re: Vec<f64> = (0..256).map(|i| ((i * 37) % 11) as f64 - 5.0).collect();
        let im = vec![0.0f64; 256];
        let original = re.clone();
        let mut spectrum_im = im.clone();
        fft(&mut re, &mut spectrum_im, false);
        // A DC-heavy real signal must land in bin 0 and its mirror.
        assert!(re[0].abs() > 1.0);
        fft(&mut re, &mut spectrum_im, true);
        for (a, b) in re.iter().zip(original.iter()) {
            assert!((a - b).abs() < 1e-9, "round trip changed the signal");
        }
    }

    #[test]
    fn the_shared_fft_puts_a_sine_in_one_bin() {
        // 32 cycles across 256 samples: bins 32 and 224, nothing else.
        let mut re: Vec<f64> = (0..256)
            .map(|i| (core::f64::consts::TAU * 32.0 * i as f64 / 256.0).sin())
            .collect();
        let mut im = vec![0.0f64; 256];
        fft(&mut re, &mut im, false);
        for bin in 1..128 {
            let power = re[bin].hypot(im[bin]);
            if bin == 32 {
                assert!(power > 100.0, "the sine's own bin is empty");
            } else {
                assert!(power < 1e-6, "energy leaked into bin {bin}");
            }
        }
    }

    #[test]
    fn rng_is_deterministic_and_bipolar() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..64 {
            let x = a.next_bipolar();
            assert_eq!(x, b.next_bipolar());
            assert!((-1.0..1.0).contains(&x));
        }
    }
}
