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
//! * The hop's partition work is **spread over the hop** rather than landing in
//!   the block that happens to close it. Every spectrum older than the newest
//!   one is already in the delay line, so the partitions that multiply them are
//!   pre-accumulated a group at a time as the hop fills; only the newest
//!   spectrum, which cannot exist before the hop ends, is handled at the
//!   boundary. That keeps the transform itself as the only spike left.
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

/// How many slices a hop's partition work is broken into. Eight matches the
/// usual 128-frame render quantum, so with a long IR every block of the hop
/// carries its share instead of one block carrying all of it.
const SPREAD: usize = 8;

/// Why an impulse response was refused.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum IrError {
    /// Shorter than [`MIN_IR_SAMPLES`].
    TooShort,
    /// Contains NaN or infinity.
    NotFinite,
    /// Nothing left after DC removal.
    Silent,
    /// The arena cannot hold the partition spectra.
    NoMemory,
}

/// The analysed impulse response: partition spectra plus the buffers the
/// analysis itself needs. Shared **read-only** by every convolution node, so a
/// patch with three reverb nodes in impulse-response mode holds one response,
/// not three.
pub struct IrSpectra {
    /// IR partition spectra, laid out partition by partition.
    ir_re: Vec<f32>,
    ir_im: Vec<f32>,
    /// DC-removed copy of the response being analysed.
    scratch: Vec<f32>,
    /// Transform scratch for the analysis (message path only).
    re: Vec<f64>,
    im: Vec<f64>,
    partitions: usize,
    /// Unit-energy normalisation of the loaded IR.
    normalisation: f32,
    ready: bool,
}

impl IrSpectra {
    pub const fn new() -> Self {
        Self {
            ir_re: Vec::new(),
            ir_im: Vec::new(),
            scratch: Vec::new(),
            re: Vec::new(),
            im: Vec::new(),
            partitions: 0,
            normalisation: 1.0,
            ready: false,
        }
    }

    /// Allocate the analysis working set. Idempotent, and called from
    /// [`IrSpectra::set_ir`] on the message path: a patch that never loads a
    /// response never pays for the partition spectra. Returns false when the
    /// arena is full, so the host can refuse the file instead of aborting.
    pub fn prepare(&mut self) -> bool {
        if self.ir_re.len() == MAX_PARTITIONS * BINS {
            return true;
        }
        let mut ir_re: Vec<f32> = Vec::new();
        let mut ir_im: Vec<f32> = Vec::new();
        let mut scratch: Vec<f32> = Vec::new();
        let mut re: Vec<f64> = Vec::new();
        let mut im: Vec<f64> = Vec::new();
        let spectra = MAX_PARTITIONS * BINS;
        if ir_re.try_reserve_exact(spectra).is_err()
            || ir_im.try_reserve_exact(spectra).is_err()
            || scratch.try_reserve_exact(MAX_IR_SAMPLES).is_err()
            || re.try_reserve_exact(FFT_SIZE).is_err()
            || im.try_reserve_exact(FFT_SIZE).is_err()
        {
            return false;
        }
        ir_re.resize(spectra, 0.0);
        ir_im.resize(spectra, 0.0);
        scratch.resize(MAX_IR_SAMPLES, 0.0);
        re.resize(FFT_SIZE, 0.0);
        im.resize(FFT_SIZE, 0.0);
        self.ir_re = ir_re;
        self.ir_im = ir_im;
        self.scratch = scratch;
        self.re = re;
        self.im = im;
        true
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
        if !self.prepare() {
            self.clear();
            return Err(IrError::NoMemory);
        }
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
        self.ready = true;
        Ok(())
    }

    /// Forget the impulse response: every convolver becomes a silent tap.
    pub fn clear(&mut self) {
        self.partitions = 0;
        self.ready = false;
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
}

/// One convolution node's state: the frequency-domain delay line and the
/// per-hop buffers. The response itself lives in [`IrSpectra`] and is passed in
/// on every call, so two nodes never share a tail.
pub struct Convolver {
    /// Frequency-domain delay line: the last `partitions` input spectra.
    fdl_re: Vec<f32>,
    fdl_im: Vec<f32>,
    /// Sliding input: the previous hop, then the hop being filled.
    in_l: Vec<f32>,
    in_r: Vec<f32>,
    /// Wet signal for the hop that just finished, emitted over the next hop.
    out_l: Vec<f32>,
    out_r: Vec<f32>,
    /// Transform scratch.
    re: Vec<f64>,
    im: Vec<f64>,
    /// Partial sums under construction, one slice of [`BINS`] per channel.
    acc_re: Vec<f64>,
    acc_im: Vec<f64>,
    /// Slices of the hop's partition work already accumulated.
    spread_group: usize,
    fdl_pos: usize,
    fill: usize,
    emitted: usize,
    /// Partition MACs done since the last [`Convolver::take_partitions`]; only
    /// the tests need to see where the hop's work actually landed.
    #[cfg(test)]
    partitions_accumulated: u64,
}

impl Convolver {
    pub const fn new() -> Self {
        Self {
            fdl_re: Vec::new(),
            fdl_im: Vec::new(),
            in_l: Vec::new(),
            in_r: Vec::new(),
            out_l: Vec::new(),
            out_r: Vec::new(),
            re: Vec::new(),
            im: Vec::new(),
            acc_re: Vec::new(),
            acc_im: Vec::new(),
            spread_group: 0,
            fdl_pos: 0,
            fill: 0,
            emitted: HOP,
            #[cfg(test)]
            partitions_accumulated: 0,
        }
    }

    /// Partition MACs performed since the previous call (test instrumentation).
    #[cfg(test)]
    pub fn take_partitions(&mut self) -> u64 {
        core::mem::take(&mut self.partitions_accumulated)
    }

    /// Allocate this node's working set. Idempotent; called from the engine when
    /// a response is imported (the message path), so a patch with no convolution
    /// node pays nothing. Returns false when the arena is full.
    pub fn prepare(&mut self) -> bool {
        if self.fdl_re.len() == MAX_PARTITIONS * BINS {
            return true;
        }
        let mut fdl_re: Vec<f32> = Vec::new();
        let mut fdl_im: Vec<f32> = Vec::new();
        let mut in_l: Vec<f32> = Vec::new();
        let mut in_r: Vec<f32> = Vec::new();
        let mut out_l: Vec<f32> = Vec::new();
        let mut out_r: Vec<f32> = Vec::new();
        let mut re: Vec<f64> = Vec::new();
        let mut im: Vec<f64> = Vec::new();
        let mut acc_re: Vec<f64> = Vec::new();
        let mut acc_im: Vec<f64> = Vec::new();
        let spectra = MAX_PARTITIONS * BINS;
        if fdl_re.try_reserve_exact(spectra).is_err()
            || fdl_im.try_reserve_exact(spectra).is_err()
            || in_l.try_reserve_exact(FFT_SIZE).is_err()
            || in_r.try_reserve_exact(FFT_SIZE).is_err()
            || out_l.try_reserve_exact(HOP).is_err()
            || out_r.try_reserve_exact(HOP).is_err()
            || re.try_reserve_exact(FFT_SIZE).is_err()
            || im.try_reserve_exact(FFT_SIZE).is_err()
            || acc_re.try_reserve_exact(2 * BINS).is_err()
            || acc_im.try_reserve_exact(2 * BINS).is_err()
        {
            return false;
        }
        fdl_re.resize(spectra, 0.0);
        fdl_im.resize(spectra, 0.0);
        in_l.resize(FFT_SIZE, 0.0);
        in_r.resize(FFT_SIZE, 0.0);
        out_l.resize(HOP, 0.0);
        out_r.resize(HOP, 0.0);
        re.resize(FFT_SIZE, 0.0);
        im.resize(FFT_SIZE, 0.0);
        acc_re.resize(2 * BINS, 0.0);
        acc_im.resize(2 * BINS, 0.0);
        self.fdl_re = fdl_re;
        self.fdl_im = fdl_im;
        self.in_l = in_l;
        self.in_r = in_r;
        self.out_l = out_l;
        self.out_r = out_r;
        self.re = re;
        self.im = im;
        self.acc_re = acc_re;
        self.acc_im = acc_im;
        true
    }

    /// Longest IR a loaded impulse response can be, in samples.
    pub fn max_ir_samples() -> usize {
        MAX_IR_SAMPLES
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
        self.acc_re.fill(0.0);
        self.acc_im.fill(0.0);
        self.spread_group = SPREAD;
        self.fdl_pos = 0;
    }

    /// Add `mix` of the convolution with `ir` to `left`/`right`, in place.
    ///
    /// `ir` is shared: every node reads the same partition spectra and keeps its
    /// own delay line, so their tails cannot mix.
    pub fn process(&mut self, ir: &IrSpectra, left: &mut [f32], right: &mut [f32], frames: usize, mix: f32) {
        if self.in_l.is_empty() {
            // Never allocated (a bare `Convolver` in a test): nothing to run.
            return;
        }
        if !ir.ready || ir.partitions == 0 || frames == 0 || mix <= 0.0 {
            // Still advance the line so switching the reverb on mid-note does not
            // replay the last hop of dry signal as a burst of tail.
            if ir.ready {
                self.skip(ir, left, right, frames);
            }
            return;
        }
        let wet_gain = ir.normalisation * mix;
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
                self.run_hop(ir);
                self.fill = 0;
                self.emitted = 0;
                self.in_l.copy_within(HOP..FFT_SIZE, 0);
                self.in_r.copy_within(HOP..FFT_SIZE, 0);
            } else {
                self.spread(ir);
            }

            left[i] = dry_l + wet_l * wet_gain;
            right[i] = dry_r + wet_r * wet_gain;
        }
    }

    /// Advance the input line while the effect is bypassed.
    fn skip(&mut self, ir: &IrSpectra, left: &[f32], right: &[f32], frames: usize) {
        for i in 0..frames {
            self.in_l[HOP + self.fill] = left[i];
            self.in_r[HOP + self.fill] = right[i];
            self.fill += 1;
            if self.fill == HOP {
                self.run_hop(ir);
                self.fill = 0;
                self.emitted = 0;
                self.in_l.copy_within(HOP..FFT_SIZE, 0);
                self.in_r.copy_within(HOP..FFT_SIZE, 0);
            } else {
                self.spread(ir);
            }
        }
    }

    /// Release whichever slices of the next boundary's partition work have come
    /// round, given how far the hop has filled. Cheap enough to call per sample:
    /// it is one multiply and a compare until a slice is actually due.
    fn spread(&mut self, ir: &IrSpectra) {
        let target = (self.fill * SPREAD).div_ceil(HOP).min(SPREAD);
        self.spread_upto(ir, target);
    }

    /// Accumulate the partition slices up to `target` (idempotent). The oldest
    /// partitions are the cheap ones to postpone — the delay line already holds
    /// every spectrum they need — so they are what gets spread.
    fn spread_upto(&mut self, ir: &IrSpectra, target: usize) {
        while self.spread_group < target {
            let group = self.spread_group;
            let total = ir.partitions.saturating_sub(1);
            let lo = 1 + total * group / SPREAD;
            let hi = 1 + total * (group + 1) / SPREAD;
            for partition in lo..hi {
                for channel in 0..2 {
                    self.accumulate(ir, channel, partition);
                }
            }
            self.spread_group += 1;
        }
    }

    /// Add one partition's contribution to one channel's accumulator. The
    /// partition meets the input spectrum written `partition` hops before the
    /// one the boundary is about to close.
    fn accumulate(&mut self, ir: &IrSpectra, channel: usize, partition: usize) {
        if ir.partitions == 0 {
            return;
        }
        let index = (self.fdl_pos + ir.partitions - partition) % ir.partitions;
        let ir_base = partition * BINS;
        let x_base = index * BINS;
        let acc_re = &mut self.acc_re[channel * BINS..(channel + 1) * BINS];
        let acc_im = &mut self.acc_im[channel * BINS..(channel + 1) * BINS];
        for bin in 0..BINS {
            let hr = ir.ir_re[ir_base + bin] as f64;
            let hi = ir.ir_im[ir_base + bin] as f64;
            let xr = self.fdl_re[x_base + bin] as f64;
            let xi = self.fdl_im[x_base + bin] as f64;
            acc_re[bin] += hr * xr - hi * xi;
            acc_im[bin] += hr * xi + hi * xr;
        }
        #[cfg(test)]
        {
            self.partitions_accumulated += 1;
        }
    }

    /// Transform the block that just filled, finish the accumulated partitions
    /// and produce the next hop of wet signal.
    fn run_hop(&mut self, ir: &IrSpectra) {
        // Whatever the spread schedule has not released yet (a bypass gap, a
        // block that jumped over several slices) is finished here: the sum has
        // to be complete before it can be transformed back.
        self.spread_upto(ir, SPREAD);

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
            // Σ h_i · x_{n-i}, completed: the newest spectrum is the one term
            // that could not be prepared earlier, everything else is already in
            // the accumulator from the hop's own blocks.
            self.accumulate(ir, channel, 0);

            // Back to the time domain: with a 2-hop transform and a 1-hop filter
            // the valid part of the circular convolution is the second half.
            self.re.fill(0.0);
            self.im.fill(0.0);
            let acc_re = &self.acc_re[channel * BINS..(channel + 1) * BINS];
            let acc_im = &self.acc_im[channel * BINS..(channel + 1) * BINS];
            for bin in 0..BINS {
                self.re[bin] = acc_re[bin];
                self.im[bin] = acc_im[bin];
                if bin > 0 && bin < FFT_SIZE - bin {
                    self.re[FFT_SIZE - bin] = acc_re[bin];
                    self.im[FFT_SIZE - bin] = -acc_im[bin];
                }
            }
            fft(&mut self.re, &mut self.im, true);
            let out = if channel == 0 { &mut self.out_l } else { &mut self.out_r };
            for i in 0..HOP {
                out[i] = self.re[HOP + i] as f32;
            }
        }
        // Start building the next hop's sum as soon as its first samples land.
        self.acc_re.fill(0.0);
        self.acc_im.fill(0.0);
        self.spread_group = 0;
        self.fdl_pos = (last + 1) % ir.partitions.max(1);
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

    /// A loaded response plus one node convolving with it. The engine shares a
    /// single `IrSpectra` between every node; the tests keep the pair together
    /// for brevity.
    struct Rig {
        ir: IrSpectra,
        node: Convolver,
    }

    impl Rig {
        fn new(response: &[f32]) -> Self {
            let mut ir = IrSpectra::new();
            ir.set_ir(response).expect("usable IR");
            let mut node = Convolver::new();
            node.prepare();
            Self { ir, node }
        }

        fn process(&mut self, left: &mut [f32], right: &mut [f32], frames: usize, mix: f32) {
            self.node.process(&self.ir, left, right, frames, mix);
        }

        /// Run `input` through the node and return the wet signal alone, with
        /// the hop of latency taken out.
        fn wet(&mut self, input: &[f32]) -> Vec<f32> {
            let mut left = input.to_vec();
            let mut right = input.to_vec();
            let frames = 512;
            for chunk in 0..input.len().div_ceil(frames) {
                let start = chunk * frames;
                let end = (start + frames).min(input.len());
                self.process(&mut left[start..end], &mut right[start..end], end - start, 1.0);
            }
            left.iter()
                .zip(input.iter())
                .map(|(wet, dry)| wet - dry)
                .collect()
        }
    }

    #[test]
    fn an_impulse_ir_delays_the_wet_signal_by_one_hop() {
        let mut ir = vec![0.0f32; HOP];
        ir[0] = 1.0;
        let mut rig = Rig::new(&ir);
        assert_eq!(rig.ir.partitions(), 1);
        // Unit energy: a single 1.0 tap normalises to 1.0 (the DC removal that
        // stops a response with an offset from integrating moves it by a hair).
        assert!((rig.ir.normalisation() - 1.0).abs() < 1e-2);
        let gain = rig.ir.normalisation();

        let input = noise(4096, 7);
        let wet = rig.wet(&input);
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
        let ir = noise(HOP * 3 + 37, 11);
        let mut rig = Rig::new(&ir);
        assert_eq!(rig.ir.partitions(), 4);
        let gain = rig.ir.normalisation();
        assert!(gain > 0.0);

        let input = noise(12_000, 23);
        let wet = rig.wet(&input);
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

    /// Load: the hop's partition work has to be spread across the hop, not
    /// dumped into the block that happens to close it. A spike is a dropout
    /// risk on a machine that is already busy, and the load monitor only
    /// averages over the window it is given.
    #[test]
    fn the_hop_work_is_spread_over_the_blocks_of_the_hop() {
        // The worst case the engine allows: a full-length response.
        let ir = noise(MAX_IR_SAMPLES, 5);
        let mut rig = Rig::new(&ir);
        assert_eq!(rig.ir.partitions(), MAX_PARTITIONS);

        let quantum = 128;
        let mut left = noise(quantum * 16, 9);
        let mut right = left.clone();
        let mut per_block = Vec::new();
        for start in (0..left.len()).step_by(quantum) {
            let end = (start + quantum).min(left.len());
            rig.process(&mut left[start..end], &mut right[start..end], end - start, 1.0);
            per_block.push(rig.node.take_partitions());
        }

        // Steady state: the first hop is the one that fills the delay line.
        let steady = &per_block[SPREAD..];
        let total: u64 = steady.iter().sum();
        let worst = *steady.iter().max().expect("blocks");
        assert!(total >= MAX_PARTITIONS as u64 * 2, "no work was accounted for");
        assert!(
            worst * 4 <= total,
            "a single block did {worst} of {total} partition MACs: {per_block:?}"
        );
        // …and every block of the hop does part of it, rather than a few doing
        // everything and the rest idling.
        let busy = steady.iter().filter(|count| **count > 0).count();
        assert!(busy * 2 >= steady.len(), "only {busy} of {} blocks worked", steady.len());
    }

    /// Whatever the hop's work is broken into, the result may not depend on how
    /// the caller cuts the stream into blocks: the ABI allows anything from 128
    /// to 1024 frames and the host is free to change its mind mid-stream.
    #[test]
    fn the_wet_signal_does_not_depend_on_the_block_size() {
        let ir = noise(HOP * 5 + 11, 31);
        let input = noise(20_000, 13);

        let render = |frames: usize| {
            let mut rig = Rig::new(&ir);
            let mut left = input.clone();
            let mut right = input.clone();
            for start in (0..input.len()).step_by(frames) {
                let end = (start + frames).min(input.len());
                rig.process(&mut left[start..end], &mut right[start..end], end - start, 1.0);
            }
            left
        };

        let reference = render(128);
        for frames in [256, 512, 1024, 333] {
            let other = render(frames);
            let worst = reference
                .iter()
                .zip(other.iter())
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);
            assert!(worst < 1e-4, "block size {frames} changed the wet signal by {worst}");
        }
    }

    /// Frequency domain, on the worst case the engine allows: the wet output of
    /// an impulse has to be the (normalised) impulse response itself, so the
    /// spread schedule may move the work around but not the transfer function.
    #[test]
    fn a_full_length_ir_keeps_its_transfer_function() {
        let ir = noise(MAX_IR_SAMPLES, 17);
        let mut rig = Rig::new(&ir);
        assert_eq!(rig.ir.partitions(), MAX_PARTITIONS);
        let gain = rig.ir.normalisation() as f64;

        // An impulse in, the response out: the wet path is a delay of one hop.
        let mut left = vec![0.0f32; MAX_IR_SAMPLES + 4 * HOP];
        let mut right = left.clone();
        left[0] = 1.0;
        right[0] = 1.0;
        for start in (0..left.len()).step_by(128) {
            let end = (start + 128).min(left.len());
            rig.process(&mut left[start..end], &mut right[start..end], end - start, 1.0);
        }

        // Compare a handful of probe frequencies against the analytic response.
        // A wrong partition pairing (the failure this schedule can introduce)
        // shows up as a phase or magnitude error here, not as a level change.
        for freq in [55.0f64, 220.0, 1000.0, 4000.0, 12000.0, 17000.0] {
            let (mut wr, mut wi, mut hr, mut hi) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
            for (i, h) in ir.iter().enumerate() {
                let phase = core::f64::consts::TAU * freq * i as f64 / 48_000.0;
                hr += *h as f64 * phase.cos();
                hi -= *h as f64 * phase.sin();
                let wet = left[HOP + i] as f64;
                wr += wet * phase.cos();
                wi -= wet * phase.sin();
            }
            let (want_re, want_im) = (hr * gain, hi * gain);
            let error = ((wr - want_re).powi(2) + (wi - want_im).powi(2)).sqrt();
            let magnitude = (want_re * want_re + want_im * want_im).sqrt();
            assert!(
                error < magnitude * 0.02 + 1e-3,
                "at {freq} Hz the wet response is off by {error} against {magnitude}"
            );
        }
    }

    /// Frequency domain: an IR that rings at one frequency has to leave its mark
    /// there and nowhere else, which is the whole point of loading an IR.
    #[test]
    fn a_resonant_ir_shapes_the_wet_spectrum() {
        let ring = 3000.0f32;
        let ir: Vec<f32> = (0..8000)
            .map(|i| {
                let t = i as f32 / 48_000.0;
                (core::f32::consts::TAU * ring * t).sin() * (-t * 4.0).exp()
            })
            .collect();
        // A sine IR is a resonator: the wet output of a noise burst must be
        // dominated by that frequency.
        let mut rig = Rig::new(&ir);

        let input = noise(24_000, 5);
        let wet = rig.wet(&input);
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
            let mut rig = Rig::new(ir);
            let input = noise(24_000, 3);
            let wet = rig.wet(&input);
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
        let ir = IrSpectra::new();
        let mut convolver = Convolver::new();
        let input = noise(2048, 17);
        let mut left = input.clone();
        let mut right = input.clone();
        convolver.process(&ir, &mut left, &mut right, 2048, 1.0);
        assert_eq!(left, input, "nothing loaded: no wet signal, no latency");
    }

    #[test]
    fn unusable_irs_are_refused_with_a_reason() {
        let mut ir = IrSpectra::new();
        assert_eq!(ir.set_ir(&[0.0; 8]).err(), Some(IrError::TooShort));
        assert_eq!(ir.set_ir(&[0.0; 2048]).err(), Some(IrError::Silent));
        let mut broken = vec![0.0f32; 2048];
        broken[5] = f32::NAN;
        assert_eq!(ir.set_ir(&broken).err(), Some(IrError::NotFinite));
        assert!(!ir.has_ir());
    }

    #[test]
    fn an_over_long_ir_is_clamped_to_the_available_partitions() {
        let mut ir = IrSpectra::new();
        let long = noise(MAX_IR_SAMPLES + 50_000, 4);
        ir.set_ir(&long).expect("long IR");
        assert_eq!(ir.partitions(), MAX_PARTITIONS);
        assert_eq!(IrSpectra::max_ir_samples(), MAX_IR_SAMPLES);
        assert_eq!(Convolver::max_ir_samples(), MAX_IR_SAMPLES);
    }

    /// Two nodes on one response: the partition spectra are shared, so the
    /// second node costs only its own delay line — and because that line is its
    /// own, one node's tail can never appear in the other's output.
    #[test]
    fn two_nodes_share_the_response_and_keep_their_own_tails() {
        let ir = noise(HOP * 2 + 3, 41);
        let mut spectra = IrSpectra::new();
        spectra.set_ir(&ir).expect("noise IR");
        let mut one = Convolver::new();
        let mut two = Convolver::new();
        one.prepare();
        two.prepare();

        let quantum = 128;
        let input = noise(quantum * 40, 7);
        let mut one_out = input.clone();
        let mut one_silent = vec![0.0f32; input.len()];
        let mut two_out = vec![0.0f32; input.len()];
        let mut two_silent = vec![0.0f32; input.len()];
        for start in (0..input.len()).step_by(quantum) {
            let end = (start + quantum).min(input.len());
            let frames = end - start;
            one.process(&spectra, &mut one_out[start..end], &mut one_silent[start..end], frames, 1.0);
            // The second node gets silence the whole time.
            two.process(&spectra, &mut two_silent[start..end], &mut two_out[start..end], frames, 1.0);
        }
        // Node one rang; node two, fed silence, stayed silent: no shared tail.
        assert!(one_out.iter().any(|v| v.abs() > 1e-3), "the driven node did not ring");
        assert!(
            two_out.iter().all(|v| v.abs() < 1e-6),
            "the silent node picked up the other node's tail"
        );

        // And the response really is shared: two fresh nodes running the same
        // input through one `IrSpectra` produce bit-identical tails (if they
        // shared a delay line, the second pass would feed the first's history).
        let mut a = Convolver::new();
        let mut b = Convolver::new();
        a.prepare();
        b.prepare();
        let mut a_left = input.clone();
        let mut a_right = input.clone();
        let mut b_left = input.clone();
        let mut b_right = input.clone();
        for start in (0..input.len()).step_by(quantum) {
            let end = (start + quantum).min(input.len());
            let frames = end - start;
            a.process(&spectra, &mut a_left[start..end], &mut a_right[start..end], frames, 1.0);
            b.process(&spectra, &mut b_left[start..end], &mut b_right[start..end], frames, 1.0);
        }
        assert_eq!(a_left, b_left, "one response, two nodes: the tails must match");
    }
}
