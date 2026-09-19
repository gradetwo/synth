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
import { barBeatAt, beatsToSeconds, secondsToBeats, type TempoSegment } from '@/midi/tempo';

/** Lookahead window: schedule every click inside it, nothing further out. */
const HORIZON_S = 0.25;
const CLICK_S = 0.035;

class Metronome {
  enabled = false;
  /** Beats between accents; 0 means "never accent". */
  beatsPerBar = 4;
  /** Next beat to click, in beats from the top of the song. */
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

  /**
   * Start counting from `fromSongTime` (negative for a count-in).
   *
   * The position is kept in *beats* rather than seconds, so a tempo map needs no
   * special handling: each click is converted to a time through the map, and a
   * change of tempo is simply the next beat being somewhere else.
   */
  arm(fromSongTime: number, map: TempoSegment[]): void {
    const beat = secondsToBeats(map, fromSongTime);
    this.nextBeat = Math.ceil(beat - 1e-6);
    if (this.nextBeat < beat) this.nextBeat += 1;
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
  schedule(songTime: number, rate: number, map: TempoSegment[], now: number): void {
    if (!this.enabled) return;
    const ctx = engine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const node = this.ensureNode(ctx);
    for (let guard = 0; guard < 512; guard += 1) {
      const beat = this.nextBeat;
      const at = beatsToSeconds(map, beat);
      if (at >= songTime + HORIZON_S) break;
      const when = now + (at - songTime) / Math.max(0.05, rate);
      if (when >= ctx.currentTime) {
        const where = barBeatAt(map, beat);
        // The first beat of a bar is the loud one; the count-in is quieter and
        // pitched differently (see `click`).
        this.click(node, ctx, when, where.beat === 1, at < 0);
      }
      this.nextBeat = beat + 1;
      // A long stall must not schedule a burst of clicks.
      if (beatsToSeconds(map, this.nextBeat) < songTime - 1) this.nextBeat = secondsToBeats(map, songTime);
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
