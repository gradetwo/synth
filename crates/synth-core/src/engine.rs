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
use crate::dsp::comb::CombFilter;
use crate::dsp::ladder::LadderFilter;
use crate::dsp::reverb::{Reverb, ReverbParams};
use crate::dsp::util::{exp2, note_to_hz, semitone_ratio, soft_limit, Rng};
use crate::fft::Spectrum;
use crate::params::{
    id, is_continuous, LfoTarget, ModDst, ModSrc, OscParams, Params, MAX_BLOCK_SIZE, MAX_UNISON,
    MAX_VOICES, PARAM_COUNT,
};
use crate::voice::{NoteOnResult, VoiceManager};

// ---------------------------------------------------------------- C ABI glue

extern "C" {
    fn gs_daisy_init(sample_rate: f32);
    fn gs_voice_reset(v: i32);
    fn gs_voice_phase(v: i32, p0: f32, p1: f32);
    fn gs_voice_osc_set(v: i32, which: i32, sub: i32, wave: u32, freq: f32, amp: f32, pw: f32);
    fn gs_voice_osc_block(v: i32, which: i32, sub: i32, out: *mut f32, frames: u32);
    fn gs_voice_filter_set(v: i32, side: i32, kind: i32, freq: f32, res: f32, drive: f32);
    fn gs_voice_filter_block(
        v: i32,
        side: i32,
        kind: i32,
        input: *const f32,
        out: *mut f32,
        frames: u32,
    );
    fn gs_voice_dc_block(v: i32, side: i32, input: *const f32, out: *mut f32, frames: u32);
    fn gs_init(sample_rate: f32, max_polyphony: u32) -> u32;
    fn gs_voice_formant_set(v: i32, side: i32, vowel: f32, res: f32);
    fn gs_voice_formant_block(
        v: i32,
        side: i32,
        input: *const f32,
        out: *mut f32,
        frames: u32,
    );
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
/// Fade applied to a voice that is being stolen. Long-release patches steal
/// constantly on dense material, and every cut is a tiny broadband click, so
/// the fade is deliberately gentle: 20 ms is inaudible as a note ending but
/// spreads the discontinuity over a thousand samples.
const STEAL_RELEASE: f32 = 0.02;
/// Per-voice gain before the mix bus.
/// Envelope level below which a voice stops being filtered: -54 dB, far under
/// anything audible, which is exactly where long release tails spend their time.
const SILENT_VOICE: f32 = 0.002;

/// Trim applied *before* the per-voice filter, with the same amount made up
/// after it. The ladder's tanh stages saturate around unity, and the raw
/// oscillator sum can reach ~1.2 at full level, so without this trim every
/// loud note picked up intermodulation grit — very audible on clean patches
/// such as the bell, which is nothing but two sines.
const FILTER_TRIM: f32 = 0.65;

/// Per-voice bus gain. With decorrelated start phases a dense chord sums to
/// roughly sqrt(N) instead of N, so this leaves the master bus inside the
/// limiter's linear region even with every oscillator at full level.
const VOICE_GAIN: f32 = 0.22;
/// One-pole time constant for continuous-parameter smoothing (seconds).
const SMOOTH_TAU_S: f32 = 0.02;
/// Peak limiter: ceiling, lookahead window and release (seconds).
const LIMIT_CEILING: f32 = 0.95;
/// Lookahead of ~2.7 ms at 48 kHz: long enough to catch any transient, short
/// enough that the delay is imperceptible.
const LOOKAHEAD: usize = 128;
const LIMIT_RELEASE_S: f32 = 0.15;
/// Peak-detector hold: how long the limiter remembers a transient.
const LIMIT_PEAK_HOLD_S: f32 = 0.05;

/// Frequency of a note number with an explicit master tune and tuning table.
#[inline]
fn pitch_hz_with(note: f32, master_tune: f32, tuning: &[f32; crate::params::TUNING_NOTES]) -> f32 {
    let index = note.round() as i32;
    let cents = if (0..crate::params::TUNING_NOTES as i32).contains(&index) {
        tuning[index as usize]
    } else {
        0.0
    };
    note_to_hz(note + master_tune + cents / 100.0)
}

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
    delay_time: f32,
    delay_fb: f32,
    delay_mix: f32,
}

impl FxSnapshot {
    const fn new() -> Self {
        Self {
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
    /// Scratch for rendering one unison sub-voice at a time.
    unison_buf: [f32; MAX_BLOCK_SIZE],
    /// Filtered OSC 2 signal when the oscillators are panned apart.
    voice_buf_r: [f32; MAX_BLOCK_SIZE],
    /// Per-voice LFO state, used when a patch retriggers the LFO per note.
    voice_lfos: [Lfo; MAX_VOICES],
    voice_lfo2s: [Lfo; MAX_VOICES],
    /// Scratch for a per-voice LFO block (voices render one at a time).
    lfo_scratch: [f32; MAX_BLOCK_SIZE],
    lfo2_scratch: [f32; MAX_BLOCK_SIZE],
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
    /// Increments per started voice; drives the per-note RANDOM source.
    random_seed: u32,
    /// Polyphony asked for by the host, before the unison budget is applied.
    poly_request: usize,
    /// Blocks a voice spent in its silent release tail (filter skipped).
    silent_blocks: u32,
    /// One four-pole low-pass per voice per oscillator side.
    ladders: [[LadderFilter; 2]; MAX_VOICES],
    /// Per-note tuning offsets in cents. Lives here rather than in `Params` so
    /// it is an instrument setting that presets do not overwrite.
    tuning: [f32; crate::params::TUNING_NOTES],
    /// Per-note pitch bend in semitones (MPE): every note bends on its own, so
    /// this cannot be the single global `pitch_bend` wheel.
    bends: [f32; crate::params::TUNING_NOTES],
    reverb: Reverb,
    /// One comb resonator per voice, used by the COMB filter type.
    combs: [CombFilter; MAX_VOICES],
    pitch_bend: f32,
    mod_wheel: f32,
    /// Channel pressure (0..1) from the controller.
    aftertouch: f32,
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
    /// Decaying peak estimate that feeds the limiter.
    limit_peak: f32,
    /// Current attack ramp (gain units per sample).
    limit_slope: f32,
    /// Gain the signal currently needs (attack is instant, release is slow).
    limit_target: f32,
    /// Lookahead delay lines.
    look_l: [f32; LOOKAHEAD],
    look_r: [f32; LOOKAHEAD],
    look_pos: usize,
    /// Highest true-peak estimate since the last meter read.
    true_peak: f32,
    /// Short-term RMS for the loudness readout.
    rms_avg: f32,
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
            unison_buf: [0.0; MAX_BLOCK_SIZE],
            voice_buf_r: [0.0; MAX_BLOCK_SIZE],
            voice_lfos: [Lfo::new(); MAX_VOICES],
            voice_lfo2s: [Lfo::new(); MAX_VOICES],
            lfo_scratch: [0.0; MAX_BLOCK_SIZE],
            lfo2_scratch: [0.0; MAX_BLOCK_SIZE],
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
            random_seed: 0,
            poly_request: 16,
            silent_blocks: 0,
            ladders: [[LadderFilter::new(); 2]; MAX_VOICES],
            tuning: [0.0; crate::params::TUNING_NOTES],
            bends: [0.0; crate::params::TUNING_NOTES],
            reverb: Reverb::new(),
            combs: [const { CombFilter::new() }; MAX_VOICES],
            pitch_bend: 0.0,
            mod_wheel: 0.0,
            aftertouch: 0.0,
            mono_held: [0; 16],
            mono_len: 0,
            master_gain: 0.75,
            smooth_target: [0.0; PARAM_COUNT],
            smooth_value: [0.0; PARAM_COUNT],
            smooth_set: [false; PARAM_COUNT],
            smooth_ready: [false; PARAM_COUNT],
            limit_gain: 1.0,
            limit_peak: 0.0,
            limit_slope: 0.0,
            limit_target: 1.0,
            look_l: [0.0; LOOKAHEAD],
            look_r: [0.0; LOOKAHEAD],
            look_pos: 0,
            true_peak: 0.0,
            rms_avg: 0.0,
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
        for comb in self.combs.iter_mut() {
            comb.prepare(self.sample_rate);
        }
        self.reverb.set_sample_rate(self.sample_rate);
        self.reverb.set_params(ReverbParams {
            size: self.params.fx.reverb_size,
            damp: self.params.fx.reverb_damp,
            mix: 0.0,
            width: self.params.fx.reverb_width,
            predelay: self.params.fx.reverb_predelay,
        });
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
        self.poly_request = max_polyphony.clamp(2, MAX_VOICES);
        self.apply_polyphony_cap();
        self.pitch_bend = 0.0;
        self.mod_wheel = 0.0;
        self.aftertouch = 0.0;
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
        let unison_before = (self.params.osc[0].unison, self.params.osc[1].unison);
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
        if matches!(param_id, id::OSC1_UNISON | id::OSC2_UNISON)
            && (self.params.osc[0].unison, self.params.osc[1].unison) != unison_before
        {
            self.apply_polyphony_cap();
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

    /// Tuning offset for a (possibly fractional) note number.
    #[inline]
    fn tuning_cents(&self, note: f32) -> f32 {
        let index = note.round() as i32;
        if (0..crate::params::TUNING_NOTES as i32).contains(&index) {
            self.tuning[index as usize]
        } else {
            0.0
        }
    }

    /// Frequency of a note number in Hz, including master tune and microtuning.
    #[inline]
    pub fn pitch_hz(&self, note: f32) -> f32 {
        note_to_hz(note + self.params.master_tune + self.tuning_cents(note) / 100.0)
    }

    /// Set one key's microtuning offset (cents).
    pub fn set_tuning_note(&mut self, note: u32, cents: f32) {
        if (note as usize) < crate::params::TUNING_NOTES {
            self.tuning[note as usize] = cents.clamp(-1200.0, 1200.0);
        }
    }

    /// Bend one note (MPE). `semitones` is the already-scaled bend amount.
    pub fn note_bend(&mut self, note: u32, semitones: f32) {
        if (note as usize) < crate::params::TUNING_NOTES {
            self.bends[note as usize] = semitones.clamp(-48.0, 48.0);
        }
    }

    pub fn note_bend_at(&self, note: usize) -> f32 {
        self.bends.get(note).copied().unwrap_or(0.0)
    }

    pub fn tuning_cents_at(&self, note: usize) -> f32 {
        self.tuning.get(note).copied().unwrap_or(0.0)
    }

    pub fn set_max_polyphony(&mut self, n: usize) {
        self.poly_request = n.clamp(2, MAX_VOICES);
        self.apply_polyphony_cap();
    }

    /// Voice-blocks that took the silent-tail fast path (diagnostics).
    pub fn silent_blocks(&self) -> u32 {
        self.silent_blocks
    }

    /// Current voice ceiling (see [`Self::update_polyphony_cap`]).
    pub fn max_polyphony(&self) -> usize {
        self.vm.max_polyphony()
    }

    /// prd.md §7.1 — elastic downgrade with smooth release.
    pub fn trigger_smooth_downgrade(&mut self) {
        // Lower the *request* so a later unison change cannot restore the old
        // ceiling, then let the cap apply as usual.
        self.poly_request = self.poly_request.saturating_sub(2).max(4);
        self.apply_polyphony_cap();
        let cap = self.vm.max_polyphony();
        self.vm.force_release_excess(cap);
    }

    pub fn pitch_bend(&mut self, semitones: f32) {
        self.pitch_bend = semitones.clamp(-24.0, 24.0);
    }

    pub fn mod_wheel(&mut self, value: f32) {
        self.mod_wheel = value.clamp(0.0, 1.0);
    }

    pub fn aftertouch(&mut self, value: f32) {
        self.aftertouch = value.clamp(0.0, 1.0);
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        if self.params.voice_mode != 0 {
            self.mono_note_on(note, velocity);
            return;
        }
        let vel = velocity.clamp(0.0, 1.0);
        let freq = self.pitch_hz(note as f32);
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

    /// Unison multiplies the oscillator count, so the voice cap shrinks with it:
    /// the requested polyphony is divided by the stack size (a seven-voice stack
    /// on a sixteen-voice patch plays two notes, never seven times the work).
    fn apply_polyphony_cap(&mut self) {
        let unison = self.params.osc[0].unison.max(self.params.osc[1].unison).max(1) as usize;
        let cap = (self.poly_request / unison).max(2);
        self.vm.set_max_polyphony(cap);
    }

    /// Deterministic per-note random value for the RANDOM modulation source.
    fn next_random(&mut self) -> f32 {
        self.random_seed = self.random_seed.wrapping_add(1);
        (self.random_seed as f32 * 0.754_877_7 + 0.13).fract()
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
        let freq = self.pitch_hz(note as f32);
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
            self.ladders[slot][0].reset();
            self.ladders[slot][1].reset();
            unsafe { gs_voice_reset(slot as i32) };
            let (p0, p1) = self.next_phases();
            unsafe { gs_voice_phase(slot as i32, p0, p1) };
            let random = self.next_random();
            self.vm.voices[slot].random = random;
            self.voice_lfos[slot].retrigger();
            self.voice_lfo2s[slot].retrigger();
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
            let freq = self.pitch_hz(last as f32);
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
        let random = self.next_random();
        self.vm.voices[slot].random = random;
        self.voice_lfos[slot].retrigger();
        self.voice_lfo2s[slot].retrigger();
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

    /// True-peak estimate since the last [`Self::take_true_peak`].
    pub fn true_peak(&self) -> f32 {
        self.true_peak
    }

    /// Short-term RMS of the output, as a linear amplitude.
    pub fn loudness_rms(&self) -> f32 {
        self.rms_avg
    }

    /// Current limiter gain reduction (1.0 = none).
    pub fn limit_reduction(&self) -> f32 {
        self.limit_gain
    }

    /// Reset the peak hold after the UI has read it.
    pub fn take_true_peak(&mut self) -> f32 {
        let peak = self.true_peak;
        self.true_peak = 0.0;
        peak
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
        // The per-voice LFO scratch buffers are moved out so the loop can keep
        // borrowing `self` for the voice state.
        let mut lfo_scratch = self.lfo_scratch;
        let mut lfo2_scratch = self.lfo2_scratch;
        let mut active = 0u32;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active {
                self.render_voice(
                    slot,
                    frames,
                    depth,
                    lfo_value,
                    depth2,
                    lfo2_value,
                    &mut lfo_scratch,
                    &mut lfo2_scratch,
                );
                active += 1;
            }
        }
        self.lfo_scratch = lfo_scratch;
        self.lfo2_scratch = lfo2_scratch;
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

        // --- master volume, lookahead limiter, safety limiter ----------------
        let target = self.params.master_volume;
        let start = self.master_gain;
        let step = (target - start) / frames as f32;
        let sr = self.sample_rate.max(1000.0);

        // The signal is delayed by LOOKAHEAD samples while the gain is computed
        // from the *incoming* samples, so a transient is already attenuated by
        // the time it reaches the output — no clipping and no pumping.
        let decay = (-1.0 / (LIMIT_PEAK_HOLD_S * sr)).exp();
        let release_step = 1.0 / (LIMIT_RELEASE_S * sr);
        for i in 0..frames {
            let g = start + step * (i as f32 + 1.0);
            let in_l = self.fx_l[i] * g;
            let in_r = self.fx_r[i] * g;

            // Sliding peak estimate: fast attack, ~60 ms hold-and-decay.
            let abs = in_l.abs().max(in_r.abs());
            self.limit_peak = if abs > self.limit_peak { abs } else { self.limit_peak * decay };

            let need = if self.limit_peak > LIMIT_CEILING {
                LIMIT_CEILING / self.limit_peak
            } else {
                1.0
            };
            // `limit_target` is the gain the signal *needs*: it drops instantly
            // and recovers over the release time, while `limit_gain` follows it
            // with a linear attack that lands within the lookahead window.
            if need < self.limit_target {
                self.limit_target = need;
                self.limit_slope = (self.limit_gain - need) / LOOKAHEAD as f32;
            } else {
                self.limit_target = (self.limit_target + release_step).min(need);
            }
            if self.limit_gain > self.limit_target {
                self.limit_gain = (self.limit_gain - self.limit_slope).max(self.limit_target);
            } else {
                self.limit_gain = self.limit_target;
            }

            // Delayed signal × gain.
            let out_l = self.look_l[self.look_pos] * self.limit_gain;
            let out_r = self.look_r[self.look_pos] * self.limit_gain;
            self.look_l[self.look_pos] = in_l;
            self.look_r[self.look_pos] = in_r;
            self.look_pos += 1;
            if self.look_pos >= LOOKAHEAD {
                self.look_pos = 0;
            }

            // True-peak estimate: the inter-sample peak of a linear ramp is the
            // average of neighbouring samples, which catches most of what a
            // sample-peak meter misses.
            let interp = ((in_l + out_l) * 0.5).abs().max(((in_r + out_r) * 0.5).abs());
            self.true_peak = self.true_peak.max(interp).max(out_l.abs()).max(out_r.abs());

            let l = soft_limit(out_l);
            let r = soft_limit(out_r);
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
        // Short-term loudness (RMS over the meter window, in dBFS): the UI shows
        // it next to the peak so loudness problems are visible before clipping.
        let mut sum = 0.0f32;
        for i in 0..frames {
            sum += self.out_l[i] * self.out_l[i] + self.out_r[i] * self.out_r[i];
        }
        let block_rms = (sum / (2.0 * frames as f32)).sqrt();
        self.rms_avg = self.rms_avg * 0.92 + block_rms * 0.08;
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
        let tuning = self.tuning;
        let params = self.params.env;
        let fenv_params = self.params.filter_env;
        while let Some((slot, _note, _vel)) = self
            .vm
            .flush_pending(|note| pitch_hz_with(note as f32, tune, &tuning))
        {
            self.ladders[slot][0].reset();
            self.ladders[slot][1].reset();
            unsafe { gs_voice_reset(slot as i32) };
            let (p0, p1) = self.next_phases();
            unsafe { gs_voice_phase(slot as i32, p0, p1) };
            let random = self.next_random();
            self.vm.voices[slot].random = random;
            self.voice_lfos[slot].retrigger();
            self.voice_lfo2s[slot].retrigger();
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

    #[allow(clippy::too_many_arguments)]
    fn render_voice(
        &mut self,
        slot: usize,
        frames: usize,
        depth: f32,
        lfo_value: f32,
        depth2: f32,
        lfo2_value: f32,
        lfo_scratch: &mut [f32; MAX_BLOCK_SIZE],
        lfo2_scratch: &mut [f32; MAX_BLOCK_SIZE],
    ) {
        let voice = self.vm.voices[slot];
        let sr = self.sample_rate;
        let params = self.params;

        // --- LFOs: global, or per-voice when RETRIG is on -------------------
        // A retriggered LFO restarts with every note, which is what makes
        // vibrato and filter sweeps line up with the attack.
        let lfo_per_voice = params.lfo.on && params.lfo.retrigger;
        let lfo2_per_voice = params.lfo2.on && params.lfo2.retrigger;
        let lfo_value = if lfo_per_voice {
            let rate = if params.lfo.sync {
                params.tempo / 60.0
            } else {
                params.lfo.rate
            };
            let mut lfo = self.voice_lfos[slot];
            lfo.one_shot = params.lfo.one_shot;
            lfo.render(params.lfo.wave, rate, sr, &mut lfo_scratch[..frames]);
            self.voice_lfos[slot] = lfo;
            lfo.value
        } else {
            lfo_value
        };
        let lfo2_value = if lfo2_per_voice {
            let rate = if params.lfo2.sync {
                params.tempo / 60.0
            } else {
                params.lfo2.rate
            };
            let mut lfo = self.voice_lfo2s[slot];
            lfo.one_shot = params.lfo2.one_shot;
            lfo.render(params.lfo2.wave, rate, sr, &mut lfo2_scratch[..frames]);
            self.voice_lfo2s[slot] = lfo;
            lfo.value
        } else {
            lfo2_value
        };

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
        let mut mod_pan = 0.0f32;
        let mut mod_res = 0.0f32;
        for route in params.routes.iter() {
            if !route.enabled || route.amount == 0.0 {
                continue;
            }
            let src = match route.src {
                ModSrc::Lfo => lfo_value,
                ModSrc::Env => voice.env_value,
                ModSrc::ModWheel => self.mod_wheel,
                ModSrc::Velocity => voice.velocity,
                ModSrc::Lfo2 => lfo2_value,
                ModSrc::Aftertouch => self.aftertouch,
                // Bipolar, sampled once per note so a held note stays put.
                ModSrc::Random => voice.random * 2.0 - 1.0,
                // ±1 across ±48 semitones around middle C.
                ModSrc::KeyTrack => (voice.note as f32 - 60.0) / 48.0,
            };
            let v = src * route.amount;
            match route.dst {
                ModDst::Cutoff => mod_cutoff += v,
                ModDst::Pitch => mod_pitch += v,
                ModDst::Volume => mod_volume += v,
                ModDst::Pwm => mod_pwm += v,
                ModDst::Pan => mod_pan += v,
                ModDst::Resonance => mod_res += v,
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

        // The note's own bend (MPE) rides on top of the global wheel.
        let note_bend = self.note_bend_at(voice.note as usize);
        let bend = semitone_ratio(pitch_mod + note_bend);

        // --- oscillators ----------------------------------------------------
        // Unison renders each sub-voice through this scratch buffer; it is moved
        // out of `self` first so the loop can still borrow `osc_a`/`osc_b`.
        let mut scratch: [f32; MAX_BLOCK_SIZE] = self.unison_buf;
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
            render_oscillator(
                slot,
                which,
                o,
                freq,
                pw,
                frames,
                out,
                &mut self.rng,
                &mut scratch[..],
            );
        }
        self.unison_buf = scratch;

        // Per-oscillator stereo: when the two oscillators sit at different pan
        // positions they keep separate signal paths (and separate filters), so
        // panning them apart actually spreads two different sounds instead of
        // fading one mono voice. Everything else keeps the cheap mono path.
        let levels = osc_level[0] + osc_level[1];
        let stereo = params.filter.kind != crate::params::FilterType::Comb
            && params.osc[0].on
            && params.osc[1].on
            && osc_level[0] > 0.0
            && osc_level[1] > 0.0
            && (params.osc[0].pan - params.osc[1].pan).abs() > 0.02;

        if stereo {
            let trim = FILTER_TRIM;
            for i in 0..frames {
                self.voice_buf[i] = self.osc_a[i] * osc_level[0] * trim;
                self.voice_buf_r[i] = self.osc_b[i] * osc_level[1] * trim;
            }
        } else {
            simd::mix2_into(
                &self.osc_a[..frames],
                &self.osc_b[..frames],
                &mut self.voice_buf[..frames],
                osc_level[0] * FILTER_TRIM,
                osc_level[1] * FILTER_TRIM,
            );
        }

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
            let gain = self.env_buf[i] * velocity;
            self.voice_buf[i] *= gain;
            if stereo {
                self.voice_buf_r[i] *= gain;
            }
        }

        // --- tremolo / volume modulation ------------------------------------
        let vol_depth = depth * matches!(params.lfo.target, LfoTarget::Volume) as u32 as f32;
        let vol_depth2 = depth2 * matches!(params.lfo2.target, LfoTarget::Volume) as u32 as f32;
        if vol_depth > 0.0 || vol_depth2 > 0.0 || mod_volume != 0.0 {
            for i in 0..frames {
                let l = if lfo_per_voice { lfo_scratch[i] } else { self.lfo_buf[i] };
                let l2 = if lfo2_per_voice {
                    lfo2_scratch[i]
                } else {
                    self.lfo2_buf[i]
                };
                let mut g = 1.0 - vol_depth * (0.5 - 0.5 * l) - vol_depth2 * (0.5 - 0.5 * l2);
                g += mod_volume * (0.5 + 0.5 * l);
                let g = g.clamp(0.0, 4.0);
                self.voice_buf[i] *= g;
                if stereo {
                    self.voice_buf_r[i] *= g;
                }
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
        // The matrix can push resonance up to twice the knob value (clamped).
        let resonance = (params.filter.res * (1.0 + mod_res) + mod_res * 0.25).clamp(0.0, 1.0);

        // Release tails are the expensive half of a long-release patch: a dense
        // song keeps a dozen voices ringing well below -50 dB, and filtering
        // them cannot be heard. Past this point the voice passes through dry —
        // its filter state is re-initialised when the slot is retriggered.
        let audible = env_last >= SILENT_VOICE;

        if !audible {
            // Nothing to do: the trimmed oscillator signal is already in
            // `voice_buf` (and `voice_buf_r`) and falls through to the makeup
            // gain below.
            self.silent_blocks = self.silent_blocks.saturating_add(1);
        } else if kind == crate::params::FilterType::Formant {
            // Vowel formants: cutoff morphs A→E→I→O→U, resonance sets the Q.
            // Each oscillator side keeps its own three band-passes.
            // Map the cutoff knob logarithmically onto the five vowels: 80 Hz
            // is "A", 4 kHz and above is "U", so the useful travel spans the
            // whole knob instead of cramming every vowel into the top octave.
            let vowel = ((cutoff / 80.0).log2() / (4000.0f32 / 80.0).log2()).clamp(0.0, 1.0);
            unsafe {
                gs_voice_formant_set(slot as i32, 0, vowel, resonance);
                gs_voice_formant_block(
                    slot as i32,
                    0,
                    self.voice_buf.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    frames as u32,
                );
                gs_voice_dc_block(
                    slot as i32,
                    0,
                    self.osc_a.as_ptr(),
                    self.voice_buf.as_mut_ptr(),
                    frames as u32,
                );
                if stereo {
                    gs_voice_formant_set(slot as i32, 1, vowel, resonance);
                    gs_voice_formant_block(
                        slot as i32,
                        1,
                        self.voice_buf_r.as_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                    gs_voice_dc_block(
                        slot as i32,
                        1,
                        self.osc_b.as_ptr(),
                        self.voice_buf_r.as_mut_ptr(),
                        frames as u32,
                    );
                }
            }
        } else if kind == crate::params::FilterType::Comb {
            // Rust comb resonator: the cutoff sets the comb pitch and the
            // resonance its feedback. It replaces the ladder/SVF chain here.
            // The comb keeps one delay line per voice, so this filter type runs
            // the mono path even when the oscillators are panned apart.
            let mut comb = core::mem::replace(&mut self.combs[slot], CombFilter::new());
            comb.set(sr, cutoff, resonance);
            comb.process(&self.voice_buf[..frames], &mut self.osc_a[..frames]);
            self.combs[slot] = comb;
            unsafe {
                gs_voice_dc_block(
                    slot as i32,
                    0,
                    self.osc_a.as_ptr(),
                    self.voice_buf.as_mut_ptr(),
                    frames as u32,
                );
            }
        } else if kind == crate::params::FilterType::Lp {
            // 24 dB/oct low-pass. This is our own ladder rather than the
            // vendored one: measured with a pure sine, the wasm build of that
            // C++ filter dropped a sample at every render-block boundary, which
            // is audible crackle on an otherwise simple patch. One instance per
            // oscillator side, so it still takes part in the stereo path.
            let mut side0 = self.ladders[slot][0];
            side0.set(sr, cutoff, resonance, params.filter.drive);
            for sample in self.voice_buf[..frames].iter_mut() {
                *sample = side0.process(*sample);
            }
            self.ladders[slot][0] = side0;
            unsafe {
                gs_voice_dc_block(
                    slot as i32,
                    0,
                    self.voice_buf.as_ptr(),
                    self.osc_a.as_mut_ptr(),
                    frames as u32,
                );
            }
            self.voice_buf[..frames].copy_from_slice(&self.osc_a[..frames]);
            if stereo {
                let mut side1 = self.ladders[slot][1];
                side1.set(sr, cutoff, resonance, params.filter.drive);
                for sample in self.voice_buf_r[..frames].iter_mut() {
                    *sample = side1.process(*sample);
                }
                self.ladders[slot][1] = side1;
                unsafe {
                    gs_voice_dc_block(
                        slot as i32,
                        1,
                        self.voice_buf_r.as_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                }
                self.voice_buf_r[..frames].copy_from_slice(&self.osc_b[..frames]);
            }
        } else {
        unsafe {
            gs_voice_filter_set(
                slot as i32,
                0,
                kind.to_u32() as i32,
                cutoff,
                resonance,
                params.filter.drive,
            );
            gs_voice_filter_block(
                slot as i32,
                0,
                kind.to_u32() as i32,
                self.voice_buf.as_ptr(),
                self.osc_a.as_mut_ptr(),
                frames as u32,
            );
            gs_voice_dc_block(
                slot as i32,
                0,
                self.osc_a.as_ptr(),
                self.voice_buf.as_mut_ptr(),
                frames as u32,
            );

            if stereo {
                gs_voice_filter_set(
                    slot as i32,
                    1,
                    kind.to_u32() as i32,
                    cutoff,
                    resonance,
                    params.filter.drive,
                );
                gs_voice_filter_block(
                    slot as i32,
                    1,
                    kind.to_u32() as i32,
                    self.voice_buf_r.as_ptr(),
                    self.osc_b.as_mut_ptr(),
                    frames as u32,
                );
                gs_voice_dc_block(
                    slot as i32,
                    1,
                    self.osc_b.as_ptr(),
                    self.voice_buf_r.as_mut_ptr(),
                    frames as u32,
                );
            }
        }
        }

        // Make up the trim that kept the filter inside its linear region.
        let makeup = 1.0 / FILTER_TRIM;
        for sample in self.voice_buf[..frames].iter_mut() {
            *sample *= makeup;
        }
        if stereo {
            for sample in self.voice_buf_r[..frames].iter_mut() {
                *sample *= makeup;
            }
        }

        // --- pan + accumulate into the stereo mix bus -----------------------
        if stereo {
            // Each oscillator has its own position (the matrix PAN offset is
            // applied to both), with an equal-power law per oscillator.
            let mut angles = [0.0f32; 2];
            for which in 0..2 {
                let pan = (params.osc[which].pan + mod_pan).clamp(-1.0, 1.0);
                angles[which] = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
            }
            let (l1, r1) = (angles[0].cos(), angles[0].sin());
            let (l2, r2) = (angles[1].cos(), angles[1].sin());
            for i in 0..frames {
                let a = self.voice_buf[i] * VOICE_GAIN;
                let b = self.voice_buf_r[i] * VOICE_GAIN;
                self.mix_l[i] += a * l1 + b * l2;
                self.mix_r[i] += a * r1 + b * r2;
            }
        } else {
            // Mono voice: the two PAN controls collapse into one level-weighted
            // position, applied after the shared filter.
            let pan = if levels > 1e-4 {
                ((osc_level[0] * params.osc[0].pan + osc_level[1] * params.osc[1].pan) / levels
                    + mod_pan)
                    .clamp(-1.0, 1.0)
            } else {
                mod_pan.clamp(-1.0, 1.0)
            };
            let angle = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
            let pan_l = angle.cos();
            let pan_r = angle.sin();
            simd::accumulate(
                &self.voice_buf[..frames],
                &mut self.mix_l[..frames],
                VOICE_GAIN * pan_l,
            );
            simd::accumulate(
                &self.voice_buf[..frames],
                &mut self.mix_r[..frames],
                VOICE_GAIN * pan_r,
            );
        }

        // --- retire finished voices -----------------------------------------
        if !voice.gate && !self.envs[slot].is_active() {
            self.vm.release_slot(slot);
            self.envs[slot].reset();
            self.filter_envs[slot].reset();
        }
    }

    fn apply_fx(&mut self, frames: usize) {
        let fx = self.params.fx;
        let dly_mix = if fx.delay_on { fx.delay_mix } else { 0.0 };
        let dly_time = self.params.delay_time_seconds();
        let dly_fb = fx.delay_fb;

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

        // Rust reverb: damped, modulated and with a pre-delay, which the old
        // Soundpipe `revsc` could not do. It replaces revsc entirely.
        self.reverb.set_params(ReverbParams {
            size: if fx.reverb_on { fx.reverb_size } else { 0.0 },
            damp: fx.reverb_damp,
            mix: if fx.reverb_on { fx.reverb_mix } else { 0.0 },
            width: fx.reverb_width,
            predelay: fx.reverb_predelay,
        });
        self.reverb
            .process(&mut self.fx_l[..frames], &mut self.fx_r[..frames]);

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
    scratch: &mut [f32],
) {
    match params.wave.daisy_id() {
        Some(daisy_wave) => unsafe {
            let unison = (params.unison.max(1) as usize).min(MAX_UNISON as usize);
            if unison == 1 {
                gs_voice_osc_set(slot as i32, which as i32, 0, daisy_wave, freq, 1.0, pw);
                gs_voice_osc_block(slot as i32, which as i32, 0, out.as_mut_ptr(), frames as u32);
                return;
            }
            // Unison: stack detuned copies. The detune spread is symmetric
            // around the nominal pitch and the stack is level-compensated by
            // 1/sqrt(n) so adding voices does not just make the patch louder.
            out.fill(0.0);
            let n = unison as f32;
            let gain = 1.0 / n.sqrt();
            let max_cents = params.spread.clamp(0.0, 1.0) * 35.0;
            for sub in 0..unison {
                let t = if unison == 1 {
                    0.0
                } else {
                    (sub as f32 / (n - 1.0)) * 2.0 - 1.0
                };
                let detune = semitone_ratio(t * max_cents / 100.0);
                let sub_freq = (freq * detune).clamp(0.25, 24_000.0);
                gs_voice_osc_set(
                    slot as i32,
                    which as i32,
                    sub as i32,
                    daisy_wave,
                    sub_freq,
                    1.0,
                    pw,
                );
                gs_voice_osc_block(
                    slot as i32,
                    which as i32,
                    sub as i32,
                    scratch.as_mut_ptr(),
                    frames as u32,
                );
                for i in 0..frames {
                    out[i] += scratch[i] * gain;
                }
            }
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

    const KNEE_FOR_DIAG: f32 = 0.82;

    /// Take the engine lock, recovering from a poisoned mutex so one failing
    /// test cannot cascade into every other engine test.
    fn lock_engine() -> std::sync::MutexGuard<'static, ()> {
        ENGINE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn new_engine(poly: usize) -> Box<Engine> {
        let mut e = Box::new(Engine::new());
        e.init(48000.0, poly);
        e
    }

    #[test]
    fn silence_in_silence_out() {
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.process(128);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Square as u32 as f32);
        e.process(128);
        assert_eq!(e.params.osc[0].wave, crate::params::Wave::Square);
    }

    /// Single-bin magnitude with a Hann window (measurement helper).
    fn bin_mag(samples: &[f32], freq: f32, sr: f32) -> f32 {
        let n = samples.len();
        let w = core::f32::consts::TAU as f64 * freq as f64 / sr as f64;
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, x) in samples.iter().enumerate() {
            let win = 0.5 - 0.5 * (core::f32::consts::TAU as f64 * i as f64 / n as f64).cos();
            let v = *x as f64 * win;
            re += v * (w * i as f64).cos();
            im -= v * (w * i as f64).sin();
        }
        ((re * re + im * im).sqrt() / n as f64) as f32 * 2.0
    }

    #[test]
    fn measure_aliasing_and_thd() {
        let _guard = lock_engine();
        let sr = 48000.0f32;

        // --- oscillator aliasing: C7 saw, filter wide open -------------------
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.note_on(96, 1.0);
        for _ in 0..120 {
            e.process(128);
        }
        let mut buf = vec![0.0f32; 8192];
        for chunk in buf.chunks_mut(128) {
            e.process(128);
            chunk.copy_from_slice(&e.out_l[..chunk.len()]);
        }
        let f0 = 440.0 * 2f32.powf((96.0 - 69.0) / 12.0);
        // Aliased partials land between the harmonics; compare that energy with
        // the total signal energy (a ratio against the harmonics alone is
        // misleading because a saw spreads its energy over many of them).
        let mut alias = 0.0f32;
        let mut k = 1;
        while f0 * (k as f32 + 0.5) < sr * 0.5 - 1000.0 {
            alias += bin_mag(&buf, f0 * k as f32 + f0 * 0.5, sr).powi(2);
            k += 1;
        }
        let signal = buf.iter().map(|v| v * v).sum::<f32>() / buf.len() as f32;
        println!(
            "MEAS aliasing saw_C7 rel={:.1}dB (native reference)",
            10.0 * (alias / signal.max(1e-15)).log10()
        );
        assert!(
            10.0 * (alias / signal.max(1e-15)).log10() < -60.0,
            "polyBLEP saw lost its band limiting"
        );

        // --- filter drive THD: sine through the ladder -----------------------
        for drive in [0.0f32, 0.5, 1.0] {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, 0.0);
            e.set_param(id::FILTER_CUTOFF, 12000.0);
            e.set_param(id::FILTER_RES, 0.2);
            e.set_param(id::FILTER_DRIVE, drive);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::FX_REVERB_ON, 0.0);
            e.note_on(69, 1.0);
            for _ in 0..120 {
                e.process(128);
            }
            let mut buf = vec![0.0f32; 8192];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            // Sanity check the analyser itself on a synthetic tone.
            let reference: Vec<f32> = (0..8192)
                .map(|i| 0.13 * (core::f32::consts::TAU * 440.0 * i as f32 / sr).sin())
                .collect();
            let ref_fund = bin_mag(&reference, 440.0, sr);
            let mut ref_h = 0.0f32;
            for k in 2..=12 {
                ref_h += bin_mag(&reference, 440.0 * k as f32, sr).powi(2);
            }
            println!("MEAS wave_param={:?} kind={:?}", e.params.osc[0].wave, e.params.filter.kind);
            let fund = bin_mag(&buf, 440.0, sr);
            let mut h = 0.0f32;
            let mut parts = String::new();
            for k in 2..=12 {
                let m = bin_mag(&buf, 440.0 * k as f32, sr);
                h += m * m;
                if k <= 6 {
                    parts.push_str(&format!(" h{k}={:.4}", m / fund.max(1e-9)));
                }
            }
            let thd = (h.sqrt() / fund.max(1e-9)) * 100.0;
            println!(
                "MEAS thd sine drive={drive:.1} fund={fund:.4} thd={thd:.2}% | reference fund={ref_fund:.4} thd={:.2}% |{parts}",
                (ref_h.sqrt() / ref_fund.max(1e-9)) * 100.0
            );
        }
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

    #[test]
    fn diagnose_limiter_overshoot() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        for param in [id::OSC1_LEVEL, id::OSC2_LEVEL] {
            e.set_param(param, 1.0);
        }
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 16000.0);
        e.set_param(id::FX_REVERB_ON, 1.0);
        e.set_param(id::FX_DELAY_ON, 1.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for note in [36, 40, 43, 47, 52, 55, 56, 59, 60, 63, 64, 66, 68, 71, 75, 78] {
            e.note_on(note, 1.0);
        }
        let mut worst = 0.0f32;
        let mut worst_at = 0usize;
        let mut worst_gain = 1.0f32;
        let mut worst_bus = 0.0f32;
        let mut over = 0usize;
        let mut total = 0usize;
        for block in 0..160 {
            e.process(128);
            for i in 0..128 {
                let o = e.out_l[i].abs().max(e.out_r[i].abs());
                if o > KNEE_FOR_DIAG {
                    over += 1;
                }
                total += 1;
                if o > worst {
                    worst = o;
                    worst_at = block * 128 + i;
                    worst_gain = e.limit_gain;
                    worst_bus = e.fx_l[i].abs().max(e.fx_r[i].abs());
                }
            }
        }
        println!(
            "LIM worst_out={worst:.3} at_sample={worst_at} gain={worst_gain:.3} bus={worst_bus:.3} over_knee={:.2}%",
            100.0 * over as f32 / total as f32
        );
    }

    /// The host pushes every parameter on every block, so a parameter flood
    /// must not undo the polyphony the load monitor asked for (it did, which
    /// left slow devices at sixteen voices and dropping out).
    #[test]
    fn parameter_flood_keeps_the_host_polyphony() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        let flood = |e: &mut Engine| {
            for param in 0..crate::params::PARAM_COUNT as u32 {
                e.set_param(param, 0.0);
            }
            // …with the values the worklet actually sends for the switches.
            e.set_param(id::OSC1_ON, 1.0);
            e.set_param(id::OSC2_ON, 0.0);
        };
        e.set_max_polyphony(4);
        assert_eq!(e.max_polyphony(), 4);
        flood(&mut e);
        assert_eq!(e.max_polyphony(), 4, "a parameter push restored the old cap");

        // Unison still divides whatever the host asked for.
        e.set_param(id::OSC1_UNISON, 2.0);
        assert_eq!(e.max_polyphony(), 2);
        e.set_param(id::OSC1_UNISON, 1.0);
        assert_eq!(e.max_polyphony(), 4);

        // The emergency downgrade sticks as well.
        e.set_max_polyphony(16);
        e.trigger_smooth_downgrade();
        assert_eq!(e.max_polyphony(), 14);
        flood(&mut e);
        assert_eq!(e.max_polyphony(), 14, "the emergency downgrade was undone");
    }

    /// The lookahead limiter must catch a transient *before* it reaches the
    /// output: no sample may exceed the ceiling, and the gain must come back
    /// afterwards.
    #[test]
    fn limiter_catches_transients_without_clipping() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        for param in [id::OSC1_LEVEL, id::OSC2_LEVEL] {
            e.set_param(param, 1.0);
        }
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::ENV_ATTACK, 0.0005);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        let notes = [36, 40, 43, 47, 52, 55, 56, 59, 60, 63, 64, 66, 68, 71, 75, 78];
        for note in notes {
            e.note_on(note, 1.0);
        }
        let mut peak = 0.0f32;
        let mut min_gain = 1.0f32;
        let mut bus_peak = 0.0f32;
        for _ in 0..240 {
            e.process(128);
            for i in 0..128 {
                peak = peak.max(e.out_l[i].abs()).max(e.out_r[i].abs());
                bus_peak = bus_peak.max(e.fx_l[i].abs()).max(e.fx_r[i].abs());
            }
            min_gain = min_gain.min(e.limit_gain);
        }
        assert!(peak <= 1.0, "output clipped at {peak}");
        assert!(peak > 0.5, "nothing came through: {peak}");
        if bus_peak > LIMIT_CEILING {
            assert!(min_gain < 0.999, "bus peaked at {bus_peak} but the limiter stayed open");
        }
        assert!(min_gain > 0.4, "limiter worked far too hard: {min_gain}");

        // Release: with the notes released the gain must return to unity.
        for note in notes {
            e.note_off(note);
        }
        for _ in 0..400 {
            e.process(128);
        }
        assert!(e.limit_gain > 0.99, "limiter did not release: {}", e.limit_gain);
    }

    /// The new modulation sources must actually reach the DSP: aftertouch and
    /// key tracking move the cutoff, and the per-note random is stable.
    #[test]
    fn aftertouch_keytrack_and_random_modulate() {
        let _guard = lock_engine();
        let base = |e: &mut Engine| {
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_CUTOFF, 800.0);
            e.set_param(id::FILTER_RES, 0.1);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::LFO2_ON, 0.0);
        };
        // Mean sample-to-sample step of the left channel: a cheap, monotonic
        // proxy for brightness (more high end = bigger steps).
        let brightness = |e: &mut Engine| {
            for _ in 0..40 {
                e.process(128);
            }
            let mut sum = 0.0f32;
            let mut prev = e.out_l[0];
            for sample in e.out_l[..128].iter() {
                sum += (sample - prev).abs();
                prev = *sample;
            }
            sum
        };

        // AFTERTOUCH -> cutoff.
        let mut e = new_engine(16);
        base(&mut e);
        e.set_route(0, ModSrc::Aftertouch as u32, ModDst::Cutoff as u32, 1.0, true);
        // The shared base patch opens the filter to 18 kHz, which leaves no room
        // to brighten; aftertouch->cutoff has to be measured where the filter is
        // actually working.
        e.set_param(id::FILTER_CUTOFF, 700.0);
        e.set_param(id::FILTER_RES, 0.2);
        e.note_on(60, 0.8);
        let quiet = brightness(&mut e);
        e.aftertouch(1.0);
        let pressed = brightness(&mut e);
        assert!(pressed > quiet * 1.05, "aftertouch did nothing: {quiet} -> {pressed}");

        // KEYTRACK -> cutoff: a high note must be brighter than a low one.
        let mut e = new_engine(16);
        base(&mut e);
        e.set_route(0, ModSrc::KeyTrack as u32, ModDst::Cutoff as u32, 1.0, true);
        e.note_on(36, 0.8);
        let low = brightness(&mut e);
        e.all_notes_off();
        for _ in 0..80 {
            e.process(128);
        }
        e.note_on(84, 0.8);
        let high = brightness(&mut e);
        assert!(high > low * 1.2, "key tracking did nothing: {low} -> {high}");

        // RANDOM -> pan: a steady value per note, different between notes.
        let mut e = new_engine(16);
        base(&mut e);
        e.set_route(0, ModSrc::Random as u32, ModDst::Pan as u32, 1.0, true);
        e.note_on(60, 0.8);
        let mut first = 0.0f32;
        for _ in 0..40 {
            e.process(128);
            first += e.out_l[64].abs() - e.out_r[64].abs();
        }
        let mut second = 0.0f32;
        e.note_on(67, 0.8);
        for _ in 0..40 {
            e.process(128);
            second += e.out_l[64].abs() - e.out_r[64].abs();
        }
        assert!((first - second).abs() > 1e-3, "random pan never varied");
    }

    /// Unison stacks detuned copies: the sum must beat (a wider, moving sound)
    /// while staying level-compensated, and the voice cap must shrink with it.
    #[test]
    fn unison_thickens_without_getting_louder() {
        let _guard = lock_engine();
        let render = |unison: u32, spread: f32| -> (f32, f32) {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_CUTOFF, 12000.0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::OSC1_UNISON, unison as f32);
            e.set_param(id::OSC1_SPREAD, spread);
            e.note_on(57, 1.0);
            for _ in 0..40 {
                e.process(128);
            }
            // One second of audio, measured in 100 ms windows: short windows
            // track the waveform itself, long ones track the detune beating.
            let mut buf = vec![0.0f32; 48_000];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            let windows: Vec<f32> = buf
                .chunks(4_800)
                .map(|w| (w.iter().map(|v| v * v).sum::<f32>() / w.len() as f32).sqrt())
                .collect();
            let mean = windows.iter().sum::<f32>() / windows.len() as f32;
            let var = windows.iter().map(|r| (r - mean).powi(2)).sum::<f32>()
                / windows.len() as f32;
            (mean, var.sqrt() / mean.max(1e-9))
        };
        let (single, single_var) = render(1, 0.0);
        let (stack, stack_var) = render(5, 1.0);
        // Level compensated: within ~3 dB of the single voice.
        let ratio = stack / single;
        assert!(
            (0.7..=1.4).contains(&ratio),
            "unison changed the level: {single} -> {stack}"
        );
        // Detuned copies beat against each other, so the long-window level moves.
        assert!(
            stack_var > single_var * 2.0,
            "unison did not thicken: {single_var} -> {stack_var}"
        );

        // Polyphony is capped so a seven-voice stack cannot melt the CPU.
        let mut e = new_engine(16);
        e.set_param(id::OSC1_UNISON, 7.0);
        assert!(e.max_polyphony() <= 2, "voice cap not scaled: {}", e.max_polyphony());
        e.set_param(id::OSC1_UNISON, 1.0);
        assert!(e.max_polyphony() >= 16, "voice cap did not recover");
    }

    /// A retriggered LFO must restart with every note (so vibrato lines up with
    /// the attack), while a free-running LFO keeps going.
    #[test]
    fn lfo_retrigger_resets_the_phase_per_note() {
        let _guard = lock_engine();
        let measure = |retrigger: bool, gap_blocks: usize| -> f32 {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_CUTOFF, 2000.0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 1.0);
            e.set_param(id::LFO_WAVE, crate::params::LfoWave::Square as u32 as f32);
            e.set_param(id::LFO_RATE, 2.0);
            e.set_param(id::LFO_DEPTH, 1.0);
            e.set_param(id::LFO_TARGET, crate::params::LfoTarget::Cutoff as u32 as f32);
            e.set_param(id::LFO_RETRIG, if retrigger { 1.0 } else { 0.0 });
            e.set_route(0, ModSrc::Lfo as u32, ModDst::Cutoff as u32, 0.0, false);
            // Let a free-running LFO drift to a different part of its cycle.
            for _ in 0..gap_blocks {
                e.process(128);
            }
            e.note_on(60, 1.0);
            for _ in 0..10 {
                e.process(128);
            }
            // Brightness of the first block after the attack: with retrigger the
            // LFO always starts its cycle at the same point, without it depends
            // on where the free-running phase happened to be.
            let mut sum = 0.0f32;
            let mut prev = e.out_l[0];
            for sample in e.out_l[..128].iter() {
                sum += (sample - prev).abs();
                prev = *sample;
            }
            sum
        };
        let early = measure(true, 3);
        let late = measure(true, 900);
        let ratio = (early / late).max(late / early);
        assert!(ratio < 1.05, "retriggered LFO drifted with time: {early} vs {late}");
    }

    /// Panning the two oscillators apart must give two *different* signals in
    /// the two channels, not one mono voice at two gains.
    #[test]
    fn per_oscillator_panning_separates_the_channels() {
        let _guard = lock_engine();
        // Correlation between the channels over a rendered buffer.
        let correlate = |pan1: f32, pan2: f32, kind: crate::params::Wave| -> f32 {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.7);
            e.set_param(id::OSC1_PAN, pan1);
            e.set_param(id::OSC2_ON, 1.0);
            e.set_param(id::OSC2_WAVE, kind as u32 as f32);
            e.set_param(id::OSC2_PITCH, 12.0);
            e.set_param(id::OSC2_LEVEL, 0.7);
            e.set_param(id::OSC2_PAN, pan2);
            e.set_param(id::FILTER_CUTOFF, 16000.0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.note_on(57, 1.0);
            for _ in 0..40 {
                e.process(128);
            }
            let mut buf_l = vec![0.0f32; 8192];
            let mut buf_r = vec![0.0f32; 8192];
            for chunk in 0..64 {
                e.process(128);
                for i in 0..128 {
                    buf_l[chunk * 128 + i] = e.out_l[i];
                    buf_r[chunk * 128 + i] = e.out_r[i];
                }
            }
            let mut num = 0.0f64;
            let mut dl = 0.0f64;
            let mut dr = 0.0f64;
            for i in 0..buf_l.len() {
                num += (buf_l[i] as f64) * (buf_r[i] as f64);
                dl += (buf_l[i] as f64).powi(2);
                dr += (buf_r[i] as f64).powi(2);
            }
            (num / (dl.sqrt() * dr.sqrt()).max(1e-12)) as f32
        };

        // Centred: both channels carry the same waveform, so they correlate.
        let mono = correlate(0.0, 0.0, crate::params::Wave::Sine);
        assert!(mono > 0.99, "centred patch should be mono, corr {mono}");

        // OSC 1 sine hard left, OSC 2 saw an octave up hard right: the channels
        // now carry different sounds and must decorrelate.
        let wide = correlate(-1.0, 1.0, crate::params::Wave::Saw);
        assert!(wide < 0.8, "per-oscillator panning did not separate: corr {wide}");
    }

    /// The COMB filter type must turn noise into a pitched signal: the comb
    /// period shows up as a strong autocorrelation peak that a plain low-pass
    /// does not produce.
    #[test]
    fn comb_filter_type_resonates() {
        let _guard = lock_engine();
        let autocorrelation = |kind: crate::params::FilterType, res: f32| -> f32 {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Noise as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, kind as u32 as f32);
            e.set_param(id::FILTER_CUTOFF, 200.0);
            e.set_param(id::FILTER_RES, res);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            // The default patch sweeps the cutoff with the LFO and the matrix;
            // a comb has to be measured with its pitch standing still.
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::LFO2_ON, 0.0);
            for index in 0..crate::params::MOD_ROUTES {
                e.set_route(index, 0, 0, 0.0, false);
            }
            e.note_on(60, 1.0);
            for _ in 0..80 {
                e.process(128);
            }
            let mut buf = vec![0.0f32; 24_000];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            assert!(buf.iter().all(|v| v.is_finite()), "comb blew up");
            // 200 Hz at 48 kHz = a 240-sample period, so the comb lines up with
            // a 240-sample lag while white noise does not.
            let lag = 240;
            let mut num = 0.0f64;
            let mut den = 0.0f64;
            for i in 0..buf.len() - lag {
                num += (buf[i] as f64) * (buf[i + lag] as f64);
            }
            for v in buf.iter() {
                den += (*v as f64) * (*v as f64);
            }
            (num / den.max(1e-12)) as f32
        };

        let comb = autocorrelation(crate::params::FilterType::Comb, 0.9);
        // Reference: the same noise through a non-resonant low-pass. (A
        // resonant ladder is a poor reference — it self-oscillates and is
        // periodic all by itself.)
        let plain = autocorrelation(crate::params::FilterType::Lp, 0.0);

        assert!(comb > 0.3, "comb did not ring: autocorrelation {comb}");
        assert!(
            comb > plain * 3.0,
            "comb was no more periodic than a low-pass: {comb} vs {plain}"
        );
    }

    /// Where does a block's time actually go? Prints a breakdown so the audio
    /// budget can be spent where it matters (run with `--release --nocapture`).
    #[test]
    fn diagnose_cost_breakdown() {
        let _guard = lock_engine();
        let build = |reverb: f32, chorus: f32, drive: f32| -> Box<Engine> {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.7);
            e.set_param(id::OSC2_ON, 1.0);
            e.set_param(id::OSC2_WAVE, crate::params::Wave::Triangle as u32 as f32);
            e.set_param(id::OSC2_PITCH, 12.0);
            e.set_param(id::OSC2_LEVEL, 0.3);
            e.set_param(id::FILTER_CUTOFF, 4200.0);
            e.set_param(id::FILTER_RES, 0.1);
            e.set_param(id::FILTER_DRIVE, 0.2);
            e.set_param(id::ENV_DECAY, 1.1);
            e.set_param(id::ENV_SUSTAIN, 0.3);
            e.set_param(id::ENV_RELEASE, 1.3);
            e.set_param(id::FX_REVERB_ON, reverb);
            e.set_param(id::FX_REVERB_MIX, 0.3 * reverb);
            e.set_param(id::FX_CHORUS_ON, chorus);
            e.set_param(id::FX_CHORUS_MIX, 0.3 * chorus);
            e.set_param(id::FX_DRIVE_ON, drive);
            e.set_param(id::FX_DRIVE_MIX, 0.45 * drive);
            e
        };
        // Interleaved, best-of-three: a single pass picks up whatever else the
        // machine is doing and invents costs that are not there.
        let configs: [(&str, f32, f32, f32); 5] = [
            ("voices only", 0.0, 0.0, 0.0),
            ("+reverb", 1.0, 0.0, 0.0),
            ("+chorus", 0.0, 1.0, 0.0),
            ("+drive", 0.0, 0.0, 1.0),
            ("everything", 1.0, 1.0, 1.0),
        ];
        let notes = [52u8, 55, 59, 64, 67, 71, 76, 79, 83, 88, 91, 95];
        let mut engines: Vec<(String, Box<Engine>)> = configs
            .iter()
            .map(|(label, rev, cho, drv)| {
                let mut e = build(*rev, *cho, *drv);
                for note in notes {
                    e.note_on(note, 0.9);
                }
                for _ in 0..80 {
                    e.process(128);
                }
                ((*label).to_string(), e)
            })
            .collect();
        let mut best = vec![f64::MAX; engines.len()];
        for _round in 0..4 {
            for (i, (_, engine)) in engines.iter_mut().enumerate() {
                let blocks = 200;
                let start = std::time::Instant::now();
                for _ in 0..blocks {
                    engine.process(128);
                }
                let us = start.elapsed().as_secs_f64() * 1e6 / blocks as f64;
                best[i] = best[i].min(us);
            }
        }
        for (i, (label, _)) in engines.iter().enumerate() {
            println!(
                "COST {label}: {:.0}us ({:.0}% of 2667us)",
                best[i],
                best[i] / 2667.0 * 100.0
            );
        }
    }

    #[allow(dead_code)]
    fn unused_run_placeholder() {
    }

    /// The FORMANTS filter type must place its three peaks on the vowel it is
    /// tuned to: noise through it should show energy at F1/F2 for "A", and the
    /// peaks must move when the cutoff morphs to "U".
    #[test]
    fn formant_filter_morphs_vowels() {
        let _guard = lock_engine();
        let mag_at = |buf: &[f32], freq: f32| -> f32 {
            let w = core::f32::consts::TAU * freq / 48_000.0;
            let mut re = 0.0f64;
            let mut im = 0.0f64;
            for (i, v) in buf.iter().enumerate() {
                re += (*v as f64) * (w * i as f32).cos() as f64;
                im -= (*v as f64) * (w * i as f32).sin() as f64;
            }
            ((re * re + im * im).sqrt() / buf.len() as f64) as f32
        };
        let render = |cutoff: f32| -> Vec<f32> {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Noise as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.9);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, crate::params::FilterType::Formant as u32 as f32);
            e.set_param(id::FILTER_CUTOFF, cutoff);
            e.set_param(id::FILTER_RES, 0.4);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::FILTER_KBD, 0.0);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::LFO2_ON, 0.0);
            for index in 0..crate::params::MOD_ROUTES {
                e.set_route(index, 0, 0, 0.0, false);
            }
            e.note_on(60, 1.0);
            for _ in 0..80 {
                e.process(128);
            }
            let mut buf = vec![0.0f32; 8192];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            buf
        };

        // "A": 80 Hz on the knob is the first vowel, with F1 near 800 Hz and
        // F2 near 1150 Hz.
        let a = render(80.0);
        assert!(a.iter().all(|v| v.is_finite()), "formant blew up");
        let a_f1 = mag_at(&a, 800.0);
        let a_off = mag_at(&a, 400.0).max(mag_at(&a, 2000.0));
        assert!(a_f1 > a_off * 1.5, "no formant peak at F1: {a_f1} vs {a_off}");
        assert!(mag_at(&a, 1150.0) > mag_at(&a, 2000.0) * 1.2, "F2 missing for A");

        // "U" (4 kHz on the knob): the peaks move down to ~325/700 Hz.
        let u = render(4000.0);
        let u_low = mag_at(&u, 325.0).max(mag_at(&u, 700.0));
        let u_high = mag_at(&u, 2700.0);
        assert!(u_low > u_high * 1.3, "U did not move the peaks: {u_low} vs {u_high}");
        assert!(
            mag_at(&u, 325.0) > mag_at(&a, 325.0) * 1.3,
            "U should have more energy near 325 Hz than A"
        );
    }

    /// A single pure sine note must not glitch at render-block boundaries.
    ///
    /// This is the regression for the click that made plain patches crackle:
    /// the vendored ladder filter dropped a sample at every 128-sample block
    /// boundary in the wasm build, which shows up here as a sample step far
    /// larger than a sine of that amplitude and frequency can produce. The
    /// native build was clean, which is why it took a wasm measurement to find.
    #[test]
    fn single_sine_note_has_no_block_boundary_glitch() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_TYPE, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_RES, 0.05);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::LFO_ON, 0.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(69, 1.0);
        let n = 96_000;
        let mut out = vec![0.0f32; n];
        for chunk in out.chunks_mut(128) {
            e.process(128);
            chunk.copy_from_slice(&e.out_l[..chunk.len()]);
        }
        let (mut peak, mut worst) = (0.0f32, (0.0f32, 0usize));
        for i in 24_000..n {
            peak = peak.max(out[i].abs());
            let d = (out[i] - out[i - 1]).abs();
            if d > worst.0 {
                worst = (d, i);
            }
        }
        let ideal = (core::f32::consts::TAU * 440.0 / 48_000.0) * peak;
        println!(
            "SINE native peak {peak:.4} maxStep {:.5} (ideal {ideal:.5}, x{:.1}) @{}",
            worst.0,
            worst.0 / ideal,
            worst.1
        );
        assert!(
            worst.0 < ideal * 2.0,
            "single sine note glitches: step {:.5} vs ideal {ideal:.5} at sample {}",
            worst.0,
            worst.1
        );
    }

    /// Microtuning: a key offset by +100 cents must sound a semitone higher.
    #[test]
    fn microtuning_offsets_a_single_key() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        let base = e.pitch_hz(69.0);
        assert!((base - 440.0).abs() < 0.01, "A4 should be 440 Hz, got {base}");
        e.set_tuning_note(69, 100.0);
        let raised = e.pitch_hz(69.0);
        assert!(
            (raised / base - 2.0f32.powf(1.0 / 12.0)).abs() < 1e-4,
            "100 cents should be a semitone: {base} -> {raised}"
        );
        // Other keys are untouched, and master tune still applies on top.
        assert!((e.pitch_hz(60.0) - 261.6256).abs() < 0.01);
        e.set_param(id::MASTER_TUNE, 12.0);
        assert!((e.pitch_hz(60.0) - 523.2511).abs() < 0.05);
        // Out-of-range keys are ignored rather than panicking.
        e.set_tuning_note(200, 50.0);
        assert_eq!(e.tuning_cents_at(200), 0.0);
    }

    /// MPE: bending one note must move that note and only that note. Measured
    /// from the audio, because the bend is applied where the oscillator is
    /// tuned rather than stored on the voice.
    #[test]
    fn per_note_bend_moves_only_that_note() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }

        /// Frequency from upward zero crossings — good to a fraction of a Hz
        /// over a second of a clean sine, which is all this test needs.
        fn measured_hz(e: &mut Engine) -> f32 {
            let frames = 24_000;
            let mut buffer = vec![0.0f32; frames];
            for chunk in buffer.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            let mut crossings = 0;
            let mut first = None;
            let mut last = 0;
            for i in 1..frames {
                if buffer[i - 1] < 0.0 && buffer[i] >= 0.0 {
                    crossings += 1;
                    if first.is_none() {
                        first = Some(i);
                    }
                    last = i;
                }
            }
            let span = (last - first.unwrap_or(0)) as f32;
            if crossings < 2 || span <= 0.0 {
                return 0.0;
            }
            (crossings - 1) as f32 * 48_000.0 / span
        }

        // One note, bent: the pitch must rise by exactly two semitones.
        e.note_on(67, 1.0);
        let plain = measured_hz(&mut e);
        e.note_bend(67, 2.0);
        let bent = measured_hz(&mut e);
        assert!(
            (bent / plain - 2.0f32.powf(2.0 / 12.0)).abs() < 0.01,
            "bend was not two semitones: {plain:.1} Hz -> {bent:.1} Hz"
        );
        e.note_bend(67, 0.0);
        let restored = measured_hz(&mut e);
        assert!(
            (restored / plain - 1.0).abs() < 0.01,
            "clearing the bend did not restore the note: {plain:.1} -> {restored:.1}"
        );

        // A second note must be untouched by the first note's bend.
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(60, 1.0);
        let low = measured_hz(&mut e);
        e.note_bend(67, 7.0); // bend a note that is not sounding
        let low_after = measured_hz(&mut e);
        assert!(
            (low_after / low - 1.0).abs() < 0.005,
            "bending another note moved this one: {low:.1} -> {low_after:.1}"
        );
    }

    /// A quiet signal must pass through the limiter untouched (gain exactly 1)
    /// and the limiter must report the true-peak meter.
    #[test]
    fn limiter_is_transparent_when_not_needed() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_LEVEL, 0.5);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::MASTER_VOLUME, 0.5);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.note_on(60, 0.7);
        for _ in 0..60 {
            e.process(128);
        }
        assert_eq!(e.limit_gain, 1.0, "limiter touched a quiet signal");
        let mut peak = 0.0f32;
        // Read the meter the way the UI does — once per render block — and keep
        // the largest reading: the meter accumulates between takes, so this is
        // exactly what it must not under-report.
        let mut reported = 0.0f32;
        for _ in 0..40 {
            e.process(128);
            for i in 0..128 {
                peak = peak.max(e.out_l[i].abs());
            }
            reported = reported.max(e.take_true_peak());
        }
        assert!(peak > 0.01 && peak < 0.5);
        assert!(reported >= peak * 0.95, "meter {reported} below sample peak {peak}");
        assert!(reported < peak * 2.0, "meter {reported} far above sample peak {peak}");
        assert_eq!(e.take_true_peak(), 0.0);
    }

    /// A loud polyphonic chord must reach the output without being coloured:
    /// the master bus stays inside the limiter's linear region, so nothing is
    /// soft-clipped on the way out (this used to distort ~25% of samples).
    #[test]
    fn dense_chords_stay_clean() {
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
        let _guard = lock_engine();
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
