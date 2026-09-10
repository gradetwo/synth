/**
 * Practice metronome.
 *
 * Runs on its own Web Audio nodes instead of through the synth, so a click
 * never colours the patch, never lands in a recording and never appears in an
 * export. Clicks are scheduled ahead on the AudioContext clock, which keeps
 * them steady even when the requestAnimationFrame loop stutters — the same
 * trick a DAW uses.
 */

import { engine } from './engine';

/** Lookahead window: schedule every click inside it, nothing further out. */
const HORIZON_S = 0.25;
const CLICK_S = 0.035;

class Metronome {
  enabled = false;
  /** Beats between accents; 0 means "never accent". */
  beatsPerBar = 4;
  private nextBeat = 0;
  private node: GainNode | null = null;

  /** Route clicks straight to the destination, outside the synth graph. */
  private ensureNode(ctx: AudioContext): GainNode {
    if (this.node && this.node.context === ctx) return this.node;
    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    gain.connect(ctx.destination);
    this.node = gain;
    return gain;
  }

  /** Start counting from `fromSongTime` (negative for a count-in). */
  arm(fromSongTime: number, bpm: number): void {
    const beat = 60 / Math.max(20, bpm);
    // Snap the first click onto the beat grid so the count-in lines up.
    this.nextBeat = Math.ceil(fromSongTime / beat - 1e-6) * beat;
  }

  stop(): void {
    this.nextBeat = 0;
    const ctx = engine.ctx;
    if (this.node && ctx) {
      // Cut any click that is still ringing.
      this.node.gain.cancelScheduledValues(ctx.currentTime);
      this.node.gain.setValueAtTime(0, ctx.currentTime);
      this.node.gain.setValueAtTime(0.5, ctx.currentTime + 0.01);
    }
  }

  /**
   * Schedule every click up to `songTime + HORIZON_S`.
   *
   * `songTime` is the player's position and `now` the AudioContext time it
   * corresponds to, so a click at song time `t` is scheduled at
   * `now + (t - songTime) / rate`.
   */
  schedule(songTime: number, rate: number, bpm: number, now: number): void {
    if (!this.enabled) return;
    const ctx = engine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const node = this.ensureNode(ctx);
    const beat = 60 / Math.max(20, bpm);
    while (this.nextBeat < songTime + HORIZON_S) {
      const at = now + (this.nextBeat - songTime) / Math.max(0.05, rate);
      if (at >= ctx.currentTime) {
        const index = Math.round(this.nextBeat / beat);
        const accented = this.beatsPerBar > 0 && ((index % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar === 0;
        this.click(node, ctx, at, accented, this.nextBeat < 0);
      }
      this.nextBeat += beat;
      // A long stall must not schedule a burst of clicks.
      if (this.nextBeat < songTime - 1) this.nextBeat = songTime;
    }
  }

  private click(node: GainNode, ctx: AudioContext, at: number, accented: boolean, countIn: boolean): void {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    // The count-in is a touch quieter and higher so it reads as "get ready".
    const freq = countIn ? 1320 : accented ? 1760 : 1174;
    const peak = countIn ? 0.35 : accented ? 0.7 : 0.45;
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_S);
    osc.connect(env);
    env.connect(node);
    osc.start(at);
    osc.stop(at + CLICK_S + 0.01);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
}

export const metronome = new Metronome();
