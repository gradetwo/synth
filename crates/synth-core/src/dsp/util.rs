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
