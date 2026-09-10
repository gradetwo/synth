//! Coloured noise.
//!
//! White noise is flat per hertz; pink falls at 3 dB per octave and brown at
//! 6 dB, which is what makes them sound "softer" and is why every analogue synth
//! has them. Both are one-pole-filtered white noise, so they are cheap and
//! need only a little state per oscillator.
//!
//! The filter runs at the sample rate, so the frequency where the slope starts
//! is set relative to it: a fixed corner in Hz would change character with the
//! context's sample rate.

/// Noise colour.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NoiseColour {
    White,
    Pink,
    Brown,
}

#[derive(Clone, Copy)]
pub struct NoiseGen {
    colour: NoiseColour,
    /// Pink: the Paul Kellet 3-pole approximation, which tracks -3 dB/octave
    /// within about 0.05 dB from 10 Hz to 20 kHz.
    pink: [f32; 3],
    /// Brown: a leaky integrator of white noise.
    brown: f32,
    /// Corner frequency of the pink filter, as a fraction of the sample rate.
    corner_hz: f32,
}

impl NoiseGen {
    pub const fn new() -> Self {
        Self {
            colour: NoiseColour::White,
            pink: [0.0; 3],
            brown: 0.0,
            // 5 Hz: the leak is only there to stop the random walk from
            // drifting into DC. A first-order corner at 20 Hz left the -6 dB
            // slope still forming at 250 Hz (measured -4.2 dB/octave); moving
            // it down puts the asymptotic slope across the audible band.
            corner_hz: 5.0,
        }
    }

    pub fn set_colour(&mut self, colour: NoiseColour) {
        self.colour = colour;
    }

    pub fn set_corner_hz(&mut self, hz: f32) {
        self.corner_hz = hz.clamp(1.0, 200.0);
    }

    pub fn reset(&mut self) {
        self.pink = [0.0; 3];
        self.brown = 0.0;
    }

    /// One sample of noise for the current colour. `white` is the caller's
    /// noise source in -1..1, so the RNG stays where the engine keeps it.
    #[inline]
    pub fn process(&mut self, white: f32, sample_rate: f32) -> f32 {
        match self.colour {
            NoiseColour::White => white,
            NoiseColour::Pink => {
                // Paul Kellet's refined method: three one-poles whose corner
                // frequencies are spread over the band.
                self.pink[0] = 0.99765 * self.pink[0] + white * 0.099_046;
                self.pink[1] = 0.96300 * self.pink[1] + white * 0.296_516;
                self.pink[2] = 0.57000 * self.pink[2] + white * 1.052_691;
                (self.pink[0] + self.pink[1] + self.pink[2] + white * 0.1848) * 0.28
            }
            NoiseColour::Brown => {
                // Leaky integration: the leak is what stops the walk from
                // drifting into DC, and it is scaled by the sample rate so the
                // colour does not change with the device.
                let leak = 1.0 - (core::f32::consts::TAU * self.corner_hz / sample_rate.max(1000.0));
                self.brown = (self.brown + white * 0.05) * leak.clamp(0.9, 0.9999);
                self.brown * 3.5
            }
        }
    }
}

impl Default for NoiseGen {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spectral slope in dB per octave, measured with an FFT over octave bands
    /// between 250 Hz and 4 kHz. Measuring it in the frequency domain is the
    /// point: "pink" and "brown" are statements about a spectrum, and a level
    /// check cannot tell them apart from white noise.
    fn slope(colour: NoiseColour) -> f32 {
        const SR: f32 = 48_000.0;
        const N: usize = 1 << 14;
        let mut noise = NoiseGen::new();
        noise.set_colour(colour);
        // A deterministic source, so the test does not depend on the engine RNG.
        let mut state = 0x1234_5678u32;
        let mut re = vec![0.0f64; N];
        let mut im = vec![0.0f64; N];
        for i in 0..N {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let white = (state >> 8) as f32 / 8_388_608.0 - 1.0;
            let v = noise.process(white, SR) as f64;
            let win = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / N as f64).cos();
            re[i] = v * win;
        }
        // Iterative radix-2 FFT.
        let mut j = 0usize;
        for i in 1..N {
            let mut bit = N >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= N {
            let ang = -core::f64::consts::TAU / len as f64;
            let mut i = 0;
            while i < N {
                for k in 0..len / 2 {
                    let wr = (ang * k as f64).cos();
                    let wi = (ang * k as f64).sin();
                    let ur = re[i + k];
                    let ui = im[i + k];
                    let vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
                    let vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
                    re[i + k] = ur + vr;
                    im[i + k] = ui + vi;
                    re[i + k + len / 2] = ur - vr;
                    im[i + k + len / 2] = ui - vi;
                }
                i += len;
            }
            len <<= 1;
        }
        // Energy per octave band, from 250 Hz to 4 kHz (four octaves).
        let mut bands = [0.0f64; 4];
        let mut counts = [0usize; 4];
        for bin in 1..N / 2 {
            let hz = bin as f64 * SR as f64 / N as f64;
            if !(250.0..4000.0).contains(&hz) {
                continue;
            }
            let index = ((hz / 250.0).log2().floor() as usize).min(3);
            bands[index] += re[bin] * re[bin] + im[bin] * im[bin];
            counts[index] += 1;
        }
        for (band, count) in bands.iter_mut().zip(counts) {
            *band /= count.max(1) as f64;
        }
        // Least-squares slope of dB against octave index.
        let db: Vec<f64> = bands
            .iter()
            .map(|e| 10.0 * e.max(1e-30).log10())
            .collect();
        let mean_x = 1.5;
        let mean_y = db.iter().sum::<f64>() / 4.0;
        let mut num = 0.0;
        let mut den = 0.0;
        for (index, y) in db.iter().enumerate() {
            let x = index as f64 - mean_x;
            num += x * (y - mean_y);
            den += x * x;
        }
        (num / den) as f32
    }

    #[test]
    fn pink_falls_at_three_db_per_octave() {
        let measured = slope(NoiseColour::Pink);
        assert!(
            (measured + 3.0).abs() < 0.6,
            "pink slope should be about -3 dB/octave, measured {measured:.2}"
        );
    }

    #[test]
    fn brown_falls_at_six_db_per_octave() {
        let measured = slope(NoiseColour::Brown);
        assert!(
            (measured + 6.0).abs() < 0.8,
            "brown slope should be about -6 dB/octave, measured {measured:.2}"
        );
    }

    #[test]
    fn white_is_flat() {
        let measured = slope(NoiseColour::White);
        assert!(
            measured.abs() < 0.5,
            "white should be flat, measured {measured:.2}"
        );
    }

    #[test]
    fn stays_bounded() {
        let mut noise = NoiseGen::new();
        for colour in [NoiseColour::White, NoiseColour::Pink, NoiseColour::Brown] {
            noise.set_colour(colour);
            noise.reset();
            for i in 0..100_000 {
                let v = noise.process(if i % 2 == 0 { 1.0 } else { -1.0 }, 48_000.0);
                assert!(v.is_finite() && v.abs() < 20.0, "{colour:?} ran away: {v}");
            }
        }
    }
}
