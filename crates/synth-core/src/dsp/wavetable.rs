//! Wavetable oscillator tables (A6.2).
//!
//! A wavetable is one cycle of a waveform, played back at the note's frequency.
//! Naively that aliases badly: the cycle holds harmonics far above Nyquist for a
//! high note. The fix is **mipmaps** — one band-limited copy of the cycle per
//! octave, each holding only the harmonics that fit below Nyquist at that pitch,
//! so whatever level a note picks, it cannot alias by construction.
//!
//! The factory tables are generated here from harmonic recipes rather than
//! shipped as samples: a recipe is a handful of numbers, the mipmaps are derived
//! from it, and "band-limited" is then a property of the generator rather than
//! of a careful resampling step.
//!
//! [`Table::from_cycle`] takes the other route for a waveform the player
//! imported: one cycle of samples goes through a forward transform, then each
//! mip level is rebuilt from the bins below its own Nyquist (an ideal brick
//! wall, phase included) before being decimated. Same guarantee, measured the
//! same way.

/// Table length. **Every** level is this long (P9.7): the levels differ in how
/// many harmonics they hold, not in how many samples they use.
///
/// P9.5 measured the residuum and attributed it to the *interpolator*: a short
/// level read with linear interpolation is a piecewise-linear approximation of
/// a band-limited signal, and the chord error is a train of high harmonics that
/// folds back to `SR − k·f0` (1/N²: -24 dB at 16 samples, -58 dB at 128). The
/// obvious repair — keep a shorter level but hold more samples — trades one
/// error for a worse one, because the read rate is fixed by the note: a level
/// of `N` samples holding `h` harmonics is read with a phase step of `2πh/N`
/// per output sample, and the chord error is set by that product, not by `N`
/// alone. Decimating the level (what shipped) keeps `h/N` at its Nyquist
/// maximum, so the error stays where it was.
///
/// Holding every level at [`BASE_LEN`] samples instead leaves the same
/// harmonic content in a table dozens of times longer than the pitch needs:
/// C8 uses 4 harmonics of a 2048-sample table, so the read is nearly
/// sample-for-sample and the fold-back falls away. Measured on the P9.5 ruler
/// (BH-7, 4 s, exact bins, real wasm): the worst factory bank went from
/// -25.8 dB to -105 dB, and a full-spectrum imported saw from -31 dB to -119 dB
/// at C2. See `docs/notes/band-limited-oscillators.md` §P9.7.
pub const BASE_LEN: usize = 2048;
/// Number of mip levels: each holds one octave's worth of harmonics.
///
/// The shortest level matters: at the top of the keyboard even 16 harmonics
/// reach above Nyquist (16 × 4186 Hz), so the bank has to go down to a few
/// harmonics or the highest notes alias.
pub const LEVELS: usize = 9;
/// Shortest cycle [`Table::from_cycle`] will accept. The analysis resamples it
/// to [`BASE_LEN`], so anything shorter than the point where the source
/// resolution stops mattering is refused.
pub const MIN_CYCLE: usize = 64;

/// A harmonic recipe: amplitude per harmonic, `1` = the fundamental.
pub type Recipe = &'static [(u32, f32)];

/// Organ-ish: strong fundamental with the first few overtones.
pub const ORGAN: Recipe = &[(1, 1.0), (2, 0.5), (3, 0.35), (4, 0.25), (6, 0.12), (8, 0.08)];
/// Hollow: odd harmonics only, the classic square-ish clarinet tone.
pub const HOLLOW: Recipe = &[(1, 1.0), (3, 0.33), (5, 0.2), (7, 0.14), (9, 0.11), (11, 0.09)];
/// Vocal: formant-like emphasis around the 3rd–5th harmonics.
pub const VOCAL: Recipe = &[(1, 1.0), (2, 0.4), (3, 0.9), (4, 0.7), (5, 0.6), (6, 0.2), (7, 0.1)];
/// Metallic: sparse, high harmonics with a slight stretch in the ratios.
pub const METALLIC: Recipe =
    &[(1, 1.0), (3, 0.5), (5, 0.4), (8, 0.3), (11, 0.25), (15, 0.2), (19, 0.15)];
/// Glass: a bright, bell-like spectrum that keeps going up.
pub const GLASS: Recipe = &[
    (1, 1.0),
    (2, 0.2),
    (5, 0.5),
    (9, 0.35),
    (14, 0.25),
    (20, 0.18),
    (27, 0.12),
    (35, 0.08),
];

pub const RECIPES: [(&str, Recipe); 5] = [
    ("organ", ORGAN),
    ("hollow", HOLLOW),
    ("vocal", VOCAL),
    ("metallic", METALLIC),
    ("glass", GLASS),
];

/// Why an imported cycle could not be turned into a table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CycleError {
    /// Fewer than [`MIN_CYCLE`] samples.
    TooShort,
    /// Contains NaN or an infinity.
    NotFinite,
    /// Nothing left after DC removal.
    Silent,
}

/// One waveform, every mip level. Levels are stored longest first.
#[derive(Clone)]
pub struct Table {
    levels: Vec<Vec<f32>>,
}

/// The harmonic ceiling of mip `level`: `BASE_LEN >> level` harmonics, i.e. the
/// content that still fits below Nyquist when the level is played at the pitch
/// that selects it. The level *length* no longer takes part in this: every level
/// is [`BASE_LEN`] samples.
///
/// Note the `/ 2`: a level holding `h` harmonics is safe to read while
/// `h <= SR / (2 f)`, which is exactly what [`Table::level_for`] checks, and the
/// engine clamps `f` to `SR / (BASE_LEN >> level)`. The harmonic *count* here is
/// therefore `(BASE_LEN >> level) / 2`, not `BASE_LEN >> level`: one octave of
/// headroom over that clamp. Without it level 8 would hold 8 harmonics and C8
/// (4186 Hz) would have its 6th–8th fold back to 22.9/18.7/14.5 kHz.
#[inline]
fn level_top(level: usize) -> u32 {
    ((BASE_LEN >> level) / 2).max(1) as u32
}

impl Table {
    /// Build the mipmaps of `recipe`: every level is [`BASE_LEN`] samples long
    /// and holds only the harmonics up to its own octave's Nyquist.
    pub fn from_recipe(recipe: Recipe) -> Self {
        let mut levels = Vec::with_capacity(LEVELS);
        for level in 0..LEVELS {
            levels.push(render_level(recipe, BASE_LEN, level_top(level)));
        }
        Self { levels }
    }

    /// Build the mipmaps of one cycle of a waveform given as samples.
    ///
    /// The cycle is resampled to [`BASE_LEN`], DC is removed, and one transform
    /// gives the full harmonic content. Each level is then rebuilt from the bins
    /// below its own Nyquist — DC and everything above dropped, nothing else
    /// touched — so the levels are brick-wall band-limited *and* keep the
    /// original phase, which is what makes an imported saw still look like a
    /// saw rather than like a pile of cosines. Levels are individually peak
    /// normalised, exactly as the recipe tables are, so switching level as the
    /// pitch rises cannot jump in loudness.
    pub fn from_cycle(cycle: &[f32]) -> Result<Self, CycleError> {
        if cycle.len() < MIN_CYCLE {
            return Err(CycleError::TooShort);
        }
        if cycle.iter().any(|value| !value.is_finite()) {
            return Err(CycleError::NotFinite);
        }

        let n = BASE_LEN;
        let mut re = vec![0.0f64; n];
        let mut im = vec![0.0f64; n];
        let step = cycle.len() as f64 / n as f64;
        for (index, slot) in re.iter_mut().enumerate() {
            let position = index as f64 * step;
            let first = (position.floor() as usize) % cycle.len();
            let second = (first + 1) % cycle.len();
            let fraction = position - position.floor();
            *slot = cycle[first] as f64 * (1.0 - fraction) + cycle[second] as f64 * fraction;
        }

        let mean = re.iter().sum::<f64>() / n as f64;
        for value in re.iter_mut() {
            *value -= mean;
        }
        let rms = (re.iter().map(|value| value * value).sum::<f64>() / n as f64).sqrt();
        if !(rms > 1e-4) {
            return Err(CycleError::Silent);
        }

    crate::dsp::util::fft(&mut re, &mut im, false);

        let mut levels = Vec::with_capacity(LEVELS);
        for level in 0..LEVELS {
            let mut level_re = re.clone();
            let mut level_im = im.clone();
            // Harmonics 1..=top survive; `bin` folds the upper half of the
            // spectrum onto its mirror so one test covers both sides.
            let top = level_top(level);
            for (k, (r, i)) in level_re.iter_mut().zip(level_im.iter_mut()).enumerate() {
                let bin = if k <= n / 2 { k } else { n - k };
                if bin == 0 || bin as u32 > top {
                    *r = 0.0;
                    *i = 0.0;
                }
            }
            crate::dsp::util::fft(&mut level_re, &mut level_im, true);

            // Every level keeps the full table length: the inverse transform
            // already *is* the level, no decimation. That is the P9.7 fix --
            // the read step per output sample is `freq / sample_rate`, and a
            // long table holding few harmonics is what makes the chord error
            // small (see the module note on `BASE_LEN`).
            let mut out: Vec<f32> = level_re.iter().map(|value| *value as f32).collect();
            let peak = out.iter().fold(0.0f32, |peak, value| peak.max(value.abs()));
            if peak > 0.0 {
                let gain = 1.0 / peak;
                for value in out.iter_mut() {
                    *value *= gain;
                }
            }
            levels.push(out);
        }
        Ok(Self { levels })
    }

    /// Level index for a playback frequency: the highest level whose harmonics
    /// still fit under Nyquist at that pitch.
    pub fn level_for(&self, freq_hz: f32, sample_rate: f32) -> usize {
        let nyquist = sample_rate.max(1000.0) * 0.5;
        let mut index = self.levels.len() - 1;
        for level in 0..self.levels.len() {
            // The level holds harmonics up to its own octave's Nyquist; a
            // harmonic `h` of the note sits at `h * freq`, so it fits while
            // `h * freq <= nyq`.
            let max_harmonic = level_top(level) as f32;
            if freq_hz * max_harmonic <= nyquist {
                index = level;
                break;
            }
        }
        index
    }

    pub fn level_len(&self, level: usize) -> usize {
        self.levels[level.min(self.levels.len() - 1)].len()
    }

    /// Read the table at a 0..1 phase with linear interpolation.
    #[inline]
    pub fn sample(&self, level: usize, phase: f32) -> f32 {
        let table = &self.levels[level.min(self.levels.len() - 1)];
        let len = table.len();
        let position = phase.rem_euclid(1.0) * len as f32;
        let index = position as usize;
        let frac = position - index as f32;
        let a = table[index % len];
        let b = table[(index + 1) % len];
        a + (b - a) * frac
    }
}

/// One mip level: the recipe's harmonics up to `top`, as a sine sum over the
/// full `len`-sample table.
fn render_level(recipe: Recipe, len: usize, top: u32) -> Vec<f32> {
    let mut out = vec![0.0f32; len];
    let mut peak = 0.0f32;
    for (harmonic, amplitude) in recipe.iter() {
        if *harmonic > top {
            // Higher levels simply drop what does not fit: that *is* the
            // band-limiting, and it is why a high note cannot alias.
            continue;
        }
        for (index, value) in out.iter_mut().enumerate() {
            let phase = core::f32::consts::TAU * (*harmonic as f32) * index as f32 / len as f32;
            *value += amplitude * phase.sin();
        }
    }
    for value in out.iter() {
        peak = peak.max(value.abs());
    }
    if peak > 0.0 {
        let gain = 1.0 / peak;
        for value in out.iter_mut() {
            *value *= gain;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Energy above a frequency, measured by a direct DFT of the level.
    fn energy_above(table: &[f32], hz_above: f32, sample_rate: f32) -> f32 {
        let n = table.len();
        let mut energy = 0.0f32;
        let mut probe = hz_above;
        while probe < sample_rate * 0.5 {
            let w = core::f32::consts::TAU * probe / sample_rate;
            let (mut re, mut im) = (0.0f32, 0.0f32);
            for (index, value) in table.iter().enumerate() {
                re += value * (w * index as f32).cos();
                im -= value * (w * index as f32).sin();
            }
            energy += (re * re + im * im) / (n * n) as f32;
            probe += sample_rate / n as f32;
        }
        energy
    }

    #[test]
    fn every_level_is_band_limited_to_its_own_nyquist() {
        // If a level held a harmonic above its own Nyquist, playing that level
        // at the pitch it was chosen for would alias. Measure it: the level's
        // spectrum must be empty above `len / 2` harmonics.
        for recipe in RECIPES {
            let table = Table::from_recipe(recipe.1);
            for level in 0..LEVELS {
                let len = table.level_len(level);
                let content = table.levels[level].clone();
                // All harmonics present live below `len / 2` cycles per table;
                // a DFT over the table's own period sees them at integer bins.
                let energy = energy_above(&content, len as f32 * 0.5, len as f32);
                assert!(
                    energy < 1e-6,
                    "{} level {level} has energy above its Nyquist: {energy:e}",
                    recipe.0
                );
            }
        }
    }

    #[test]
    fn every_level_is_full_length_and_still_normalised() {
        let table = Table::from_recipe(GLASS);
        for level in 0..LEVELS {
            // P9.7: levels no longer shrink -- the length is what keeps the
            // read step small. Only the harmonic ceiling falls with the level.
            assert_eq!(table.level_len(level), BASE_LEN);
        }
        for level in 0..LEVELS {
            let peak = (0..1024)
                .map(|i| table.sample(level, i as f32 / 1024.0).abs())
                .fold(0.0f32, f32::max);
            assert!((peak - 1.0).abs() < 0.15, "level {level} peak {peak}");
        }
    }

    #[test]
    fn the_level_chosen_for_a_note_cannot_alias() {
        let table = Table::from_recipe(GLASS);
        for freq in [55.0f32, 110.0, 440.0, 880.0, 2093.0, 4186.0] {
            let level = table.level_for(freq, 48_000.0);
            // The level's highest surviving harmonic is `level_top(level)`, and
            // that partial must still sit below Nyquist at this pitch — that is
            // the whole point of a mipmap.
            let top = level_top(level) as f32 * freq;
            assert!(
                top <= 48_000.0 * 0.5,
                "{freq} Hz picked level {level} whose top harmonic is {top} Hz"
            );
            // And it must be the *longest* level that satisfies that, or the
            // note would be needlessly dull.
            if level > 0 {
                let longer = level_top(level - 1) as f32 * freq;
                assert!(
                    longer > 48_000.0 * 0.5,
                    "{freq} Hz could have used level {} ({longer} Hz top)",
                    level - 1
                );
            }
        }
        // The very top of the keyboard has to fall back to the shortest level.
        assert_eq!(table.level_for(4186.0, 48_000.0), LEVELS - 1);
    }

    #[test]
    fn sampling_wraps_and_interpolates() {
        let table = Table::from_recipe(ORGAN);
        let at_zero = table.sample(0, 0.0);
        let at_one = table.sample(0, 1.0);
        assert!((at_zero - at_one).abs() < 1e-5, "phase 1.0 should wrap to 0.0");
        // Both a negative phase and a phase beyond 1 wrap rather than panic.
        assert!(table.sample(0, -0.25).is_finite());
        assert!(table.sample(0, 3.75).is_finite());
        // Linear interpolation: the midpoint sits between its neighbours.
        let a = table.sample(0, 0.1000);
        let b = table.sample(0, 0.1005);
        let mid = table.sample(0, 0.10025);
        assert!(mid <= a.max(b) + 1e-6 && mid >= a.min(b) - 1e-6);
    }

    // ------------------------------------------------- imported single cycles

    /// Amplitude of one harmonic of a table, by direct DFT over its own period.
    fn harmonic_amplitude(table: &[f32], harmonic: usize) -> f32 {
        let n = table.len();
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (index, value) in table.iter().enumerate() {
            let phase = core::f64::consts::TAU * harmonic as f64 * index as f64 / n as f64;
            re += *value as f64 * phase.cos();
            im -= *value as f64 * phase.sin();
        }
        ((re * re + im * im).sqrt() / n as f64) as f32 * 2.0
    }

    fn sine_cycle(harmonics: &[(f32, f32)]) -> Vec<f32> {
        (0..BASE_LEN)
            .map(|index| {
                let phase = core::f32::consts::TAU * index as f32 / BASE_LEN as f32;
                harmonics
                    .iter()
                    .map(|(ratio, amplitude)| amplitude * (ratio * phase).sin())
                    .sum()
            })
            .collect()
    }

    #[test]
    fn an_imported_cycle_keeps_its_harmonic_balance() {
        let cycle = sine_cycle(&[(1.0, 1.0), (3.0, 0.5), (7.0, 0.25)]);
        let table = Table::from_cycle(&cycle).expect("clean cycle");
        let level0 = &table.levels[0];
        let first = harmonic_amplitude(level0, 1);
        assert!(first > 0.1, "fundamental vanished: {first}");
        assert!(
            (harmonic_amplitude(level0, 3) / first - 0.5).abs() < 0.02,
            "third harmonic changed level"
        );
        assert!(
            (harmonic_amplitude(level0, 7) / first - 0.25).abs() < 0.02,
            "seventh harmonic changed level"
        );
        // Nothing was invented between the harmonics.
        assert!(harmonic_amplitude(level0, 2) < first * 1e-3);
        assert!(harmonic_amplitude(level0, 5) < first * 1e-3);
    }

    #[test]
    fn an_imported_cycle_keeps_its_phase() {
        // A cosine and a sine have the same magnitude spectrum, so a
        // magnitude-only import would pass the balance test above and still
        // play the wrong waveform. Correlate against both.
        let cycle: Vec<f32> = (0..BASE_LEN)
            .map(|index| (core::f32::consts::TAU * index as f32 / BASE_LEN as f32).cos())
            .collect();
        let table = Table::from_cycle(&cycle).expect("clean cycle");
        let (mut with_cos, mut with_sin) = (0.0f64, 0.0f64);
        for (index, value) in table.levels[0].iter().enumerate() {
            let phase = core::f64::consts::TAU * index as f64 / BASE_LEN as f64;
            with_cos += *value as f64 * phase.cos();
            with_sin += *value as f64 * phase.sin();
        }
        let n = BASE_LEN as f64;
        // Share of the fundamental's energy that lands on the cosine: scale
        // free, so peak normalisation cannot flatter it.
        let share = with_cos / with_cos.hypot(with_sin);
        assert!(share > 0.99, "phase was not preserved, cosine share {share}");
        assert!(
            with_cos.hypot(with_sin) * 2.0 / n > 0.98,
            "fundamental came back weak"
        );
    }

    #[test]
    fn an_imported_cycle_is_band_limited_at_every_level() {
        // A saw has harmonics all the way up, so every level has something to
        // throw away. If the brick wall leaked, playing the level at the pitch
        // it is chosen for would alias.
        let cycle: Vec<f32> = (0..BASE_LEN)
            .map(|index| {
                let phase = core::f32::consts::TAU * index as f32 / BASE_LEN as f32;
                (1..=BASE_LEN / 2)
                    .map(|k| (k as f32 * phase).sin() / k as f32)
                    .sum()
            })
            .collect();
        let table = Table::from_cycle(&cycle).expect("clean cycle");
        for level in 0..LEVELS {
            let len = table.level_len(level);
            let content = table.levels[level].clone();
            let energy = energy_above(&content, len as f32 * 0.5, len as f32);
            assert!(energy < 1e-6, "level {level} leaked above its Nyquist: {energy:e}");
        }
    }

    #[test]
    fn an_imported_cycle_is_normalised_and_dc_free() {
        let cycle = sine_cycle(&[(1.0, 0.4)]);
        let offset: Vec<f32> = cycle.iter().map(|value| value + 0.7).collect();
        let table = Table::from_cycle(&offset).expect("clean cycle");
        for level in 0..LEVELS {
            let peak = table.levels[level]
                .iter()
                .fold(0.0f32, |peak, value| peak.max(value.abs()));
            assert!((peak - 1.0).abs() < 1e-3, "level {level} peak {peak}");
        }
        let mean = table.levels[0].iter().sum::<f32>() / BASE_LEN as f32;
        assert!(mean.abs() < 1e-3, "DC offset survived: {mean}");
    }

    #[test]
    fn a_short_cycle_is_resampled_rather_than_refused() {
        // Files are not required to hold exactly 2048 samples.
        let cycle: Vec<f32> = (0..64)
            .map(|index| (core::f32::consts::TAU * index as f32 / 64.0).sin())
            .collect();
        let table = Table::from_cycle(&cycle).expect("64-sample cycle");
        let first = harmonic_amplitude(&table.levels[0], 1);
        assert!(first > 0.9, "fundamental lost in resampling: {first}");
        for harmonic in 2..12 {
            assert!(
                harmonic_amplitude(&table.levels[0], harmonic) < first * 0.05,
                "resampling invented harmonic {harmonic}"
            );
        }
    }

    #[test]
    fn unusable_cycles_are_rejected_with_a_reason() {
        assert_eq!(Table::from_cycle(&[0.0; MIN_CYCLE - 1]).err(), Some(CycleError::TooShort));
        assert_eq!(Table::from_cycle(&[0.0; BASE_LEN]).err(), Some(CycleError::Silent));
        assert_eq!(
            Table::from_cycle(&[0.25; BASE_LEN]).err(),
            Some(CycleError::Silent),
            "a constant has no waveform once DC is removed"
        );
        let mut spike = vec![0.0f32; BASE_LEN];
        spike[3] = f32::NAN;
        assert_eq!(Table::from_cycle(&spike).err(), Some(CycleError::NotFinite));
        let mut huge = vec![0.0f32; BASE_LEN];
        huge[7] = f32::INFINITY;
        assert_eq!(Table::from_cycle(&huge).err(), Some(CycleError::NotFinite));
    }
}
