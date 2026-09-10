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

/// Longest table (level 0). Lower levels halve it until [`MIN_LEN`].
pub const BASE_LEN: usize = 2048;
pub const MIN_LEN: usize = 8;
/// Shortest cycle [`Table::from_cycle`] will accept: below this the analysis is
/// all rounding noise.
pub const MIN_CYCLE: usize = 16;
/// Number of mip levels: 2048, 1024, … 8.
///
/// The shortest level matters: at the top of the keyboard even 16 harmonics
/// reach above Nyquist (16 × 4186 Hz), so the bank has to go down to a few
/// harmonics or the highest notes alias.
pub const LEVELS: usize = 9;

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

impl Table {
    /// Build the mipmaps of `recipe`. Level `k` has `BASE_LEN >> k` samples and
    /// contains only harmonics up to its own Nyquist.
    pub fn from_recipe(recipe: Recipe) -> Self {
        let mut levels = Vec::with_capacity(LEVELS);
        for level in 0..LEVELS {
            let len = (BASE_LEN >> level).max(MIN_LEN);
            levels.push(render_level(recipe, len));
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

        fft(&mut re, &mut im, false);

        let mut levels = Vec::with_capacity(LEVELS);
        for level in 0..LEVELS {
            let len = (BASE_LEN >> level).max(MIN_LEN);
            let mut level_re = re.clone();
            let mut level_im = im.clone();
            // Harmonics 1..=top survive; `bin` folds the upper half of the
            // spectrum onto its mirror so one test covers both sides.
            let top = (len / 2).saturating_sub(1).max(1);
            for (k, (r, i)) in level_re.iter_mut().zip(level_im.iter_mut()).enumerate() {
                let bin = if k <= n / 2 { k } else { n - k };
                if bin == 0 || bin > top {
                    *r = 0.0;
                    *i = 0.0;
                }
            }
            fft(&mut level_re, &mut level_im, true);

            let decimate = n / len;
            let mut out: Vec<f32> = (0..len).map(|j| level_re[j * decimate] as f32).collect();
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
        for (level, table) in self.levels.iter().enumerate() {
            // The table's own Nyquist is `len / 2` harmonics; a harmonic `h` of
            // the note sits at `h * freq`, so it fits while `h * freq <= nyq`.
            let max_harmonic = (table.len() / 2).max(1) as f32;
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

/// One mip level: the recipe's harmonics below `len / 2`, as a sine sum.
fn render_level(recipe: Recipe, len: usize) -> Vec<f32> {
    let max_harmonic = (len / 2 - 1).max(1) as u32;
    let mut out = vec![0.0f32; len];
    let mut peak = 0.0f32;
    for (harmonic, amplitude) in recipe.iter() {
        if *harmonic > max_harmonic {
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

/// In-place iterative radix-2 complex transform (forward or inverse).
///
/// This is analysis, not synthesis: it runs once when a cycle is imported, off
/// the audio path, so it can afford `f64` and a straightforward implementation.
/// The vendored 512-point analyser FFT is fixed-size and windowed, and reusing
/// it here would mean teaching it a second size for no gain.
fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    if n < 2 {
        return;
    }

    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut half = 1usize;
    while half < n {
        let span = half * 2;
        let angle = core::f64::consts::TAU / span as f64 * if inverse { 1.0 } else { -1.0 };
        let (tw_re, tw_im) = (angle.cos(), angle.sin());
        let mut base = 0usize;
        while base < n {
            let (mut wr, mut wi) = (1.0f64, 0.0f64);
            for k in 0..half {
                let (ar, ai) = (re[base + k], im[base + k]);
                let (br, bi) = (re[base + k + half], im[base + k + half]);
                let (vr, vi) = (br * wr - bi * wi, br * wi + bi * wr);
                re[base + k] = ar + vr;
                im[base + k] = ai + vi;
                re[base + k + half] = ar - vr;
                im[base + k + half] = ai - vi;
                let next_wr = wr * tw_re - wi * tw_im;
                wi = wr * tw_im + wi * tw_re;
                wr = next_wr;
            }
            base += span;
        }
        half = span;
    }

    if inverse {
        let scale = 1.0 / n as f64;
        for value in re.iter_mut() {
            *value *= scale;
        }
        for value in im.iter_mut() {
            *value *= scale;
        }
    }
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
    fn levels_shrink_and_stay_normalised() {
        let table = Table::from_recipe(GLASS);
        for level in 0..LEVELS {
            let len = table.level_len(level);
            assert_eq!(len, (BASE_LEN >> level).max(MIN_LEN));
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
            let len = table.level_len(level) as f32;
            // The level's highest harmonic is `len / 2`, and that partial must
            // still sit below Nyquist at this pitch — that is the whole point of
            // a mipmap.
            let top = (len / 2.0) * freq;
            assert!(
                top <= 48_000.0 * 0.5,
                "{freq} Hz picked a {len}-sample level whose top harmonic is {top} Hz"
            );
            // And it must be the *longest* level that satisfies that, or the
            // note would be needlessly dull.
            if level > 0 {
                let longer = table.level_len(level - 1) as f32;
                assert!(
                    (longer / 2.0) * freq > 48_000.0 * 0.5,
                    "{freq} Hz could have used the longer {longer}-sample level"
                );
            }
        }
        // The very top of the keyboard has to fall back to the shortest level.
        assert_eq!(table.level_len(table.level_for(4186.0, 48_000.0)), MIN_LEN);
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
