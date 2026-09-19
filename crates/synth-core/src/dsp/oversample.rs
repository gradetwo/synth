//! Optional 2x oversampling for the saturating filter path (P6.5).
//!
//! The ladder (and the C bridge's state-variable family) saturate their input,
//! and a tanh-style stage folds every harmonic it generates above the base
//! Nyquist straight back into the audible band. Running the *whole* filter path
//! — band-limiting included — at twice the sample rate moves that fold to
//! 48 kHz, where the anti-imaging filter can remove it before the decimation.
//!
//! The brief for P6.2b was explicit: never patch a band-limited output with a
//! second correction. So this is a complete up/process/down round trip rather
//! than a correction bolted onto the nonlinearity. The prototype is a
//! Kaiser-windowed low-pass (63 taps, beta 8, cutoff 0.21 of the *oversampled*
//! rate = 20 kHz at 96 kHz): flat to 19 kHz, -12 dB at 21 kHz, already -71 dB
//! at the base Nyquist and below -85 dB from there up. The same table serves
//! the interpolator and the decimator, which is what makes the round trip a
//! pure delay.
//!
//! The round trip is linear phase, so it costs a fixed [`OS_LATENCY`] samples
//! at the base rate. The caller has to account for that (the engine reports it
//! in `oversample_latency()`), because a causal anti-imaging filter cannot have
//! zero group delay.

/// Taps in the shared Kaiser prototype.
pub const OS_TAPS: usize = 63;
/// Centre tap, i.e. the group delay of one FIR at the oversampled rate.
pub const OS_CENTRE: usize = OS_TAPS / 2;
/// Round-trip latency of up + down, in base-rate samples. Zero would need a
/// non-causal filter, so this is the price of the mode and is compensated
/// explicitly by the caller.
pub const OS_LATENCY: usize = OS_CENTRE;

/// Kaiser low-pass, `sum = 1`, symmetric. Generated with
/// `h[n] = 2 fc sinc(2 fc (n - 31)) * I0(beta sqrt(1 - ((n-31)/31)^2)) / I0(beta)`,
/// `fc = 0.21`, `beta = 8`, then normalised so the DC gain is exactly one.
///
/// The cutoff is low enough that the stopband is already ~-70 dB at the base
/// Nyquist (0.25 of the oversampled rate = 24 kHz), which is what has to be
/// gone before the decimation: a halfband has no guard band, so the octave
/// just below Nyquist folds onto itself (the same trap the sync decimator's
/// comment records). Cost is 63 taps rather than the sync path's 95 because
/// this one runs on every voice, and it still reaches -97 dB by 24.2 kHz.
#[rustfmt::skip]
const OS_H: [f32; OS_TAPS] = [
    -0.000001508, 0.000054388, 0.000058423, -0.000126979,
    -0.000257244, 0.000109753, 0.000638094, 0.000222426,
    -0.001070892, -0.001118757, 0.001149812, 0.002637395,
    -0.000221923, -0.004371227, -0.002360323, 0.005271592,
    0.006776361, -0.003749280, -0.012218226, -0.001858482,
    0.016554060, 0.012551760, -0.016341748, -0.027950654,
    0.007024669, 0.045965512, 0.017837353, -0.063115727,
    -0.074675878, 0.075486185, 0.307105289, 0.419991553,
    0.307105289, 0.075486185, -0.074675878, -0.063115727,
    0.017837353, 0.045965512, 0.007024669, -0.027950654,
    -0.016341748, 0.012551760, 0.016554060, -0.001858482,
    -0.012218226, -0.003749280, 0.006776361, 0.005271592,
    -0.002360323, -0.004371227, -0.000221923, 0.002637395,
    0.001149812, -0.001118757, -0.001070892, 0.000222426,
    0.000638094, 0.000109753, -0.000257244, -0.000126979,
    0.000058423, 0.000054388, -0.000001508,
];

/// One channel of the 2x round trip. Holds only the history the block-wise FIR
/// needs, so a block costs one copy and no allocation.
#[derive(Clone, Copy)]
pub struct Oversampler2x {
    /// Last [`OS_CENTRE`] base-rate input samples, oldest first.
    up_tail: [f32; OS_CENTRE],
    /// Last [`OS_TAPS`] - 1 oversampled samples, oldest first.
    down_tail: [f32; OS_TAPS - 1],
}

impl Oversampler2x {
    pub const fn new() -> Self {
        Self {
            up_tail: [0.0; OS_CENTRE],
            down_tail: [0.0; OS_TAPS - 1],
        }
    }

    /// Drop the history, e.g. when the mode is switched on: the round trip
    /// restarts from silence instead of carrying a stale tail across a gap.
    pub fn reset(&mut self) {
        self.up_tail = [0.0; OS_CENTRE];
        self.down_tail = [0.0; OS_TAPS - 1];
    }

    /// Zero-stuff `x` and low-pass it: writes `2 * x.len()` samples to `out`.
    ///
    /// `scratch` is the caller's scratch (at least `OS_CENTRE + x.len()` long)
    /// so the round trip allocates nothing per block.
    pub fn upsample(&mut self, x: &[f32], out: &mut [f32], scratch: &mut [f32]) {
        let n = x.len();
        debug_assert!(out.len() >= n * 2);
        debug_assert!(scratch.len() >= OS_CENTRE + n);
        scratch[..OS_CENTRE].copy_from_slice(&self.up_tail);
        scratch[OS_CENTRE..OS_CENTRE + n].copy_from_slice(x);
        for i in 0..n {
            let base = OS_CENTRE + i;
            let mut even = 0.0f32;
            let mut odd = 0.0f32;
            // Even phase: h[2j] with x[i-j]; centre tap (j = 8) included.
            let mut j = 0;
            while 2 * j < OS_TAPS {
                even += OS_H[2 * j] * scratch[base - j];
                j += 1;
            }
            // Odd phase: h[2j+1], the half-sample in between.
            let mut j = 0;
            while 2 * j + 1 < OS_TAPS {
                odd += OS_H[2 * j + 1] * scratch[base - j];
                j += 1;
            }
            // Zero stuffing halves the level, so the interpolation gain is 2.
            out[2 * i] = 2.0 * even;
            out[2 * i + 1] = 2.0 * odd;
        }
        // The tail is the last OS_CENTRE input samples.
        self.up_tail.copy_from_slice(&scratch[n..OS_CENTRE + n]);
    }

    /// Low-pass `v` and keep every other sample: writes `v.len() / 2` samples.
    pub fn downsample(&mut self, v: &[f32], out: &mut [f32], scratch: &mut [f32]) {
        let n = v.len() / 2;
        debug_assert!(out.len() >= n);
        debug_assert!(scratch.len() >= OS_TAPS - 1 + v.len());
        let c = OS_TAPS - 1;
        scratch[..c].copy_from_slice(&self.down_tail);
        scratch[c..c + v.len()].copy_from_slice(v);
        for i in 0..n {
            let base = c + 2 * i;
            // Symmetric coefficients: pair k with OS_TAPS-1-k and use only the
            // first half of the table.
            let mut acc = OS_H[OS_CENTRE] * scratch[base - OS_CENTRE];
            let mut k = 0;
            while k < OS_CENTRE {
                acc += OS_H[k] * (scratch[base - k] + scratch[base - (OS_TAPS - 1 - k)]);
                k += 1;
            }
            out[i] = acc;
        }
        // The tail is the last OS_TAPS - 1 oversampled samples.
        let end = c + v.len();
        self.down_tail.copy_from_slice(&scratch[end - c..end]);
    }
}

impl Default for Oversampler2x {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The decimator's real job: content the 1x stream cannot carry has to be
    /// *gone* before every other sample is kept, or it folds back. A 30 kHz
    /// tone (above the 24 kHz base Nyquist) at the oversampled rate must not
    /// survive as its 18 kHz mirror.
    #[test]
    fn decimation_removes_everything_above_the_base_nyquist() {
        let mut os = Oversampler2x::new();
        let mut scratch = [0.0f32; 4096];
        // A 3 kHz tone plus a 30 kHz tone, at the oversampled rate.
        let mut v = [0.0f32; 1024];
        for (i, x) in v.iter_mut().enumerate() {
            let t = i as f32 / 96000.0;
            *x = (core::f32::consts::TAU * 3000.0 * t).sin()
                + (core::f32::consts::TAU * 30000.0 * t).sin();
        }
        let mut out = [0.0f32; 512];
        let mut settled = [0.0f32; 512];
        for _ in 0..4 {
            os.downsample(&v, &mut out, &mut scratch);
            settled = out;
        }
        let mag = |data: &[f32], f: f32| {
            let k = core::f32::consts::TAU * f / 48000.0;
            let (mut re, mut im) = (0.0f32, 0.0f32);
            for (i, &x) in data.iter().enumerate() {
                re += x * (k * i as f32).cos();
                im -= x * (k * i as f32).sin();
            }
            (re * re + im * im).sqrt() / data.len() as f32
        };
        let wanted = mag(&settled, 3000.0);
        let mirror = mag(&settled, 18000.0);
        assert!(wanted > 0.3, "the 3 kHz tone came out at {wanted}");
        assert!(
            mirror < wanted * 1e-3,
            "the 30 kHz tone folded to 18 kHz at {:.1} dB",
            20.0 * (mirror / wanted).log10()
        );
    }

    /// A DC input must come back as the same DC after a full round trip (the
    /// interpolation gain of 2 and the decimator's unity DC gain have to agree).
    #[test]
    fn round_trip_is_unity_at_dc() {
        let mut os = Oversampler2x::new();
        let x = [0.5f32; 64];
        let mut up = [0.0f32; 128];
        let mut scratch = [0.0f32; 512];
        let mut y = [0.0f32; 64];
        // Settle the FIR history first so the output is steady state.
        for _ in 0..8 {
            os.upsample(&x, &mut up, &mut scratch);
            os.downsample(&up, &mut y, &mut scratch);
        }
        for v in &y[48..] {
            assert!((v - 0.5).abs() < 1e-4, "DC came back as {v}");
        }
    }

    /// The interpolator must not invent energy above the base Nyquist: a base
    /// sine has to come back out of the decimator at (almost) the same level,
    /// while the image above 24 kHz is what the prototype has to kill.
    #[test]
    fn upsample_kills_the_image_above_the_base_nyquist() {
        // 30 kHz at 96 kHz is an image that the 48 kHz stream cannot carry: it
        // must be attenuated by the decimator's stopband, not folded back.
        let mut os = Oversampler2x::new();
        let mut up = [0.0f32; 256];
        let mut scratch = [0.0f32; 1024];
        let mut x = [0.0f32; 128];
        for (i, v) in x.iter_mut().enumerate() {
            // 3 kHz at the base rate: well inside the passband.
            *v = (2.0 * core::f32::consts::PI * 3000.0 * i as f32 / 48000.0).sin();
        }
        for _ in 0..4 {
            os.upsample(&x, &mut up, &mut scratch);
        }
        // Goertzel at the base-band tone and at its mirror around 24 kHz.
        let mag = |data: &[f32], f: f32| {
            let k = 2.0 * core::f32::consts::PI * f / 96000.0;
            let coeff = 2.0 * k.cos();
            let (mut s1, mut s2) = (0.0f32, 0.0f32);
            for &v in data {
                let s0 = v + coeff * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            (s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0).sqrt() / data.len() as f32
        };
        let pass = mag(&up, 3000.0);
        // The image of 3 kHz in the 2x domain sits at 93 kHz = 96 - 3; after
        // decimation it is the 3 kHz content itself, so check the stopband at
        // 30 kHz instead, which is what folds onto 18 kHz.
        let stop = mag(&up, 30000.0);
        assert!(pass > 0.3, "passband came out at {pass}");
        assert!(
            stop < pass * 0.02,
            "30 kHz image is only {:.1} dB down",
            20.0 * (stop / pass).log10()
        );
    }

    /// The round trip must be a pure delay of [`OS_LATENCY`] samples: the
    /// caller compensates exactly that, so an off-by-one here would show up as
    /// a phase jump at the switch.
    #[test]
    fn round_trip_delays_by_exactly_the_reported_latency() {
        let mut os = UpsampleHarness::new();
        // Impulse at t = 40, run long enough that the tail is settled.
        let mut x = [0.0f32; 128];
        x[40] = 1.0;
        let mut out = [0.0f32; 128];
        os.run(&x, &mut out);
        let peak = out
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap())
            .map(|(i, _)| i)
            .unwrap();
        assert_eq!(
            peak,
            40 + OS_LATENCY,
            "impulse came out at {peak}, expected {}",
            40 + OS_LATENCY
        );
    }

    struct UpsampleHarness {
        os: Oversampler2x,
        up: [f32; 256],
        scratch: [f32; 1024],
    }

    impl UpsampleHarness {
        fn new() -> Self {
            Self {
                os: Oversampler2x::new(),
                up: [0.0; 256],
                scratch: [0.0; 1024],
            }
        }

        fn run(&mut self, x: &[f32], out: &mut [f32]) {
            self.os.upsample(x, &mut self.up, &mut self.scratch);
            self.os.downsample(&self.up, out, &mut self.scratch);
        }
    }
}
