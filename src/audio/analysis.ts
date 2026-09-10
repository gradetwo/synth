/**
 * Live analysis bus.
 *
 * The worklet posts a compact analysis frame every few blocks; this module keeps
 * the latest copy so canvas components can read it inside their own rAF loop
 * without causing a React re-render 60 times a second.
 */

import { engine } from './engine';

export const analysis = {
  spectrum: new Float32Array(36),
  peaks: new Float32Array(36),
  peakL: 0,
  peakR: 0,
  voices: 0,
  violations: 0,
  /** True-peak estimate of the last analysis window (linear). */
  truePeak: 0,
  /** Short-term output RMS (linear). */
  loudness: 0,
  /** Limiter gain reduction, 1.0 = none. */
  limit: 1,
  frames: 0,
};

let wired = false;

export function wireAnalysis() {
  if (wired) return;
  wired = true;
  engine.onAnalysis((frame) => {
    analysis.spectrum.set(frame.spectrum);
    analysis.peakL = frame.peakL;
    analysis.peakR = frame.peakR;
    analysis.voices = frame.voices;
    analysis.violations = frame.violations;
    analysis.truePeak = frame.truePeak;
    analysis.loudness = frame.loudness;
    analysis.limit = frame.limit;
    analysis.frames += 1;
    for (let i = 0; i < analysis.spectrum.length; i++) {
      const v = analysis.spectrum[i];
      analysis.peaks[i] = Math.max(analysis.peaks[i] - 0.012, v);
    }
  });
}
