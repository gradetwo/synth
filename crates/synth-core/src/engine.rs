//! The real-time synth engine.
//!
//! `Engine` owns every buffer it needs as a fixed-size array, so `process` is
//! allocation free (verified by the arena's violation counter). The render loop
//! is block based: `gs_voice_*_block` calls into the vendored C/C++ DSP amortise
//! FFI overhead over 128..1024 frames, exactly as prd.md §2.2 prescribes.

use crate::alloc_arena;
use crate::dsp::adsr::Adsr;
use crate::dsp::lfo::Lfo;
use crate::dsp::simd;
use crate::dsp::util::{exp2, note_to_hz, semitone_ratio, soft_limit, Rng};
use crate::fft::Spectrum;
use crate::params::{
    id, is_continuous, LfoTarget, ModDst, ModSrc, OscParams, Params, MAX_BLOCK_SIZE, MAX_VOICES,
    PARAM_COUNT,
};
use crate::voice::{NoteOnResult, VoiceManager};

// ---------------------------------------------------------------- C ABI glue

extern "C" {
    fn gs_daisy_init(sample_rate: f32);
    fn gs_voice_reset(v: i32);
    fn gs_voice_phase(v: i32, p0: f32, p1: f32);
    fn gs_voice_osc_set(v: i32, which: i32, wave: u32, freq: f32, amp: f32, pw: f32);
    fn gs_voice_osc_block(v: i32, which: i32, out: *mut f32, frames: u32);
    fn gs_voice_filter_set(v: i32, kind: i32, freq: f32, res: f32, drive: f32);
    fn gs_voice_filter_block(v: i32, kind: i32, input: *const f32, out: *mut f32, frames: u32);
    fn gs_voice_dc_block(v: i32, input: *const f32, out: *mut f32, frames: u32);
    fn gs_sp_init(sample_rate: f32);
    fn gs_fx_init(sample_rate: f32);
    fn gs_fx_chorus_set(depth: f32, freq: f32, delay_ms: f32, feedback: f32);
    fn gs_fx_chorus_block(in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_flanger_set(depth: f32, freq: f32, delay_ms: f32, feedback: f32);
    fn gs_fx_flanger_block(in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_phaser_set(depth: f32, freq: f32, feedback: f32, poles: i32);
    fn gs_fx_phaser_block(in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_overdrive_set(drive: f32);
    fn gs_fx_overdrive_block(in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    #[cfg(test)]
    fn gs_sp_alloc_events() -> u32;
    fn gs_sp_set_reverb(feedback: f32, lpfreq: f32, mix: f32);
    fn gs_sp_set_delay(time_s: f32, feedback: f32, mix: f32);
    fn gs_sp_process_block(
        in_l: *const f32,
        in_r: *const f32,
        out_l: *mut f32,
        out_r: *mut f32,
        frames: u32,
    );
}

/// Short release applied to a stolen voice (seconds).
const STEAL_RELEASE: f32 = 0.008;
/// Per-voice gain before the mix bus.
/// Per-voice bus gain. With decorrelated start phases a dense chord sums to
/// roughly sqrt(N) instead of N, so this leaves the master bus inside the
/// limiter's linear region even with every oscillator at full level.
const VOICE_GAIN: f32 = 0.22;
/// One-pole time constant for continuous-parameter smoothing (seconds).
const SMOOTH_TAU_S: f32 = 0.02;
/// Peak limiter: ceiling, attack and release (seconds).
const LIMIT_CEILING: f32 = 0.95;
const LIMIT_ATTACK_S: f32 = 0.002;
const LIMIT_RELEASE_S: f32 = 0.15;

fn is_env_param(param_id: u32) -> bool {
    matches!(
        param_id,
        id::ENV_ATTACK
            | id::ENV_DECAY
            | id::ENV_SUSTAIN
            | id::ENV_RELEASE
            | id::FILTER_ENV_ATTACK
            | id::FILTER_ENV_DECAY
            | id::FILTER_ENV_SUSTAIN
            | id::FILTER_ENV_RELEASE
    )
}

#[derive(Clone, Copy)]
struct FxSnapshot {
    reverb_fb: f32,
    reverb_lpf: f32,
    reverb_mix: f32,
    delay_time: f32,
    delay_fb: f32,
    delay_mix: f32,
}

impl FxSnapshot {
    const fn new() -> Self {
        Self {
            reverb_fb: -1.0,
            reverb_lpf: -1.0,
            reverb_mix: -1.0,
            delay_time: -1.0,
            delay_fb: -1.0,
            delay_mix: -1.0,
        }
    }
}

pub struct Engine {
    pub sample_rate: f32,
    pub params: Params,
    pub vm: VoiceManager,
    pub lfo: Lfo,
    pub lfo2: Lfo,
    pub spectrum: Spectrum,

    /// One amplitude envelope per voice (see `dsp::adsr`).
    envs: [Adsr; MAX_VOICES],
    /// Independent filter envelope per voice.
    filter_envs: [Adsr; MAX_VOICES],

    // Scratch buffers — all statically sized, all reused per voice.
    osc_a: [f32; MAX_BLOCK_SIZE],
    osc_b: [f32; MAX_BLOCK_SIZE],
    env_buf: [f32; MAX_BLOCK_SIZE],
    voice_buf: [f32; MAX_BLOCK_SIZE],
    lfo_buf: [f32; MAX_BLOCK_SIZE],
    lfo2_buf: [f32; MAX_BLOCK_SIZE],
    filter_env_buf: [f32; MAX_BLOCK_SIZE],
    mix_l: [f32; MAX_BLOCK_SIZE],
    mix_r: [f32; MAX_BLOCK_SIZE],
    fx_l: [f32; MAX_BLOCK_SIZE],
    fx_r: [f32; MAX_BLOCK_SIZE],

    // Public output buffers (pointer-exported to the worklet).
    out_l: [f32; MAX_BLOCK_SIZE],
    out_r: [f32; MAX_BLOCK_SIZE],

    rng: Rng,
    /// Increments per started voice; drives the low-discrepancy phase spread.
    phase_seed: u32,
    pitch_bend: f32,
    mod_wheel: f32,
    /// Held notes for mono/legato mode (slot 0 only).
    mono_held: [u8; 16],
    mono_len: usize,
    master_gain: f32,
    /// Block-rate one-pole smoother for continuous parameters (anti-zipper).
    /// `smooth_set` marks parameters the host has actually provided, so unset
    /// parameters keep their defaults instead of snapping to zero.
    smooth_target: [f32; PARAM_COUNT],
    smooth_value: [f32; PARAM_COUNT],
    smooth_set: [bool; PARAM_COUNT],
    smooth_ready: [bool; PARAM_COUNT],
    /// Peak-limiter gain reduction (1.0 = no limiting).
    limit_gain: f32,
    peak_l: f32,
    peak_r: f32,
    active_voices: u32,
    /// Non-finite samples caught by the master-bus guard (should stay 0).
    pub nan_events: u32,
    spectrum_counter: u32,
    env_dirty: bool,
    fx: FxSnapshot,
    initialised: bool,
}

impl Engine {
    pub const fn new() -> Self {
        Self {
            sample_rate: 48000.0,
            params: Params::new(),
            vm: VoiceManager::new(),
            lfo: Lfo::new(),
            lfo2: Lfo::new(),
            spectrum: Spectrum::new(),
            envs: [Adsr::new(); MAX_VOICES],
            filter_envs: [Adsr::new(); MAX_VOICES],
            osc_a: [0.0; MAX_BLOCK_SIZE],
            osc_b: [0.0; MAX_BLOCK_SIZE],
            env_buf: [0.0; MAX_BLOCK_SIZE],
            voice_buf: [0.0; MAX_BLOCK_SIZE],
            lfo_buf: [0.0; MAX_BLOCK_SIZE],
            lfo2_buf: [0.0; MAX_BLOCK_SIZE],
            filter_env_buf: [0.0; MAX_BLOCK_SIZE],
            mix_l: [0.0; MAX_BLOCK_SIZE],
            mix_r: [0.0; MAX_BLOCK_SIZE],
            fx_l: [0.0; MAX_BLOCK_SIZE],
            fx_r: [0.0; MAX_BLOCK_SIZE],
            out_l: [0.0; MAX_BLOCK_SIZE],
            out_r: [0.0; MAX_BLOCK_SIZE],
            rng: Rng::new(0x51f3_9b1d),
            phase_seed: 0,
            pitch_bend: 0.0,
            mod_wheel: 0.0,
            mono_held: [0; 16],
            mono_len: 0,
            master_gain: 0.75,
            smooth_target: [0.0; PARAM_COUNT],
            smooth_value: [0.0; PARAM_COUNT],
            smooth_set: [false; PARAM_COUNT],
            smooth_ready: [false; PARAM_COUNT],
            limit_gain: 1.0,
            peak_l: 0.0,
            peak_r: 0.0,
            active_voices: 0,
            nan_events: 0,
            spectrum_counter: 0,
            env_dirty: true,
            fx: FxSnapshot::new(),
            initialised: false,
        }
    }

    pub fn init(&mut self, sample_rate: f32, max_polyphony: usize) {
        self.sample_rate = if (8000.0..=192000.0).contains(&sample_rate) {
            sample_rate
        } else {
            48000.0
        };
        unsafe {
            gs_daisy_init(self.sample_rate);
            gs_sp_init(self.sample_rate);
            gs_fx_init(self.sample_rate);
        }
        self.spectrum.init();
        self.spectrum.reset();
        self.lfo.reset();
        self.lfo2.reset();
        for env in self.envs.iter_mut() {
            env.set_sample_rate(self.sample_rate);
            env.reset();
        }
        for env in self.filter_envs.iter_mut() {
            env.set_sample_rate(self.sample_rate);
            env.reset();
        }
        self.vm.reset();
        self.vm.set_max_polyphony(max_polyphony);
        self.pitch_bend = 0.0;
        self.mod_wheel = 0.0;
        self.mono_held = [0; 16];
        self.mono_len = 0;
        self.master_gain = self.params.master_volume;
        self.peak_l = 0.0;
        self.peak_r = 0.0;
        self.nan_events = 0;
        self.env_dirty = true;
        self.fx = FxSnapshot::new();
        self.initialised = true;
    }

    pub fn set_param(&mut self, param_id: u32, value: f32) {
        // The worklet pushes every AudioParam on every block, so side effects
        // here must be edge-triggered rather than level-triggered.
        let mode_changed =
            param_id == id::VOICE_MODE && (value as u32).min(2) != self.params.voice_mode;
        self.params.set(param_id, value);
        if is_continuous(param_id) {
            let index = param_id as usize;
            if index < PARAM_COUNT {
                self.smooth_target[index] = if value.is_finite() { value } else { 0.0 };
                self.smooth_set[index] = true;
            }
        }
        if matches!(
            param_id,
            id::ENV_ATTACK
                | id::ENV_DECAY
                | id::ENV_SUSTAIN
                | id::ENV_RELEASE
                | id::FILTER_ENV_ATTACK
                | id::FILTER_ENV_DECAY
                | id::FILTER_ENV_SUSTAIN
                | id::FILTER_ENV_RELEASE
        ) {
            self.env_dirty = true;
        }
        if mode_changed {
            // Switching polyphony model: release everything cleanly.
            self.mono_len = 0;
            for slot in 0..MAX_VOICES {
                self.vm.voices[slot].gate = false;
                self.vm.voices[slot].released = true;
            }
        }
    }

    pub fn set_route(&mut self, index: usize, src: u32, dst: u32, amount: f32, enabled: bool) {
        self.params.set_route(index, src, dst, amount, enabled);
    }

    /// Advance the block-rate smoothers and write the smoothed values into the
    /// parameter block the DSP reads. First call snaps to the host value so
    /// patch loading stays sample-accurate.
    fn update_smoothing(&mut self, frames: usize) {
        let sr = self.sample_rate.max(1000.0);
        let coeff = 1.0 - (-(frames as f32) / (SMOOTH_TAU_S * sr)).exp();
        let mut env_changed = false;
        for index in 0..PARAM_COUNT {
            let param_id = index as u32;
            if !is_continuous(param_id) || !self.smooth_set[index] {
                continue;
            }
            let target = self.smooth_target[index];
            let value = if self.smooth_ready[index] {
                self.smooth_value[index] + (target - self.smooth_value[index]) * coeff
            } else {
                self.smooth_ready[index] = true;
                target
            };
            if is_env_param(param_id) && (value - self.smooth_value[index]).abs() > 1e-7 {
                env_changed = true;
            }
            self.smooth_value[index] = value;
            self.params.set(param_id, value);
        }
        if env_changed {
            self.env_dirty = true;
        }
    }

    pub fn set_max_polyphony(&mut self, n: usize) {
        self.vm.set_max_polyphony(n);
    }

    /// prd.md §7.1 — elastic downgrade with smooth release.
    pub fn trigger_smooth_downgrade(&mut self) {
        let next = self.vm.max_polyphony.saturating_sub(2).max(4);
        self.vm.set_max_polyphony(next);
        self.vm.force_release_excess(next);
    }

    pub fn pitch_bend(&mut self, semitones: f32) {
        self.pitch_bend = semitones.clamp(-24.0, 24.0);
    }

    pub fn mod_wheel(&mut self, value: f32) {
        self.mod_wheel = value.clamp(0.0, 1.0);
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        if self.params.voice_mode != 0 {
            self.mono_note_on(note, velocity);
            return;
        }
        let vel = velocity.clamp(0.0, 1.0);
        let freq = note_to_hz(note as f32 + self.params.master_tune);
        match self.vm.note_on(note, vel, freq) {
            NoteOnResult::Allocated(slot) => self.retrigger(slot),
            NoteOnResult::Queued(victim) => {
                // Smooth steal: short release on the victim, new note queued.
                self.envs[victim].set_release(STEAL_RELEASE);
                self.envs[victim].gate_off();
            }
            NoteOnResult::Dropped => {}
        }
    }

    pub fn note_off(&mut self, note: u8) {
        if self.params.voice_mode != 0 {
            self.mono_note_off(note);
            return;
        }
        self.vm.note_off(note);
    }

    pub fn all_notes_off(&mut self) {
        self.mono_len = 0;
        self.vm.all_notes_off();
    }

    /// Deterministic low-discrepancy start phases for a new voice.
    fn next_phases(&mut self) -> (f32, f32) {
        self.phase_seed = self.phase_seed.wrapping_add(1);
        let n = self.phase_seed as f32;
        let p0 = (n * 0.618_034).fract();
        let p1 = (n * 0.754_877_7 + 0.37).fract();
        (p0, p1)
    }

    /// MONO/LEGATO note-on: always uses slot 0.
    fn mono_note_on(&mut self, note: u8, velocity: f32) {
        let was_held = self.mono_len;
        if self.mono_len < self.mono_held.len() && !self.mono_held[..self.mono_len].contains(&note) {
            self.mono_held[self.mono_len] = note;
            self.mono_len += 1;
        }
        let freq = note_to_hz(note as f32 + self.params.master_tune);
        // Legato only suppresses the envelope restart when a key is already held.
        let legato = self.params.voice_mode == 2 && was_held > 0;
        let slot = 0usize;
        let was_active = self.vm.voices[slot].active;
        {
            let voice = &mut self.vm.voices[slot];
            voice.active = true;
            voice.note = note;
            voice.velocity = velocity.clamp(0.0, 1.0);
            voice.gate = true;
            voice.released = false;
            voice.stealing = false;
            voice.age = 1;
            voice.target_freq = freq;
            if !was_active {
                voice.current_freq = freq;
            }
        }
        if !legato {
            unsafe { gs_voice_reset(slot as i32) };
            let (p0, p1) = self.next_phases();
            unsafe { gs_voice_phase(slot as i32, p0, p1) };
            let p = self.params.env;
            let env = &mut self.envs[slot];
            env.reset();
            env.set_params(p.attack, p.decay, p.sustain, p.release);
            env.gate_on();
            let f = self.params.filter_env;
            let fenv = &mut self.filter_envs[slot];
            fenv.reset();
            fenv.set_params(f.attack, f.decay, f.sustain, f.release);
            fenv.gate_on();
        }
    }

    /// MONO/LEGATO note-off: glide back to the most recent still-held key.
    fn mono_note_off(&mut self, note: u8) {
        if let Some(pos) = self.mono_held[..self.mono_len].iter().position(|&n| n == note) {
            for i in pos..self.mono_len.saturating_sub(1) {
                self.mono_held[i] = self.mono_held[i + 1];
            }
            self.mono_len = self.mono_len.saturating_sub(1);
        }
        let slot = 0usize;
        if self.mono_len == 0 {
            if self.vm.voices[slot].active {
                self.vm.voices[slot].gate = false;
                self.vm.voices[slot].released = true;
                self.envs[slot].gate_off();
                self.filter_envs[slot].gate_off();
            }
        } else {
            let last = self.mono_held[self.mono_len - 1];
            let freq = note_to_hz(last as f32 + self.params.master_tune);
            self.vm.voices[slot].note = last;
            self.vm.voices[slot].target_freq = freq;
        }
    }

    fn retrigger(&mut self, slot: usize) {
        unsafe { gs_voice_reset(slot as i32) };
        // Start each voice at a spread phase: identical start phases make a
        // stacked chord peak linearly instead of ~sqrt(N), which used to push
        // the master bus into the limiter on every attack. The sequence is
        // deterministic (golden-ratio low-discrepancy) so renders and the DSP
        // baseline stay reproducible.
        let (p0, p1) = self.next_phases();
        unsafe { gs_voice_phase(slot as i32, p0, p1) };
        let p = self.params.env;
        let env = &mut self.envs[slot];
        env.reset();
        env.set_params(p.attack, p.decay, p.sustain, p.release);
        env.gate_on();
        let f = self.params.filter_env;
        let fenv = &mut self.filter_envs[slot];
        fenv.reset();
        fenv.set_params(f.attack, f.decay, f.sustain, f.release);
        fenv.gate_on();
    }

    fn apply_env_to_all(&mut self) {
        let p = self.params.env;
        let f = self.params.filter_env;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active && !self.vm.voices[slot].stealing {
                self.envs[slot].set_params(p.attack, p.decay, p.sustain, p.release);
                self.filter_envs[slot].set_params(f.attack, f.decay, f.sustain, f.release);
            }
        }
        self.env_dirty = false;
    }

    pub fn left_ptr(&self) -> *const f32 {
        self.out_l.as_ptr()
    }

    pub fn right_ptr(&self) -> *const f32 {
        self.out_r.as_ptr()
    }

    pub fn spectrum_ptr(&self) -> *const f32 {
        self.spectrum.bins().as_ptr()
    }

    pub fn peak_l(&self) -> f32 {
        self.peak_l
    }

    pub fn peak_r(&self) -> f32 {
        self.peak_r
    }

    pub fn active_voices(&self) -> u32 {
        self.active_voices
    }

    /// Rendered left channel of the most recent block (test/debug access).
    pub fn left(&self) -> &[f32] {
        &self.out_l
    }

    /// Rendered right channel of the most recent block (test/debug access).
    pub fn right(&self) -> &[f32] {
        &self.out_r
    }

    /// Scratch view used by diagnostics (envelope / oscillator taps).
    pub fn debug_env(&self) -> &[f32] {
        &self.env_buf
    }

    pub fn debug_osc(&self) -> &[f32] {
        &self.osc_a
    }

    pub fn debug_mix(&self) -> &[f32] {
        &self.mix_l
    }

    pub fn debug_fx(&self) -> &[f32] {
        &self.fx_l
    }

    /// Render `frames` samples. Returns the number of voices that were active.
    pub fn process(&mut self, frames: usize) -> u32 {
        if !self.initialised {
            return 0;
        }
        let frames = frames.clamp(1, MAX_BLOCK_SIZE);

        alloc_arena::enter_process();
        self.update_smoothing(frames);
        self.flush_pending();
        if self.env_dirty {
            self.apply_env_to_all();
        }

        // --- global LFO -----------------------------------------------------
        let lfo_on = self.params.lfo.on;
        let depth = if lfo_on { self.params.lfo.depth } else { 0.0 };
        let lfo_rate = if self.params.lfo.sync {
            // One cycle per beat.
            self.params.tempo / 60.0
        } else {
            self.params.lfo.rate
        };
        if lfo_on {
            self.lfo
                .render(self.params.lfo.wave, lfo_rate, self.sample_rate, &mut self.lfo_buf[..frames]);
        } else {
            self.lfo_buf[..frames].fill(0.0);
            self.lfo.value = 0.0;
        }
        let lfo_value = self.lfo.value;

        // --- second LFO -----------------------------------------------------
        let lfo2_on = self.params.lfo2.on;
        let depth2 = if lfo2_on { self.params.lfo2.depth } else { 0.0 };
        let lfo2_rate = if self.params.lfo2.sync {
            self.params.tempo / 60.0
        } else {
            self.params.lfo2.rate
        };
        if lfo2_on {
            self.lfo2
                .render(self.params.lfo2.wave, lfo2_rate, self.sample_rate, &mut self.lfo2_buf[..frames]);
        } else {
            self.lfo2_buf[..frames].fill(0.0);
            self.lfo2.value = 0.0;
        }
        let lfo2_value = self.lfo2.value;

        // --- clear mix bus --------------------------------------------------
        self.mix_l[..frames].fill(0.0);
        self.mix_r[..frames].fill(0.0);

        // --- render voices --------------------------------------------------
        let mut active = 0u32;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active {
                self.render_voice(slot, frames, depth, lfo_value, depth2, lfo2_value);
                active += 1;
            }
        }
        self.active_voices = active;

        // --- master bus: hand the raw sum to the FX send ---------------------
        // No clipper here: the voice gain already leaves headroom, and clipping
        // this early turned every loud chord into audible distortion.
        // The ±1e-15 alternating dither is -300 dBFS and inaudible, but it keeps
        // the reverb/delay feedback paths out of denormal range, where wasm has
        // no flush-to-zero and a decaying tail can cost 100x the CPU.
        for i in 0..frames {
            let dither = if i & 1 == 0 { 1e-15 } else { -1e-15 };
            self.fx_l[i] = self.mix_l[i] + dither;
            self.fx_r[i] = self.mix_r[i] - dither;
        }

        // --- global FX (Soundpipe reverb + delay) ---------------------------
        self.apply_fx(frames);

        // --- volume ramp + limiter + final soft clip ------------------------
        let target = self.params.master_volume;
        let start = self.master_gain;
        let step = (target - start) / frames as f32;

        // Peak limiter: duck loud polyphonic passages before the clipper works.
        let mut block_peak = 0.0f32;
        for i in 0..frames {
            let g = start + step * (i as f32 + 1.0);
            block_peak = block_peak
                .max((self.fx_l[i] * g).abs())
                .max((self.fx_r[i] * g).abs());
        }
        let desired = if block_peak > LIMIT_CEILING {
            LIMIT_CEILING / block_peak
        } else {
            1.0
        };
        let sr = self.sample_rate.max(1000.0);
        let coeff = if desired < self.limit_gain {
            1.0 - (-(frames as f32) / (LIMIT_ATTACK_S * sr)).exp()
        } else {
            1.0 - (-(frames as f32) / (LIMIT_RELEASE_S * sr)).exp()
        };
        self.limit_gain += (desired - self.limit_gain) * coeff;
        let limit = self.limit_gain;

        for i in 0..frames {
            let g = start + step * (i as f32 + 1.0);
            let l = soft_limit(self.fx_l[i] * limit * g);
            let r = soft_limit(self.fx_r[i] * limit * g);
            if l.is_finite() {
                self.out_l[i] = l;
            } else {
                self.out_l[i] = 0.0;
                self.nan_events += 1;
            }
            if r.is_finite() {
                self.out_r[i] = r;
            } else {
                self.out_r[i] = 0.0;
                self.nan_events += 1;
            }
        }
        self.master_gain = target;

        // --- meters + spectrum ----------------------------------------------
        let pl = simd::peak(&self.out_l[..frames]);
        let pr = simd::peak(&self.out_r[..frames]);
        self.peak_l = if pl > self.peak_l { pl } else { self.peak_l * 0.82 };
        self.peak_r = if pr > self.peak_r { pr } else { self.peak_r * 0.82 };

        self.spectrum_counter = self.spectrum_counter.wrapping_add(1);
        if self.spectrum_counter % 2 == 0 {
            // Analyse a mono sum so the display is independent of panning.
            for i in 0..frames {
                self.voice_buf[i] = (self.out_l[i] + self.out_r[i]) * 0.5;
            }
            self.spectrum
                .analyze(&self.voice_buf[..frames], self.sample_rate);
        }

        alloc_arena::leave_process();
        active
    }

    fn flush_pending(&mut self) {
        let sr = self.sample_rate;
        let tune = self.params.master_tune;
        let params = self.params.env;
        let fenv_params = self.params.filter_env;
        while let Some((slot, _note, _vel)) = self
            .vm
            .flush_pending(|note| note_to_hz(note as f32 + tune))
        {
            unsafe { gs_voice_reset(slot as i32) };
            let env = &mut self.envs[slot];
            env.reset();
            env.set_params(params.attack, params.decay, params.sustain, params.release);
            env.gate_on();
            let fenv = &mut self.filter_envs[slot];
            fenv.reset();
            fenv.set_params(fenv_params.attack, fenv_params.decay, fenv_params.sustain, fenv_params.release);
            fenv.gate_on();
            let _ = sr;
        }
    }

    fn render_voice(
        &mut self,
        slot: usize,
        frames: usize,
        depth: f32,
        lfo_value: f32,
        depth2: f32,
        lfo2_value: f32,
    ) {
        let voice = self.vm.voices[slot];
        let sr = self.sample_rate;
        let params = self.params;

        // --- glide ----------------------------------------------------------
        let target_freq = voice.target_freq;
        let current_freq = if params.glide > 0.0001 {
            let coeff = 1.0 - (-(frames as f32) / (params.glide * 0.5 * sr).max(1.0)).exp();
            voice.current_freq + (target_freq - voice.current_freq) * coeff.clamp(0.0, 1.0)
        } else {
            target_freq
        };
        self.vm.voices[slot].current_freq = current_freq;

        // --- modulation matrix (per voice, evaluated at block rate) ---------
        let mut mod_cutoff = 0.0f32;
        let mut mod_pitch = 0.0f32;
        let mut mod_volume = 0.0f32;
        let mut mod_pwm = 0.0f32;
        for route in params.routes.iter() {
            if !route.enabled || route.amount == 0.0 {
                continue;
            }
            let src = match route.src {
                ModSrc::Lfo => lfo_value,
                ModSrc::Env => voice.env_value,
                ModSrc::ModWheel => self.mod_wheel,
                ModSrc::Velocity => voice.velocity,
            };
            let v = src * route.amount;
            match route.dst {
                ModDst::Cutoff => mod_cutoff += v,
                ModDst::Pitch => mod_pitch += v,
                ModDst::Volume => mod_volume += v,
                ModDst::Pwm => mod_pwm += v,
            }
        }

        // LFO direct target (mirrors the reference UI's LFO routing).
        let mut pitch_mod = self.pitch_bend * params.pitch_bend_range + params.master_tune;
        let mut pw_mod = 0.0f32;
        if depth > 0.0 {
            match params.lfo.target {
                LfoTarget::Pitch => pitch_mod += lfo_value * depth * 2.0,
                LfoTarget::Pwm => pw_mod += lfo_value * depth * 0.4,
                _ => {}
            }
        }
        if depth2 > 0.0 {
            match params.lfo2.target {
                LfoTarget::Pitch => pitch_mod += lfo2_value * depth2 * 2.0,
                LfoTarget::Pwm => pw_mod += lfo2_value * depth2 * 0.4,
                _ => {}
            }
        }
        pitch_mod += mod_pitch * 12.0;
        pw_mod += mod_pwm * 0.4;

        let bend = semitone_ratio(pitch_mod);

        // --- oscillators ----------------------------------------------------
        let mut osc_level = [0.0f32; 2];
        for which in 0..2 {
            let o = params.osc[which];
            let level = if o.on { o.level } else { 0.0 };
            osc_level[which] = level;
            let out: &mut [f32] = if which == 0 {
                &mut self.osc_a[..frames]
            } else {
                &mut self.osc_b[..frames]
            };
            if level <= 0.0 {
                out.fill(0.0);
                continue;
            }
            let detune = semitone_ratio(o.detune / 100.0);
            let mut freq = current_freq * bend * semitone_ratio(o.pitch) * detune;
            freq = freq.clamp(0.25, sr * 0.45);
            let pw = if o.wave.is_pulse() {
                (o.pw + pw_mod).clamp(0.05, 0.95)
            } else {
                (o.pw + pw_mod).clamp(0.05, 0.95)
            };
            render_oscillator(slot, which, o, freq, pw, frames, out, &mut self.rng);
        }

        simd::mix2_into(
            &self.osc_a[..frames],
            &self.osc_b[..frames],
            &mut self.voice_buf[..frames],
            osc_level[0],
            osc_level[1],
        );

        // --- amplitude envelope ---------------------------------------------
        let gate = voice.gate;
        {
            let env = &mut self.envs[slot];
            for sample in self.env_buf[..frames].iter_mut() {
                *sample = env.process(gate);
            }
        }
        let env_last = self.env_buf[frames - 1];
        self.vm.voices[slot].env_value = env_last;

        // Independent filter envelope (shares the voice gate).
        {
            let fenv = &mut self.filter_envs[slot];
            for sample in self.filter_env_buf[..frames].iter_mut() {
                *sample = fenv.process(gate);
            }
        }
        let filter_env_last = self.filter_env_buf[frames - 1];

        let velocity = voice.velocity;
        for i in 0..frames {
            self.voice_buf[i] *= self.env_buf[i] * velocity;
        }

        // --- tremolo / volume modulation ------------------------------------
        let vol_depth = depth * matches!(params.lfo.target, LfoTarget::Volume) as u32 as f32;
        let vol_depth2 = depth2 * matches!(params.lfo2.target, LfoTarget::Volume) as u32 as f32;
        if vol_depth > 0.0 || vol_depth2 > 0.0 || mod_volume != 0.0 {
            for i in 0..frames {
                let l = self.lfo_buf[i];
                let l2 = self.lfo2_buf[i];
                let mut g = 1.0 - vol_depth * (0.5 - 0.5 * l) - vol_depth2 * (0.5 - 0.5 * l2);
                g += mod_volume * (0.5 + 0.5 * l);
                self.voice_buf[i] *= g.clamp(0.0, 4.0);
            }
        }

        // --- filter ---------------------------------------------------------
        let mut cutoff = params.filter.cutoff;
        if params.filter.kbd {
            cutoff *= semitone_ratio(voice.note as f32 - 60.0);
        }
        if params.filter.env_amt > 0.0 {
            cutoff *= exp2(filter_env_last * params.filter.env_amt * 6.0);
        }
        if depth > 0.0 && matches!(params.lfo.target, LfoTarget::Cutoff) {
            cutoff *= exp2(lfo_value * depth * 4.0);
        }
        if depth2 > 0.0 && matches!(params.lfo2.target, LfoTarget::Cutoff) {
            cutoff *= exp2(lfo2_value * depth2 * 4.0);
        }
        cutoff *= exp2(mod_cutoff * 4.0);
        cutoff = cutoff.clamp(20.0, sr * 0.45);

        let kind = params.filter.kind;
        unsafe {
            gs_voice_filter_set(
                slot as i32,
                kind.to_u32() as i32,
                cutoff,
                params.filter.res,
                params.filter.drive,
            );
            gs_voice_filter_block(
                slot as i32,
                kind.to_u32() as i32,
                self.voice_buf.as_ptr(),
                self.osc_a.as_mut_ptr(),
                frames as u32,
            );
            gs_voice_dc_block(
                slot as i32,
                self.osc_a.as_ptr(),
                self.voice_buf.as_mut_ptr(),
                frames as u32,
            );
        }

        // --- pan + accumulate into the stereo mix bus -----------------------
        // The per-voice filter is mono, so the two oscillator PAN controls are
        // combined into a level-weighted voice position and applied with an
        // equal-power law after the filter.
        let levels = osc_level[0] + osc_level[1];
        let pan = if levels > 1e-4 {
            ((osc_level[0] * params.osc[0].pan + osc_level[1] * params.osc[1].pan) / levels)
                .clamp(-1.0, 1.0)
        } else {
            0.0
        };
        let angle = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
        let pan_l = angle.cos();
        let pan_r = angle.sin();
        simd::accumulate(&self.voice_buf[..frames], &mut self.mix_l[..frames], VOICE_GAIN * pan_l);
        simd::accumulate(&self.voice_buf[..frames], &mut self.mix_r[..frames], VOICE_GAIN * pan_r);

        // --- retire finished voices -----------------------------------------
        if !voice.gate && !self.envs[slot].is_active() {
            self.vm.release_slot(slot);
            self.envs[slot].reset();
            self.filter_envs[slot].reset();
        }
    }

    fn apply_fx(&mut self, frames: usize) {
        let fx = self.params.fx;
        let rev_mix = if fx.reverb_on { fx.reverb_mix } else { 0.0 };
        let dly_mix = if fx.delay_on { fx.delay_mix } else { 0.0 };
        let rev_fb = 0.70 + fx.reverb_size * 0.27;
        let rev_lpf = 4000.0 + fx.reverb_size * 10000.0;
        let dly_time = self.params.delay_time_seconds();
        let dly_fb = fx.delay_fb;

        if (rev_fb - self.fx.reverb_fb).abs() > 1e-4
            || (rev_lpf - self.fx.reverb_lpf).abs() > 1.0
            || (rev_mix - self.fx.reverb_mix).abs() > 1e-4
        {
            unsafe { gs_sp_set_reverb(rev_fb, rev_lpf, rev_mix) };
            self.fx.reverb_fb = rev_fb;
            self.fx.reverb_lpf = rev_lpf;
            self.fx.reverb_mix = rev_mix;
        }
        if (dly_time - self.fx.delay_time).abs() > 1e-4
            || (dly_fb - self.fx.delay_fb).abs() > 1e-4
            || (dly_mix - self.fx.delay_mix).abs() > 1e-4
        {
            unsafe { gs_sp_set_delay(dly_time, dly_fb, dly_mix) };
            self.fx.delay_time = dly_time;
            self.fx.delay_fb = dly_fb;
            self.fx.delay_mix = dly_mix;
        }

        unsafe {
            gs_sp_process_block(
                self.fx_l.as_ptr(),
                self.fx_r.as_ptr(),
                self.fx_l.as_mut_ptr(),
                self.fx_r.as_mut_ptr(),
                frames as u32,
            );
        }

        // Modulation effects run after reverb/delay, each wet/dry blended.
        if fx.chorus_on && fx.chorus_mix > 0.0 {
            unsafe {
                gs_fx_chorus_set(fx.chorus_depth, fx.chorus_rate, 20.0, 0.25);
                gs_fx_chorus_block(
                    self.fx_l.as_ptr(),
                    self.fx_r.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    self.osc_b.as_mut_ptr(),
                    frames as u32,
                );
            }
            self.blend_wet(frames, fx.chorus_mix);
        }
        if fx.flanger_on && fx.flanger_mix > 0.0 {
            unsafe {
                gs_fx_flanger_set(0.5, fx.flanger_rate, 2.0, fx.flanger_fb);
                gs_fx_flanger_block(
                    self.fx_l.as_ptr(),
                    self.fx_r.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    self.osc_b.as_mut_ptr(),
                    frames as u32,
                );
            }
            self.blend_wet(frames, fx.flanger_mix);
        }
        if fx.phaser_on && fx.phaser_mix > 0.0 {
            unsafe {
                gs_fx_phaser_set(0.8, fx.phaser_rate, fx.phaser_fb, 4);
                gs_fx_phaser_block(
                    self.fx_l.as_ptr(),
                    self.fx_r.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    self.osc_b.as_mut_ptr(),
                    frames as u32,
                );
            }
            self.blend_wet(frames, fx.phaser_mix);
        }
        if fx.drive_on && fx.drive_mix > 0.0 {
            unsafe {
                gs_fx_overdrive_set(fx.drive_amt);
                gs_fx_overdrive_block(
                    self.fx_l.as_ptr(),
                    self.fx_r.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    self.osc_b.as_mut_ptr(),
                    frames as u32,
                );
            }
            self.blend_wet(frames, fx.drive_mix);
        }
    }

    /// `fx_l/fx_r = dry*(1-mix) + wet*mix`, where the wet signal is in
    /// `osc_a/osc_b` (free scratch buffers after the voice loop).
    fn blend_wet(&mut self, frames: usize, mix: f32) {
        let dry = 1.0 - mix;
        for i in 0..frames {
            self.fx_l[i] = self.fx_l[i] * dry + self.osc_a[i] * mix;
            self.fx_r[i] = self.fx_r[i] * dry + self.osc_b[i] * mix;
        }
    }
}

/// Render one oscillator into `out` (block ABI, noise handled in Rust).
#[allow(clippy::too_many_arguments)]
fn render_oscillator(
    slot: usize,
    which: usize,
    params: OscParams,
    freq: f32,
    pw: f32,
    frames: usize,
    out: &mut [f32],
    rng: &mut Rng,
) {
    match params.wave.daisy_id() {
        Some(daisy_wave) => unsafe {
            gs_voice_osc_set(
                slot as i32,
                which as i32,
                daisy_wave,
                freq,
                1.0,
                pw,
            );
            gs_voice_osc_block(slot as i32, which as i32, out.as_mut_ptr(), frames as u32);
        },
        None => {
            // White noise: no oscillator state to preserve.
            for sample in out.iter_mut() {
                *sample = rng.next_bipolar() * 0.5;
            }
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Process-wide engine instance. The AudioWorklet is single threaded, and the
/// engine is only ever touched from `process()` / message handlers on that
/// thread.
pub static mut ENGINE: Engine = Engine::new();

/// Safe accessor for the single-threaded worklet engine.
///
/// # Safety
/// Must only be called from the audio render thread (and the worklet's message
/// handler, which is serialised against `process` by the AudioWorklet runtime).
#[allow(static_mut_refs)]
pub fn engine() -> &'static mut Engine {
    unsafe { &mut *core::ptr::addr_of_mut!(ENGINE) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// The C DSP keeps process-wide state, so engine tests are serialised.
    static ENGINE_LOCK: Mutex<()> = Mutex::new(());

    fn new_engine(poly: usize) -> Box<Engine> {
        let mut e = Box::new(Engine::new());
        e.init(48000.0, poly);
        e
    }

    #[test]
    fn silence_in_silence_out() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        let frames = 128;
        for _ in 0..8 {
            e.process(frames);
        }
        for i in 0..frames {
            assert!(e.out_l[i].abs() < 1e-6, "left not silent at {i}");
            assert!(e.out_r[i].abs() < 1e-6, "right not silent at {i}");
        }
    }

    #[test]
    fn note_on_produces_audio_and_note_off_decays() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::FILTER_CUTOFF, 12000.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_RELEASE, 0.02);
        e.note_on(60, 1.0);
        let mut energy = 0.0f32;
        for _ in 0..40 {
            e.process(128);
            energy += simd::peak(&e.out_l[..128]);
        }
        assert!(energy > 0.5, "expected audible output, got {energy}");
        e.note_off(60);
        for _ in 0..80 {
            e.process(128);
        }
        assert!(simd::peak(&e.out_l[..128]) < 1e-4);
    }

    #[test]
    fn process_is_allocation_free() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::FX_REVERB_ON, 1.0);
        e.set_param(id::FX_DELAY_ON, 1.0);
        e.note_on(60, 1.0);
        let before_arena = alloc_arena::alloc_count();
        let before_sp = unsafe { gs_sp_alloc_events() };
        for _ in 0..200 {
            e.process(128);
        }
        assert_eq!(
            unsafe { gs_sp_alloc_events() },
            before_sp,
            "C DSP must not allocate during process"
        );
        assert_eq!(
            alloc_arena::alloc_count(),
            before_arena,
            "Rust arena must not allocate during process"
        );
        assert_eq!(alloc_arena::violations(), 0);
    }

    #[test]
    fn polyphony_downgrade_releases_excess_voices() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(8);
        for n in 0..8u8 {
            e.note_on(48 + n, 1.0);
        }
        e.process(128);
        let forced = e.vm.force_release_excess(4);
        assert!(forced >= 4, "expected at least 4 voices released, got {forced}");
    }

    #[test]
    fn extreme_and_random_params_stay_finite() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(8);
        let mut rng = Rng::new(0x9e37_79b9);
        for round in 0..160u32 {
            for id in 0..=66u32 {
                let value = match round % 4 {
                    0 => rng.next_bipolar() * 1.0e6,
                    1 => {
                        if rng.next_bipolar() > 0.0 {
                            f32::MAX
                        } else {
                            f32::MIN
                        }
                    }
                    2 => f32::NAN,
                    _ => rng.next_bipolar(),
                };
                e.set_param(id, value);
            }
            if round % 7 == 0 {
                e.note_on((rng.next_u32() % 128) as u8, 1.0);
            }
            if round % 11 == 0 {
                e.note_off((rng.next_u32() % 128) as u8);
            }
            for _ in 0..4 {
                e.process(128);
            }
            for &x in e.left().iter().chain(e.right().iter()) {
                assert!(x.is_finite(), "non-finite output at round {round}: {x}");
            }
        }
        assert_eq!(e.nan_events, 0, "the output guard should never trigger");
    }

    #[test]
    fn mono_and_legato_use_one_voice() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::VOICE_MODE, 1.0); // mono
        e.set_param(id::GLIDE, 0.2);
        e.note_on(60, 1.0);
        e.process(128);
        assert_eq!(e.active_voices(), 1);
        e.note_on(67, 1.0);
        e.process(128);
        assert_eq!(e.active_voices(), 1, "mono must reuse slot 0");

        e.set_param(id::VOICE_MODE, 2.0); // legato
        e.note_on(64, 1.0);
        e.process(128);
        assert_eq!(e.active_voices(), 1);
        e.note_off(64);
        e.process(128);
        assert_eq!(e.active_voices(), 1, "still holding the previous key");
        e.note_off(67);
        e.note_off(60);
        for _ in 0..600 {
            e.process(128);
        }
        assert_eq!(e.active_voices(), 0);
    }

    #[test]
    fn pan_moves_energy_between_channels() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(1);
        e.set_param(id::OSC1_WAVE, 2.0);
        e.set_param(id::OSC1_LEVEL, 1.0);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC1_PAN, -1.0);
        e.note_on(60, 1.0);
        for _ in 0..40 {
            e.process(128);
        }
        let left = simd::peak(&e.left()[..128]);
        let right = simd::peak(&e.right()[..128]);
        assert!(left > right * 5.0, "expected hard-left pan, L={left} R={right}");

        e.set_param(id::OSC1_PAN, 1.0);
        for _ in 0..40 {
            e.process(128);
        }
        let left = simd::peak(&e.left()[..128]);
        let right = simd::peak(&e.right()[..128]);
        assert!(right > left * 5.0, "expected hard-right pan, L={left} R={right}");
    }

    #[test]
    fn spectrum_bins_update_while_playing() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 16000.0);
        e.note_on(69, 1.0);
        for _ in 0..40 {
            e.process(128);
        }
        let peak = e
            .spectrum
            .bins()
            .iter()
            .cloned()
            .fold(0.0f32, f32::max);
        assert!(peak > 0.05, "spectrum should show energy, got {peak}");
    }

    #[test]
    fn continuous_params_snap_on_first_block_then_smooth() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::FILTER_CUTOFF, 12000.0);
        e.process(128);
        // First block snaps to the host value.
        assert!((e.params.filter.cutoff - 12000.0).abs() < 1e-3);

        // A later change is ramped, not stepped.
        e.set_param(id::FILTER_CUTOFF, 400.0);
        e.process(128);
        let after_one = e.params.filter.cutoff;
        assert!(
            after_one < 12000.0 && after_one > 400.0,
            "cutoff should be mid-ramp, got {after_one}"
        );
        for _ in 0..120 {
            e.process(128);
        }
        assert!(
            (e.params.filter.cutoff - 400.0).abs() < 1.0,
            "cutoff should converge, got {}",
            e.params.filter.cutoff
        );
    }

    #[test]
    fn discrete_params_change_immediately() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.process(128);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Square as u32 as f32);
        e.process(128);
        assert_eq!(e.params.osc[0].wave, crate::params::Wave::Square);
    }

    fn render_chord(e: &mut Engine, notes: &[u8], blocks: usize) -> (f32, f32, f32) {
        for note in notes {
            e.note_on(*note, 1.0);
        }
        let mut peak = 0.0f32;
        let mut knee = 0usize;
        let mut total = 0usize;
        let mut min_gain = 1.0f32;
        for block in 0..blocks {
            e.process(128);
            if block < 12 {
                continue; // skip the attack of the first block
            }
            for i in 0..128 {
                let out = e.out_l[i].abs().max(e.out_r[i].abs());
                peak = peak.max(out);
                if out > 0.82 {
                    knee += 1;
                }
                total += 1;
            }
            min_gain = min_gain.min(e.limit_gain);
        }
        (peak, knee as f32 / total as f32, min_gain)
    }

    /// A loud polyphonic chord must reach the output without being coloured:
    /// the master bus stays inside the limiter's linear region, so nothing is
    /// soft-clipped on the way out (this used to distort ~25% of samples).
    #[test]
    fn dense_chords_stay_clean() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        for param in [id::OSC1_LEVEL, id::OSC2_LEVEL] {
            e.set_param(param, 1.0);
        }
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 16000.0);
        e.set_param(id::MASTER_VOLUME, 0.75);
        let (peak, knee, min_gain) =
            render_chord(&mut e, &[36, 43, 48, 52, 55, 59, 62, 64, 67, 71, 74, 79], 200);
        assert!(peak <= 1.0, "output clipped at {peak}");
        assert!(knee < 0.001, "{:.2}% of the output was soft-limited", knee * 100.0);
        assert!(min_gain > 0.98, "limiter worked too hard: {min_gain}");
    }

    /// Voices start at random phases, so a stacked chord grows like sqrt(N)
    /// instead of N. Without this the same chord used to peak around 1.6.
    #[test]
    fn stacked_voices_do_not_start_in_phase() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        for param in [id::OSC1_LEVEL, id::OSC2_LEVEL] {
            e.set_param(param, 1.0);
        }
        e.set_param(id::FILTER_CUTOFF, 16000.0);
        let mut peak_mix = 0.0f32;
        for note in [36, 43, 48, 52, 55, 59, 62, 64, 67, 71, 74, 79] {
            e.note_on(note, 1.0);
        }
        for block in 0..120 {
            e.process(128);
            if block < 12 {
                continue;
            }
            for i in 0..128 {
                peak_mix = peak_mix.max(e.mix_l[i].abs().max(e.mix_r[i].abs()));
            }
        }
        assert!(peak_mix < 1.2, "in-phase stacking suspected, mix peaked at {peak_mix}");
    }

    #[test]
    fn limiter_keeps_the_master_bus_bounded() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        for param in [id::OSC1_LEVEL, id::OSC2_LEVEL] {
            e.set_param(param, 1.0);
        }
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_RES, 1.0);
        e.set_param(id::FILTER_DRIVE, 1.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for note in [48, 52, 55, 59, 62, 64, 67, 71, 74, 77, 79, 83] {
            e.note_on(note, 1.0);
        }
        for _ in 0..80 {
            e.process(128);
        }
        for i in 0..128 {
            assert!(e.out_l[i].is_finite() && e.out_r[i].is_finite());
            assert!(e.out_l[i].abs() <= 1.0 + 1e-6, "left over unity at {i}");
            assert!(e.out_r[i].abs() <= 1.0 + 1e-6, "right over unity at {i}");
        }
        assert!(e.limit_gain <= 1.0 && e.limit_gain > 0.0);
    }
}
