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
//! out around -33 dB. A level is now **as long as its band allows**: content at
//! `SR / 2^(k+1)` is stored at `SR / 2^(k-3)`, so it sits at 1/16 of the level's
//! Nyquist and the error falls with ν⁴. Levels 1..=3 (rates up to 8×) all read
//! one full-length table band-limited to `SR/16`; each later level halves both
//! the rate and the band. Building those tables is a sharp low-pass per level,
//! which is why the chain is filtered with 192 taps of Blackman-windowed sinc
//! rather than the old short half-band filters — see [`LEVEL_NYQUIST`].
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
/// The value is not free: level *k* has to be decimated by `2^(k-3)`, so levels
/// 1..=3 (rates up to 8×) read a full-length table band-limited to `SR/16`
/// (3 kHz at 48 kHz). Below the range this batch is judged on — the P9.1b line
/// is ≥ 1 kHz — that is a real bandwidth loss when a sample is played an octave
/// or two up, and it is the honest price of reaching −60 dB with a four-point
/// interpolator. Measured: 192 taps of Blackman-windowed sinc at this cutoff
/// put the whole chain 68 dB down or better on the P9.5 ruler (see
/// `docs/notes/band-limited-oscillators.md` §P9.8).
pub const LEVEL_NYQUIST: f32 = 0.0625;
/// Taps in each mip-chain low-pass. The transition has to be sharp: content just
/// above a level's band is what folds when that level is read at the top of its
/// rate range, and only the *filter* can remove it. 192 taps of Blackman are
/// where the measured floor stops improving (see §P9.8).
const CHAIN_TAPS: usize = 192;
/// Longest filter this module will build.
const MAX_TAPS: usize = 192;

/// The table level `level` reads. Level 0 is the full-band base; levels 1..=3
/// only need `SR/16`, which is exactly what the first chain entry holds at full
/// length; level `k >= 4` reads chain entry `k - 3`.
const fn table_for(level: usize) -> usize {
    if level == 0 {
        0
    } else if level <= 3 {
        1
    } else {
        level - 2
    }
}

/// Samples a level's table holds per output sample at playback rate 1: the table
/// is decimated by `2^level_shift(level)` relative to the engine rate, so the
/// read step for a rate is `rate / 2^level_shift(level)`.
pub const fn level_shift(level: usize) -> usize {
    let table = table_for(level);
    if table == 0 {
        0
    } else {
        table - 1
    }
}

/// Tables the mip chain can hold: the base plus chain entries 0..=5.
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
}

impl Sample {
    pub const fn new() -> Self {
        Self { pool: Vec::new(), tables: [Table::EMPTY; TABLE_COUNT], count: 0 }
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

    /// Highest mip level the built chain can serve. Levels 0..=3 read chain
    /// entry 0, and each further entry carries exactly one more level.
    pub fn max_level(&self) -> usize {
        match self.count {
            0 | 1 => 0,
            n => (n + 1).min(LEVELS - 1),
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

        // Table 1 is the base low-passed once at `LEVEL_NYQUIST`; every later
        // table filters the one before it at half the band and halves its rate,
        // so each one keeps its content at `LEVEL_NYQUIST` of its own Nyquist.
        // Each filter writes straight into the next slot of the pool: the input
        // and the output ranges never overlap, so the mipmap needs no scratch.
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
            if step == 0 {
                low_pass_into(input, cutoff, CHAIN_TAPS, out);
            } else {
                low_pass_decimate_into(input, cutoff, CHAIN_TAPS, out);
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
    /// Four-point (cubic Lagrange) interpolation rather than linear: at the
    /// rates an octave or two above the root the read step is a large fraction
    /// of a sample, and a chord's error is a train of high harmonics that folds
    /// back. P9.7 measured cubic a few dB better than linear here; P9.8's longer
    /// levels are what let the chord error fall with the table's own band.
    fn read(&self, level: usize, position: f64) -> f32 {
        let table = self.table(level);
        let len = table.len();
        let wrapped = position.rem_euclid(len as f64);
        let index = wrapped as usize;
        let fraction = (wrapped - index as f64) as f32;
        let at = |offset: isize| table[(index as isize + offset).rem_euclid(len as isize) as usize];
        let a = at(0);
        let b = at(1);
        let previous = at(-1);
        let next = at(2);
        // Lagrange through (-1, previous), (0, a), (1, b), (2, next):
        // p(x) = a + k1*x + k2*x*(x-1) + k3*x*(x-1)*(x-2).
        let k1 = b - a;
        let k2 = 0.5 * (previous - 2.0 * a + b);
        let k3 = (next - 3.0 * b + 3.0 * a - previous) / 6.0;
        a + fraction * (k1 + (fraction - 1.0) * (k2 + (fraction - 2.0) * k3))
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
    /// rather than at the 0.44 the old decimate-by-`2^k` chain left it at.
    #[test]
    fn every_level_keeps_its_content_well_inside_its_own_band() {
        let sample = load(&sine(220.0, 24_000, SR));
        assert_eq!(sample.level_count(), LEVELS);
        for level in 0..LEVELS {
            let shift = level_shift(level);
            assert_eq!(sample.level_len(level), 24_000 >> shift, "level {level} length");
            if level == 0 {
                continue;
            }
            // Table 1 upward holds `LEVEL_NYQUIST` of the rate it was built at,
            // and level `k` is read at up to `2^k`, so its output content stops
            // at the output Nyquist (the `<=` is tight for levels 3, 4 and 8).
            let band = LEVEL_NYQUIST * SR / (1 << shift) as f32;
            assert!(band * (1 << level) as f32 <= SR / 2.0 + 1e-3, "level {level} band {band}");
        }
        // Level 1 reads the same full-length table as level 3, which is the price
        // this batch paid for -60 dB: band above `SR/16` is gone an octave up.
        assert_eq!(sample.level_len(1), 24_000);
        assert_eq!(sample.level_len(4), 12_000);
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
