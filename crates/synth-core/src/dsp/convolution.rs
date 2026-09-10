//! Impulse-response reverb: uniform partitioned convolution (A5).
//!
//! Convolving a signal with a recorded impulse response is the only way to get
//! *that* room, and it is the second engine behind the reverb section — the
//! algorithmic reverb is still there for the cases where an IR is not the point
//! (it is cheaper, and its size/damping controls are what a patch usually wants).
//!
//! Straight time-domain convolution with a two-second IR would be ~96 000
//! multiply-accumulates per sample per channel, which no render quantum can
//! afford. Instead the IR is split into **partitions** of [`HOP`] samples, each
//! partition is transformed once when the IR is loaded, and every hop the input
//! block is transformed and multiplied by the partitions in the frequency
//! domain (an [overlap-save](https://en.wikipedia.org/wiki/Overlap%E2%80%93save_method)
//! scheme with a frequency-domain delay line of input spectra). The cost falls
//! from O(IR) per sample to O(log HOP) plus a handful of complex multiplies.
//!
//! Two consequences worth stating out loud, because they are audible:
//!
//! * The wet signal is delayed by [`HOP`] samples (~21 ms at 48 kHz). A reverb
//!   tail arriving 21 ms late is a pre-delay, not a smear, and the dry path is
//!   untouched, so nothing combs.
//! * The whole hop's work happens once per [`HOP`] samples rather than being
//!   spread evenly. At 48 kHz that is a ~1 ms spike every 21 ms, which the load
//!   monitor tolerates by design (it acts on sustained cost, not one block).
//!
//! The IR is normalised to **unit energy**, so an IR recorded quietly and one
//! recorded hot produce the same wet level and the mix knob means the same
//! thing either way.

use crate::dsp::util::fft;

/// Samples per partition (and the wet path's latency).
pub const HOP: usize = 1024;
/// Transform size: one hop of history plus one hop of new input.
pub const FFT_SIZE: usize = HOP * 2;
const BINS: usize = FFT_SIZE / 2 + 1;
/// Longest IR the engine will hold: [`MAX_PARTITIONS`] × [`HOP`] samples, i.e.
/// 2.05 s at 48 kHz. It is a memory ceiling as much as a musical one.
pub const MAX_PARTITIONS: usize = 96;
pub const MAX_IR_SAMPLES: usize = MAX_PARTITIONS * HOP;
/// Shortest IR that is worth convolving; below this it is a click, not a space.
pub const MIN_IR_SAMPLES: usize = 32;

/// Why an impulse response was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IrError {
    /// Shorter than [`MIN_IR_SAMPLES`].
    TooShort,
    /// Contains NaN or infinity.
    NotFinite,
    /// Nothing left after DC removal.
    Silent,
}

pub struct Convolver {
    /// Working set. Allocated once by [`Convolver::prepare`] (from the shared
    /// arena on wasm) — the transform of a two-second IR is not something to
    /// keep on the stack, and the render loop must never allocate.
    /// IR partition spectra, laid out partition by partition.
    ir_re: Vec<f32>,
    ir_im: Vec<f32>,
    /// Frequency-domain delay line: the last `partitions` input spectra.
    fdl_re: Vec<f32>,
    fdl_im: Vec<f32>,
    /// Sliding input: the previous hop, then the hop being filled.
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    /// Wet signal for the hop that just finished, emitted over the next hop.
    out_l: Vec<f32>,
    out_r: Vec<f32>,
    /// DC-removed copy of the response being analysed.
    scratch: Vec<f32>,
    /// Transform scratch.
    re: Vec<f64>,
    im: Vec<f64>,
    acc_re: Vec<f64>,
    acc_im: Vec<f64>,
    fdl_pos: usize,
    partitions: usize,
    fill: usize,
    emitted: usize,
    /// Unit-energy normalisation of the loaded IR.
    normalisation: f32,
    ready: bool,
}

impl Convolver {
    pub const fn new() -> Self {
        Self {
            ir_re: Vec::new(),
            ir_im: Vec::new(),
            fdl_re: Vec::new(),
            fdl_im: Vec::new(),
            in_l: Vec::new(),
            in_r: Vec::new(),
            out_l: Vec::new(),
            out_r: Vec::new(),
            scratch: Vec::new(),
            re: Vec::new(),
            im: Vec::new(),
            acc_re: Vec::new(),
            acc_im: Vec::new(),
            fdl_pos: 0,
            partitions: 0,
            fill: 0,
            emitted: HOP,
            normalisation: 1.0,
            ready: false,
        }
    }

    /// Allocate the working set. Idempotent, and called from `Engine::init` so
    /// the memory is reserved before any audio runs.
    pub fn prepare(&mut self) {
        if self.ir_re.len() == MAX_PARTITIONS * BINS {
            return;
        }
        self.ir_re = vec![0.0; MAX_PARTITIONS * BINS];
        self.ir_im = vec![0.0; MAX_PARTITIONS * BINS];
        self.fdl_re = vec![0.0; MAX_PARTITIONS * BINS];
        self.fdl_im = vec![0.0; MAX_PARTITIONS * BINS];
        self.in_l = vec![0.0; FFT_SIZE];
        self.in_r = vec![0.0; FFT_SIZE];
        self.out_l = vec![0.0; HOP];
        self.out_r = vec![0.0; HOP];
        self.scratch = vec![0.0; MAX_IR_SAMPLES];
        self.re = vec![0.0; FFT_SIZE];
        self.im = vec![0.0; FFT_SIZE];
        self.acc_re = vec![0.0; BINS];
        self.acc_im = vec![0.0; BINS];
    }

    /// Longest IR the loaded impulse response can be, in samples.
    pub fn max_ir_samples() -> usize {
        MAX_IR_SAMPLES
    }

    /// Analyse an impulse response. Called from the message path, never from
    /// `process`.
    pub fn set_ir(&mut self, ir: &[f32]) -> Result<(), IrError> {
        if ir.len() < MIN_IR_SAMPLES {
            return Err(IrError::TooShort);
        }
        if ir.iter().any(|v| !v.is_finite()) {
            return Err(IrError::NotFinite);
        }
        self.prepare();
        let len = ir.len().min(MAX_IR_SAMPLES);
        let mean = ir[..len].iter().map(|v| *v as f64).sum::<f64>() / len as f64;
        for (i, value) in ir[..len].iter().enumerate() {
            self.scratch[i] = *value - mean as f32;
        }
        let energy: f64 = self.scratch[..len].iter().map(|v| (*v as f64) * (*v as f64)).sum();
        if energy <= 1e-12 {
            return Err(IrError::Silent);
        }
        // Unit energy: convolving with noise then measures roughly unity gain, so
        // a quiet IR and a loud IR land at the same wet level.
        self.normalisation = (1.0 / energy.sqrt()) as f32;

        self.partitions = len.div_ceil(HOP).min(MAX_PARTITIONS);
        for partition in 0..self.partitions {
            self.re.fill(0.0);
            self.im.fill(0.0);
            let start = partition * HOP;
            let count = HOP.min(len - start);
            for i in 0..count {
                self.re[i] = self.scratch[start + i] as f64;
            }
            fft(&mut self.re, &mut self.im, false);
            let base = partition * BINS;
            for bin in 0..BINS {
                self.ir_re[base + bin] = self.re[bin] as f32;
                self.ir_im[base + bin] = self.im[bin] as f32;
            }
        }
        self.fdl_re[..self.partitions * BINS].fill(0.0);
        self.fdl_im[..self.partitions * BINS].fill(0.0);
        self.fdl_pos = 0;
        self.ready = true;
        self.reset();
        Ok(())
    }

    /// Forget the impulse response: the convolver becomes a silent tap.
    pub fn clear(&mut self) {
        self.partitions = 0;
        self.ready = false;
        self.reset();
    }

    pub fn has_ir(&self) -> bool {
        self.ready && self.partitions > 0
    }

    /// Number of partitions currently in use (for diagnostics and tests).
    pub fn partitions(&self) -> usize {
        self.partitions
    }

    /// Unit-energy gain applied to the wet signal.
    pub fn normalisation(&self) -> f32 {
        self.normalisation
    }

    pub fn reset(&mut self) {
        if self.in_l.is_empty() {
            return;
        }
        self.in_l.fill(0.0);
        self.in_r.fill(0.0);
        self.fill = 0;
        self.out_l.fill(0.0);
        self.out_r.fill(0.0);
        self.emitted = HOP;
        self.fdl_re.fill(0.0);
        self.fdl_im.fill(0.0);
        self.fdl_pos = 0;
    }

    /// Add `mix` of the convolution to `left`/`right`, in place.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32], frames: usize, mix: f32) {
        if !self.ready || self.partitions == 0 || frames == 0 || mix <= 0.0 {
            // Still advance the line so switching the reverb on mid-note does not
            // replay the last hop of dry signal as a burst of tail.
            if self.ready {
                self.skip(left, right, frames);
            }
            return;
        }
        let wet_gain = self.normalisation * mix;
        for i in 0..frames {
            let dry_l = left[i];
            let dry_r = right[i];

            let wet_l = if self.emitted < HOP { self.out_l[self.emitted] } else { 0.0 };
            let wet_r = if self.emitted < HOP { self.out_r[self.emitted] } else { 0.0 };
            self.emitted += 1;

            self.in_l[HOP + self.fill] = dry_l;
            self.in_r[HOP + self.fill] = dry_r;
            self.fill += 1;

            if self.fill == HOP {
                self.run_hop();
                self.fill = 0;
                self.emitted = 0;
                self.in_l.copy_within(HOP..FFT_SIZE, 0);
                self.in_r.copy_within(HOP..FFT_SIZE, 0);
            }

            left[i] = dry_l + wet_l * wet_gain;
            right[i] = dry_r + wet_r * wet_gain;
        }
    }

    /// Advance the input line while the effect is bypassed.
    fn skip(&mut self, left: &[f32], right: &[f32], frames: usize) {
        for i in 0..frames {
            self.in_l[HOP + self.fill] = left[i];
            self.in_r[HOP + self.fill] = right[i];
            self.fill += 1;
            if self.fill == HOP {
                self.run_hop();
                self.fill = 0;
                self.emitted = 0;
                self.in_l.copy_within(HOP..FFT_SIZE, 0);
                self.in_r.copy_within(HOP..FFT_SIZE, 0);
            }
        }
    }

    /// Transform the block that just filled, accumulate the partitions and
    /// produce the next hop of wet signal.
    fn run_hop(&mut self) {
        let last = self.fdl_pos;
        for channel in 0..2 {
            self.re.fill(0.0);
            self.im.fill(0.0);
            let input = if channel == 0 { &self.in_l } else { &self.in_r };
            for i in 0..FFT_SIZE {
                self.re[i] = input[i] as f64;
            }
            fft(&mut self.re, &mut self.im, false);
            let base = last * BINS;
            for bin in 0..BINS {
                self.fdl_re[base + bin] = self.re[bin] as f32;
                self.fdl_im[base + bin] = self.im[bin] as f32;
            }

            // Σ h_i · x_{n-i}: the newest spectrum against the first partition,
            // walking backwards through the delay line.
            self.acc_re.fill(0.0);
            self.acc_im.fill(0.0);
            let mut index = last;
            for partition in 0..self.partitions {
                let ir_base = partition * BINS;
                let x_base = index * BINS;
                for bin in 0..BINS {
                    let (hr, hi) = (self.ir_re[ir_base + bin] as f64, self.ir_im[ir_base + bin] as f64);
                    let (xr, xi) = (self.fdl_re[x_base + bin] as f64, self.fdl_im[x_base + bin] as f64);
                    self.acc_re[bin] += hr * xr - hi * xi;
                    self.acc_im[bin] += hr * xi + hi * xr;
                }
                index = if index == 0 { self.partitions - 1 } else { index - 1 };
            }

            // Back to the time domain: with a 2-hop transform and a 1-hop filter
            // the valid part of the circular convolution is the second half.
            self.re.fill(0.0);
            self.im.fill(0.0);
            for bin in 0..BINS {
                self.re[bin] = self.acc_re[bin];
                self.im[bin] = self.acc_im[bin];
                if bin > 0 && bin < FFT_SIZE - bin {
                    self.re[FFT_SIZE - bin] = self.acc_re[bin];
                    self.im[FFT_SIZE - bin] = -self.acc_im[bin];
                }
            }
            fft(&mut self.re, &mut self.im, true);
            let out = if channel == 0 { &mut self.out_l } else { &mut self.out_r };
            for i in 0..HOP {
                out[i] = self.re[HOP + i] as f32;
            }
        }
        self.fdl_pos = (last + 1) % self.partitions.max(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::util::Rng;

    fn noise(len: usize, seed: u32) -> Vec<f32> {
        let mut rng = Rng::new(seed);
        (0..len).map(|_| rng.next_bipolar() * 0.5).collect()
    }

    /// Straight time-domain convolution, as the reference the fast path has to
    /// agree with.
    fn direct_fir(input: &[f32], ir: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0f32; input.len() + ir.len()];
        for (i, x) in input.iter().enumerate() {
            for (j, h) in ir.iter().enumerate() {
                out[i + j] += x * h;
            }
        }
        out
    }

    /// Run `input` through the convolver and return the wet signal alone, with
    /// the hop of latency taken out.
    fn wet_of(convolver: &mut Convolver, input: &[f32]) -> Vec<f32> {
        let mut left = input.to_vec();
        let mut right = input.to_vec();
        let frames = 512;
        for chunk in 0..input.len().div_ceil(frames) {
            let start = chunk * frames;
            let end = (start + frames).min(input.len());
            convolver.process(&mut left[start..end], &mut right[start..end], end - start, 1.0);
        }
        left.iter()
            .zip(input.iter())
            .map(|(wet, dry)| wet - dry)
            .collect()
    }

    #[test]
    fn an_impulse_ir_delays_the_wet_signal_by_one_hop() {
        let mut convolver = Convolver::new();
        let mut ir = vec![0.0f32; HOP];
        ir[0] = 1.0;
        convolver.set_ir(&ir).expect("impulse IR");
        assert_eq!(convolver.partitions(), 1);
        // Unit energy: a single 1.0 tap normalises to 1.0 (the DC removal that
        // stops a response with an offset from integrating moves it by a hair).
        assert!((convolver.normalisation() - 1.0).abs() < 1e-2);
        let gain = convolver.normalisation();

        let input = noise(4096, 7);
        let wet = wet_of(&mut convolver, &input);
        // Correlate the tail against the input one hop earlier: a single-tap IR
        // makes the convolver a (scaled) delay line and nothing else.
        let (mut dot, mut wet_energy, mut input_energy) = (0.0f64, 0.0f64, 0.0f64);
        for i in 2 * HOP..input.len() {
            let a = wet[i] as f64;
            let b = input[i - HOP] as f64 * gain as f64;
            dot += a * b;
            wet_energy += a * a;
            input_energy += b * b;
        }
        let correlation = dot / (wet_energy.sqrt() * input_energy.sqrt()).max(1e-12);
        assert!(correlation > 0.99, "an impulse IR should be a delay line: r = {correlation}");
    }

    /// The fast path has to be a convolution, exactly: same result as the direct
    /// sum, sample for sample, for an IR spanning several partitions.
    #[test]
    fn a_multi_partition_ir_matches_a_direct_convolution() {
        let mut convolver = Convolver::new();
        let ir = noise(HOP * 3 + 37, 11);
        convolver.set_ir(&ir).expect("noise IR");
        assert_eq!(convolver.partitions(), 4);
        let gain = convolver.normalisation();
        assert!(gain > 0.0);

        let input = noise(12_000, 23);
        let wet = wet_of(&mut convolver, &input);
        let scaled_ir: Vec<f32> = ir.iter().map(|h| h * gain).collect();
        let reference = direct_fir(&input, &scaled_ir);

        // Ignore the first hop (the line is still filling) and compare the rest.
        let mut worst = 0.0f32;
        for i in HOP..input.len() {
            let expected = if i - HOP < reference.len() { reference[i - HOP] } else { 0.0 };
            worst = worst.max((wet[i] - expected).abs());
        }
        assert!(worst < 2e-3, "partitioned convolution differs from the direct sum by {worst}");
    }

    /// Frequency domain: an IR that rings at one frequency has to leave its mark
    /// there and nowhere else, which is the whole point of loading an IR.
    #[test]
    fn a_resonant_ir_shapes_the_wet_spectrum() {
        let mut convolver = Convolver::new();
        let ring = 3000.0f32;
        let ir: Vec<f32> = (0..8000)
            .map(|i| {
                let t = i as f32 / 48_000.0;
                (core::f32::consts::TAU * ring * t).sin() * (-t * 4.0).exp()
            })
            .collect();
        // A sine IR is a resonator: the wet output of a noise burst must be
        // dominated by that frequency.
        convolver.set_ir(&ir).expect("resonant IR");

        let input = noise(24_000, 5);
        let wet = wet_of(&mut convolver, &input);
        let magnitude = |freq: f32, from: usize, to: usize| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, value) in wet[from..to].iter().enumerate() {
                let phase = core::f64::consts::TAU * freq as f64 * i as f64 / 48_000.0;
                re += *value as f64 * phase.cos();
                im -= *value as f64 * phase.sin();
            }
            (re * re + im * im).sqrt() / (to - from) as f64
        };
        let at_ring = magnitude(ring, 10_000, 12_000);
        let away = magnitude(ring * 3.0, 10_000, 12_000);
        assert!(
            at_ring > away * 20.0,
            "the IR's frequency should dominate the tail: {at_ring} vs {away}"
        );
    }

    /// Level consistency: two IRs with wildly different raw levels must reach the
    /// same wet level, or the mix knob would mean something different per file.
    #[test]
    fn unit_energy_normalisation_evens_out_ir_levels() {
        let tail_rms = |ir: &[f32]| {
            let mut convolver = Convolver::new();
            convolver.set_ir(ir).expect("IR");
            let input = noise(24_000, 3);
            let wet = wet_of(&mut convolver, &input);
            let slice = &wet[4096..20_000];
            (slice.iter().map(|v| v * v).sum::<f32>() / slice.len() as f32).sqrt()
        };
        let quiet: Vec<f32> = noise(6000, 9).iter().map(|v| v * 0.001).collect();
        let loud: Vec<f32> = noise(30_000, 9).iter().map(|v| v * 20.0).collect();
        let a = tail_rms(&quiet);
        let b = tail_rms(&loud);
        let ratio = 20.0 * (a / b).log10();
        assert!(ratio.abs() < 6.0, "IR levels differ by {ratio} dB after normalisation");
    }

    #[test]
    fn an_empty_convolver_passes_the_signal_through() {
        let mut convolver = Convolver::new();
        let input = noise(2048, 17);
        let mut left = input.clone();
        let mut right = input.clone();
        convolver.process(&mut left, &mut right, 2048, 1.0);
        assert_eq!(left, input, "nothing loaded: no wet signal, no latency");
    }

    #[test]
    fn unusable_irs_are_refused_with_a_reason() {
        let mut convolver = Convolver::new();
        assert_eq!(convolver.set_ir(&[0.0; 8]).err(), Some(IrError::TooShort));
        assert_eq!(convolver.set_ir(&[0.0; 2048]).err(), Some(IrError::Silent));
        let mut broken = vec![0.0f32; 2048];
        broken[5] = f32::NAN;
        assert_eq!(convolver.set_ir(&broken).err(), Some(IrError::NotFinite));
        assert!(!convolver.has_ir());
    }

    #[test]
    fn an_over_long_ir_is_clamped_to_the_available_partitions() {
        let mut convolver = Convolver::new();
        let ir = noise(MAX_IR_SAMPLES + 50_000, 4);
        convolver.set_ir(&ir).expect("long IR");
        assert_eq!(convolver.partitions(), MAX_PARTITIONS);
        assert_eq!(Convolver::max_ir_samples(), MAX_IR_SAMPLES);
    }
}
