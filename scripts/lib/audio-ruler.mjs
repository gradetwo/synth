/**
 * The rulers: how the gate (and the P13 tools) turn a render into a number.
 *
 * Two independent windowed measures live here on purpose, and the gate asserts
 * with both:
 *
 *   * `offGridFloor` -- a 7-term Blackman-Harris window over a whole
 *     four-second render, zero-padded to an FFT, exact bins, +-8 bins excluded
 *     around every harmonic. The P9.1a post-mortem is why: the exact-bin
 *     Parseval measure this replaced was a difference of two nearly equal large
 *     numbers, and no oscillator sits on a whole number of analysis periods.
 *     The 7-term window's -180 dB sidelobes make what is left the engine's own
 *     off-grid energy.
 *   * `binMagHann` -- a Hann-windowed single-frequency Goertzel (P9.7), read at
 *     frequencies in the gaps between harmonics. It answers a different
 *     question: not "how much total off-grid power" but "how tall is the floor
 *     at this exact frequency".
 *
 * Plus the plain tools -- `fftInPlace`, `binMag`, `binMagRect`, `spectrum`,
 * `thdPercent`, `interHarmonicDb` -- and the oversampling comparison
 * (`aliasFloor`), which the P6.5 chain section and the P9.4 graph section share
 * so the two can never drift apart.
 *
 * **Which layer this measures.** The samples come from `render-core.mjs`: the
 * wasm core run in Node, with no AudioWorklet and no Web Audio graph in front
 * of it. The rulers are layer-blind -- they will measure whatever buffer they
 * are handed -- but the *pipeline* is not, so a browser-side problem (AudioParam
 * ranges, automation timing: the v2.0.7 ten-preset clamp bug) is invisible
 * here. Browser-layer rulers are P13.4.
 *
 * The formulas and window coefficients are moved **verbatim** from
 * `verify-audio.mjs`. P13.1 is a refactor: nothing here may change a number.
 * The `why` comments travelled with the code.
 */
import { SR, BLOCK, P, WAVE, engine, render, clearModMatrix } from './render-core.mjs';

/** Iterative radix-2 FFT, in place, on a Float64Array pair. */
export function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + half] * cr - im[i + j + half] * ci;
        const vi = re[i + j + half] * ci + im[i + j + half] * cr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 7-term Blackman-Harris, the minimum-sidelobe member of the family. */
export const BH7 = [
  0.27105140069342, 0.43329793923448, 0.21812299954311, 0.06592544638803,
  0.01081174209837, 0.00077658482522, 0.00001388721735,
];

export function bh7Window(n, N) {
  let v = BH7[0];
  for (let k = 1; k < BH7.length; k++) {
    v += (k % 2 ? -1 : 1) * BH7[k] * Math.cos((2 * Math.PI * k * n) / (N - 1));
  }
  return v;
}

/** The alias ruler's exclusion half-width, in bins of its four-second window. */
export const FLOOR_BINS = 8;

/**
 * The share of a settled render's power that is *not* on the harmonic grid of
 * `f0`, in dB. The window is a 7-term Blackman-Harris over the whole render,
 * zero-padded to the next power of two; `bins` bins either side of every
 * harmonic are excluded (the gate's own ±8; P13.2's `gs1.gate` can ask for a
 * different width, which is why it is a parameter with the gate's value as the
 * default and not a second function). At four seconds a bin is 0.25 Hz and the
 * window's own main lobe is +-1.75 Hz, so the exclusion covers the lobe and no
 * line power can be mistaken for off-grid energy.
 */
export function offGridFloor(samples, f0, bins = FLOOR_BINS) {
  const N = samples.length;
  let nfft = 1;
  while (nfft < N) nfft <<= 1;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < N; i++) re[i] = samples[i] * bh7Window(i, N);
  fftInPlace(re, im);
  const half = nfft >> 1;
  const df = SR / nfft;
  const exHz = (bins * SR) / N;
  const excluded = new Uint8Array(half);
  for (let k = 1; k * f0 < SR / 2 + exHz; k++) {
    const centre = k * f0;
    const lo = Math.max(0, Math.ceil((centre - exHz) / df));
    const hi = Math.min(half - 1, Math.floor((centre + exHz) / df));
    for (let b = lo; b <= hi; b++) excluded[b] = 1;
  }
  let off = 0;
  let total = 0;
  for (let b = 0; b < half; b++) {
    const p = re[b] * re[b] + im[b] * im[b];
    total += p;
    if (!excluded[b]) off += p;
  }
  return 10 * Math.log10(Math.max(off, 1e-300) / Math.max(total, 1e-300));
}

/** Windowed single-bin magnitude (Hann window, same maths as the Rust tests). */
export function binMag(samples, freq) {
  const n = samples.length;
  const w = (2 * Math.PI * freq) / SR;
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    const v = samples[i] * win;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return (Math.hypot(re, im) / n) * 2;
}

/**
 * Radix-2 FFT magnitude spectrum, Blackman-Harris windowed.
 *
 * The gate needs the frequency domain, not just levels: a filter that drops a
 * sample at every render-block boundary is a click train, and a click train is
 * broadband noise — invisible to a peak or RMS check, obvious in a spectrum.
 *
 * The window has to be this good: a Hann window's own sidelobes sit around
 * -46 dB a few bins away from a strong partial, which is indistinguishable from
 * real broadband junk. Blackman-Harris puts them below -92 dB, so whatever the
 * "everything that is not a harmonic" number reports is the signal, not the
 * measurement.
 */
export function spectrum(samples, n = 8192) {
  const BH = [0.35875, 0.48829, 0.14128, 0.01168];
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const src = samples[i] ?? 0;
    const t = (2 * Math.PI * i) / n;
    const win =
      BH[0] - BH[1] * Math.cos(t) + BH[2] * Math.cos(2 * t) - BH[3] * Math.cos(3 * t);
    re[i] = src * win;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / n;
  return mag;
}

/** Rectangular-window single-bin amplitude (no leakage on an exact bin). */
export const binMagRect = (samples, freq) => {
  const w = (2 * Math.PI * freq) / SR;
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
  }
  return Math.hypot(re, im) / samples.length;
};
/**
 * The fixture every alias measurement renders: one quiet, unmodulated sine with
 * the whole rest of the engine spelled out, so a measurement does not depend on
 * where in the file it sits. `aliasFloor` and 4c's delay probe both build on it.
 */
export const aliasBase = [
  [P.OSC1_ON, 1], [P.OSC1_WAVE, WAVE.sine], [P.OSC1_LEVEL, 0.8],
  // One voice, on pitch: unison, detune and microtuning are all state a
  // previous scenario may have left behind, and all three would move the
  // harmonics off the bins the measurement subtracts.
  [P.OSC1_PITCH, 0], [P.OSC1_DETUNE, 0], [P.OSC1_UNISON, 1], [P.OSC1_SPREAD, 0],
  [P.OSC1_SYNC, 0], [P.OSC1_SUB, 0], [P.OSC1_SUB_LEVEL, 0], [P.MASTER_TUNE, 0],
  [P.OSC2_ON, 0], [P.OSC2_LEVEL, 0],
  [P.OSC2_PITCH, 0], [P.OSC2_DETUNE, 0], [P.OSC2_UNISON, 1], [P.OSC2_SPREAD, 0],
  [P.OSC_FM, 0], [P.OSC_RING, 0], [P.NOISE_MIX, 0], [P.VOICE_MODE, 0],
  [P.FILTER_TYPE, 0], [P.FILTER_CUTOFF, 20000], [P.FILTER_RES, 0.1],
  [P.FILTER_DRIVE, 0], [P.FILTER_ENV_AMT, 0], [P.FILTER_KBD, 0],
  // No second stage: the whole scenario is spelled out, so the measurement
  // does not depend on where in the file it sits.
  [P.FILTER_ROUTING, 0], [P.FILTER_MORPH, 0], [P.FILTER2_TYPE, 0],
  [P.FILTER2_CUTOFF, 20000], [P.FILTER2_RES, 0], [P.FILTER2_DRIVE, 0],
  [P.ENV_ATTACK, 0.01], [P.ENV_SUSTAIN, 1],
  [P.LFO_ON, 0], [P.LFO2_ON, 0],
  [P.FX_REVERB_ON, 0], [P.FX_DELAY_ON, 0], [P.FX_CHORUS_ON, 0],
  [P.FX_FLANGER_ON, 0], [P.FX_PHASER_ON, 0],
  [P.FX_CRUSH_ON, 0], [P.FX_EQ_ON, 0], [P.FX_TRANSIENT_ON, 0],
  // Master volume low enough that the master limiter stays linear: its
  // gain loop is time-varying and would be counted as non-harmonic
  // energy that no amount of oversampling can remove.
  [P.MASTER_VOLUME, 0.1],
];

/**
 * Non-harmonic energy in dB below the signal's own RMS. Parseval rather than
 * a list of probed frequencies: the folds land at `n * fs - k * f0`, which is
 * not a fixed fraction of the grid, and probing the wrong bins would report
 * the noise floor and call it a pass.
 */
export const aliasFloor = (extra) => {
  engine(
    [
      ...aliasBase,
      ...extra,
    ],
    [[ALIAS_NOTE, 1]],
  );
  clearModMatrix();
  const rendered = render(20 + ALIAS_SKIP + ALIAS_BLOCKS);
  const buf = [];
  for (let b = ALIAS_SKIP; b < ALIAS_SKIP + ALIAS_BLOCKS; b++) {
    for (const v of rendered[b][0]) buf.push(v);
  }
  const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
  let harmonics = 0;
  for (let k = 1; k * ALIAS_F0 < SR / 2; k++) {
    const m = binMagRect(buf, k * ALIAS_F0);
    // A sinusoid of amplitude A reads |sum|/N = A/2, so its power is 2m^2.
    harmonics += 2 * m * m;
  }
  const folded = Math.max(rms * rms - harmonics, 1e-30);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  return {
    db: 10 * Math.log10(folded / Math.max(rms * rms, 1e-30)),
    fund: binMagRect(buf, ALIAS_F0) * 2,
    samples: buf.length,
    rms,
    peak,
  };
};
export const ALIAS_NOTE = 45;
export const ALIAS_F0 = 440 * 2 ** ((ALIAS_NOTE - 69) / 12);
export const ALIAS_BLOCKS = (1 * SR) / BLOCK; // one whole second
export const ALIAS_SKIP = 400; // let the attack and the limiter settle (P9.1a: was 240)

// The second, independent ruler. C7 is the note whose 4 s hold **exactly 8372
// cycles** (4 * 2093 = 8372), so at C7 every harmonic sits on a whole-Hz
// frequency and the gaps between them are several hundred Hz wide. A Hann
// window read at a single frequency in one of those gaps (Goertzel, no DFT
// bin) therefore sees *only* what the source puts there: the window keeps the
// neighbouring harmonic lines 100+ dB down and the probe is far from any of
// them. This is a different question from the BH-7 ruler above -- that one
// integrates the whole off-grid spectrum with a window chosen for its -180 dB
// sidelobes, this one reads the height of the floor at a handful of exact
// frequencies. It is reported as a ratio to the fundamental.
//
// The P9.5 review's second ruler was a *rectangular* window over the same 8372
// cycles. At the -30 dB it was measuring that was fine; P9.7's fix dropped the
// floor by another 70 dB and exposed the ruler's own limit -- a rectangular
// window's sidelobes decay as 1/bin, so with harmonic lines this strong the
// gap bins hold about -13 dB of leakage no matter what the source does. It is
// kept in `docs/notes/band-limited-oscillators.md` §P9.7 as the measurement
// lesson; the Hann probe below is what replaced it.
export const binMagHann = (samples, freq) => {
  const n = samples.length;
  const w = (2 * Math.PI * freq) / SR;
  let re = 0;
  let im = 0;
  let windowSum = 0;
  for (let i = 0; i < n; i++) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n);
    const v = samples[i] * win;
    re += v * Math.cos(w * i);
    im -= v * Math.sin(w * i);
    windowSum += win;
  }
  return (Math.hypot(re, im) / windowSum) * 2;
};

/**
 * THD as a percentage of the fundamental: the RMS sum of harmonics 2..`maxHarmonic`
 * read with `binMag`, against the fundamental read the same way. Extracted from
 * the gate's distortion section, which is where the 12-harmonic form was fitted.
 */
export function thdPercent(samples, f0, maxHarmonic = 12, fundamentalFloor = 1e-9) {
  const fund = binMag(samples, f0);
  let harmonics = 0;
  for (let k = 2; k <= maxHarmonic; k++) harmonics += binMag(samples, f0 * k) ** 2;
  return (Math.sqrt(harmonics) / Math.max(fund, fundamentalFloor)) * 100;
}

/**
 * The energy that sits *between* a tone's harmonics, in dB below the signal's
 * own mean square: the sum of `binMag` at every half-harmonic below `limitHz`
 * against the render's power. This is where folded partials land, so it is the
 * aliasing number the C7 wave scan and the imported-saw scan both print.
 */
export function interHarmonicDb(samples, f0, limitHz = 20000) {
  let between = 0;
  let k = 1;
  while (f0 * (k + 0.5) < limitHz) {
    between += binMag(samples, f0 * (k + 0.5)) ** 2;
    k += 1;
  }
  const signal = samples.reduce((sum, v) => sum + v * v, 0) / samples.length;
  return 10 * Math.log10(between / Math.max(signal, 1e-12));
}
