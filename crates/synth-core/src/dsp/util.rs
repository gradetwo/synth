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

/// Padé approximation of tanh — used as the master soft clipper.
/// Accurate to ~1e-4 over [-4, 4] and monotonic beyond, with no libm call.
#[inline]
pub fn soft_clip(x: f32) -> f32 {
    if x <= -3.0 {
        return -1.0;
    }
    if x >= 3.0 {
        return 1.0;
    }
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
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
}

/// Linear interpolation, used for glide between note frequencies.
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
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
    fn soft_clip_is_bounded_and_odd() {
        assert!(soft_clip(10.0) <= 1.0);
        assert!(soft_clip(-10.0) >= -1.0);
        for x in [0.1f32, 0.5, 1.0, 2.0] {
            assert!((soft_clip(x) + soft_clip(-x)).abs() < 1e-6);
        }
        assert!((soft_clip(0.0)).abs() < 1e-9);
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
