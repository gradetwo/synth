/**
 * MIDI player.
 *
 * Drives `noteBus` from a flat note list. A requestAnimationFrame loop advances
 * song time and fires the note-on/off events whose timestamps have passed; the
 * resolution (~16 ms) is fine for a demo player and keeps the scheduler simple
 * and dependency-free.
 */

import { engine } from '@/audio/engine';
import { metronome } from '@/audio/metronome';
import { noteBus } from '@/audio/noteBus';
import { songTracks, type MidiSong } from './smf';

interface TimedEvent {
  t: number;
  note: number;
  on: boolean;
  velocity: number;
  /** Stereo position of the layer the note belongs to (-1..1). */
  pan: number;
}

export interface PlayerState {
  playing: boolean;
  /** Song position in seconds. */
  time: number;
  duration: number;
  loop: boolean;
  /** Tempo multiplier, 1 = as written. */
  rate: number;
  /** Semitone transposition applied at playback. */
  transpose: number;
  /** A/B loop region in seconds; both null when the whole song loops. */
  loopStart: number | null;
  loopEnd: number | null;
  /** Metronome click on every beat. */
  metronome: boolean;
  /** One bar of clicks before the song starts. */
  countIn: boolean;
}

/** Mute, solo and level per file track. */
export interface LayerState {
  name: string;
  muted: boolean;
  soloed: boolean;
  /** 0..1, applied to the layer's note velocities when it is scheduled. */
  volume: number;
  /** Seconds this layer is shifted by (negative = earlier). */
  offset: number;
  /** -1 (left) .. 1 (right); the layer's place in the stereo image. */
  pan: number;
}

function buildEvents(song: MidiSong | null, layers: LayerState[]): TimedEvent[] {
  if (!song) return [];
  const events: TimedEvent[] = [];
  // One layer is the normal case and behaves exactly as before; with several,
  // mute and solo decide which of them reach the synth.
  const anySolo = layers.some((layer) => layer.soloed);
  const audible = songTracks(song)
    .map((track, index) => ({
      notes: track.notes,
      volume: layers[index]?.volume ?? 1,
      offset: layers[index]?.offset ?? 0,
      pan: layers[index]?.pan ?? 0,
      layer: layers[index],
    }))
    .filter(({ layer }) => {
      // A song without layer state (hand-built) is all audible.
      if (!layer) return true;
      if (anySolo) return layer.soloed && !layer.muted;
      return !layer.muted;
    });
  for (const { notes, volume, offset, pan } of audible) {
    for (const n of notes) {
      // The layer's level is a velocity scale; a note never fades to nothing,
      // or a quiet layer would silently drop notes instead of playing them
      // softly. The offset slides the whole layer in time; a shifted note that
      // would start before zero is dropped rather than played at the start.
      const start = n.start + offset;
      if (start < 0) continue;
      const velocity = Math.max(1 / 127, Math.min(1, n.velocity * volume));
      events.push({ t: start, note: n.note, on: true, velocity, pan });
      events.push({ t: start + n.duration, note: n.note, on: false, velocity, pan });
    }
  }
  events.sort((a, b) => a.t - b.t || Number(b.on) - Number(a.on));
  return events;
}

export class MidiPlayer {
  private events: TimedEvent[] = [];
  private cursor = 0;
  private active = new Set<number>();
  private raf = 0;
  private resumeElapsed = 0;
  private resumeWall = 0;
  private listeners = new Set<(s: PlayerState) => void>();
  private state: PlayerState = {
    playing: false,
    time: 0,
    duration: 0,
    loop: false,
    rate: 1,
    transpose: 0,
    loopStart: null,
    loopEnd: null,
    metronome: false,
    countIn: false,
  };
  /** Song tempo, used by the metronome. */
  private bpm = 120;
  private song: MidiSong | null = null;
  private layers: LayerState[] = [];

  /** Called when a non-looping song reaches its end. */
  onEnded: (() => void) | null = null;

  load(song: MidiSong | null): void {
    this.stop();
    this.song = song;
    // Layer state is per song: a fresh load starts with everything audible.
    this.layers = song
      ? songTracks(song).map((layer) => ({
          name: layer.name,
          muted: false,
          soloed: false,
          volume: 1,
          offset: 0,
          pan: 0,
        }))
      : [];
    this.events = buildEvents(song, this.layers);
    this.cursor = 0;
    this.bpm = song?.bpm ?? 120;
    // A new song invalidates any loop region from the previous one.
    this.state = {
      ...this.state,
      time: 0,
      duration: song?.duration ?? 0,
      loopStart: null,
      loopEnd: null,
    };
    this.emit();
  }

  /** The current song's layers, for the panel's mute/solo strip. */
  getLayers(): LayerState[] {
    return this.layers;
  }

  setLayer(
    index: number,
    patch: Partial<Pick<LayerState, 'muted' | 'soloed' | 'volume' | 'offset' | 'pan'>>,
  ): void {
    const layer = this.layers[index];
    if (!layer) return;
    const clean: typeof patch = { ...patch };
    if (patch.volume !== undefined) clean.volume = Math.max(0, Math.min(1, patch.volume));
    // Keep a layer inside the song: a minute of offset either way is plenty for
    // nudging an arrangement, and it cannot be dragged out of existence.
    if (patch.offset !== undefined) clean.offset = Math.max(-60, Math.min(60, patch.offset));
    if (patch.pan !== undefined) clean.pan = Math.max(-1, Math.min(1, patch.pan));
    this.layers = this.layers.map((entry, i) => (i === index ? { ...entry, ...clean } : entry));
    this.rebuild();
  }

  /**
   * Rebuild the event list after a mute/solo change. A change while playing
   * takes effect immediately: the notes that are already sounding are released
   * so a muted layer goes quiet instead of ringing on.
   */
  private rebuild(): void {
    const time = this.state.time;
    const playing = this.state.playing;
    this.events = buildEvents(this.song, this.layers);
    if (!playing) {
      this.cursor = 0;
      return;
    }
    for (const note of this.active) engine.noteOff(note);
    this.active.clear();
    this.cursor = this.events.findIndex((event) => event.t >= time);
    if (this.cursor < 0) this.cursor = this.events.length;
  }

  getState(): PlayerState {
    return this.state;
  }

  subscribe(fn: (s: PlayerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  play(): void {
    if (this.state.playing || this.events.length === 0) return;
    if (this.state.time >= this.state.duration - 1e-3) this.seek(0);
    // Starting audio is a user gesture; use it to un-suspend iOS.
    void engine.resumeIfSuspended();
    this.resumeElapsed = this.state.time;
    this.resumeWall = performance.now();
    if (this.state.metronome) {
      const beats = metronome.beatsPerBar > 0 ? metronome.beatsPerBar : 4;
      const bar = (60 / Math.max(20, this.bpm)) * beats;
      const from = this.state.countIn ? -bar : this.state.time;
      if (this.state.countIn) this.resumeWall += (bar * 1000) / this.state.rate;
      metronome.arm(from, this.bpm);
    }
    this.state = { ...this.state, playing: true };
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.state.playing) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    metronome.stop();
    this.resumeElapsed = this.state.time;
    this.releaseAll();
    this.state = { ...this.state, playing: false };
    this.emit();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    metronome.stop();
    this.releaseAll();
    this.cursor = 0;
    this.resumeElapsed = 0;
    this.state = { ...this.state, playing: false, time: 0 };
    this.emit();
  }

  seek(seconds: number): void {
    const time = Math.max(0, Math.min(this.state.duration, seconds));
    this.releaseAll();
    if (this.state.metronome) metronome.arm(time, this.bpm);
    this.resumeElapsed = time;
    this.resumeWall = performance.now();
    this.cursor = 0;
    while (this.cursor < this.events.length && this.events[this.cursor].t < time) this.cursor++;
    this.state = { ...this.state, time };
    this.emit();
  }

  setLoop(loop: boolean): void {
    this.state = { ...this.state, loop };
    this.emit();
  }

  /**
   * A/B loop region. Either point can be set on its own (the transport has one
   * button per point); the region only takes effect once both exist, and
   * `setLoopRegion(null, null)` clears it.
   */
  setLoopRegion(start: number | null, end: number | null): void {
    if (start == null && end == null) {
      this.state = { ...this.state, loopStart: null, loopEnd: null };
      this.emit();
      return;
    }
    const clamp = (v: number) => Math.max(0, Math.min(this.state.duration, v));
    // One argument at a time: the other keeps whatever it already had, so the
    // A and B buttons can be pressed in any order.
    let s = start == null ? this.state.loopStart : clamp(start);
    let e = end == null ? this.state.loopEnd : clamp(end);
    if (s != null && e != null && e - s < 0.1) {
      s = null;
      e = null;
    }
    this.state = { ...this.state, loopStart: s, loopEnd: e };
    if (s != null && e != null) this.state.loop = true;
    // Jump into the region when the playhead is outside it.
    const { loopStart, loopEnd } = this.state;
    if (loopStart != null && loopEnd != null && this.state.playing) {
      if (this.state.time < loopStart || this.state.time > loopEnd) this.seek(loopStart);
    }
    this.emit();
  }

  setMetronome(on: boolean): void {
    this.state = { ...this.state, metronome: on };
    metronome.enabled = on;
    if (on && this.state.playing) metronome.arm(this.state.time, this.bpm);
    else if (!on) metronome.stop();
    this.emit();
  }

  setCountIn(on: boolean): void {
    this.state = { ...this.state, countIn: on };
    this.emit();
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.25, Math.min(2, rate));
    if (this.state.playing) {
      this.resumeElapsed = this.state.time;
      this.resumeWall = performance.now();
    }
    this.state = { ...this.state, rate: clamped };
    this.emit();
  }

  setTranspose(semitones: number): void {
    this.state = { ...this.state, transpose: Math.max(-24, Math.min(24, Math.round(semitones))) };
    this.emit();
  }

  private tick = (): void => {
    if (!this.state.playing) return;
    const now = performance.now();
    const target = this.resumeElapsed + ((now - this.resumeWall) / 1000) * this.state.rate;
    const { loopStart, loopEnd } = this.state;
    const region = loopStart != null && loopEnd != null;
    const endPoint = this.state.loop && region ? Math.min(loopEnd, this.state.duration) : this.state.duration;

    if (this.state.metronome) {
      const ctx = engine.ctx;
      if (ctx) metronome.schedule(target, this.state.rate, this.bpm, ctx.currentTime);
    }

    if (target >= endPoint) {
      this.fireUpTo(endPoint);
      if (this.state.loop) {
        const back = region ? Math.min(loopStart, endPoint) : 0;
        this.releaseAll();
        this.cursor = 0;
        while (this.cursor < this.events.length && this.events[this.cursor].t < back) this.cursor++;
        // Carry the overshoot so the loop does not drift late.
        const overshoot = (target - endPoint) / Math.max(0.05, this.state.rate);
        this.resumeElapsed = back;
        this.resumeWall = now - Math.min(overshoot, 0.25) * 1000;
        if (this.state.metronome) metronome.arm(back, this.bpm);
        this.state = { ...this.state, time: back };
        this.emit();
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      this.state = { ...this.state, playing: false, time: endPoint };
      this.emit();
      metronome.stop();
      this.onEnded?.();
      return;
    }

    this.fireUpTo(target);
    this.state = { ...this.state, time: target };
    this.emit();
    this.raf = requestAnimationFrame(this.tick);
  };

  private fireUpTo(time: number): void {
    while (this.cursor < this.events.length && this.events[this.cursor].t <= time) {
      const event = this.events[this.cursor++];
      const note = Math.max(0, Math.min(127, event.note + this.state.transpose));
      if (event.on) {
        if (!this.active.has(note)) {
          this.active.add(note);
          noteBus.noteOn(note, event.velocity, event.pan);
        }
      } else if (this.active.delete(note)) {
        noteBus.noteOff(note);
      }
    }
  }

  private releaseAll(): void {
    for (const note of this.active) noteBus.noteOff(note);
    this.active.clear();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const midiPlayer = new MidiPlayer();
