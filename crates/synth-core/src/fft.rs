//! Spectrum analysis for the on-screen analyser.
//!
//! prd.md §2.1 selects an FFT for spectral analysis. To keep the WASM core
//! dependency-free and fully offline we implement an in-place iterative
//! radix-2 FFT (the same algorithm rustfft uses for power-of-two sizes) plus
//! logarithmic band mapping. 512 points at 48 kHz gives ~94 Hz resolution,
//! which is plenty for a 36-band display.

use crate::params::SPECTRUM_BINS;

pub const FFT_SIZE: usize = 512;
const HALF: usize = FFT_SIZE / 2;

#[derive(Clone, Copy)]
pub struct Spectrum {
    re: [f32; FFT_SIZE],
    im: [f32; FFT_SIZE],
    tw_re: [f32; HALF],
    tw_im: [f32; HALF],
    window: [f32; FFT_SIZE],
    bins: [f32; SPECTRUM_BINS],
    peaks: [f32; SPECTRUM_BINS],
    initialised: bool,
}

impl Spectrum {
    pub const fn new() -> Self {
        Self {
            re: [0.0; FFT_SIZE],
            im: [0.0; FFT_SIZE],
            tw_re: [0.0; HALF],
            tw_im: [0.0; HALF],
            window: [0.0; FFT_SIZE],
            bins: [0.0; SPECTRUM_BINS],
            peaks: [0.0; SPECTRUM_BINS],
            initialised: false,
        }
    }

    /// Precompute twiddle factors and the Hann window. Called once from
    /// `gs_init`; never allocates.
    pub fn init(&mut self) {
        if self.initialised {
            return;
        }
        let n = FFT_SIZE as f32;
        for k in 0..HALF {
            let angle = core::f32::consts::TAU * (k as f32) / n;
            self.tw_re[k] = angle.cos();
            self.tw_im[k] = -angle.sin();
        }
        for (i, w) in self.window.iter_mut().enumerate() {
            let p = i as f32 / (FFT_SIZE as f32 - 1.0);
            *w = 0.5 - 0.5 * (core::f32::consts::TAU * p).cos();
        }
        self.initialised = true;
    }

    pub fn reset(&mut self) {
        self.bins = [0.0; SPECTRUM_BINS];
        self.peaks = [0.0; SPECTRUM_BINS];
    }

    pub fn bins(&self) -> &[f32; SPECTRUM_BINS] {
        &self.bins
    }

    /// Analyse one block of mono samples. `samples` is zero-padded/truncated to
    /// `FFT_SIZE`. Returns the smoothed logarithmic magnitudes.
    pub fn analyze(&mut self, samples: &[f32], sample_rate: f32) -> &[f32; SPECTRUM_BINS] {
        if !self.initialised {
            self.init();
        }
        let n = samples.len().min(FFT_SIZE);
        for i in 0..FFT_SIZE {
            let s = if i < n { samples[i] } else { 0.0 };
            self.re[i] = s * self.window[i];
            self.im[i] = 0.0;
        }
        self.fft();
        self.map_bins(sample_rate);
        &self.bins
    }

    fn fft(&mut self) {
        // Bit-reversal permutation.
        let mut j = 0usize;
        for i in 1..FFT_SIZE {
            let mut bit = FFT_SIZE >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j |= bit;
            if i < j {
                self.re.swap(i, j);
                self.im.swap(i, j);
            }
        }

        let mut len = 2usize;
        while len <= FFT_SIZE {
            let half = len >> 1;
            let step = FFT_SIZE / len;
            let mut base = 0usize;
            while base < FFT_SIZE {
                let mut k = 0usize;
                for offset in 0..half {
                    let i = base + offset;
                    let j = i + half;
                    let wr = self.tw_re[k];
                    let wi = self.tw_im[k];
                    let xr = self.re[j];
                    let xi = self.im[j];
                    let tr = xr * wr - xi * wi;
                    let ti = xr * wi + xi * wr;
                    self.re[j] = self.re[i] - tr;
                    self.im[j] = self.im[i] - ti;
                    self.re[i] += tr;
                    self.im[i] += ti;
                    k += step;
                }
                base += len;
            }
            len <<= 1;
        }
    }

    fn map_bins(&mut self, sample_rate: f32) {
        let bin_hz = sample_rate / FFT_SIZE as f32;
        let low = 30.0f32;
        let high = 18000.0f32.min(sample_rate * 0.5 - bin_hz);
        let log_low = low.ln();
        let log_high = high.ln();
        let norm = 2.0 / FFT_SIZE as f32;

        for band in 0..SPECTRUM_BINS {
            let t0 = band as f32 / SPECTRUM_BINS as f32;
            let t1 = (band + 1) as f32 / SPECTRUM_BINS as f32;
            let f0 = (log_low + (log_high - log_low) * t0).exp();
            let f1 = (log_low + (log_high - log_low) * t1).exp();
            let mut k0 = (f0 / bin_hz).floor() as usize;
            let mut k1 = (f1 / bin_hz).ceil() as usize;
            k0 = k0.clamp(1, HALF - 1);
            k1 = k1.clamp(k0 + 1, HALF);

            let mut mag = 0.0f32;
            for k in k0..k1 {
                let re = self.re[k];
                let im = self.im[k];
                let m = (re * re + im * im).sqrt();
                if m > mag {
                    mag = m;
                }
            }
            // Convert to a display curve: dBFS-ish, then compress.
            let db = 20.0 * (mag * norm + 1e-9).log10();
            let v = ((db + 78.0) / 78.0).clamp(0.0, 1.0);
            let v = v.powf(1.35);

            let smoothed = if v > self.bins[band] {
                v
            } else {
                self.bins[band] * 0.82 + v * 0.18
            };
            self.bins[band] = smoothed;
            self.peaks[band] = (self.peaks[band] - 0.012).max(smoothed);
        }
    }
}

impl Default for Spectrum {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, sample_rate: f32) -> [f32; FFT_SIZE] {
        let mut buf = [0.0f32; FFT_SIZE];
        for (i, s) in buf.iter_mut().enumerate() {
            *s = (core::f32::consts::TAU * freq * i as f32 / sample_rate).sin();
        }
        buf
    }

    #[test]
    fn fft_peaks_at_input_frequency() {
        let mut spec = Spectrum::new();
        let sr = 48000.0;
        let buf = sine(1000.0, sr);
        spec.analyze(&buf, sr);
        // FFT bin index of 1 kHz is round(1000 / 93.75) = 11.
        let mut best = 0;
        let mut best_mag = 0.0;
        for k in 1..HALF {
            let m = (spec.re[k] * spec.re[k] + spec.im[k] * spec.im[k]).sqrt();
            if m > best_mag {
                best_mag = m;
                best = k;
            }
        }
        assert!((best as i32 - 11).abs() <= 1, "peak bin was {best}");
    }

    #[test]
    fn spectrum_magnitudes_are_normalised() {
        let mut spec = Spectrum::new();
        let buf = sine(440.0, 48000.0);
        let bins = spec.analyze(&buf, 48000.0);
        for &v in bins.iter() {
            assert!((0.0..=1.0).contains(&v), "bin out of range: {v}");
        }
        let peak = bins.iter().cloned().fold(0.0f32, f32::max);
        assert!(peak > 0.2, "expected a visible peak, got {peak}");
    }

    #[test]
    fn silence_decays_to_zero() {
        let mut spec = Spectrum::new();
        let loud = sine(1000.0, 48000.0);
        spec.analyze(&loud, 48000.0);
        let silent = [0.0f32; FFT_SIZE];
        for _ in 0..120 {
            spec.analyze(&silent, 48000.0);
        }
        let peak = spec.bins.iter().cloned().fold(0.0f32, f32::max);
        assert!(peak < 0.01, "spectrum did not decay: {peak}");
    }
}
