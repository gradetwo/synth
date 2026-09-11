/**
 * GROOVE SYNTH GS-1 — AudioWorklet render thread.
 *
 * This file is served as a standalone asset (see `engine.ts`), so it must not
 * import anything. It drives the Rust/WASM core through the block ABI:
 *   1. AudioParam values are read once per render quantum (k-rate) and pushed
 *      into the engine — the browser does the interpolation and thread sync.
 *   2. Note/controller events arrive as transferable ArrayBuffers (zero copy).
 *   3. The engine renders `frames` samples into its static buffers; we rebuild
 *      Float32Array views every block so a `memory.grow` can never detach them.
 */

/* Keep in sync with `src/audio/params.ts` (id) and `src/params.rs`. */
const PARAMS = [
  ['masterVolume', 0, 0.75, 0, 1],
  ['osc1On', 1, 1, 0, 1],
  ['osc1Wave', 2, 2, 0, 7],
  ['osc1Pitch', 3, 0, -48, 48],
  ['osc1Detune', 4, 7, -100, 100],
  ['osc1Level', 5, 0.65, 0, 1],
  ['osc1Pw', 6, 0.5, 0.05, 0.95],
  ['osc2On', 7, 1, 0, 1],
  ['osc2Wave', 8, 2, 0, 7],
  ['osc2Pitch', 9, 0, -48, 48],
  ['osc2Detune', 10, -6, -100, 100],
  ['osc2Level', 11, 0.55, 0, 1],
  ['osc2Pw', 12, 0.5, 0.05, 0.95],
  ['filterType', 13, 0, 0, 3],
  ['filterCutoff', 14, 9000, 20, 20000],
  ['filterRes', 15, 0.25, 0, 1],
  ['filterDrive', 16, 0.15, 0, 1],
  ['filterEnvAmt', 17, 0.5, 0, 1],
  ['filterKbd', 18, 1, 0, 1],
  ['envAttack', 19, 0.003, 0.0005, 8],
  ['envDecay', 20, 0.16, 0.001, 12],
  ['envSustain', 21, 0.55, 0, 1],
  ['envRelease', 22, 0.28, 0.005, 16],
  ['lfoOn', 23, 1, 0, 1],
  ['lfoWave', 24, 0, 0, 3],
  ['lfoRate', 25, 4.6, 0.02, 40],
  ['lfoDepth', 26, 0.32, 0, 1],
  ['lfoTarget', 27, 0, 0, 3],
  ['lfoSync', 28, 0, 0, 1],
  ['fxReverbOn', 29, 1, 0, 1],
  ['fxReverbSize', 30, 0.45, 0, 1],
  ['fxReverbMix', 31, 0.25, 0, 1],
  ['fxDelayOn', 32, 0, 0, 1],
  ['fxDelaySync', 33, 2, 0, 3],
  ['fxDelayFb', 34, 0.35, 0, 0.95],
  ['fxDelayMix', 35, 0.22, 0, 1],
  ['glide', 36, 0, 0, 1],
  ['tempo', 37, 120, 20, 300],
  ['pitchBendRange', 38, 2, 0, 24],
  ['osc1Pan', 39, 0, -1, 1],
  ['osc2Pan', 40, 0, -1, 1],
  ['masterTune', 41, 0, -24, 24],
  ['voiceMode', 42, 0, 0, 2],
  ['fxChorusOn', 43, 0, 0, 1],
  ['fxChorusDepth', 44, 0.5, 0, 1],
  ['fxChorusRate', 45, 0.6, 0.02, 10],
  ['fxChorusMix', 46, 0.4, 0, 1],
  ['fxFlangerOn', 47, 0, 0, 1],
  ['fxFlangerRate', 48, 0.3, 0.02, 10],
  ['fxFlangerFb', 49, 0.5, 0, 0.95],
  ['fxFlangerMix', 50, 0.4, 0, 1],
  ['fxPhaserOn', 51, 0, 0, 1],
  ['fxPhaserRate', 52, 0.4, 0.02, 10],
  ['fxPhaserFb', 53, 0.6, 0, 0.95],
  ['fxPhaserMix', 54, 0.5, 0, 1],
  ['fxDriveOn', 55, 0, 0, 1],
  ['fxDriveAmt', 56, 0.4, 0, 1],
  ['fxDriveMix', 57, 0.6, 0, 1],
  ['filterEnvAttack', 58, 0.01, 0.0005, 8],
  ['filterEnvDecay', 59, 0.3, 0.001, 12],
  ['filterEnvSustain', 60, 0.5, 0, 1],
  ['filterEnvRelease', 61, 0.3, 0.005, 16],
  ['lfo2On', 62, 0, 0, 1],
  ['lfo2Wave', 63, 1, 0, 3],
  ['lfo2Rate', 64, 0.5, 0.02, 40],
  ['lfo2Depth', 65, 0.3, 0, 1],
  ['lfo2Target', 66, 0, 0, 3],
  ['fxReverbDamp', 67, 0.35, 0, 1],
  ['fxReverbWidth', 68, 0.8, 0, 1],
  ['fxReverbPredelay', 69, 0.012, 0, 0.1],
  ['osc1Unison', 70, 1, 1, 7],
  ['osc1Spread', 71, 0.35, 0, 1],
  ['osc2Unison', 72, 1, 1, 7],
  ['osc2Spread', 73, 0.35, 0, 1],
  ['lfoRetrig', 74, 0, 0, 1],
  ['lfoOneshot', 75, 0, 0, 1],
  ['lfo2Retrig', 76, 0, 0, 1],
  ['lfo2Oneshot', 77, 0, 0, 1],
  // Per-patch loudness trim: presets set it, the UI does not show it.
  ['patchGain', 78, 1, 0, 8],
  ['wtUser', 79, 0, 0, 1],
  ['fxDelayDamp', 80, 0.35, 0, 1],
  ['fxDelayPingpong', 81, 0, 0, 1],
  ['smpRoot', 96, 60, 0, 127],
  ['smpMode', 97, 0, 0, 2],
  ['smpLoopStart', 98, 0, 0, 1],
  ['smpLoopEnd', 99, 1, 0, 1],
  ['fxReverbMode', 94, 0, 0, 1],
  ['fxConvTrim', 95, 1, 0, 4],
  ['fxChain1', 82, 1, 0, 6],
  ['fxChain2', 83, 2, 0, 6],
  ['fxChain3', 84, 3, 0, 6],
  ['fxChain4', 85, 4, 0, 6],
  ['fxChain5', 86, 5, 0, 6],
  ['fxChain6', 87, 6, 0, 6],
  ['fxParallel1', 88, 0, 0, 1],
  ['fxParallel2', 89, 0, 0, 1],
  ['fxParallel3', 90, 0, 0, 1],
  ['fxParallel4', 91, 0, 0, 1],
  ['fxParallel5', 92, 0, 0, 1],
  ['fxParallel6', 93, 0, 0, 1],
];

const SPECTRUM_BINS = 36;
const ANALYSIS_INTERVAL = 6; // blocks between analysis messages (~16 ms @ 48k/128)

/**
 * AudioWorkletGlobalScope is only guaranteed `currentFrame`, `currentTime`,
 * `sampleRate` and `registerProcessor` — `performance` is *not* part of the
 * spec (Safari does not expose it). Fall back to `Date.now()` so the load
 * monitor never throws on the audio thread.
 */
/** Rendered-audio warm-up before the load monitor is allowed to act. */
const WARMUP_MS = 2000;
/** Consecutive over-budget blocks before it counts as a missed deadline. */
const MISS_STREAK = 3;
/** Fraction of the quantum budget that counts as "too much". */
const OVER_LOAD = 0.35;
/** Consecutive blocks over that fraction before voices are shed (~32 ms). */
const OVER_BLOCKS = 12;

const nowMs = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

class SynthWorkletProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return PARAMS.map(([name, , defaultValue, minValue, maxValue]) => ({
      name,
      defaultValue,
      minValue,
      maxValue,
      automationRate: 'k-rate',
    }));
  }

  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.ready = false;
    this.muted = false;
    this.blockCount = 0;
    this.pendingSpectrum = new Float32Array(SPECTRUM_BINS);
    this.maxPoly = opts.maxPolyphony || 16;
    this.currentPoly = this.maxPoly;
    // 0 = the load monitor decides; otherwise a ceiling the user pinned.
    this.manualPoly = 0;
    this.renderedMs = 0;
    this.missStreak = 0;
    this.overStreak = 0;
    this.costAvg = 0;
    this.lastDowngrade = -Infinity;
    this.lastUpgrade = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
    /** Instance B's parameter values, so a restart can restore them. */
    this.paramsB = opts.paramsB || null;
    this.instanceRoute = opts.instanceRoute || null;

    const bytes = opts.wasmBytes;
    if (!bytes) {
      this.port.postMessage({ type: 'error', message: '缺少 WASM 数据' });
      return;
    }

    // Instantiate asynchronously from an ArrayBuffer. This is portable across
    // Safari (which cannot reliably structured-clone a WebAssembly.Module) and
    // keeps compilation off the render path: `process()` outputs silence until
    // `ready` flips.
    WebAssembly.instantiate(bytes, {})
      .then(({ instance }) => {
        this.wasm = instance.exports;
        this.memory = this.wasm.memory;
        this.leftPtr = this.wasm.gs_left_ptr();
        this.rightPtr = this.wasm.gs_right_ptr();
        this.spectrumPtr = this.wasm.gs_spectrum_ptr();
        this.bins = this.wasm.gs_spectrum_bins();
        this.maxBlock = this.wasm.gs_max_block_size();
        this.wasm.gs_init(opts.sampleRate || sampleRate, opts.maxPolyphony || 16);
        if (opts.routes) {
          opts.routes.forEach((r, i) => {
            this.wasm.gs_set_mod_route(i, r.src, r.dst, r.amount, r.enabled ? 1 : 0);
          });
        }
        // Instance B: the same parameter ids as instance A, delivered as
        // messages rather than a second set of AudioParams.
        if (this.paramsB && typeof this.wasm.gs_set_param_inst === 'function') {
          for (const [id, value] of Object.entries(this.paramsB)) {
            this.wasm.gs_set_param_inst(1, Number(id), Number(value));
          }
        }
        if (this.instanceRoute && typeof this.wasm.gs_set_instance_route === 'function') {
          const r = this.instanceRoute;
          this.wasm.gs_set_instance_route(
            r.mode | 0,
            r.splitNote | 0,
            Number(r.aLo ?? 0),
            Number(r.aHi ?? 1),
            Number(r.bLo ?? 0),
            Number(r.bHi ?? 1),
          );
        }
        this.ready = true;
        this.port.postMessage({ type: 'ready', abi: this.wasm.gs_abi_version() });
      })
      .catch((err) => {
        this.port.postMessage({ type: 'error', message: 'WASM 实例化失败: ' + String(err) });
      });
  }

  handleMessage(data) {
    if (!this.ready) return;

    // Zero-copy MIDI-style event packet.
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      const status = bytes[0] & 0xf0;
      const note = bytes[1];
      if (status === 0x90 && bytes[2] > 0) {
        this.wasm.gs_note_on(note, bytes[2] / 127);
      } else if (status === 0x80 || status === 0x90) {
        this.wasm.gs_note_off(note);
      }
      return;
    }

    switch (data.type) {
      case 'noteOn':
        this.wasm.gs_note_on(data.note, data.velocity);
        break;
      case 'noteOnPan':
        this.wasm.gs_note_on_pan(data.note, data.velocity, data.pan);
        break;
      case 'noteOff':
        this.wasm.gs_note_off(data.note);
        break;
      case 'allNotesOff':
      case 'panic':
        this.wasm.gs_all_notes_off();
        break;
      case 'pitchBend':
        this.wasm.gs_pitch_bend(data.value);
        break;
      case 'aftertouch':
        this.wasm.gs_aftertouch(data.value);
        break;
      case 'modWheel':
        this.wasm.gs_mod_wheel(data.value);
        break;
      case 'modRoute':
        this.wasm.gs_set_mod_route(data.index, data.src, data.dst, data.amount, data.enabled ? 1 : 0);
        break;
      case 'noteBend':
        if (this.wasm.gs_note_bend) {
          this.wasm.gs_note_bend(Number(data.note) | 0, Number(data.semitones) || 0);
        }
        break;
      case 'tuning':
        // Microtuning: one key's cent offset. Sent as a burst when the
        // temperament changes, so it is a plain message rather than an
        // AudioParam.
        if (this.wasm.gs_set_tuning_note) {
          this.wasm.gs_set_tuning_note(Number(data.note) | 0, Number(data.cents) || 0);
        }
        break;
      case 'setPolyphony': {
        // A host request (the audio-settings panel) becomes the ceiling the
        // load monitor may fall below but never climb back over, and it is
        // echoed so the UI can show the value actually in force.
        const value = Math.max(2, Math.min(this.maxPoly, Number(data.value) || this.maxPoly));
        this.manualPoly = value;
        this.currentPoly = value;
        this.wasm.gs_set_max_polyphony(value);
        this.wasm.gs_force_release_excess();
        this.port.postMessage({ type: 'polyphony', value, reason: 'manual' });
        break;
      }
      case 'downgrade':
        this.wasm.gs_trigger_smooth_downgrade();
        break;
      case 'wavetable': {
        // Single-cycle import (A6.2): the analysis runs here on the message
        // path, never inside `process`, so a slow import cannot cause a dropout.
        const samples = data.samples;
        const reply = { type: 'wavetable', request: data.request, has: false, code: 0 };
        if (typeof this.wasm.gs_wavetable_import === 'function') {
          const capacity = this.wasm.gs_wavetable_capacity();
          const count = Math.min(samples ? samples.length : 0, capacity);
          if (count > 0) {
            const scratch = new Float32Array(
              this.memory.buffer,
              this.wasm.gs_wavetable_import_ptr(),
              capacity,
            );
            scratch.set(samples.subarray(0, count));
            reply.code = this.wasm.gs_wavetable_import(count);
          } else {
            reply.code = 1;
          }
          reply.has = this.wasm.gs_wavetable_has() === 1;
        } else {
          reply.code = -1;
        }
        this.port.postMessage(reply);
        break;
      }
      case 'ir': {
        // Impulse response import (A5). Same contract as the wavetable import:
        // analysis on the message path, never inside an audio block.
        const samples = data.samples;
        const reply = { type: 'ir', request: data.request, has: false, code: 0 };
        if (typeof this.wasm.gs_ir_import === 'function') {
          const capacity = this.wasm.gs_ir_capacity();
          const count = Math.min(samples ? samples.length : 0, capacity);
          if (count > 0) {
            const scratch = new Float32Array(
              this.memory.buffer,
              this.wasm.gs_ir_import_ptr(),
              capacity,
            );
            scratch.set(samples.subarray(0, count));
            reply.code = this.wasm.gs_ir_import(count);
          } else {
            reply.code = 1;
          }
          reply.has = this.wasm.gs_ir_has() === 1;
        } else {
          reply.code = -1;
        }
        this.port.postMessage(reply);
        break;
      }
      case 'paramB':
        // One parameter of the second layer. Cheap enough to send per change,
        // and it avoids a hundred extra AudioParams on the graph.
        if (typeof this.wasm.gs_set_param_inst === 'function') {
          this.wasm.gs_set_param_inst(1, Number(data.id) | 0, Number(data.value) || 0);
        }
        break;
      case 'paramsB': {
        // The whole set at once, for loading a patch or restoring at startup.
        if (typeof this.wasm.gs_set_param_inst === 'function' && data.values) {
          for (const [id, value] of Object.entries(data.values)) {
            this.wasm.gs_set_param_inst(1, Number(id), Number(value));
          }
        }
        break;
      }
      case 'instanceRoute': {
        if (typeof this.wasm.gs_set_instance_route === 'function') {
          this.wasm.gs_set_instance_route(
            Number(data.mode) | 0,
            Number(data.splitNote) | 0,
            Number(data.aLo ?? 0),
            Number(data.aHi ?? 1),
            Number(data.bLo ?? 0),
            Number(data.bHi ?? 1),
          );
        }
        break;
      }
      case 'sample': {
        // Sample import (A). `sampleRate` is the file's own rate: playing it at
        // the right pitch is the whole point, so the core resamples it to the
        // engine rate rather than assuming the two match.
        const samples = data.samples;
        const sourceRate = Number(data.sampleRate) || sampleRate;
        const reply = { type: 'sample', request: data.request, has: false, code: 0 };
        if (typeof this.wasm.gs_sample_import === 'function') {
          const capacity = this.wasm.gs_sample_capacity();
          const count = Math.min(samples ? samples.length : 0, capacity);
          if (count > 0) {
            const scratch = new Float32Array(
              this.memory.buffer,
              this.wasm.gs_sample_import_ptr(),
              capacity,
            );
            scratch.set(samples.subarray(0, count));
            reply.code = this.wasm.gs_sample_import(count, sourceRate);
          } else {
            reply.code = 1;
          }
          reply.has = this.wasm.gs_sample_has() === 1;
        } else {
          reply.code = -1;
        }
        this.port.postMessage(reply);
        break;
      }
      case 'sampleClear':
        if (this.wasm.gs_sample_clear) this.wasm.gs_sample_clear();
        this.port.postMessage({ type: 'sample', request: data.request, has: false, code: 0 });
        break;
      case 'irClear':
        if (this.wasm.gs_ir_clear) this.wasm.gs_ir_clear();
        this.port.postMessage({ type: 'ir', request: data.request, has: false, code: 0 });
        break;
      case 'wavetableClear':
        if (this.wasm.gs_wavetable_clear) this.wasm.gs_wavetable_clear();
        this.port.postMessage({ type: 'wavetable', request: data.request, has: false, code: 0 });
        break;
      case 'mute':
        this.muted = !!data.value;
        if (this.muted) this.wasm.gs_all_notes_off();
        break;
      default:
        break;
    }
  }

  monitorLoad(frames, cost, rate) {
    const budget = (frames / rate) * 1000;
    // Warm-up is measured in *rendered audio*, not blocks: the first second
    // after start (and after the first notes on a phone) is full of first-touch
    // costs and JIT compilation, and the old 15-block (40 ms) guard let those
    // spikes trigger a downgrade — which is why the app reported "device
    // overloaded" at 4% load, on the very first key press.
    this.renderedMs += (frames / rate) * 1000;
    // Asymmetric follower: rises slowly (only *sustained* load counts) and
    // falls quickly. A symmetric average let a single slow block — a GC pause,
    // a page fault on a phone — keep the estimate above the threshold for
    // twenty blocks, which is how a 4%-load device ended up shedding voices.
    if (!this.costAvg) {
      this.costAvg = cost;
    } else {
      const alpha = cost > this.costAvg ? 0.05 : 0.35;
      this.costAvg += (cost - this.costAvg) * alpha;
    }
    if (this.renderedMs < WARMUP_MS) {
      // Discard the warm-up average rather than keeping the last sample: a slow
      // startup must not decide the first verdict as soon as the window closes.
      this.costAvg = 0;
      this.missStreak = 0;
      this.overStreak = 0;
      return;
    }
    const now = nowMs();
    const load = this.costAvg / budget;
    // Decisions are made on *repetition*, not on single blocks:
    //
    //  * a missed deadline (a block that ate the whole quantum) counts after
    //    three in a row — one is a GC pause, a page fault or another tab;
    //  * high load counts after a sustained stretch — a single spike used to
    //    drag the average over the threshold for twenty blocks, which is how a
    //    phone at 4% load reported "device overloaded" on the first key press.
    this.missStreak = cost > budget ? this.missStreak + 1 : 0;
    this.overStreak = cost > budget * OVER_LOAD ? this.overStreak + 1 : 0;
    const missed = this.missStreak >= MISS_STREAK;
    const overloaded = this.overStreak >= OVER_BLOCKS;
    const step = missed || load > 0.85 ? 8 : 4;
    const cooldown = missed ? 250 : 900;
    if (
      (overloaded || missed) &&
      this.currentPoly > 4 &&
      now - this.lastDowngrade > cooldown
    ) {
      this.currentPoly = Math.max(4, this.currentPoly - step);
      this.wasm.gs_set_max_polyphony(this.currentPoly);
      this.wasm.gs_force_release_excess();
      this.lastDowngrade = now;
      this.costAvg = 0;
      this.port.postMessage({ type: 'polyphony', value: this.currentPoly, reason: 'overload' });
    } else if (
      this.costAvg < budget * 0.12 &&
      this.currentPoly < this.maxPoly &&
      now - this.lastUpgrade > 8000
    ) {
      // Never climb back over a ceiling the user pinned.
      this.currentPoly = Math.min(this.manualPoly || this.maxPoly, this.currentPoly + 4);
      this.wasm.gs_set_max_polyphony(this.currentPoly);
      this.lastUpgrade = now;
      this.costAvg = 0;
      this.port.postMessage({ type: 'polyphony', value: this.currentPoly, reason: 'recover' });
    }
  }

  process(_inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];
    const frames = left.length;

    if (!this.ready || this.muted) {
      left.fill(0);
      if (right !== left) right.fill(0);
      return true;
    }

    // 1. Push the browser-interpolated AudioParam values into the engine.
    for (let i = 0; i < PARAMS.length; i++) {
      const name = PARAMS[i][0];
      const values = parameters[name];
      if (values !== undefined) this.wasm.gs_set_param(PARAMS[i][1], values[0]);
    }

    // 2. Render a dynamic block (128..1024 frames depending on the host),
    //    measuring the cost against the render-quantum budget so we can shed
    //    voices smoothly before the audio thread misses its deadline.
    const block = Math.min(frames, this.maxBlock);
    const t0 = nowMs();
    this.wasm.gs_process(block);
    const cost = nowMs() - t0;
    this.monitorLoad(block, cost, sampleRate);

    // 3. Rebuild views every block; never cache them across `memory.grow`.
    const leftView = new Float32Array(this.memory.buffer, this.leftPtr, block);
    const rightView = new Float32Array(this.memory.buffer, this.rightPtr, block);
    left.set(leftView);
    if (right !== left) right.set(rightView);

    // 4. Periodic analyser + meter message (small, structured-cloned copy).
    this.blockCount++;
    const budget = (block / sampleRate) * 1000;
    if (this.blockCount % ANALYSIS_INTERVAL === 0) {
      const spec = new Float32Array(this.memory.buffer, this.spectrumPtr, this.bins);
      this.pendingSpectrum.set(spec.subarray(0, SPECTRUM_BINS));
      this.port.postMessage(
        {
          type: 'analysis',
          spectrum: this.pendingSpectrum.slice(),
          peakL: this.wasm.gs_peak_l(),
          peakR: this.wasm.gs_peak_r(),
          voices: this.wasm.gs_active_voices(),
          violations: this.wasm.gs_alloc_violations(),
          // True-peak / loudness / limiter meters (ABI 2+).
          truePeak: this.wasm.gs_take_true_peak ? this.wasm.gs_take_true_peak() : 0,
          loudness: this.wasm.gs_loudness_rms ? this.wasm.gs_loudness_rms() : 0,
          limit: this.wasm.gs_limit_reduction ? this.wasm.gs_limit_reduction() : 1,
          // Share of the render-quantum budget the DSP is using: the number to
          // watch when a device starts dropping out ("crackling").
          load: budget > 0 ? this.costAvg / budget : 0,
        },
        [],
      );
    }

    return true;
  }
}

registerProcessor('gs1-synth-processor', SynthWorkletProcessor);
