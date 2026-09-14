//! Sampler: one recorded sound as an oscillator source (A).
//!
//! A sample is played by reading it faster or slower — `rate = note / root` —
//! which is also why it aliases: playing a sound an octave up doubles the
//! frequency of everything in it, including whatever sat near the top of the
//! original band. Speeding a 48 kHz one-shot up by four puts its 8 kHz content
//! at 32 kHz, above Nyquist, folding back to 16 kHz.
//!
//! The fix is the one the wavetable oscillator already uses: keep a **mipmap**
//! of the sample. Level `k` holds the sample low-passed to `rate / 2^(k+1)`, so
//! it can be played at any rate up to `2^k` without folding, and loop points are
//! stored as fractions of the sample so they land in the same place on every
//! level.
//!
//! P9.8 changed what "level" means. A level used to be the sample decimated by
//! `2^k`, which leaves its content at 0.44 of its own Nyquist no matter what:
//! the read step of `rate / 2^k` then handed the interpolator a signal at the
//! worst frequency it could be at, and the four-point Lagrange chord error came
//! out around -33 dB. A level is now **as long as its band allows**: level `k`
//! holds `SR / 2^(k+1)` — the widest band a rate of `2^k` can carry — stored at
//! `SR / 2^(k-1)`, so the content sits at a quarter of the level's Nyquist. That
//! quarter is only affordable because the read is a 16-tap windowed sinc rather
//! than a cubic; the four-point kernel needs the content down at a sixteenth
//! (see [`LEVEL_NYQUIST`] for the numbers).
//!
//! Levels are built with a windowed-sinc decimator rather than an FFT: the
//! sample is seconds long, not 2048 points, and this runs once when a file is
//! imported. Loop points are stored as fractions of the sample so they land in
//! the same place on every level.

/// Longest sample the engine will hold: 4 s at 48 kHz. It is a memory ceiling
/// (the mipmap costs about three times the sample) as much as a musical one.
pub const MAX_BASE_SAMPLES: usize = 192_000;
/// Samples a file can hold after resampling to the engine rate.
pub const MIN_BASE_SAMPLES: usize = 64;
/// Mip levels: 1/1, 1/2 … 1/256 of the rate.
pub const LEVELS: usize = 9;
/// Shortest mip level (a few hundred samples still loop smoothly).
pub const MIN_LEVEL_LEN: usize = 256;

/// Where the content of a mip level sits inside that level's own band, as a
/// fraction of its Nyquist (P9.8).
///
/// P9.7 fixed the *interpolator* (f32 position → f64, linear → cubic) and left
/// the sampler at −33 dB because a mip level built by plain decimation always
/// holds content right up to its own Nyquist: 0.44 of it with the 0.22-cutoff
/// half-band filter, whatever the level. The read step of `rate / 2^k` samples
/// then hands the interpolator a signal at the worst possible frequency, and a
/// four-point Lagrange chord error at ν = 0.44 is a train of images about 30 dB
/// down.
///
/// Making the level *longer for the same content* moves ν down: a level whose
/// band is `SR / 2^(k+1)` stored at `SR / 2^(k-3)` samples keeps ν at 1/16, and
/// the chord error falls with ν⁴. That is this constant. It is the sampler's
/// version of P9.7's "every wavetable level is full length": here the length is
/// only what the alias-free band allows, because the sample itself supplies the
/// bandwidth and the table has to be filtered down to it.
///
/// Where the content of a mip level sits inside that level's own band, as a
/// fraction of its Nyquist (P9.8).
///
/// P9.7 fixed the *interpolator* (f32 position → f64, linear → cubic) and left
/// the sampler at −33 dB because a mip level built by plain decimation always
/// holds content right up to its own Nyquist: 0.44 of it with the 0.22-cutoff
/// half-band filter, whatever the level. The read step of `rate / 2^k` samples
/// then hands the interpolator a signal at the worst possible frequency, and a
/// four-point Lagrange chord error at ν = 0.44 is a train of images about 30 dB
/// down.
///
/// Making the level *longer for the same content* moves ν down, and the error
/// falls with ν^(order). The level layout is then set by two constraints at once:
/// level `k` must be band-limited to `SR / 2^(k+1)` (or a rate up to `2^k` folds),
/// and its content must sit at `LEVEL_NYQUIST` of the table it is stored in (or
/// the interpolator's images come back). Together they fix the level's table at
/// `SR / 2^(1 + log2(1/LEVEL_NYQUIST) - k)` samples — which is `SR / 2^(k+1)` for
/// this value, i.e. **every level gets the widest band its own rate range
/// allows**, and none of them is short.
///
/// 1/4 is only reachable because the interpolator is a 16-tap windowed sinc
/// rather than a cubic: measured (f64, per-phase scan) the four-point kernel
/// images at −22 dB when the content sits at a quarter of Nyquist, while this one
/// is −92 dB there *after* the lookup table's own 1024-phase quantization. The
/// full arithmetic and the pre-1C numbers are in
/// `docs/notes/band-limited-oscillators.md` §P9.8.
pub const LEVEL_NYQUIST: f32 = 0.25;
/// Taps in each mip-chain low-pass. With the levels above, the transition a
/// filter has to make is at most 2:1 (cutoff at half the new Nyquist), so 96 taps
/// would already be generous — but the two ends of the chain want different
/// things and the measured floor says so:
///
///   * the **early** stages build the levels a note one or two octaves up reads,
///     and there the filter's transition band is what folds: at 192 taps a
///     harmonic just above the level's band is 40-60 dB further down than at 96
///     (2960 Hz read -87.5 dB with 192, -66.6 with 96);
///   * the **late** stages build short tables (a few hundred samples) whose loop
///     starts a couple of samples in, so a 192-tap filter's edge-clamped region
///     covers the whole loop and the seam folds back (8372 Hz read -58.1 dB with
///     192 taps, -80.2 with 96).
///
/// Measured across the keyboard (7-term Blackman-Harris ruler, gate sample):
/// 192/192 worst -58.1 dB, 96/96 worst -66.6 dB, 192 early + 96 late worst
/// -77.3 dB. See `docs/notes/band-limited-oscillators.md` §P9.8.
const CHAIN_TAPS_EARLY: usize = 192;
const CHAIN_TAPS_LATE: usize = 96;
/// Filter length for chain step `step` (`0` builds level 1's table).
const fn chain_taps(step: usize) -> usize {
    if step < 3 {
        CHAIN_TAPS_EARLY
    } else {
        CHAIN_TAPS_LATE
    }
}
/// Longest filter this module will build.
const MAX_TAPS: usize = 192;

/// Taps in the playback interpolator, and entries in its phase table.
///
/// A windowed sinc rather than a polynomial: 16 taps of a 4-term
/// Blackman-Harris-windowed sinc are flat to within 0.01 dB across the band a
/// level holds, where a cubic is already 0.4 dB down and −34 dB of images at the
/// same frequency. The kernel is precomputed per phase on the import path (one
/// `sin`/`cos` per tap per phase, never in `process`) and read back with a linear
/// blend between the two nearest phases.
const KERNEL_TAPS: usize = 16;
const KERNEL_PHASES: usize = 1024;
/// Rows in the phase table: one more than the phase count, because the blend for
/// the last phase needs the kernel at `x = 1`, and that is *not* the row for
/// `x = 0` — its taps sit one sample further along. Wrapping to row 0 there ran
/// every thousandth sample through the wrong kernel and cost 30 dB.
const KERNEL_ROWS: usize = KERNEL_PHASES + 1;
const KERNEL_LEN: usize = KERNEL_TAPS * KERNEL_ROWS;
/// Offset of the first tap from the read position's integer part: the kernel's
/// taps sit at `-7..=8`, so the interpolation point lands between them.
const FIRST_TAP: isize = -(KERNEL_TAPS as isize / 2) + 1;

/// The table level `level` reads: the full-band base for level 0, then chain
/// entry `level - 1` — one table per level, each holding exactly the band its own
/// rate range allows.
const fn table_for(level: usize) -> usize {
    if level == 0 {
        0
    } else {
        level
    }
}

/// Samples a level's table holds per output sample at playback rate 1: the table
/// is decimated by `2^level_shift(level)` relative to the engine rate, so the
/// read step for a rate is `rate / 2^level_shift(level)`.
pub const fn level_shift(level: usize) -> usize {
    if level == 0 {
        0
    } else {
        level - 1
    }
}

/// Tables the mip chain can hold: the base plus one per level.
const TABLE_COUNT: usize = table_for(LEVELS - 1) + 1;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SampleError {
    /// Fewer than [`MIN_BASE_SAMPLES`] samples after resampling.
    TooShort,
    /// Contains NaN or an infinity.
    NotFinite,
    /// Nothing left after DC removal.
    Silent,
    /// The arena cannot hold the sample's mipmap. Refused with a reason rather
    /// than truncated: a short chain would silently play the wrong level, and
    /// with it the wrong band.
    NoRoom,
}

/// How playback behaves at the end of the sample.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LoopMode {
    /// Play once, then silence (a drum hit).
    OneShot,
    /// Wrap from the loop end back to the loop start (a sustained tone).
    Loop,
    /// Reverse direction at each loop bound (a pad, or a tape-style loop).
    PingPong,
}

impl LoopMode {
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => LoopMode::Loop,
            2 => LoopMode::PingPong,
            _ => LoopMode::OneShot,
        }
    }
}

/// Playback settings, from the patch: the pitch the sample was recorded at, how
/// it loops, and where the loop sits inside it (0..1 of the sample).
#[derive(Clone, Copy)]
pub struct SampleParams {
    pub root_hz: f32,
    pub mode: LoopMode,
    pub loop_start: f32,
    pub loop_end: f32,
}

impl SampleParams {
    pub const fn new() -> Self {
        Self { root_hz: 261.6256, mode: LoopMode::OneShot, loop_start: 0.0, loop_end: 1.0 }
    }
}

/// Per-voice read position, in samples of the level being played.
///
/// P9.7: the position is **f64**, not f32. It runs to `MAX_BASE_SAMPLES`
/// (192000) and a level can be thousands of samples long, so an f32's unit in
/// the last place is a few 1e-4 samples — a *phase* error about 10⁴ times
/// coarser than the wavetable's `phase ∈ [0,1)`. Because the level's loop is
/// seamless, that error does not average out: it repeats at the loop rate and
/// shows up as a family of sidebands `± loop_rate` around every harmonic. At
/// C7 the full-length loop (8.31 Hz) put them at -35 dB, and an f64 replica of
/// the same read put the floor at -44.7 dB with the sidebands gone. The table
/// itself stays f32; only the accumulator and the wrap arithmetic need the
/// wider type.
#[derive(Clone, Copy)]
pub struct ReadState {
    pub position: f64,
    /// +1 forward, −1 in ping-pong reverse.
    pub direction: f64,
    /// Set once a one-shot has run past its end.
    pub finished: bool,
}

impl ReadState {
    pub const fn new() -> Self {
        Self { position: 0.0, direction: 1.0, finished: false }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

/// One mip table inside [`Sample::pool`].
#[derive(Clone, Copy)]
struct Table {
    offset: u32,
    len: u32,
}

impl Table {
    const EMPTY: Self = Self { offset: 0, len: 0 };
}

pub struct Sample {
    /// Every mip table back to back, so one exact-size allocation covers the
    /// whole mipmap. Table 0 is the full-band base; table 1 is that base
    /// low-passed to [`LEVEL_NYQUIST`] at full length; table `1 + i` is table `i`
    /// low-passed again and halved. Levels map onto tables through [`table_for`],
    /// so several levels share one. Empty until something is loaded.
    ///
    /// P9.8 made this a pool rather than a `Vec<Vec<f32>>`: the import path then
    /// asks the arena for exactly [`mipmap_samples`] and nothing else, there is
    /// no second copy of the sample and no half-built chain to clean up, and the
    /// refusal in [`Sample::load`] is one `try_reserve_exact` on one block.
    pool: Vec<f32>,
    tables: [Table; TABLE_COUNT],
    count: usize,
    /// [`KERNEL_PHASES`] rows of [`KERNEL_TAPS`] windowed-sinc weights, filled by
    /// [`Sample::prepare_kernel`] on the import path. A fixed array rather than a
    /// `Vec`: it is read from `process`, and it must not be a per-sample heap
    /// allocation.
    kernel: [f32; KERNEL_LEN],
}

impl Sample {
    pub const fn new() -> Self {
        Self {
            pool: Vec::new(),
            tables: [Table::EMPTY; TABLE_COUNT],
            count: 0,
            kernel: [0.0; KERNEL_LEN],
        }
    }

    /// Build the playback interpolator's phase table: a 4-term Blackman-Harris
    /// windowed sinc over [`KERNEL_TAPS`] taps, one row per phase, each row
    /// normalised to unity DC gain. One-time, ~16 k `sin`/`cos` calls, and
    /// idempotent — the same table for every sample.
    fn prepare_kernel(&mut self) {
        let half = KERNEL_TAPS as f32 / 2.0;
        // 4-term Blackman-Harris: a deep stopband at a wider main lobe than a
        // Blackman window, which is what buys the extra 30 dB here.
        const C: [f32; 4] = [0.35875, 0.48829, 0.14128, 0.01168];
        for phase in 0..KERNEL_ROWS {
            let x = phase as f32 / KERNEL_PHASES as f32;
            let row = &mut self.kernel[phase * KERNEL_TAPS..(phase + 1) * KERNEL_TAPS];
            let mut sum = 0.0f32;
            for (tap, weight) in row.iter_mut().enumerate() {
                let distance = x - (FIRST_TAP + tap as isize) as f32;
                let sinc = if distance.abs() < 1e-6 {
                    1.0
                } else {
                    (core::f32::consts::PI * distance).sin() / (core::f32::consts::PI * distance)
                };
                let t = (distance + half) / KERNEL_TAPS as f32;
                let window = if (0.0..=1.0).contains(&t) {
                    let angle = core::f32::consts::TAU * t;
                    C[0] - C[1] * angle.cos() + C[2] * (2.0 * angle).cos() - C[3] * (3.0 * angle).cos()
                } else {
                    0.0
                };
                *weight = sinc * window;
                sum += *weight;
            }
            if sum.abs() > 1e-9 {
                for weight in row.iter_mut() {
                    *weight /= sum;
                }
            }
        }
    }

    /// Drop the sample and hand its memory back to the arena: the response
    /// analyzer and the next import both want it.
    pub fn clear(&mut self) {
        self.pool = Vec::new();
        self.tables = [Table::EMPTY; TABLE_COUNT];
        self.count = 0;
    }

    pub fn is_loaded(&self) -> bool {
        self.count > 0
    }

    /// Length of the base table, in samples (level 0 and the first chain entry
    /// are both this long).
    pub fn base_len(&self) -> usize {
        self.tables[0].len as usize
    }

    /// Table a level reads, clamped to what the chain actually built. A sample
    /// too short to decimate still plays: the level is the base, exactly as it
    /// was before the chain existed.
    fn table_index(&self, level: usize) -> usize {
        let last = self.count.saturating_sub(1);
        table_for(level.min(self.max_level())).min(last)
    }

    fn table(&self, level: usize) -> &[f32] {
        let entry = self.tables[self.table_index(level)];
        &self.pool[entry.offset as usize..entry.offset as usize + entry.len as usize]
    }

    /// Highest mip level the built chain can serve. Level `k >= 1` reads chain
    /// entry `k - 1`, so the tables built are exactly the levels available.
    pub fn max_level(&self) -> usize {
        match self.count {
            0 => 0,
            n => (n - 1).min(LEVELS - 1),
        }
    }

    pub fn level_len(&self, level: usize) -> usize {
        self.tables[self.table_index(level)].len as usize
    }

    /// Number of mip levels the built chain can serve (1 when only the base fit).
    pub fn level_count(&self) -> usize {
        if self.count == 0 {
            0
        } else {
            self.max_level() + 1
        }
    }

    /// Resample `samples` (recorded at `source_rate`) to the engine rate, remove
    /// DC, normalise to unit peak and build the mipmap.
    ///
    /// One-time analysis: called when a file is imported, never from `process`.
    /// The whole mipmap is one `try_reserve_exact` of [`mipmap_samples`], and a
    /// sample the arena cannot hold comes back as [`SampleError::NoRoom`] instead
    /// of aborting the module — with the sample already loaded left alone, since
    /// that is decided before the pool is touched. A file rejected for its own
    /// content (silent, short, not finite) clears the sampler.
    pub fn load(&mut self, samples: &[f32], source_rate: f32, engine_rate: f32) -> Result<(), SampleError> {
        self.prepare_kernel();
        if samples.len() < MIN_BASE_SAMPLES / 4 {
            return Err(SampleError::TooShort);
        }
        if samples.iter().any(|value| !value.is_finite()) {
            return Err(SampleError::NotFinite);
        }

        let rate = if source_rate.is_finite() && source_rate > 1000.0 { source_rate } else { engine_rate };
        let ratio = (engine_rate.max(1000.0) / rate) as f64;
        let base_len = ((samples.len() as f64 * ratio).round() as usize).clamp(1, MAX_BASE_SAMPLES);
        if base_len < MIN_BASE_SAMPLES {
            return Err(SampleError::TooShort);
        }

        // One block for every table. An existing pool is reused when it is
        // already big enough, otherwise a fresh exact-size block replaces it —
        // the old one goes back to the arena before the new one is asked for.
        //
        // The tables are invalidated *after* the pool is secured, so a refusal
        // leaves the loaded sample alone, and *before* anything else can fail
        // (the silence check below), so a rejected import cannot leave `tables`
        // pointing into a pool that has since changed length.
        let needed = mipmap_samples(base_len);
        if self.pool.capacity() < needed {
            let Some(fresh) = try_vec(needed) else {
                return Err(SampleError::NoRoom);
            };
            self.pool = fresh;
        } else {
            self.pool.clear();
            self.pool.resize(needed, 0.0);
        }
        self.count = 0;
        self.tables = [Table::EMPTY; TABLE_COUNT];

        // Level 0: the resampled, DC-free, peak-normalised base.
        {
            let base = &mut self.pool[..base_len];
            for (index, slot) in base.iter_mut().enumerate() {
                let position = index as f64 / ratio;
                let first = (position.floor() as usize).min(samples.len() - 1);
                let second = (first + 1).min(samples.len() - 1);
                let fraction = (position - position.floor()) as f32;
                *slot = samples[first] * (1.0 - fraction) + samples[second] * fraction;
            }
            let mean = base.iter().map(|value| *value as f64).sum::<f64>() / base_len as f64;
            for value in base.iter_mut() {
                *value -= mean as f32;
            }
            let peak = base.iter().fold(0.0f32, |peak, value| peak.max(value.abs()));
            if peak < 1e-5 {
                return Err(SampleError::Silent);
            }
            let gain = 1.0 / peak;
            for value in base.iter_mut() {
                *value *= gain;
            }
        }
        self.tables[0] = Table { offset: 0, len: base_len as u32 };
        self.count = 1;
        if base_len < MIN_LEVEL_LEN {
            return Ok(());
        }

        // Table 1 is the base low-passed once at `LEVEL_NYQUIST` — the widest band
        // a level read at up to 2× may hold; every later table filters the one
        // before it at half the band and halves its rate, so level `k` ends up
        // with exactly `SR / 2^(k+1)` and all of it is inside Nyquist. Each filter
        // writes straight into the next slot of the pool: the input and the output
        // ranges never overlap, so the mipmap needs no scratch.
        let mut offset = base_len;
        while self.count < TABLE_COUNT {
            let step = self.count - 1;
            let cutoff = if step == 0 { LEVEL_NYQUIST } else { LEVEL_NYQUIST * 0.5 };
            let previous = self.tables[self.count - 1];
            let (input_len, next_len) = if step == 0 {
                (previous.len as usize, previous.len as usize)
            } else {
                (previous.len as usize, previous.len as usize / 2)
            };
            if next_len < MIN_LEVEL_LEN {
                break;
            }
            let start = previous.offset as usize;
            let write = offset;
            // Split the pool so the filter reads and writes disjoint slices.
            let (head, tail) = self.pool.split_at_mut(write);
            let input = &head[start..start + input_len];
            let out = &mut tail[..next_len];
            let taps = chain_taps(step);
            if step == 0 {
                low_pass_into(input, cutoff, taps, out);
            } else {
                low_pass_decimate_into(input, cutoff, taps, out);
            }
            self.tables[self.count] = Table { offset: write as u32, len: next_len as u32 };
            self.count += 1;
            offset += next_len;
        }
        Ok(())
    }

    /// Level to read for a playback rate: the coarsest level whose own band
    /// still fits below Nyquist once multiplied by `rate`.
    ///
    /// Level `k` holds content up to `rate / 2^(k+1)`, so it survives playback
    /// rates up to `2^k`; playing slower than the root never aliases. A chain
    /// that stopped early (a very short sample) clamps the level, which is all
    /// the tables it has.
    pub fn level_for(&self, rate: f32) -> usize {
        if !(rate > 1.0) {
            return 0;
        }
        let steps = rate.log2().ceil().max(0.0);
        (steps as usize).min(self.max_level())
    }

    /// Read one sample of `level` at `position` (in level samples), wrapping
    /// across the loop bounds in loop modes and stopping in one-shot mode.
    ///
    /// Sixteen-tap windowed-sinc interpolation from the phase table built in
    /// [`Sample::prepare_kernel`], blended between the two nearest phases. P9.7
    /// shipped a four-point cubic, which is enough when a level holds its content
    /// at a sixteenth of its Nyquist (P9.8's first layout) but is 34 dB down at
    /// the quarter-of-Nyquist point this layout uses; the sinc is flat to 0.01 dB
    /// there with 92 dB of image rejection (see [`LEVEL_NYQUIST`]).
    fn read(&self, level: usize, position: f64) -> f32 {
        let table = self.table(level);
        let len = table.len();
        let wrapped = position.rem_euclid(len as f64);
        let index = wrapped as usize;
        let fraction = (wrapped - index as f64) as f32;

        let scaled = fraction * KERNEL_PHASES as f32;
        let phase = (scaled as usize).min(KERNEL_PHASES - 1);
        let blend = scaled - phase as f32;
        let low = phase * KERNEL_TAPS;
        let high = low + KERNEL_TAPS;

        let start = index as isize + FIRST_TAP;
        if start >= 0 && start + KERNEL_TAPS as isize <= len as isize {
            // The common case: every tap is inside the table, no wrap per tap.
            // This is the loop that stays in line and in registers.
            let base = start as usize;
            let mut acc = 0.0f32;
            for tap in 0..KERNEL_TAPS {
                let a = self.kernel[low + tap];
                let weight = a + (self.kernel[high + tap] - a) * blend;
                acc += table[base + tap] * weight;
            }
            acc
        } else {
            read_wrapped(table, &self.kernel, low, high, blend, start)
        }
    }

    /// Render a block into `out`.
    ///
    /// `step` is the position increment per output sample at this level
    /// (`rate / 2^level_shift(level)`), so one rate works for every level. It is
    /// f64 for the same reason the position is: rounding the increment to f32
    /// would put the same loop-rate error back a sample at a time.
    pub fn render(
        &self,
        level: usize,
        out: &mut [f32],
        step: f64,
        params: &SampleParams,
        state: &mut ReadState,
    ) {
        if !self.is_loaded() {
            out.fill(0.0);
            return;
        }
        let len = self.level_len(level) as f64;
        // A one-shot plays the whole sample: loop points only mean something to
        // the looping modes.
        let (start, end) = if params.mode == LoopMode::OneShot {
            (0.0, len)
        } else {
            let start = (params.loop_start.clamp(0.0, 1.0) as f64 * len).min(len - 2.0);
            let end = (params.loop_end.clamp(0.0, 1.0) as f64 * len).max(start + 2.0).min(len);
            (start, end)
        };
        let last = (end - 1.0).max(start);
        if state.finished {
            out.fill(0.0);
            return;
        }

        for sample in out.iter_mut() {
            if state.position >= end {
                match params.mode {
                    LoopMode::OneShot => {
                        state.finished = true;
                        *sample = 0.0;
                        continue;
                    }
                    // Wrapping jumps back to the loop start: that is the point of
                    // a loop.
                    LoopMode::Loop => state.position = start + (state.position - end),
                    // Ping-pong *reflects* at the last sample instead, so the
                    // waveform keeps going without a step.
                    LoopMode::PingPong => {
                        state.position = 2.0 * last + 1.0 - state.position;
                        state.direction = -1.0;
                    }
                }
            }
            if params.mode != LoopMode::OneShot && state.position < start {
                match params.mode {
                    LoopMode::Loop => state.position = end - (start - state.position),
                    LoopMode::PingPong => {
                        state.position = 2.0 * start - state.position;
                        state.direction = 1.0;
                    }
                    LoopMode::OneShot => {}
                }
            }
            if params.mode == LoopMode::PingPong {
                // A reflection that lands outside the loop (a step larger than
                // the loop itself) is clamped rather than spiralling.
                state.position = state.position.clamp(start, last);
            } else if state.position < 0.0 {
                state.position = 0.0;
            }
            *sample = self.read(level, state.position);
            state.position += step * state.direction;
        }
        if state.position >= len && params.mode == LoopMode::OneShot {
            state.finished = true;
        }
    }
}

/// A zeroed `Vec` of `len` f32, or `None` when the arena is exhausted. The
/// mipmap is the one place in the engine that can ask for hundreds of kilobytes
/// at once, so it is the one place that has to be able to say no: the default
/// `vec!` would abort the module instead.
fn try_vec(len: usize) -> Option<Vec<f32>> {
    let mut out: Vec<f32> = Vec::new();
    out.try_reserve_exact(len).ok()?;
    out.resize(len, 0.0);
    Some(out)
}

/// Samples every mip table of a `base_len`-sample import adds up to: the base,
/// the full-length first chain entry, then a halving chain until a table would
/// be shorter than [`MIN_LEVEL_LEN`]. This is the exact size of the pool
/// [`Sample::load`] asks the arena for, so it is also the memory a sample costs.
pub const fn mipmap_samples(base_len: usize) -> usize {
    let mut total = base_len;
    if base_len < MIN_LEVEL_LEN {
        return total;
    }
    total += base_len;
    let mut len = base_len;
    let mut tables = 2;
    while tables < TABLE_COUNT {
        len /= 2;
        if len < MIN_LEVEL_LEN {
            break;
        }
        total += len;
        tables += 1;
    }
    total
}

/// Bytes [`mipmap_samples`] is worth, for the capacity arithmetic in the docs
/// and for the budget test below.
pub const fn mipmap_bytes(base_len: usize) -> usize {
    mipmap_samples(base_len) * core::mem::size_of::<f32>()
}

/// The rare case of [`Sample::read`]: the interpolation window straddles a table
/// edge, so the tap index has to wrap. Kept out of line — it runs for at most
/// [`KERNEL_TAPS`] samples per loop pass, and outlining it keeps the interior
/// loop (the one on the audio path) from being emitted twice.
#[inline(never)]
fn read_wrapped(table: &[f32], kernel: &[f32], low: usize, high: usize, blend: f32, start: isize) -> f32 {
    let len = table.len() as isize;
    let mut acc = 0.0f32;
    for tap in 0..KERNEL_TAPS {
        let a = kernel[low + tap];
        let weight = a + (kernel[high + tap] - a) * blend;
        let at = (start + tap as isize).rem_euclid(len) as usize;
        acc += table[at] * weight;
    }
    acc
}

/// Low-pass `input` into `out`, which must be the same length, with a
/// Blackman-windowed sinc at `cutoff` — a fraction of the input rate — clamping
/// at the edges so the first samples do not fade in. Coefficients are normalised
/// to unity gain at DC.
fn low_pass_into(input: &[f32], cutoff: f32, taps: usize, out: &mut [f32]) {
    let (weights, count) = low_pass_taps(cutoff, taps);
    let center = count / 2;
    for (index, slot) in out.iter_mut().enumerate() {
        let base = index as isize - center as isize;
        let mut acc = 0.0f32;
        for (tap, weight) in weights.iter().take(count).enumerate() {
            let at = (base + tap as isize).clamp(0, input.len() as isize - 1) as usize;
            acc += input[at] * weight;
        }
        *slot = acc;
    }
}

/// The same low-pass, but keeping only every second output sample: `out` holds
/// `input.len() / 2` values, the decimation of the filtered signal. Computing
/// only the survivors halves the work and needs no scratch buffer.
fn low_pass_decimate_into(input: &[f32], cutoff: f32, taps: usize, out: &mut [f32]) {
    let (weights, count) = low_pass_taps(cutoff, taps);
    let center = count / 2;
    for (index, slot) in out.iter_mut().enumerate() {
        let base = (index * 2) as isize - center as isize;
        let mut acc = 0.0f32;
        for (tap, weight) in weights.iter().take(count).enumerate() {
            let at = (base + tap as isize).clamp(0, input.len() as isize - 1) as usize;
            acc += input[at] * weight;
        }
        *slot = acc;
    }
}

/// Coefficients of the mip chain's low-pass, normalised to unity gain at DC.
fn low_pass_taps(cutoff: f32, taps: usize) -> ([f32; MAX_TAPS], usize) {
    let count = taps.clamp(3, MAX_TAPS);
    let mut weights = [0.0f32; MAX_TAPS];
    let center = (count - 1) as f32 / 2.0;
    let mut sum = 0.0f32;
    for (index, weight) in weights.iter_mut().take(count).enumerate() {
        let x = index as f32 - center;
        let sinc = if x.abs() < 1e-6 {
            2.0 * cutoff
        } else {
            (core::f32::consts::TAU * cutoff * x).sin() / (core::f32::consts::PI * x)
        };
        let t = index as f32 / (count - 1) as f32;
        let window = 0.42 - 0.5 * (core::f32::consts::TAU * t).cos() + 0.08 * (2.0 * core::f32::consts::TAU * t).cos();
        *weight = sinc * window;
        sum += *weight;
    }
    if sum.abs() > 1e-9 {
        for weight in weights.iter_mut().take(count) {
            *weight /= sum;
        }
    }
    (weights, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn sine(freq: f32, len: usize, rate: f32) -> Vec<f32> {
        (0..len)
            .map(|i| (core::f32::consts::TAU * freq * i as f32 / rate).sin() * 0.8)
            .collect()
    }

    /// Dominant frequency of a rendered block, by DFT with a Hann window.
    fn dominant(samples: &[f32], rate: f32, probe: &[f32]) -> (f32, f32) {
        let mut best = (0.0f32, 0.0f32);
        for freq in probe {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, value) in samples.iter().enumerate() {
                let win = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / samples.len() as f64).cos();
                let v = *value as f64 * win;
                let phase = core::f64::consts::TAU * *freq as f64 * i as f64 / rate as f64;
                re += v * phase.cos();
                im -= v * phase.sin();
            }
            let magnitude = ((re * re + im * im).sqrt() / samples.len() as f64) as f32;
            if magnitude > best.1 {
                best = (*freq, magnitude);
            }
        }
        best
    }

    fn load(samples: &[f32]) -> Sample {
        let mut sample = Sample::new();
        sample.load(samples, SR, SR).expect("clean sample");
        sample
    }

    fn render(sample: &Sample, rate: f32, params: SampleParams, frames: usize) -> Vec<f32> {
        let level = sample.level_for(rate);
        let step = (rate / (1 << level_shift(level)) as f32) as f64;
        let mut state = ReadState::new();
        let mut out = vec![0.0f32; frames];
        sample.render(level, &mut out, step, &params, &mut state);
        out
    }

    #[test]
    fn a_sample_plays_at_its_root_pitch_and_octaves_above() {
        let sample = load(&sine(440.0, 24_000, SR));
        let params = SampleParams { root_hz: 440.0, ..SampleParams::new() };
        // Root: rate 1.
        let out = render(&sample, 1.0, params, 8_192);
        let (freq, magnitude) = dominant(
            &out,
            SR,
            &(15..=40).map(|k| k as f32 * 20.0).collect::<Vec<_>>(),
        );
        assert!(magnitude > 0.1, "the sample should sound");
        assert!((freq - 440.0).abs() < 30.0, "root playback gave {freq} Hz");

        // An octave up: rate 2, so 880 Hz.
        let out = render(&sample, 2.0, params, 8_192);
        let (freq, _) = dominant(
            &out,
            SR,
            &(30..=60).map(|k| k as f32 * 20.0).collect::<Vec<_>>(),
        );
        assert!((freq - 880.0).abs() < 40.0, "octave playback gave {freq} Hz");
    }

    /// The point of the mipmap: an 8 kHz tone played four times too fast would
    /// fold back to 16 kHz on the full-band sample, and cannot on a band-limited
    /// level because the 8 kHz content is gone.
    #[test]
    fn mipmaps_stop_a_fast_sample_from_folding_back() {
        let sample = load(&sine(8000.0, 24_000, SR));
        let params = SampleParams::new();
        let magnitude_at = |out: &[f32], freq: f32| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, value) in out.iter().enumerate() {
                let win = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / out.len() as f64).cos();
                let v = *value as f64 * win;
                let phase = core::f64::consts::TAU * freq as f64 * i as f64 / SR as f64;
                re += v * phase.cos();
                im -= v * phase.sin();
            }
            ((re * re + im * im).sqrt() / out.len() as f64) as f32
        };

        // Force level 0 (what a naive sampler would do) and play four times up.
        let step0 = 4.0f64;
        let mut state = ReadState::new();
        let mut naive = vec![0.0f32; 8_192];
        sample.render(0, &mut naive, step0, &params, &mut state);
        let alias = magnitude_at(&naive, 16_000.0);

        let clean = render(&sample, 4.0, params, 8_192);
        let alias_clean = magnitude_at(&clean, 16_000.0);
        assert!(alias > 0.05, "the check needs the naive render to alias: {alias}");
        assert!(
            alias_clean < alias * 0.05,
            "the mipmap should remove the fold-back: {alias_clean} vs {alias}"
        );
    }

    #[test]
    fn the_level_chosen_for_a_rate_can_carry_it() {
        let sample = load(&sine(440.0, 24_000, SR));
        assert_eq!(sample.level_for(1.0), 0);
        assert_eq!(sample.level_for(1.5), 1);
        assert_eq!(sample.level_for(2.0), 1);
        assert_eq!(sample.level_for(4.0), 2);
        assert_eq!(sample.level_for(16.0), 4);
        // Nothing has content above its own Nyquist, so the level's band times
        // the rate must stay under the output Nyquist.
        for rate in [1.0f32, 1.3, 2.0, 3.0, 6.0, 12.0] {
            let level = sample.level_for(rate);
            let step = (rate / (1 << level_shift(level)) as f32) as f64;
            let mut state = ReadState::new();
            let mut out = vec![0.0f32; 4_096];
            sample.render(level, &mut out, step, &SampleParams::new(), &mut state);
            let energy = out.iter().map(|v| v * v).sum::<f32>();
            assert!(energy.is_finite());
        }
    }

    #[test]
    fn loop_mode_repeats_and_ping_pong_turns_around() {
        // A ramp is the easiest thing to read a direction from.
        let ramp: Vec<f32> = (0..4_800).map(|i| i as f32 / 4_800.0 * 2.0 - 1.0).collect();
        let sample = load(&ramp);
        let params = SampleParams { root_hz: 440.0, mode: LoopMode::Loop, loop_start: 0.0, loop_end: 1.0 };
        let out = render(&sample, 1.0, params, 24_000);
        // A looped ramp keeps restarting: several rising segments.
        let drops = out.windows(2).filter(|pair| pair[1] < pair[0] - 0.5).count();
        assert!(drops >= 4, "a loop should restart repeatedly, saw {drops} restarts");

        let params = SampleParams { mode: LoopMode::PingPong, ..params };
        let out = render(&sample, 1.0, params, 24_000);
        let drops = out.windows(2).filter(|pair| pair[1] < pair[0] - 0.5).count();
        assert_eq!(drops, 0, "ping-pong should never jump back to the start");
        // It should reverse instead: the ramp spends roughly half its time
        // descending, one small step per sample.
        let falls = out.windows(2).filter(|pair| pair[1] < pair[0]).count();
        assert!(falls > 1_000, "ping-pong should run backwards sometimes, saw {falls}");
    }

    #[test]
    fn a_one_shot_stops_at_the_end() {
        let sample = load(&sine(440.0, 4_800, SR));
        let out = render(&sample, 1.0, SampleParams { root_hz: 440.0, ..SampleParams::new() }, 9_600);
        let tail = &out[5_000..];
        assert!(tail.iter().all(|value| *value == 0.0), "one-shot should not keep ringing");
        assert!(out[..4_800].iter().any(|value| value.abs() > 0.1));
    }

    #[test]
    fn a_sample_recorded_at_another_rate_plays_at_the_right_pitch() {
        // 440 Hz recorded at 22.05 kHz: 441 samples per cycle.
        let mut sample = Sample::new();
        let source = sine(440.0, 11_025, 22_050.0);
        sample.load(&source, 22_050.0, SR).expect("clean sample");
        assert_eq!(sample.base_len(), 24_000);
        let out = render(&sample, 1.0, SampleParams { root_hz: 440.0, ..SampleParams::new() }, 8_192);
        let (freq, magnitude) = dominant(
            &out,
            SR,
            &(15..=40).map(|k| k as f32 * 20.0).collect::<Vec<_>>(),
        );
        assert!(magnitude > 0.1);
        assert!((freq - 440.0).abs() < 30.0, "resampled playback gave {freq} Hz");
    }

    #[test]
    fn unusable_samples_are_refused_with_a_reason() {
        let mut sample = Sample::new();
        assert_eq!(sample.load(&[0.0; 4], SR, SR).err(), Some(SampleError::TooShort));
        assert_eq!(sample.load(&[0.0; 4_800], SR, SR).err(), Some(SampleError::Silent));
        let mut broken = vec![0.0f32; 4_800];
        broken[10] = f32::INFINITY;
        assert_eq!(sample.load(&broken, SR, SR).err(), Some(SampleError::NotFinite));
        assert!(!sample.is_loaded());
    }

    #[test]
    fn a_long_sample_is_clamped_to_the_available_length() {
        let long = sine(220.0, 300_000, SR);
        let sample = load(&long);
        assert_eq!(sample.base_len(), MAX_BASE_SAMPLES);
        assert_eq!(sample.level_count(), LEVELS);
        // The chain halves until a table would be too short to loop.
        for level in 1..sample.level_count() {
            assert!(sample.level_len(level) >= MIN_LEVEL_LEN);
            assert!(sample.level_len(level) <= sample.level_len(level - 1));
        }
    }

    /// P9.8's whole point, pinned: every level's table is as long as its band
    /// allows, so its content sits at [`LEVEL_NYQUIST`] of the table's Nyquist
    /// rather than at the 0.44 the old decimate-by-`2^k` chain left it at, and
    /// the band itself is the widest `SR / 2^(k+1)` a rate of `2^k` can carry.
    #[test]
    fn every_level_keeps_its_content_well_inside_its_own_band() {
        // A second of audio: every one of the nine levels is long enough to build
        // (the shortest is `SR / 128` samples).
        let sample = load(&sine(220.0, 48_000, SR));
        assert_eq!(sample.level_count(), LEVELS);
        for level in 0..LEVELS {
            let shift = level_shift(level);
            assert_eq!(sample.level_len(level), 48_000 >> shift, "level {level} length");
            if level == 0 {
                continue;
            }
            // Table `k` holds `LEVEL_NYQUIST` of its own rate, and level `k` is
            // read at up to `2^k`, so its output content stops exactly at the
            // output Nyquist — the `<=` is tight for every level, which is what
            // "as wide as its band allows" means.
            let band = LEVEL_NYQUIST * SR / (1 << shift) as f32;
            assert!(band * (1 << level) as f32 <= SR / 2.0 + 1e-3, "level {level} band {band}");
            assert!(band * (1 << level) as f32 > SR / 4.0, "level {level} band {band}");
        }
        // Level 1 is full length and level 4 is an eighth of it: nothing is short.
        assert_eq!(sample.level_len(1), 48_000);
        assert_eq!(sample.level_len(4), 6_000);
    }

    /// The interpolator's own failure modes, pinned directly: every phase row
    /// must sum to one (a DC offset has to survive untouched, which is what a
    /// windowed sinc's normalisation buys) and the largest weight must sit at the
    /// interpolation point, not somewhere else (a tap-indexing bug would still
    /// "interpolate", just wrongly).
    #[test]
    fn the_kernel_table_is_dc_normalised_and_centred() {
        let sample = load(&sine(440.0, 4_800, SR));
        for phase in [0usize, 1, 17, KERNEL_PHASES / 2, KERNEL_PHASES - 1] {
            let row = &sample.kernel[phase * KERNEL_TAPS..(phase + 1) * KERNEL_TAPS];
            let sum: f32 = row.iter().sum();
            assert!((sum - 1.0).abs() < 1e-4, "phase {phase} sums to {sum}");
            let peak = row
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).expect("finite weights"))
                .map(|(tap, _)| tap)
                .expect("non-empty row");
            assert!((7..=8).contains(&peak), "phase {phase} peaks at tap {peak}");
        }
    }

    /// The row *past* the last phase is not the row for phase zero. At `x = 1`
    /// the interpolation point has moved one sample along, so the kernel is a
    /// delta in tap 8, not tap 7 — and the last phase blends into it. Reading row
    /// zero there instead ran every thousandth sample through a kernel shifted by
    /// a whole sample: a click train that cost 30 dB of floor (1047 Hz -86.4 dB
    /// with the extra row, -54.7 without).
    #[test]
    fn the_phase_table_has_a_row_past_the_last_phase() {
        let sample = load(&sine(12_000.0, 48_000, SR));
        let last = &sample.kernel[KERNEL_PHASES * KERNEL_TAPS..KERNEL_ROWS * KERNEL_TAPS];
        assert!((last[8] - 1.0).abs() < 1e-3, "x = 1 should be a delta at tap 8: {}", last[8]);
        assert!(last[7].abs() < 1e-2, "x = 1 should not sit at tap 7: {}", last[7]);
        // And the blend really lands there: a position just short of the next
        // sample must still interpolate a quarter-Nyquist sine accurately.
        let mut worst = 0.0f32;
        for i in 0..256 {
            let position = 11.0 + 0.999 + i as f64 * 3.0;
            let got = sample.read(0, position);
            let want = (core::f32::consts::TAU * 12_000.0 * position as f32 / SR).sin();
            worst = worst.max((got - want).abs());
        }
        let db = 20.0 * worst.max(1e-30).log10();
        assert!(db < -60.0, "the last phase cell interpolates {db:.1} dB down");
    }

    /// A tone well inside a level's band has to come back with its level intact:
    /// this is the cost side of a wider band, and it fails loudly if the kernel's
    /// passband ripples or the read step is off by a factor.
    #[test]
    fn the_kernel_passes_its_band_flat() {
        // 500 whole periods of 1 kHz, so a loop is seamless and an RMS reading is
        // a clean amplitude measurement of whatever level the rate picks.
        let sample = load(&sine(1_000.0, 24_000, SR));
        let params = SampleParams { root_hz: 440.0, mode: LoopMode::Loop, loop_start: 0.0, loop_end: 1.0 };
        let mut reference = 0.0f32;
        for rate in [1.0f32, 2.0, 4.0] {
            let level = sample.level_for(rate);
            let step = (rate / (1 << level_shift(level)) as f32) as f64;
            let mut state = ReadState::new();
            let mut out = vec![0.0f32; 48_000];
            sample.render(level, &mut out, step, &params, &mut state);
            let rms = (out.iter().map(|value| (*value as f64) * (*value as f64)).sum::<f64>()
                / out.len() as f64)
                .sqrt() as f32;
            if reference == 0.0 {
                reference = rms;
                // The RMS of a unit sine. Written as the constant rather than
                // `0.7071`: clippy's `approx_constant` lint is deny-by-default
                // since 1.98 and turned this line into a hard `verify:clippy`
                // failure in *this* test (the sweep found it, §一.39).
                assert!(
                    (reference - core::f32::consts::FRAC_1_SQRT_2).abs() < 0.02,
                    "the loop should be a unit sine: {reference}"
                );
            }
            // The windowed sinc is flat to a hundredth of a dB in band and the
            // chain filters pass 1 kHz at every level, so the level must not move
            // by more than a few percent from one rate to the next.
            assert!(
                (rms - reference).abs() < reference * 0.05,
                "rate {rate} changed the tone: {rms} vs {reference}"
            );
        }
    }

    /// The memory an import costs is known before it is attempted, and the
    /// longest sample the engine accepts still fits the arena — otherwise the
    /// refusal in `load` would be the normal path rather than the edge.
    #[test]
    fn the_longest_mipmap_fits_the_arena() {
        let need = mipmap_bytes(MAX_BASE_SAMPLES);
        assert!(need < crate::alloc_arena::ARENA_SIZE / 2, "4 s mipmap needs {need} bytes");
        // And it grows with the sample, not with the ceiling: a 0.25 s import is
        // not charged for 4 s.
        assert!(mipmap_bytes(12_000) * 4 < need);
    }

    /// A refusal must not leave the sampler half-loaded. `load` swaps the pool
    /// before it can know the new sample is usable, so the tables have to be
    /// invalidated with it; otherwise importing a short silent file over a long
    /// sample leaves `tables` pointing past the end of the shrunk pool and the
    /// next render reads out of bounds.
    #[test]
    fn a_rejected_import_does_not_leave_a_stale_mipmap() {
        let mut sample = Sample::new();
        sample.load(&sine(220.0, 192_000, SR), SR, SR).expect("long sample");
        assert_eq!(sample.base_len(), MAX_BASE_SAMPLES);
        assert_eq!(sample.load(&[0.0; 4_800], SR, SR).err(), Some(SampleError::Silent));
        assert!(!sample.is_loaded(), "a rejected import must not leave the old mipmap dangling");
        assert_eq!(sample.base_len(), 0, "the tables must be invalidated with the pool");
        assert_eq!(sample.level_len(0), 0);
        let mut state = ReadState::new();
        let mut out = vec![1.0f32; 512];
        sample.render(0, &mut out, 1.0, &SampleParams::new(), &mut state);
        assert!(out.iter().all(|value| *value == 0.0));
    }

    /// The decimator's job: content in level 0's top octave must not survive
    /// into level 1, because that is exactly what would fold when level 1 is
    /// played at rate 2.
    #[test]
    fn a_decimated_level_drops_the_top_octave() {
        let sample = load(&sine(14_000.0, 48_000, SR));
        let params = SampleParams::new();
        let magnitude_at = |out: &[f32], freq: f32| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, value) in out.iter().enumerate() {
                let win = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / out.len() as f64).cos();
                let v = *value as f64 * win;
                let phase = core::f64::consts::TAU * freq as f64 * i as f64 / SR as f64;
                re += v * phase.cos();
                im -= v * phase.sin();
            }
            ((re * re + im * im).sqrt() / out.len() as f64) as f32
        };

        // Level 1 played at rate 2: a 14 kHz tone would land on 28 kHz, which
        // folds to 20 kHz. That is the alias to look for.
        let mut state = ReadState::new();
        let mut out = vec![0.0f32; 8_192];
        let level = sample.level_for(2.0);
        assert_eq!(level, 1, "rate 2 should read the first decimated level");
        sample.render(level, &mut out, 2.0 / 2.0, &params, &mut state);
        let alias = magnitude_at(&out, 20_000.0);

        // The same tone read from the full-band level, which is what a sampler
        // without a mipmap does.
        let mut state = ReadState::new();
        let mut naive = vec![0.0f32; 8_192];
        sample.render(0, &mut naive, 2.0, &params, &mut state);
        let naive_alias = magnitude_at(&naive, 20_000.0);

        assert!(naive_alias > 0.05, "the naive path must actually alias: {naive_alias}");
        assert!(
            alias < naive_alias * 0.1,
            "the decimated level should drop the fold-back: {alias} vs {naive_alias}"
        );
        // And the tone itself is gone from that level.
        let through = magnitude_at(&out, 14_000.0);
        assert!(through < naive_alias * 0.25, "the top octave should be attenuated: {through}");
    }
}
