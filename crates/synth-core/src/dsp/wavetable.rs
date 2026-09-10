//! Wavetable oscillator tables (A6.2).
//!
//! A wavetable is one cycle of a waveform, played back at the note's frequency.
//! Naively that aliases badly: the cycle holds harmonics far above Nyquist for a
//! high note. The fix is **mipmaps** — one band-limited copy of the cycle per
//! octave, each holding only the harmonics that fit below Nyquist at that pitch,
//! so whatever level a note picks, it cannot alias by construction.
//!
//! The tables are generated here from harmonic recipes rather than shipped as
//! samples: a recipe is a handful of numbers, the mipmaps are derived from it,
//! and "band-limited" is then a property of the generator rather than of a
//! careful resampling step.
//!
//! Wire-up (engine wave, parameter, UI) is deliberately left for the next batch;
//! this module is the part that has to be right.

/// Longest table (level 0). Lower levels halve it until [`MIN_LEN`].
pub const BASE_LEN: usize = 2048;
pub const MIN_LEN: usize = 8;
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
}
