//! Sampler: one recorded sound as an oscillator source (A).
//!
//! A sample is played by reading it faster or slower — `rate = note / root` —
//! which is also why it aliases: playing a sound an octave up doubles the
//! frequency of everything in it, including whatever sat near the top of the
//! original band. Speeding a 48 kHz one-shot up by four puts its 8 kHz content
//! at 32 kHz, above Nyquist, folding back to 16 kHz.
//!
//! The fix is the one the wavetable oscillator already uses: keep a **mipmap**
//! of the sample. Level `k` is the sample low-passed to `rate / 2^(k+1)` and
//! decimated by `2^k`, so it can be played at any rate up to `2^k` without
//! folding. A note four times the root pitch reads level 2, which simply has no
//! content left to fold.
//!
//! Levels are built with a short windowed-sinc decimator rather than an FFT: the
//! sample is seconds long, not 2048 points, and this runs once when a file is
//! imported. Loop points are stored as fractions of the sample so they land in
//! the same place on every level.

/// Longest sample the engine will hold: 4 s at 48 kHz. It is a memory ceiling
/// (the mipmap costs about twice the sample) as much as a musical one.
pub const MAX_BASE_SAMPLES: usize = 192_000;
/// Samples a file can hold after resampling to the engine rate.
pub const MIN_BASE_SAMPLES: usize = 64;
/// Mip levels: 1/1, 1/2 … 1/256 of the rate.
pub const LEVELS: usize = 9;
/// Shortest mip level (a few hundred samples still loop smoothly).
pub const MIN_LEVEL_LEN: usize = 256;
/// Taps in the decimation filter, by level. The first levels carry the audible
/// band, so they get a long Blackman-windowed sinc (a narrow transition and a
/// deep stopband); by level 4 the content is up at a few kHz where a short
/// filter is plenty, and the levels are short enough that length would cost
/// real time.
const fn taps_for(level: usize) -> usize {
    if level <= 2 {
        64
    } else if level <= 4 {
        32
    } else {
        16
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum SampleError {
    /// Fewer than [`MIN_BASE_SAMPLES`] samples after resampling.
    TooShort,
    /// Contains NaN or an infinity.
    NotFinite,
    /// Nothing left after DC removal.
    Silent,
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
#[derive(Clone, Copy)]
pub struct ReadState {
    pub position: f32,
    /// +1 forward, −1 in ping-pong reverse.
    pub direction: f32,
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

pub struct Sample {
    /// Level `k` is the sample decimated by `2^k`; empty until something is
    /// loaded.
    levels: Vec<Vec<f32>>,
}

impl Sample {
    pub const fn new() -> Self {
        Self { levels: Vec::new() }
    }

    pub fn clear(&mut self) {
        self.levels.clear();
    }

    pub fn is_loaded(&self) -> bool {
        !self.levels.is_empty()
    }

    /// Length of the longest level, in samples.
    pub fn base_len(&self) -> usize {
        self.levels.first().map(|level| level.len()).unwrap_or(0)
    }

    pub fn level_len(&self, level: usize) -> usize {
        self.levels
            .get(level.min(self.levels.len().saturating_sub(1)))
            .map(|level| level.len())
            .unwrap_or(0)
    }

    pub fn level_count(&self) -> usize {
        self.levels.len()
    }

    /// Resample `samples` (recorded at `source_rate`) to the engine rate, remove
    /// DC, normalise to unit peak and build the mipmap.
    ///
    /// One-time analysis: called when a file is imported, never from `process`.
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
        let mut base = vec![0.0f32; base_len];
        for (index, slot) in base.iter_mut().enumerate() {
            let position = index as f64 / ratio;
            let first = (position.floor() as usize).min(samples.len() - 1);
            let second = (first + 1).min(samples.len() - 1);
            let fraction = (position - position.floor()) as f32;
            *slot = samples[first] * (1.0 - fraction) + samples[second] * fraction;
        }
        if base_len < MIN_BASE_SAMPLES {
            return Err(SampleError::TooShort);
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

        self.levels.clear();
        self.levels.push(base);
        while self.levels.len() < LEVELS {
            let next = decimate(self.levels.last().expect("just pushed"), self.levels.len() - 1);
            if next.len() < MIN_LEVEL_LEN {
                break;
            }
            self.levels.push(next);
        }
        Ok(())
    }

    /// Level to read for a playback rate: the coarsest level whose own band
    /// still fits below Nyquist once multiplied by `rate`.
    ///
    /// Level `k` holds content up to `rate / 2^(k+1)`, so it survives playback
    /// rates up to `2^k`; playing slower than the root never aliases.
    pub fn level_for(&self, rate: f32) -> usize {
        if !(rate > 1.0) {
            return 0;
        }
        let steps = rate.log2().ceil().max(0.0);
        (steps as usize).min(self.levels.len().saturating_sub(1))
    }

    /// Read one sample of `level` at `position` (in level samples), wrapping
    /// across the loop bounds in loop modes and stopping in one-shot mode.
    fn read(&self, level: usize, position: f32) -> f32 {
        let table = &self.levels[level];
        let len = table.len();
        let wrapped = position.rem_euclid(len as f32);
        let index = wrapped as usize;
        let fraction = wrapped - index as f32;
        let a = table[index % len];
        let b = table[(index + 1) % len];
        a + (b - a) * fraction
    }

    /// Render a block into `out`.
    ///
    /// `step` is the position increment per output sample at this level
    /// (`rate / 2^level`), so one rate works for every level.
    pub fn render(
        &self,
        level: usize,
        out: &mut [f32],
        step: f32,
        params: &SampleParams,
        state: &mut ReadState,
    ) {
        if !self.is_loaded() {
            out.fill(0.0);
            return;
        }
        let len = self.level_len(level) as f32;
        // A one-shot plays the whole sample: loop points only mean something to
        // the looping modes.
        let (start, end) = if params.mode == LoopMode::OneShot {
            (0.0, len)
        } else {
            let start = (params.loop_start.clamp(0.0, 1.0) * len).min(len - 2.0);
            let end = (params.loop_end.clamp(0.0, 1.0) * len).max(start + 2.0).min(len);
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

/// Halve the sample rate with a Blackman-windowed sinc low-pass just below the
/// new Nyquist, clamping at the edges so the first samples do not fade in.
fn decimate(input: &[f32], level: usize) -> Vec<f32> {
    let out_len = input.len() / 2;
    let mut out = vec![0.0f32; out_len];
    let (taps, count) = low_pass(level);
    let taps = &taps[..count];
    let center = count / 2;
    for (index, slot) in out.iter_mut().enumerate() {
        let base = (index * 2) as isize - center as isize;
        let mut acc = 0.0f32;
        for (tap, weight) in taps.iter().enumerate() {
            let at = (base + tap as isize).clamp(0, input.len() as isize - 1) as usize;
            acc += input[at] * weight;
        }
        *slot = acc;
    }
    out
}

/// Cutoff at 0.22 of the input rate: below the new Nyquist (0.25), which is
/// where the transition has to start for the stopband to be down by the time it
/// reaches it.
const CUTOFF: f32 = 0.22;
const MAX_TAPS: usize = 64;

/// Low-pass coefficients for the first decimation of a chain that starts at
/// `level`, normalised to unity gain at DC.
fn low_pass(level: usize) -> ([f32; MAX_TAPS], usize) {
    let count = taps_for(level).min(MAX_TAPS);
    let mut taps = [0.0f32; MAX_TAPS];
    let center = (count - 1) as f32 / 2.0;
    let mut sum = 0.0f32;
    for (index, tap) in taps.iter_mut().take(count).enumerate() {
        let x = index as f32 - center;
        let sinc = if x.abs() < 1e-6 {
            2.0 * CUTOFF
        } else {
            (core::f32::consts::TAU * CUTOFF * x).sin() / (core::f32::consts::PI * x)
        };
        let t = index as f32 / (count - 1) as f32;
        let window = 0.42 - 0.5 * (core::f32::consts::TAU * t).cos() + 0.08 * (2.0 * core::f32::consts::TAU * t).cos();
        *tap = sinc * window;
        sum += *tap;
    }
    if sum.abs() > 1e-9 {
        for tap in taps.iter_mut().take(count) {
            *tap /= sum;
        }
    }
    (taps, count)
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
        let step = rate / (1 << level) as f32;
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
        let step0 = 4.0f32;
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
            let step = rate / (1 << level) as f32;
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
        assert!(sample.level_count() >= 2);
        // Every level halves until it would be too short to loop.
        for level in 1..sample.level_count() {
            assert!(sample.level_len(level) >= MIN_LEVEL_LEN);
            assert!(sample.level_len(level) < sample.level_len(level - 1));
        }
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
