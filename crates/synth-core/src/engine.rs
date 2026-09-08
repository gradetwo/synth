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
use crate::dsp::util::{exp2, note_to_hz, semitone_ratio, soft_clip, Rng};
use crate::fft::Spectrum;
use crate::params::{
    id, FilterType, LfoTarget, ModDst, ModSrc, OscParams, Params, Wave, MAX_BLOCK_SIZE, MAX_VOICES,
    SPECTRUM_BINS,
};
use crate::voice::{NoteOnResult, VoiceManager};

// ---------------------------------------------------------------- C ABI glue

extern "C" {
    fn gs_daisy_init(sample_rate: f32);
    fn gs_voice_reset(v: i32);
    fn gs_voice_osc_set(v: i32, which: i32, wave: u32, freq: f32, amp: f32, pw: f32);
    fn gs_voice_osc_block(v: i32, which: i32, out: *mut f32, frames: u32);
    fn gs_voice_filter_set(v: i32, kind: i32, freq: f32, res: f32, drive: f32);
    fn gs_voice_filter_block(v: i32, kind: i32, input: *const f32, out: *mut f32, frames: u32);
    fn gs_voice_dc_block(v: i32, input: *const f32, out: *mut f32, frames: u32);
    fn gs_sp_init(sample_rate: f32);
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
const STEAL_RELEASE: f32 = 0.004;
/// Per-voice gain before the mix bus.
const VOICE_GAIN: f32 = 0.22;

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
    pub spectrum: Spectrum,

    /// One envelope per voice (see `dsp::adsr`).
    envs: [Adsr; MAX_VOICES],

    // Scratch buffers — all statically sized, all reused per voice.
    osc_a: [f32; MAX_BLOCK_SIZE],
    osc_b: [f32; MAX_BLOCK_SIZE],
    env_buf: [f32; MAX_BLOCK_SIZE],
    voice_buf: [f32; MAX_BLOCK_SIZE],
    lfo_buf: [f32; MAX_BLOCK_SIZE],
    mix_l: [f32; MAX_BLOCK_SIZE],
    mix_r: [f32; MAX_BLOCK_SIZE],
    fx_l: [f32; MAX_BLOCK_SIZE],
    fx_r: [f32; MAX_BLOCK_SIZE],

    // Public output buffers (pointer-exported to the worklet).
    out_l: [f32; MAX_BLOCK_SIZE],
    out_r: [f32; MAX_BLOCK_SIZE],

    rng: Rng,
    pitch_bend: f32,
    mod_wheel: f32,
    master_gain: f32,
    peak_l: f32,
    peak_r: f32,
    active_voices: u32,
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
            spectrum: Spectrum::new(),
            envs: [Adsr::new(); MAX_VOICES],
            osc_a: [0.0; MAX_BLOCK_SIZE],
            osc_b: [0.0; MAX_BLOCK_SIZE],
            env_buf: [0.0; MAX_BLOCK_SIZE],
            voice_buf: [0.0; MAX_BLOCK_SIZE],
            lfo_buf: [0.0; MAX_BLOCK_SIZE],
            mix_l: [0.0; MAX_BLOCK_SIZE],
            mix_r: [0.0; MAX_BLOCK_SIZE],
            fx_l: [0.0; MAX_BLOCK_SIZE],
            fx_r: [0.0; MAX_BLOCK_SIZE],
            out_l: [0.0; MAX_BLOCK_SIZE],
            out_r: [0.0; MAX_BLOCK_SIZE],
            rng: Rng::new(0x51f3_9b1d),
            pitch_bend: 0.0,
            mod_wheel: 0.0,
            master_gain: 0.75,
            peak_l: 0.0,
            peak_r: 0.0,
            active_voices: 0,
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
        }
        self.spectrum.init();
        self.spectrum.reset();
        self.lfo.reset();
        for env in self.envs.iter_mut() {
            env.set_sample_rate(self.sample_rate);
            env.reset();
        }
        self.vm.reset();
        self.vm.set_max_polyphony(max_polyphony);
        self.pitch_bend = 0.0;
        self.mod_wheel = 0.0;
        self.master_gain = self.params.master_volume;
        self.peak_l = 0.0;
        self.peak_r = 0.0;
        self.env_dirty = true;
        self.fx = FxSnapshot::new();
        self.initialised = true;
    }

    pub fn set_param(&mut self, param_id: u32, value: f32) {
        self.params.set(param_id, value);
        if matches!(
            param_id,
            id::ENV_ATTACK | id::ENV_DECAY | id::ENV_SUSTAIN | id::ENV_RELEASE
        ) {
            self.env_dirty = true;
        }
    }

    pub fn set_route(&mut self, index: usize, src: u32, dst: u32, amount: f32, enabled: bool) {
        self.params.set_route(index, src, dst, amount, enabled);
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
        self.vm.note_off(note);
    }

    pub fn all_notes_off(&mut self) {
        self.vm.all_notes_off();
    }

    fn retrigger(&mut self, slot: usize) {
        unsafe { gs_voice_reset(slot as i32) };
        let p = self.params.env;
        let env = &mut self.envs[slot];
        env.reset();
        env.set_params(p.attack, p.decay, p.sustain, p.release);
        env.gate_on();
    }

    fn apply_env_to_all(&mut self) {
        let p = self.params.env;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active && !self.vm.voices[slot].stealing {
                self.envs[slot].set_params(p.attack, p.decay, p.sustain, p.release);
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

        // --- clear mix bus --------------------------------------------------
        self.mix_l[..frames].fill(0.0);
        self.mix_r[..frames].fill(0.0);

        // --- render voices --------------------------------------------------
        let mut active = 0u32;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active {
                self.render_voice(slot, frames, depth, lfo_value);
                active += 1;
            }
        }
        self.active_voices = active;

        // --- master bus: soft clip into the FX send -------------------------
        for i in 0..frames {
            self.fx_l[i] = soft_clip(self.mix_l[i]);
            self.fx_r[i] = soft_clip(self.mix_r[i]);
        }

        // --- global FX (Soundpipe reverb + delay) ---------------------------
        self.apply_fx(frames);

        // --- volume ramp + final soft clip ----------------------------------
        let target = self.params.master_volume;
        let start = self.master_gain;
        let step = (target - start) / frames as f32;
        for i in 0..frames {
            let g = start + step * (i as f32 + 1.0);
            self.out_l[i] = soft_clip(self.fx_l[i]) * g;
            self.out_r[i] = soft_clip(self.fx_r[i]) * g;
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
        while let Some((slot, _note, _vel)) = self
            .vm
            .flush_pending(|note| note_to_hz(note as f32 + tune))
        {
            unsafe { gs_voice_reset(slot as i32) };
            let env = &mut self.envs[slot];
            env.reset();
            env.set_params(params.attack, params.decay, params.sustain, params.release);
            env.gate_on();
            let _ = sr;
        }
    }

    fn render_voice(&mut self, slot: usize, frames: usize, depth: f32, lfo_value: f32) {
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

        let velocity = voice.velocity;
        for i in 0..frames {
            self.voice_buf[i] *= self.env_buf[i] * velocity;
        }

        // --- tremolo / volume modulation ------------------------------------
        let vol_depth = depth * matches!(params.lfo.target, LfoTarget::Volume) as u32 as f32;
        if vol_depth > 0.0 || mod_volume != 0.0 {
            for i in 0..frames {
                let l = self.lfo_buf[i];
                let mut g = 1.0 - vol_depth * (0.5 - 0.5 * l);
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
            cutoff *= exp2(env_last * params.filter.env_amt * 6.0);
        }
        if depth > 0.0 && matches!(params.lfo.target, LfoTarget::Cutoff) {
            cutoff *= exp2(lfo_value * depth * 4.0);
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

        // --- accumulate into the mix bus ------------------------------------
        simd::accumulate(&self.voice_buf[..frames], &mut self.mix_l[..frames], VOICE_GAIN);
        simd::accumulate(&self.voice_buf[..frames], &mut self.mix_r[..frames], VOICE_GAIN);

        // --- retire finished voices -----------------------------------------
        if !voice.gate && !self.envs[slot].is_active() {
            self.vm.release_slot(slot);
            self.envs[slot].reset();
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
        e.set_param(id::OSC1_WAVE, Wave::Saw as u32 as f32);
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
    fn spectrum_bins_update_while_playing() {
        let _guard = ENGINE_LOCK.lock().unwrap();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, Wave::Saw as u32 as f32);
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
}
