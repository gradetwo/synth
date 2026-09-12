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
use crate::dsp::convolution::{Convolver, IrError};
use crate::dsp::delay::{Delay, DelayParams};
use crate::dsp::ladder::LadderFilter;
use crate::dsp::noise::NoiseGen;
use crate::dsp::reverb::{Reverb, ReverbParams};
use crate::dsp::sampler::{LoopMode, ReadState, Sample, SampleError, SampleParams};
use crate::dsp::wavetable::{CycleError, Table, BASE_LEN as WT_BASE_LEN};
use crate::dsp::util::{exp2, note_to_hz, semitone_ratio, soft_limit, Rng};
use crate::fft::Spectrum;
use crate::params::{
    graph_node_src, id, is_continuous, FxKind, GraphInput, LfoTarget, ModDst, ModSrc, OscParams,
    Params, FX_SLOTS, GRAPH_DRY, MAX_BLOCK_SIZE, MAX_UNISON, MAX_VOICES, PARAM_COUNT,
};
use crate::voice::{NoteOnResult, VoiceManager};

// ---------------------------------------------------------------- C ABI glue

extern "C" {
    fn gs_daisy_init(sample_rate: f32);
    fn gs_voice_reset(v: i32);
    fn gs_voice_phase(v: i32, p0: f32, p1: f32);
    fn gs_voice_osc_set(v: i32, which: i32, sub: i32, wave: u32, freq: f32, amp: f32, pw: f32);
    fn gs_voice_osc_block(v: i32, which: i32, sub: i32, out: *mut f32, frames: u32);
    fn gs_voice_osc_sync_block(
        v: i32,
        sub: i32,
        modulator: *const f32,
        depth: f32,
        master_out: *mut f32,
        slave_out: *mut f32,
        frames: u32,
    );
    fn gs_voice_osc_pm_block(
        v: i32,
        which: i32,
        sub: i32,
        modulator: *const f32,
        depth: f32,
        out: *mut f32,
        frames: u32,
    );
    fn gs_voice_filter_set(v: i32, side: i32, kind: i32, freq: f32, res: f32, drive: f32);
    fn gs_voice_filter_block(
        v: i32,
        side: i32,
        kind: i32,
        morph: f32,
        input: *const f32,
        out: *mut f32,
        frames: u32,
    );
    fn gs_voice_dc_block(v: i32, side: i32, input: *const f32, out: *mut f32, frames: u32);
    #[link_name = "_ZN12_GLOBAL__N_1L13g_dbg_filterE"]
    static mut g_dbg_filter: i32;
    fn gs_init(sample_rate: f32, max_polyphony: u32) -> u32;
    fn gs_voice_formant_set(v: i32, side: i32, vowel: f32, res: f32);
    fn gs_voice_formant_block(
        v: i32,
        side: i32,
        input: *const f32,
        out: *mut f32,
        frames: u32,
    );
    fn gs_fx_init(sample_rate: f32);
    /// How many effect slots the C bridge has state for.
    fn gs_fx_slots() -> i32;
    fn gs_fx_chorus_set(slot: i32, depth: f32, freq: f32, delay_ms: f32, feedback: f32);
    fn gs_fx_chorus_block(slot: i32, in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_flanger_set(slot: i32, depth: f32, freq: f32, delay_ms: f32, feedback: f32);
    fn gs_fx_flanger_block(slot: i32, in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_phaser_set(slot: i32, depth: f32, freq: f32, feedback: f32, poles: i32);
    fn gs_fx_phaser_block(slot: i32, in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
    fn gs_fx_overdrive_set(slot: i32, drive: f32);
    fn gs_fx_overdrive_block(slot: i32, in_l: *const f32, in_r: *const f32, out_l: *mut f32, out_r: *mut f32, frames: u32);
}

/// Short release applied to a stolen voice (seconds).
/// Fade applied to a voice that is being stolen. Long-release patches steal
/// constantly on dense material, and every cut is a tiny broadband click, so
/// the fade is deliberately gentle: 20 ms is inaudible as a note ending but
/// spreads the discontinuity over a thousand samples.
const STEAL_RELEASE: f32 = 0.02;
/// Per-voice gain before the mix bus.
/// Below this the meters report exact silence (-120 dBFS).
const METER_FLOOR: f32 = 1.0e-6;

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

/// How notes are sent to the two instances (A5.1 / P2 layer-split).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum InstanceMode {
    /// Everything plays instance A. The default, so existing patches are
    /// untouched.
    Single,
    /// Every note plays both instances (a layered sound).
    Layer,
    /// Notes at or below `split_note` play A, notes above play B.
    Split,
}

impl InstanceMode {
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => InstanceMode::Layer,
            2 => InstanceMode::Split,
            _ => InstanceMode::Single,
        }
    }
}

/// Key/velocity routing between the two instances.
#[derive(Clone, Copy)]
pub struct InstanceRouting {
    pub mode: InstanceMode,
    pub split_note: u8,
    /// Velocity window per instance, so a split can also be a dynamic layer
    /// (soft notes one sound, hard notes another).
    pub a_lo: f32,
    pub a_hi: f32,
    pub b_lo: f32,
    pub b_hi: f32,
}

impl InstanceRouting {
    pub const fn new() -> Self {
        Self {
            mode: InstanceMode::Single,
            split_note: 60,
            a_lo: 0.0,
            a_hi: 1.0,
            b_lo: 0.0,
            b_hi: 1.0,
        }
    }

    /// Whether `instance` plays this note.
    #[inline]
    fn wants(&self, instance: u8, note: u8, velocity: f32) -> bool {
        let (lo, hi) = if instance == 1 { (self.b_lo, self.b_hi) } else { (self.a_lo, self.a_hi) };
        if velocity < lo || velocity > hi {
            return false;
        }
        match self.mode {
            // The default: everything plays instance A, so adding a second
            // instance changed nothing for existing patches.
            InstanceMode::Single => instance == 0,
            InstanceMode::Layer => true,
            InstanceMode::Split => {
                if instance == 0 {
                    note <= self.split_note
                } else {
                    note > self.split_note
                }
            }
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
    /// The modulator's block, copied out of `osc_b` when OSC 1's phase is
    /// modulated by it (P6.1): the carrier renders into `osc_a` while reading
    /// this, and two separate fields are the only way to say that in Rust.
    pm_buf: [f32; MAX_BLOCK_SIZE],
    /// Sub-oscillator phase per voice and oscillator (P6.2).
    sub_phase: [[f32; 2]; MAX_VOICES],
    /// Scratch for the hard-sync pair's master block (P6.2).
    sync_buf: [f32; MAX_BLOCK_SIZE],
    /// One output buffer per effect node of the routing graph (A1), plus the
    /// scratch the node input mix is summed into. Allocated once in `init`:
    /// the render loop must never allocate, and six nodes cost ~64 KB.
    graph_node_l: Vec<f32>,
    graph_node_r: Vec<f32>,
    graph_in_l: Vec<f32>,
    graph_in_r: Vec<f32>,
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
    /// Noise colour state, per voice and oscillator.
    noise: [[NoiseGen; 2]; MAX_VOICES],
    /// Wavetable phase, per voice and oscillator (one cycle each).
    wt_phase: [[f32; 2]; MAX_VOICES],
    /// Band-limited harmonic tables, one bank per recipe. Filled in `init`:
    /// building them is not const-constructible, and they never change after.
    tables: Vec<crate::dsp::wavetable::Table>,
    /// Imported single-cycle wavetable (A6.2), if the player loaded one. It sits
    /// beside `tables` rather than replacing them so a patch that asks for the
    /// user table on a machine that has none still plays a factory bank instead
    /// of falling silent.
    user_table: Option<crate::dsp::wavetable::Table>,
    /// Where an imported cycle is staged before `import_wavetable` reads it.
    /// A field rather than a second static: the worklet writes here directly and
    /// the engine already owns the storage.
    wt_scratch: [f32; WT_BASE_LEN],
    /// One four-pole low-pass per voice per oscillator side.
    ladders: [[LadderFilter; 2]; MAX_VOICES],
    /// Per-note tuning offsets in cents. Lives here rather than in `Params` so
    /// it is an instrument setting that presets do not overwrite.
    tuning: [f32; crate::params::TUNING_NOTES],
    /// Per-note pitch bend in semitones (MPE): every note bends on its own, so
    /// this cannot be the single global `pitch_bend` wheel.
    bends: [f32; crate::params::TUNING_NOTES],
    /// One algorithmic reverb per effect node: the graph can put a reverb in
    /// two places, and sharing one state would make them cross-talk. The
    /// impulse-response engine is a single instance (see `convolver`).
    reverbs: Vec<Reverb>,
    /// Whether this block has already used the single-instance effects. The
    /// delay line (768 KB) and the convolver (787 KB) do not fit in the arena
    /// six times over, so a second node of those kinds passes its input through
    /// instead of quietly sharing — and sometimes corrupting — the first one's
    /// state. The editor does not offer a duplicate either (see `fxchain`).
    fx_delay_used: bool,
    fx_conv_used: bool,
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
    /// Stereo delay with ping-pong and damping (replaces the vendored one).
    delay: Delay,
    /// Impulse-response reverb: the second engine behind the reverb section.
    convolver: Convolver,
    /// Where an imported impulse response is staged before analysis.
    ir_scratch: Vec<f32>,
    /// The imported sample, if any (A). Like the wavetable it is instrument
    /// state, not patch state: patches choose to play it, not what it is.
    user_sample: Sample,
    /// Where a sample is staged before analysis.
    sample_scratch: Vec<f32>,
    /// Where each voice's sampler is in the sample, and which way it is going.
    smp_state: [[ReadState; 2]; MAX_VOICES],
    /// Instance B: a second, complete parameter set. Voices remember which
    /// instance played them, so both timbres can sound at once while the effect
    /// chain and the master bus stay shared.
    params_b: Params,
    /// Which instance each voice belongs to.
    voice_instance: [u8; MAX_VOICES],
    /// Per-voice stereo offset, set from the note-on that started it. The
    /// player uses it to give each song layer its own place in the image; a
    /// plain keyboard note leaves it at the centre.
    voice_pan: [f32; MAX_VOICES],
    /// Key/velocity routing between the instances.
    pub routing: InstanceRouting,
    /// Smoothing state for instance B (instance A uses the originals).
    smooth_target_b: [f32; PARAM_COUNT],
    smooth_value_b: [f32; PARAM_COUNT],
    smooth_set_b: [bool; PARAM_COUNT],
    smooth_ready_b: [bool; PARAM_COUNT],
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
            pm_buf: [0.0; MAX_BLOCK_SIZE],
            sub_phase: [[0.0; 2]; MAX_VOICES],
            sync_buf: [0.0; MAX_BLOCK_SIZE],
            graph_node_l: Vec::new(),
            graph_node_r: Vec::new(),
            graph_in_l: Vec::new(),
            graph_in_r: Vec::new(),
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
            noise: [[NoiseGen::new(); 2]; MAX_VOICES],
            wt_phase: [[0.0; 2]; MAX_VOICES],
            tables: Vec::new(),
            user_table: None,
            wt_scratch: [0.0; WT_BASE_LEN],
            ladders: [[LadderFilter::new(); 2]; MAX_VOICES],
            tuning: [0.0; crate::params::TUNING_NOTES],
            bends: [0.0; crate::params::TUNING_NOTES],
            reverbs: Vec::new(),
            fx_delay_used: false,
            fx_conv_used: false,
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
            delay: Delay::new(),
            convolver: Convolver::new(),
            ir_scratch: Vec::new(),
            user_sample: Sample::new(),
            sample_scratch: Vec::new(),
            smp_state: [[ReadState::new(); 2]; MAX_VOICES],
            params_b: Params::new(),
            voice_instance: [0; MAX_VOICES],
            voice_pan: [0.0; MAX_VOICES],
            routing: InstanceRouting::new(),
            smooth_target_b: [0.0; PARAM_COUNT],
            smooth_value_b: [0.0; PARAM_COUNT],
            smooth_set_b: [false; PARAM_COUNT],
            smooth_ready_b: [false; PARAM_COUNT],
            initialised: false,
        }
    }

    pub fn init(&mut self, sample_rate: f32, max_polyphony: usize) {
        self.sample_rate = if (8000.0..=192000.0).contains(&sample_rate) {
            sample_rate
        } else {
            48000.0
        };
        self.tables = crate::dsp::wavetable::RECIPES
            .iter()
            .map(|(_, recipe)| crate::dsp::wavetable::Table::from_recipe(recipe))
            .collect();
        unsafe {
            gs_daisy_init(self.sample_rate);
            gs_fx_init(self.sample_rate);
        }
        for comb in self.combs.iter_mut() {
            comb.prepare(self.sample_rate);
        }
        // `resize` rather than a fresh allocation, like the other arena buffers:
        // a host that re-inits must not fragment the free list.
        if self.reverbs.len() != FX_SLOTS {
            self.reverbs.clear();
            self.reverbs.resize_with(FX_SLOTS, Reverb::new);
        }
        for reverb in self.reverbs.iter_mut() {
            reverb.set_sample_rate(self.sample_rate);
        }
        self.delay.setup(self.sample_rate);
        self.convolver.prepare();
        // `resize`, not a fresh allocation: the host can re-init, and the arena
        // never grows (see the convolver's response buffer for the same reason).
        let node_capacity = FX_SLOTS * MAX_BLOCK_SIZE;
        if self.graph_node_l.len() != node_capacity {
            self.graph_node_l.clear();
            self.graph_node_l.resize(node_capacity, 0.0);
            self.graph_node_r.clear();
            self.graph_node_r.resize(node_capacity, 0.0);
            self.graph_in_l.clear();
            self.graph_in_l.resize(MAX_BLOCK_SIZE, 0.0);
            self.graph_in_r.clear();
            self.graph_in_r.resize(MAX_BLOCK_SIZE, 0.0);
        }
        // `resize`, not a fresh `vec!`: the host may re-init the engine, and the
        // arena never grows. Allocating a second 384 KB response buffer before
        // the old one is freed fragments the free list until a later init fails.
        let capacity = Convolver::max_ir_samples();
        if self.ir_scratch.len() != capacity {
            self.ir_scratch.clear();
            self.ir_scratch.resize(capacity, 0.0);
        }
        for reverb in self.reverbs.iter_mut() {
            reverb.set_params(ReverbParams {
                size: self.params.fx.reverb_size,
                damp: self.params.fx.reverb_damp,
                mix: 0.0,
                width: self.params.fx.reverb_width,
                predelay: self.params.fx.reverb_predelay,
            });
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
        self.delay.reset();
        self.initialised = true;
    }

    /// The parameter set a voice plays with.
    #[inline]
    fn params_for(&self, instance: u8) -> Params {
        if instance == 1 {
            self.params_b
        } else {
            self.params
        }
    }

    /// Set a parameter on instance B (0 sets instance A's, which is what the
    /// worklet's AudioParams already do).
    ///
    /// Smoothed exactly like instance A, so dragging a knob on the second layer
    /// cannot zipper either.
    pub fn set_param_inst(&mut self, instance: u32, param_id: u32, value: f32) {
        if instance == 0 {
            self.set_param(param_id, value);
            return;
        }
        if (param_id as usize) >= PARAM_COUNT {
            return;
        }
        self.params_b.set(param_id, value);
        if is_continuous(param_id) {
            let index = param_id as usize;
            self.smooth_target_b[index] = if value.is_finite() { value } else { 0.0 };
            self.smooth_set_b[index] = true;
        }
        if is_env_param(param_id) {
            // Held instance-B voices need the new envelope, not just the next one.
            self.env_dirty = true;
        }
        if param_id == id::VOICE_MODE {
            self.mono_len = 0;
        }
    }

    /// Route notes to the instances.
    pub fn set_instance_routing(
        &mut self,
        mode: u32,
        split_note: u32,
        a_lo: f32,
        a_hi: f32,
        b_lo: f32,
        b_hi: f32,
    ) {
        self.routing = InstanceRouting {
            mode: InstanceMode::from_u32(mode),
            split_note: split_note.min(127) as u8,
            a_lo: a_lo.clamp(0.0, 1.0),
            a_hi: a_hi.clamp(0.0, 1.0),
            b_lo: b_lo.clamp(0.0, 1.0),
            b_hi: b_hi.clamp(0.0, 1.0),
        };
    }

    /// Voices currently sounding on `instance` (diagnostics and tests).
    pub fn instance_voices(&self, instance: u8) -> u32 {
        let mut count = 0;
        for slot in 0..MAX_VOICES {
            if self.vm.voices[slot].active && self.voice_instance[slot] == instance {
                count += 1;
            }
        }
        count
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

    /// Where the host stages an imported cycle, then calls
    /// [`Engine::import_wavetable`]. The samples land straight in engine memory
    /// instead of going through a copy on the way in.
    pub fn wavetable_scratch_ptr(&mut self) -> *mut f32 {
        self.wt_scratch.as_mut_ptr()
    }

    /// Build a mipmapped table from [`Engine::wavetable_scratch_ptr`].
    ///
    /// Returns 0 on success, or the numeric [`CycleError`] the host should
    /// explain to the player. Analysis only — never called from `process`.
    pub fn import_wavetable(&mut self, len: usize) -> i32 {
        let len = len.min(self.wt_scratch.len());
        match Table::from_cycle(&self.wt_scratch[..len]) {
            Ok(table) => {
                self.user_table = Some(table);
                0
            }
            Err(CycleError::TooShort) => 1,
            Err(CycleError::Silent) => 2,
            Err(CycleError::NotFinite) => 3,
        }
    }

    /// Drop the imported table. Patches asking for it fall back to the factory
    /// banks themselves, so this cannot leave a silent patch behind.
    pub fn clear_wavetable(&mut self) {
        self.user_table = None;
    }

    /// Where the host stages an impulse response, then calls [`Engine::import_ir`].
    pub fn ir_scratch_ptr(&mut self) -> *mut f32 {
        // Allocated in `init`; the host may ask before that (or in a test), so
        // make sure the buffer exists rather than handing out a null pointer.
        if self.ir_scratch.is_empty() {
            self.ir_scratch.resize(Convolver::max_ir_samples(), 0.0);
        }
        self.ir_scratch.as_mut_ptr()
    }

    /// How many samples of impulse response the core can hold. A compile-time
    /// ceiling, so it is answerable before anything is allocated.
    pub fn ir_capacity(&self) -> usize {
        Convolver::max_ir_samples()
    }

    /// Where the host stages an imported sample, then calls
    /// [`Engine::import_sample`].
    pub fn sample_scratch_ptr(&mut self) -> *mut f32 {
        if self.sample_scratch.len() != crate::dsp::sampler::MAX_BASE_SAMPLES {
            self.sample_scratch.clear();
            self.sample_scratch.resize(crate::dsp::sampler::MAX_BASE_SAMPLES, 0.0);
        }
        self.sample_scratch.as_mut_ptr()
    }

    /// How many samples can be staged. A compile-time ceiling, so the host can
    /// ask before anything is allocated.
    pub fn sample_capacity(&self) -> usize {
        crate::dsp::sampler::MAX_BASE_SAMPLES
    }

    /// Analyse a staged sample. `source_rate` is the rate it was recorded at, so
    /// it can be resampled to the engine's. Returns 0 on success or the numeric
    /// [`SampleError`] code (1 = too short, 2 = silent, 3 = not finite).
    pub fn import_sample(&mut self, len: usize, source_rate: f32) -> i32 {
        let len = len.min(self.sample_scratch.len());
        let samples = self.sample_scratch[..len].to_vec();
        match self.user_sample.load(&samples, source_rate, self.sample_rate) {
            Ok(()) => 0,
            Err(SampleError::TooShort) => 1,
            Err(SampleError::Silent) => 2,
            Err(SampleError::NotFinite) => 3,
        }
    }

    pub fn clear_sample(&mut self) {
        self.user_sample.clear();
    }

    pub fn has_sample(&self) -> bool {
        self.user_sample.is_loaded()
    }

    /// Analyse a staged impulse response. Returns 0 on success, or the numeric
    /// [`IrError`] code (1 = too short, 2 = silent, 3 = not finite).
    pub fn import_ir(&mut self, len: usize) -> i32 {
        let len = len.min(self.ir_scratch.len());
        match self.convolver.set_ir(&self.ir_scratch[..len]) {
            Ok(()) => 0,
            Err(IrError::TooShort) => 1,
            Err(IrError::Silent) => 2,
            Err(IrError::NotFinite) => 3,
        }
    }

    pub fn clear_ir(&mut self) {
        self.convolver.clear();
    }

    pub fn has_ir(&self) -> bool {
        self.convolver.has_ir()
    }

    pub fn has_wavetable(&self) -> bool {
        self.user_table.is_some()
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
        // Instance B: the same one-pole, so the second layer cannot zipper
        // either. Its values only ever arrive from the host's messages.
        for index in 0..PARAM_COUNT {
            let param_id = index as u32;
            if !is_continuous(param_id) || !self.smooth_set_b[index] {
                continue;
            }
            let target = self.smooth_target_b[index];
            let value = if self.smooth_ready_b[index] {
                self.smooth_value_b[index] + (target - self.smooth_value_b[index]) * coeff
            } else {
                self.smooth_ready_b[index] = true;
                target
            };
            if is_env_param(param_id) && (value - self.smooth_value_b[index]).abs() > 1e-7 {
                env_changed = true;
            }
            self.smooth_value_b[index] = value;
            self.params_b.set(param_id, value);
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
        self.note_on_pan(note, velocity, 0.0);
    }

    /// Note-on with a stereo position (-1 = hard left, 1 = hard right). The
    /// player passes a song layer's pan here; playing by hand leaves it centred.
    pub fn note_on_pan(&mut self, note: u8, velocity: f32, pan: f32) {
        let vel = velocity.clamp(0.0, 1.0);
        let pan = pan.clamp(-1.0, 1.0);
        // Mono/legato keeps a single voice, so a layer there would be one note
        // per instance only by halving the effect; it plays instance A.
        if self.params.voice_mode != 0 {
            self.mono_note_on(note, vel, pan);
            return;
        }
        for instance in 0..2u8 {
            if self.routing.wants(instance, note, vel) {
                self.start_note(note, vel, instance, pan);
            }
        }
    }

    /// Start one voice for `note` on `instance`.
    fn start_note(&mut self, note: u8, vel: f32, instance: u8, pan: f32) {
        let freq = self.pitch_hz(note as f32);
        match self.vm.note_on_inst(note, vel, freq, instance, pan) {
            NoteOnResult::Allocated(slot) => {
                self.voice_instance[slot] = instance;
                self.voice_pan[slot] = pan;
                self.retrigger(slot);
            }
            NoteOnResult::Queued(victim) => {
                // Smooth steal: short release on the victim, new note queued
                // (with its instance, so the timbre survives the promotion).
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
    fn mono_note_on(&mut self, note: u8, velocity: f32, pan: f32) {
        let was_held = self.mono_len;
        if self.mono_len < self.mono_held.len() && !self.mono_held[..self.mono_len].contains(&note) {
            self.mono_held[self.mono_len] = note;
            self.mono_len += 1;
        }
        let freq = self.pitch_hz(note as f32);
        // Legato only suppresses the envelope restart when a key is already held.
        let legato = self.params.voice_mode == 2 && was_held > 0;
        let slot = 0usize;
        self.voice_pan[slot] = pan.clamp(-1.0, 1.0);
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
            self.noise[slot][0].reset();
            self.noise[slot][1].reset();
            self.wt_phase[slot] = [0.0; 2];
            self.smp_state[slot] = [ReadState::new(); 2];
            unsafe { gs_voice_reset(slot as i32) };
            let (p0, p1) = self.next_phases();
            unsafe { gs_voice_phase(slot as i32, p0, p1) };
            let random = self.next_random();
            self.vm.voices[slot].random = random;
            self.voice_lfos[slot].retrigger();
            self.voice_lfo2s[slot].retrigger();
            // Mono keeps a single voice, which is instance A's patch (see
            // `note_on`), but read the parameters of whichever instance the
            // voice was actually playing.
            let instance = self.voice_instance[slot];
            let p = self.params_for(instance).env;
            let env = &mut self.envs[slot];
            env.reset();
            env.set_params(p.attack, p.decay, p.sustain, p.release);
            env.gate_on();
            let f = self.params_for(instance).filter_env;
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
        let instance = self.voice_instance[slot];
        let p = self.params_for(instance).env;
        let env = &mut self.envs[slot];
        env.reset();
        env.set_params(p.attack, p.decay, p.sustain, p.release);
        env.gate_on();
        let f = self.params_for(instance).filter_env;
        let fenv = &mut self.filter_envs[slot];
        fenv.reset();
        fenv.set_params(f.attack, f.decay, f.sustain, f.release);
        fenv.gate_on();
    }

    fn apply_env_to_all(&mut self) {
        for slot in 0..MAX_VOICES {
            let params = self.params_for(self.voice_instance[slot]);
            let p = params.env;
            let f = params.filter_env;
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
        // Below -180 dBFS is silence by any measure, and the ±1e-15 dither that
        // keeps the effect tails out of denormals would otherwise keep the
        // meters awake forever — a meter that twitches with nothing playing is
        // a bug report waiting to happen.
        if self.rms_avg < METER_FLOOR {
            self.rms_avg = 0.0;
        }
        if self.true_peak < METER_FLOOR {
            self.true_peak = 0.0;
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
        let tuning = self.tuning;
        while let Some((slot, _note, _vel, instance, pan)) = self
            .vm
            .flush_pending(|note| pitch_hz_with(note as f32, tune, &tuning))
        {
            self.voice_instance[slot] = instance;
            self.voice_pan[slot] = pan;
            let params = self.params_for(instance).env;
            let fenv_params = self.params_for(instance).filter_env;
            self.ladders[slot][0].reset();
            self.ladders[slot][1].reset();
            self.noise[slot][0].reset();
            self.noise[slot][1].reset();
            self.wt_phase[slot] = [0.0; 2];
            self.smp_state[slot] = [ReadState::new(); 2];
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
        // The voice's own instance: parameters are read live every block, so a
        // knob still affects a held note — it just affects the layer it belongs
        // to.
        let params = self.params_for(self.voice_instance[slot]);

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
        let mut mod_fm = 0.0f32;
        let mut mod_ring = 0.0f32;
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
                ModDst::Fm => mod_fm += v,
                ModDst::Ring => mod_ring += v,
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
        // Phase modulation (P6.1): OSC 2 is the modulator, so it is rendered
        // first and OSC 1 reads it while it renders. The index is squared so the
        // bottom of the knob has usable resolution; 0 keeps the old order and
        // the old code path exactly.
        let fm_depth = (params.osc_fm + mod_fm).clamp(0.0, 1.0);
        let ring = (params.osc_ring + mod_ring).clamp(0.0, 1.0);
        let fm_cycles = FM_MAX_CYCLES * fm_depth * fm_depth;
        let modulator = fm_cycles > 0.0 && params.osc[1].on;
        let order: [usize; 2] = if modulator { [1, 0] } else { [0, 1] };

        // Hard sync (P6.2): OSC 2 is the master and OSC 1 restarts with it. It
        // needs both oscillators to be DaisySP wave oscillators — a wavetable, a
        // sample or noise has no cycle to restart — and it replaces the normal
        // render for both of them, oversampled, in one call.
        let synced = params.osc_sync
            && params.osc[0].on
            && params.osc[1].on
            && params.osc[0].wave.daisy_id().is_some()
            && params.osc[1].wave.daisy_id().is_some();

        // Unison renders each sub-voice through this scratch buffer; it is moved
        // out of `self` first so the loop can still borrow `osc_a`/`osc_b`.
        let mut scratch: [f32; MAX_BLOCK_SIZE] = self.unison_buf;
        let mut osc_level = [0.0f32; 2];
        if synced {
            // One pass per sub-voice: the slave's stack sets the detuning and the
            // master follows it, so a sync'd unison stays one period.
            let slave = params.osc[0];
            let master = params.osc[1];
            let unison = (slave.unison.max(1) as usize).min(MAX_UNISON as usize);
            let spread = (slave.spread.clamp(0.0, 1.0) * 35.0) / 100.0;
            let master_ratio = semitone_ratio(master.pitch) * semitone_ratio(master.detune / 100.0);
            let slave_ratio = semitone_ratio(slave.pitch) * semitone_ratio(slave.detune / 100.0);
            // Each Process() call is one *oversampled* step and the block makes
            // SYNC_OVERSAMPLE of them per output sample, so the oscillator's own
            // frequency has to be divided by that factor — passing it multiplied
            // ran the pair at OS^2 times the pitch.
            let osc = 1.0 / SYNC_OVERSAMPLE as f32;
            let slave_pw = (slave.pw + pw_mod).clamp(0.05, 0.95);
            let master_pw = (master.pw + pw_mod).clamp(0.05, 0.95);
            let gain = 1.0 / (unison as f32).sqrt();
            self.osc_a[..frames].fill(0.0);
            self.osc_b[..frames].fill(0.0);
            for sub in 0..unison {
                let t = if unison == 1 {
                    0.0
                } else {
                    (sub as f32 / (unison - 1) as f32) * 2.0 - 1.0
                };
                let detune = semitone_ratio(t * spread);
                let sub_freq = (current_freq * bend * slave_ratio * detune).clamp(0.25, sr * 0.45);
                let master_freq = (current_freq * bend * master_ratio * detune).clamp(0.25, sr * 0.45);
                if let (Some(slave_wave), Some(master_wave)) =
                    (slave.wave.daisy_id(), master.wave.daisy_id())
                {
                    unsafe {
                        gs_voice_osc_set(
                            slot as i32,
                            0,
                            sub as i32,
                            slave_wave,
                            sub_freq * osc,
                            1.0,
                            slave_pw,
                        );
                        gs_voice_osc_set(
                            slot as i32,
                            1,
                            sub as i32,
                            master_wave,
                            master_freq * osc,
                            1.0,
                            master_pw,
                        );
                        let pm = if modulator {
                            Some((&self.pm_buf[..frames], fm_cycles))
                        } else {
                            None
                        };
                        let (mod_ptr, depth) = match pm {
                            Some((signal, cycles)) => (signal.as_ptr(), cycles),
                            None => (core::ptr::null(), 0.0),
                        };
                        gs_voice_osc_sync_block(
                            slot as i32,
                            sub as i32,
                            mod_ptr,
                            depth,
                            self.sync_buf.as_mut_ptr(),
                            scratch.as_mut_ptr(),
                            frames as u32,
                        );
                    }
                    for i in 0..frames {
                        self.osc_a[i] += scratch[i] * gain;
                        self.osc_b[i] += self.sync_buf[i] * gain;
                    }
                }
            }
            // The sub oscillators ride the sync'd pair as well, so turning sync
            // on does not silently take them away.
            let nominal_slave = (current_freq * bend * slave_ratio).clamp(0.25, sr * 0.45);
            let nominal_master = (current_freq * bend * master_ratio).clamp(0.25, sr * 0.45);
            add_sub(
                &mut self.osc_a[..frames],
                nominal_slave,
                sr,
                slave.sub,
                slave.sub_level,
                &mut self.sub_phase[slot][0],
            );
            add_sub(
                &mut self.osc_b[..frames],
                nominal_master,
                sr,
                master.sub,
                master.sub_level,
                &mut self.sub_phase[slot][1],
            );
            osc_level[0] = if slave.on { slave.level } else { 0.0 };
            osc_level[1] = if master.on { master.level } else { 0.0 };
        }
        for which in order {
            if synced {
                break;
            }
            let o = params.osc[which];
            let level = if o.on { o.level } else { 0.0 };
            osc_level[which] = level;
            let out: &mut [f32] = if which == 0 {
                &mut self.osc_a[..frames]
            } else {
                &mut self.osc_b[..frames]
            };
            // A silent OSC 2 is still rendered when it modulates: its level is
            // how loud it is in the mix, not how much it modulates.
            if level <= 0.0 && !(which == 1 && modulator) {
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
            let pm = if which == 0 && modulator {
                Some((&self.pm_buf[..frames], fm_cycles))
            } else {
                None
            };
            render_oscillator(
                slot,
                which,
                o,
                freq,
                pw,
                frames,
                out,
                pm,
                &mut self.rng,
                &mut self.noise[slot][which],
                &self.tables,
                self.user_table.as_ref(),
                self.params.wt_user,
                &mut self.wt_phase[slot][which],
                &mut self.sub_phase[slot][which],
                &self.user_sample,
                &mut self.smp_state[slot][which],
                SampleParams {
                    root_hz: note_to_hz(self.params.sample_root),
                    mode: LoopMode::from_u32(self.params.sample_mode),
                    loop_start: self.params.sample_loop_start,
                    loop_end: self.params.sample_loop_end,
                },
                sr,
                &mut scratch[..],
            );
            if which == 1 && modulator {
                // The carrier reads this on the next iteration; copying now,
                // after OSC 2 has been rendered, is what makes the modulation
                // sample-aligned instead of one block late.
                self.pm_buf[..frames].copy_from_slice(&self.osc_b[..frames]);
            }
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
            && ring <= 0.0
            && (params.osc[0].pan - params.osc[1].pan).abs() > 0.02;

        if stereo {
            let trim = FILTER_TRIM;
            for i in 0..frames {
                self.voice_buf[i] = self.osc_a[i] * osc_level[0] * trim;
                self.voice_buf_r[i] = self.osc_b[i] * osc_level[1] * trim;
            }
        } else if ring > 0.0 {
            // Ring modulation multiplies the two oscillators, so the product is
            // level-compensated by the geometric mean of the two levels: fading
            // one oscillator out fades the product out too, exactly as it fades
            // its own part of the sum.
            let trim = FILTER_TRIM;
            let l1 = osc_level[0] * trim;
            let l2 = osc_level[1] * trim;
            let pair = (osc_level[0] * osc_level[1]).sqrt() * trim;
            for i in 0..frames {
                let a = self.osc_a[i];
                let b = self.osc_b[i];
                let sum = a * l1 + b * l2;
                let product = a * b * pair;
                self.voice_buf[i] = sum + (product - sum) * ring;
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

        // White noise blended into the voice (P6.2), after the oscillators and
        // before the filter, so the filter shapes it like anything else. One
        // source per voice, the same on both channels: it sits in the middle of
        // the image, which is where a noise bed belongs.
        if params.noise_mix > 0.0 {
            let level = params.noise_mix * 0.5;
            for i in 0..frames {
                let noise = self.rng.next_bipolar() * level;
                self.voice_buf[i] += noise;
                self.voice_buf_r[i] += noise;
            }
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
                kind.bridge_id(),
                cutoff,
                resonance,
                params.filter.drive,
            );
            gs_voice_filter_block(
                slot as i32,
                0,
                kind.bridge_id(),
                params.filter.morph,
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
                    kind.bridge_id(),
                    cutoff,
                    resonance,
                    params.filter.drive,
                );
                gs_voice_filter_block(
                    slot as i32,
                    1,
                    kind.bridge_id(),
                    params.filter.morph,
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
        // A voice's own position rides on top of the patch's: a song layer can
        // be placed in the image without touching the preset.
        let voice_pan = self.voice_pan[slot];
        if stereo {
            // Each oscillator has its own position (the matrix PAN offset is
            // applied to both), with an equal-power law per oscillator.
            let mut angles = [0.0f32; 2];
            for which in 0..2 {
                let pan = (params.osc[which].pan + mod_pan + voice_pan).clamp(-1.0, 1.0);
                angles[which] = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
            }
            let (l1, r1) = (angles[0].cos(), angles[0].sin());
            let (l2, r2) = (angles[1].cos(), angles[1].sin());
            // The patch's own trim rides on the voice gain, so a preset can be
            // level-matched without touching the player's master volume.
            let gain = VOICE_GAIN * params.patch_gain;
            for i in 0..frames {
                let a = self.voice_buf[i] * gain;
                let b = self.voice_buf_r[i] * gain;
                self.mix_l[i] += a * l1 + b * l2;
                self.mix_r[i] += a * r1 + b * r2;
            }
        } else {
            // Mono voice: the two PAN controls collapse into one level-weighted
            // position, applied after the shared filter.
            let pan = if levels > 1e-4 {
                ((osc_level[0] * params.osc[0].pan + osc_level[1] * params.osc[1].pan) / levels
                    + mod_pan
                    + voice_pan)
                    .clamp(-1.0, 1.0)
            } else {
                (mod_pan + voice_pan).clamp(-1.0, 1.0)
            };
            let angle = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
            // The patch's own trim rides on the voice gain, so a preset can be
            // level-matched without touching the player's master volume.
            let gain = VOICE_GAIN * params.patch_gain;
            let pan_l = angle.cos();
            let pan_r = angle.sin();
            simd::accumulate(
                &self.voice_buf[..frames],
                &mut self.mix_l[..frames],
                gain * pan_l,
            );
            simd::accumulate(
                &self.voice_buf[..frames],
                &mut self.mix_r[..frames],
                gain * pan_r,
            );
        }

        // --- retire finished voices -----------------------------------------
        if !voice.gate && !self.envs[slot].is_active() {
            self.vm.release_slot(slot);
            self.envs[slot].reset();
            self.filter_envs[slot].reset();
        }
    }

    /// Run the effect chain (A5).
    ///
    /// The chain is a list of positions, each holding one effect, run in signal
    /// order. Every effect keeps its own on/off switch and mix from before, so a
    /// patch that never touched the chain sounds exactly as it did; reordering
    /// only changes the order things happen in.
    ///
    /// A position marked *parallel* is a send: the effect runs on a copy of the
    /// signal and its wet output is added, leaving the signal underneath intact.
    /// A serial position is an insert: wet and dry are crossfaded.
    fn apply_fx(&mut self, frames: usize) {
        if self.params.fx.graph {
            self.apply_fx_graph(frames);
            return;
        }
        for slot in 0..FX_SLOTS {
            let kind = self.params.fx.chain[slot];
            let parallel = self.params.fx.parallel[slot];
            let fx = self.params.fx;
            match kind {
                FxKind::None => {}
                FxKind::Delay => {
                    // The delay reads its parameters every block, so a change in
                    // tempo, time or damping is picked up without a setter round
                    // trip. When it is off the wet mix is zero, which is exactly
                    // a bypass (the line keeps running so its tail does not pop
                    // back when it is switched on again).
                    self.delay.process(
                        DelayParams {
                            time_s: self.params.delay_time_seconds(),
                            feedback: fx.delay_fb,
                            mix: if fx.delay_on { fx.delay_mix } else { 0.0 },
                            damp: fx.delay_damp,
                            ping_pong: fx.delay_ping_pong,
                        },
                        &mut self.fx_l[..frames],
                        &mut self.fx_r[..frames],
                        frames,
                    );
                }
                FxKind::Reverb => {
                    let mix = if fx.reverb_on { fx.reverb_mix } else { 0.0 };
                    if fx.reverb_mode == 1 && self.convolver.has_ir() {
                        // The imported response, trimmed so its level sits where
                        // the patch expects the reverb to sit.
                        self.convolver.process(
                            &mut self.fx_l[..frames],
                            &mut self.fx_r[..frames],
                            frames,
                            mix * fx.conv_trim,
                        );
                    } else {
                        // Damped, modulated and with a pre-delay, which the old
                        // Soundpipe `revsc` could not do.
                        self.reverbs[slot].set_params(ReverbParams {
                            size: if fx.reverb_on { fx.reverb_size } else { 0.0 },
                            damp: fx.reverb_damp,
                            mix,
                            width: fx.reverb_width,
                            predelay: fx.reverb_predelay,
                        });
                        self.reverbs[slot]
                            .process(&mut self.fx_l[..frames], &mut self.fx_r[..frames]);
                    }
                }
                FxKind::Chorus if fx.chorus_on && fx.chorus_mix > 0.0 => {
                    unsafe {
                        gs_fx_chorus_set(slot as i32, fx.chorus_depth, fx.chorus_rate, 20.0, 0.25);
                        gs_fx_chorus_block(
                            slot as i32,
                            self.fx_l.as_ptr(),
                            self.fx_r.as_ptr(),
                            self.osc_a.as_mut_ptr(),
                            self.osc_b.as_mut_ptr(),
                            frames as u32,
                        );
                    }
                    self.mix_effect(frames, fx.chorus_mix, parallel);
                }
                FxKind::Flanger if fx.flanger_on && fx.flanger_mix > 0.0 => {
                    unsafe {
                        gs_fx_flanger_set(slot as i32, 0.5, fx.flanger_rate, 2.0, fx.flanger_fb);
                        gs_fx_flanger_block(
                            slot as i32,
                            self.fx_l.as_ptr(),
                            self.fx_r.as_ptr(),
                            self.osc_a.as_mut_ptr(),
                            self.osc_b.as_mut_ptr(),
                            frames as u32,
                        );
                    }
                    self.mix_effect(frames, fx.flanger_mix, parallel);
                }
                FxKind::Phaser if fx.phaser_on && fx.phaser_mix > 0.0 => {
                    unsafe {
                        gs_fx_phaser_set(slot as i32, 0.8, fx.phaser_rate, fx.phaser_fb, 4);
                        gs_fx_phaser_block(
                            slot as i32,
                            self.fx_l.as_ptr(),
                            self.fx_r.as_ptr(),
                            self.osc_a.as_mut_ptr(),
                            self.osc_b.as_mut_ptr(),
                            frames as u32,
                        );
                    }
                    self.mix_effect(frames, fx.phaser_mix, parallel);
                }
                FxKind::Drive if fx.drive_on && fx.drive_mix > 0.0 => {
                    unsafe {
                        gs_fx_overdrive_set(slot as i32, fx.drive_amt);
                        gs_fx_overdrive_block(
                            slot as i32,
                            self.fx_l.as_ptr(),
                            self.fx_r.as_ptr(),
                            self.osc_a.as_mut_ptr(),
                            self.osc_b.as_mut_ptr(),
                            frames as u32,
                        );
                    }
                    self.mix_effect(frames, fx.drive_mix, parallel);
                }
                _ => {}
            }
        }
    }

    /// Effect nodes that have their own DSP state.
    pub fn fx_slots(&self) -> usize {
        FX_SLOTS
    }

    /// Seed the routing graph from the chain that is set now: node 1 reads the
    /// dry bus, every later node reads the one before it, and the last node that
    /// actually runs feeds the mix bus. Turning the graph on after this sounds
    /// exactly like the chain it came from.
    pub fn fx_graph_from_chain(&mut self) {
        let chain = self.params.fx.chain;
        let mut previous: Option<usize> = None;
        for slot in 0..FX_SLOTS {
            let src = match previous {
                Some(from) => graph_node_src(from),
                None => GRAPH_DRY,
            };
            self.params.fx.node_in[slot] = [GraphInput { src, gain: 1.0 }, GraphInput::NONE];
            self.params.fx.node_to_out[slot] = false;
            self.params.fx.node_out_gain[slot] = 1.0;
            if chain[slot] != FxKind::None {
                previous = Some(slot);
            }
        }
        // Empty positions pass their input straight through, so the last
        // position that runs is the signal the bus ends up carrying. With no
        // effect at all it is the dry bus, which node 1 passes through.
        match previous {
            Some(last) => self.params.fx.node_to_out[last] = true,
            None => self.params.fx.node_to_out[0] = true,
        }
        self.params.fx.graph = true;
    }

    /// Render the effect positions as a feed-forward graph (A1).
    ///
    /// Nodes run in index order and an input may only read the dry bus or an
    /// *earlier* node, which is a valid topological order without sorting
    /// anything on the audio thread — and makes a loop impossible by
    /// construction. A node whose input is not connected processes silence; if
    /// nothing is routed to the mix bus the effect section is silent, which is
    /// what an empty patch should be.
    fn apply_fx_graph(&mut self, frames: usize) {
        self.fx_delay_used = false;
        self.fx_conv_used = false;
        for slot in 0..FX_SLOTS {
            self.mix_node_input(slot, frames);
            self.render_fx_node(slot, frames);
        }
        let fx = self.params.fx;
        self.fx_l[..frames].fill(0.0);
        self.fx_r[..frames].fill(0.0);
        for slot in 0..FX_SLOTS {
            if !fx.node_to_out[slot] {
                continue;
            }
            let gain = fx.node_out_gain[slot];
            let base = slot * MAX_BLOCK_SIZE;
            for i in 0..frames {
                self.fx_l[i] += self.graph_node_l[base + i] * gain;
                self.fx_r[i] += self.graph_node_r[base + i] * gain;
            }
        }
    }

    /// Sum a node's inputs into its buffer: up to two connections, each from the
    /// dry bus or an earlier node, each with its own gain.
    fn mix_node_input(&mut self, slot: usize, frames: usize) {
        let inputs = self.params.fx.node_in[slot];
        self.graph_in_l[..frames].fill(0.0);
        self.graph_in_r[..frames].fill(0.0);
        for input in inputs {
            if input.src == 0 || input.gain == 0.0 {
                continue;
            }
            if input.src == GRAPH_DRY {
                for i in 0..frames {
                    self.graph_in_l[i] += self.fx_l[i] * input.gain;
                    self.graph_in_r[i] += self.fx_r[i] * input.gain;
                }
                continue;
            }
            let from = input.src as usize - 2;
            // Reading this node or a later one would be a loop: the connection is
            // ignored, deterministically, rather than guessed at.
            if from >= slot || from >= FX_SLOTS {
                continue;
            }
            let base = from * MAX_BLOCK_SIZE;
            for i in 0..frames {
                self.graph_in_l[i] += self.graph_node_l[base + i] * input.gain;
                self.graph_in_r[i] += self.graph_node_r[base + i] * input.gain;
            }
        }
        let base = slot * MAX_BLOCK_SIZE;
        let (node_l, node_r) = (&mut self.graph_node_l, &mut self.graph_node_r);
        node_l[base..base + frames].copy_from_slice(&self.graph_in_l[..frames]);
        node_r[base..base + frames].copy_from_slice(&self.graph_in_r[..frames]);
    }

    /// Run one node's effect on its own buffer, in place. The blend law is the
    /// same one the chain uses: an insert crossfades, a send adds its wet signal
    /// to the untouched input.
    fn render_fx_node(&mut self, slot: usize, frames: usize) {
        let fx = self.params.fx;
        let kind = fx.chain[slot];
        let parallel = fx.parallel[slot];
        let base = slot * MAX_BLOCK_SIZE;
        match kind {
            FxKind::None => {}
            FxKind::Delay => {
                // One delay line exists, so only the first delay node in the
                // block drives it; a second passes its input through.
                if self.fx_delay_used {
                    return;
                }
                self.fx_delay_used = true;
                // Runs even when it is off (mix 0), so the line keeps moving and
                // switching it back on does not replay a stale tail.
                let params = DelayParams {
                    time_s: self.params.delay_time_seconds(),
                    feedback: fx.delay_fb,
                    mix: if fx.delay_on { fx.delay_mix } else { 0.0 },
                    damp: fx.delay_damp,
                    ping_pong: fx.delay_ping_pong,
                };
                self.delay.process(
                    params,
                    &mut self.graph_node_l[base..base + frames],
                    &mut self.graph_node_r[base..base + frames],
                    frames,
                );
            }
            FxKind::Reverb => {
                let mix = if fx.reverb_on { fx.reverb_mix } else { 0.0 };
                if fx.reverb_mode == 1 && self.convolver.has_ir() {
                    // Same rule as the delay: the imported response is one
                    // instance, so the first such node wins.
                    if self.fx_conv_used {
                        return;
                    }
                    self.fx_conv_used = true;
                    self.convolver.process(
                        &mut self.graph_node_l[base..base + frames],
                        &mut self.graph_node_r[base..base + frames],
                        frames,
                        mix * fx.conv_trim,
                    );
                } else {
                    self.reverbs[slot].set_params(ReverbParams {
                        size: if fx.reverb_on { fx.reverb_size } else { 0.0 },
                        damp: fx.reverb_damp,
                        mix,
                        width: fx.reverb_width,
                        predelay: fx.reverb_predelay,
                    });
                    self.reverbs[slot].process(
                        &mut self.graph_node_l[base..base + frames],
                        &mut self.graph_node_r[base..base + frames],
                    );
                }
            }
            FxKind::Chorus if fx.chorus_on && fx.chorus_mix > 0.0 => {
                unsafe {
                    gs_fx_chorus_set(slot as i32, fx.chorus_depth, fx.chorus_rate, 20.0, 0.25);
                    gs_fx_chorus_block(
                        slot as i32,
                        self.graph_node_l[base..].as_ptr(),
                        self.graph_node_r[base..].as_ptr(),
                        self.osc_a.as_mut_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                }
                self.blend_node(slot, frames, fx.chorus_mix, parallel);
            }
            FxKind::Flanger if fx.flanger_on && fx.flanger_mix > 0.0 => {
                unsafe {
                    gs_fx_flanger_set(slot as i32, 0.5, fx.flanger_rate, 2.0, fx.flanger_fb);
                    gs_fx_flanger_block(
                        slot as i32,
                        self.graph_node_l[base..].as_ptr(),
                        self.graph_node_r[base..].as_ptr(),
                        self.osc_a.as_mut_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                }
                self.blend_node(slot, frames, fx.flanger_mix, parallel);
            }
            FxKind::Phaser if fx.phaser_on && fx.phaser_mix > 0.0 => {
                unsafe {
                    gs_fx_phaser_set(slot as i32, 0.8, fx.phaser_rate, fx.phaser_fb, 4);
                    gs_fx_phaser_block(
                        slot as i32,
                        self.graph_node_l[base..].as_ptr(),
                        self.graph_node_r[base..].as_ptr(),
                        self.osc_a.as_mut_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                }
                self.blend_node(slot, frames, fx.phaser_mix, parallel);
            }
            FxKind::Drive if fx.drive_on && fx.drive_mix > 0.0 => {
                unsafe {
                    gs_fx_overdrive_set(slot as i32, fx.drive_amt);
                    gs_fx_overdrive_block(
                        slot as i32,
                        self.graph_node_l[base..].as_ptr(),
                        self.graph_node_r[base..].as_ptr(),
                        self.osc_a.as_mut_ptr(),
                        self.osc_b.as_mut_ptr(),
                        frames as u32,
                    );
                }
                self.blend_node(slot, frames, fx.drive_mix, parallel);
            }
            _ => {}
        }
    }

    /// Fold a node's wet signal (in `osc_a/osc_b`) into its own buffer.
    fn blend_node(&mut self, slot: usize, frames: usize, mix: f32, parallel: bool) {
        let dry = if parallel { 1.0 } else { 1.0 - mix };
        let base = slot * MAX_BLOCK_SIZE;
        for i in 0..frames {
            self.graph_node_l[base + i] =
                self.graph_node_l[base + i] * dry + self.osc_a[i] * mix;
            self.graph_node_r[base + i] =
                self.graph_node_r[base + i] * dry + self.osc_b[i] * mix;
        }
    }

    /// Fold an effect's wet signal into the bus.
    ///
    /// Serial (insert): `fx = dry*(1-mix) + wet*mix`.
    /// Parallel (send): `fx = dry + wet*mix` — the dry signal is left untouched,
    /// so the effect adds to the mix instead of replacing part of it.
    ///
    /// The wet signal arrives in `osc_a/osc_b` (free scratch buffers after the
    /// voice loop).
    fn mix_effect(&mut self, frames: usize, mix: f32, parallel: bool) {
        let dry = if parallel { 1.0 } else { 1.0 - mix };
        for i in 0..frames {
            self.fx_l[i] = self.fx_l[i] * dry + self.osc_a[i] * mix;
            self.fx_r[i] = self.fx_r[i] * dry + self.osc_b[i] * mix;
        }
    }
}

/// Render one oscillator block into `out` (block ABI, noise handled in Rust).
///
/// `pm` is the phase-modulation input: the modulator's samples and the index in
/// carrier cycles (P6.1). It applies to the oscillators that have a phase — the
/// band-limited shapes and the wavetable — and is ignored by noise and by the
/// sampler, which are not periodic in the same sense. Ring modulation is done
/// after this, on the two finished blocks, so it applies to every wave.
#[allow(clippy::too_many_arguments)]
fn render_oscillator(
    slot: usize,
    which: usize,
    params: OscParams,
    freq: f32,
    pw: f32,
    frames: usize,
    out: &mut [f32],
    pm: Option<(&[f32], f32)>,
    rng: &mut Rng,
    noise: &mut NoiseGen,
    tables: &[crate::dsp::wavetable::Table],
    user_table: Option<&Table>,
    use_user_table: bool,
    wt_phase: &mut f32,
    sub_phase: &mut f32,
    sample: &Sample,
    sample_state: &mut ReadState,
    sampler: SampleParams,
    sample_rate: f32,
    scratch: &mut [f32],
) {
    render_wave(slot, which, params, freq, pw, frames, out, pm, rng, noise, tables, user_table,
        use_user_table, wt_phase, sample, sample_state, sampler, sample_rate, scratch);
    // The sub oscillator (P6.2) is one sine at the nominal pitch — not one per
    // unison voice: detuning a sub just muddies the bottom, and a single low
    // sine is what "sub" means. It rides the oscillator's own level, so fading
    // the oscillator out fades its sub with it.
    add_sub(out, freq, sample_rate, params.sub, params.sub_level, sub_phase);
}

/// Add the sub oscillator (P6.2) to a rendered block.
///
/// One sine at one or two octaves below the oscillator's nominal pitch. A sine
/// has no harmonics to alias and needs no filter, and a sub that is detuned with
/// the unison stack would only muddy the bottom — so it is one per oscillator,
/// not one per unison voice. It rides the oscillator's own level.
fn add_sub(out: &mut [f32], freq: f32, sample_rate: f32, octaves: u32, level: f32, phase: &mut f32) {
    let octaves = octaves.min(2);
    if octaves == 0 || !(level > 0.0) {
        return;
    }
    let step = freq / (1u32 << octaves) as f32 / sample_rate;
    let level = level.clamp(0.0, 1.0);
    let mut p = *phase;
    for value in out.iter_mut() {
        *value += (p * core::f32::consts::TAU).sin() * level;
        p += step;
        if p >= 1.0 {
            p -= 1.0;
        }
    }
    *phase = p;
}

#[allow(clippy::too_many_arguments)]
fn render_wave(
    slot: usize,
    which: usize,
    params: OscParams,
    freq: f32,
    pw: f32,
    frames: usize,
    out: &mut [f32],
    pm: Option<(&[f32], f32)>,
    rng: &mut Rng,
    noise: &mut NoiseGen,
    tables: &[crate::dsp::wavetable::Table],
    user_table: Option<&Table>,
    use_user_table: bool,
    wt_phase: &mut f32,
    sample: &Sample,
    sample_state: &mut ReadState,
    sampler: SampleParams,
    sample_rate: f32,
    scratch: &mut [f32],
) {
    match params.wave.daisy_id() {
        Some(daisy_wave) => unsafe {
            let unison = (params.unison.max(1) as usize).min(MAX_UNISON as usize);
            if unison == 1 {
                gs_voice_osc_set(slot as i32, which as i32, 0, daisy_wave, freq, 1.0, pw);
                match pm {
                    Some((modulator, cycles)) => gs_voice_osc_pm_block(
                        slot as i32,
                        which as i32,
                        0,
                        modulator.as_ptr(),
                        cycles,
                        out.as_mut_ptr(),
                        frames as u32,
                    ),
                    None => {
                        gs_voice_osc_block(slot as i32, which as i32, 0, out.as_mut_ptr(), frames as u32)
                    }
                }
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
                match pm {
                    Some((modulator, cycles)) => gs_voice_osc_pm_block(
                        slot as i32,
                        which as i32,
                        sub as i32,
                        modulator.as_ptr(),
                        cycles,
                        scratch.as_mut_ptr(),
                        frames as u32,
                    ),
                    None => gs_voice_osc_block(
                        slot as i32,
                        which as i32,
                        sub as i32,
                        scratch.as_mut_ptr(),
                        frames as u32,
                    ),
                }
                for i in 0..frames {
                    out[i] += scratch[i] * gain;
                }
            }
        },
        None => {
            // Noise. White has no state; pink and brown are filtered, and the
            // filters live per voice so a stolen voice cannot inherit a tail
            // from the note that was using the slot.
            if params.wave == crate::params::Wave::Wavetable && !tables.is_empty() {
                // The pulse-width control picks the recipe: 0.05..0.95 maps onto
                // the five banks, so one knob covers "which table" without a new
                // parameter and without a new UI control. An imported cycle is
                // its own bank and is chosen by its own switch instead, so the
                // factory mapping keeps meaning exactly what it meant before.
                let recipe = ((pw.clamp(0.0, 1.0) * 4.0).round() as usize)
                    .min(crate::dsp::wavetable::RECIPES.len() - 1);
                let table = match (use_user_table, user_table) {
                    (true, Some(imported)) => imported,
                    _ => &tables[recipe],
                };
                let level = table.level_for(freq, sample_rate);
                let step = freq / sample_rate;
                let mut phase = *wt_phase;
                for (i, sample) in out.iter_mut().enumerate() {
                    // The offset is added to the read phase only: the oscillator
                    // keeps running at its own frequency, so a deep index cannot
                    // pull it out of tune or out of the table.
                    let read = match pm {
                        Some((modulator, cycles)) => (phase + modulator[i] * cycles).rem_euclid(1.0),
                        None => phase,
                    };
                    *sample = table.sample(level, read);
                    phase += step;
                    if phase >= 1.0 {
                        phase -= 1.0;
                    }
                }
                *wt_phase = phase;
                return;
            }
            if params.wave == crate::params::Wave::Sample {
                // An imported sample, played at this note's rate. With nothing
                // imported there is nothing to play: silence is the honest
                // answer, and the UI is where the player finds out why.
                if !sample.is_loaded() {
                    out.fill(0.0);
                    return;
                }
                let root = sampler.root_hz.max(1.0);
                let rate = (freq / root).clamp(0.01, 64.0);
                let level = sample.level_for(rate);
                let step = rate / (1usize << level) as f32;
                sample.render(level, out, step, &sampler, sample_state);
                return;
            }
            let colour = match params.wave {
                crate::params::Wave::Pink => crate::dsp::noise::NoiseColour::Pink,
                crate::params::Wave::Brown => crate::dsp::noise::NoiseColour::Brown,
                _ => crate::dsp::noise::NoiseColour::White,
            };
            noise.set_colour(colour);
            for sample in out.iter_mut() {
                let white = rng.next_bipolar() * 0.5;
                *sample = noise.process(white, sample_rate);
            }
        }
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Oversampling factor of the hard-sync pair, matching `GS_SYNC_OS` in the C
/// bridge: the oscillators run this many times faster and the block decimates
/// through a half-band filter, because the sync reset is a discontinuity.
const SYNC_OVERSAMPLE: usize = 2;

/// Full-scale phase-modulation index, in carrier cycles (P6.1). Two cycles is a
/// bright, clangorous FM tone with sidebands well past the twentieth harmonic,
/// and the squared curve below keeps the bottom of the knob's travel usable for
/// the subtle end.
const FM_MAX_CYCLES: f32 = 2.0;

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

    /// Render a note through the engine and collect every sample it produced,
    /// so two routings can be compared exactly.
    fn render_all(e: &mut Engine, note: u8, blocks: usize) -> (Vec<f32>, Vec<f32>) {
        e.note_on(note, 0.9);
        let mut left = Vec::new();
        let mut right = Vec::new();
        for _ in 0..blocks {
            e.process(128);
            left.extend_from_slice(e.left());
            right.extend_from_slice(e.right());
        }
        (left, right)
    }

    fn worst_difference(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x - y).abs())
            .fold(0.0f32, f32::max)
    }

    /// The engine and the C bridge have to agree on how many effect instances
    /// exist, or a node would read another node's state.
    #[test]
    fn the_bridge_has_one_effect_state_per_slot() {
        // Both sides of the boundary, because a mismatch would have one node
        // read another node's state.
        assert_eq!(unsafe { gs_fx_slots() } as usize, FX_SLOTS);
        assert_eq!(crate::abi::gs_fx_slot_count() as usize, FX_SLOTS);
    }

    /// Two nodes running the same effect keep their own state: with one shared
    /// instance the second `set` would overwrite the first and both outputs
    /// would be identical.
    #[test]
    fn two_nodes_of_the_same_effect_do_not_share_state() {
        let _guard = lock_engine();
        // Node 1 only, node 2 only, then both. With a state per node the pair is
        // the sum of the two; sharing one instance (what the engine did before
        // the graph had per-node effects) makes the second node drive the first
        // one's delay line and the sum no longer holds.
        let build = |node1: bool, node2: bool| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            // Stay below the lookahead limiter: this is about state, and a
            // limiter is a nonlinearity.
            e.set_param(id::MASTER_VOLUME, 0.1);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            e.set_param(id::FX_CHORUS_ON, 1.0);
            e.set_param(id::FX_CHORUS_MIX, 1.0);
            for (index, on) in [node1, node2].into_iter().enumerate() {
                if !on {
                    continue;
                }
                e.set_param(id::FX_CHAIN1 + index as u32, 3.0);
                set_graph_input(&mut e, index, 0, GRAPH_DRY, 1.0);
                route_node(&mut e, index, 1.0);
            }
            render_all(&mut e, 60, 20)
        };

        let only_one = build(true, false).0;
        let only_two = build(false, true).0;
        let both = build(true, true).0;
        assert!(both.iter().any(|v| v.abs() > 0.01), "nothing rendered");
        let worst = both
            .iter()
            .zip(only_one.iter().zip(only_two.iter()))
            .map(|(pair, (one, two))| (pair - (one + two)).abs())
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-4, "the two chorus nodes did not sum: worst {worst}");
    }

    /// Two reverb nodes keep their own tails, on the same reasoning as the
    /// chorus above. The algorithmic reverb is the one effect where two
    /// instances are musically interesting (two rooms in parallel).
    #[test]
    fn two_reverb_nodes_do_not_share_state() {
        let _guard = lock_engine();
        let build = |node1: bool, node2: bool| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::MASTER_VOLUME, 0.1);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            e.set_param(id::FX_REVERB_ON, 1.0);
            e.set_param(id::FX_REVERB_MIX, 1.0);
            e.set_param(id::FX_REVERB_SIZE, 0.8);
            // No imported response: that engine is a single instance.
            e.set_param(id::FX_REVERB_MODE, 0.0);
            for (index, on) in [node1, node2].into_iter().enumerate() {
                if !on {
                    continue;
                }
                e.set_param(id::FX_CHAIN1 + index as u32, 2.0);
                set_graph_input(&mut e, index, 0, GRAPH_DRY, 1.0);
                route_node(&mut e, index, 1.0);
            }
            render_all(&mut e, 60, 120)
        };
        let only_one = build(true, false).0;
        let only_two = build(false, true).0;
        let both = build(true, true).0;
        // A reverb tail builds up slowly; give it a third of a second and just
        // check that there is something to compare.
        assert!(
            both.iter().any(|v| v.abs() > 1e-4),
            "nothing rendered: peak {}",
            both.iter().fold(0.0f32, |m, v| m.max(v.abs()))
        );
        let worst = both
            .iter()
            .zip(only_one.iter().zip(only_two.iter()))
            .map(|(pair, (one, two))| (pair - (one + two)).abs())
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-4, "the two reverb nodes did not sum: worst {worst}");
    }

    /// The delay line and the convolver are single instances (their memory does
    /// not fit six times over), so a second node of those kinds passes its input
    /// through rather than sharing a line with the first: the sound must not
    /// change, and nothing may blow up.
    #[test]
    fn duplicate_delay_and_ir_nodes_pass_through() {
        let _guard = lock_engine();
        // Node 1 is a delay either way; node 2 is an empty position (which is a
        // pass-through) or a second delay node. Both reach the output, so with
        // the rule the two runs are identical: the duplicate passes its input
        // through instead of driving the same delay line a second time.
        let build = |duplicate: bool| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::MASTER_VOLUME, 0.1);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            e.set_param(id::FX_DELAY_ON, 1.0);
            e.set_param(id::FX_DELAY_MIX, 0.5);
            e.set_param(id::FX_DELAY_FB, 0.3);
            e.set_param(id::FX_CHAIN1, 1.0);
            set_graph_input(&mut e, 0, 0, GRAPH_DRY, 1.0);
            route_node(&mut e, 0, 1.0);
            e.set_param(id::FX_CHAIN2, if duplicate { 1.0 } else { 0.0 });
            set_graph_input(&mut e, 1, 0, GRAPH_DRY, 1.0);
            route_node(&mut e, 1, 1.0);
            render_all(&mut e, 60, 25)
        };
        let pass_through = build(false);
        let with_duplicate = build(true);
        assert!(
            pass_through.0.iter().any(|v| v.abs() > 0.01),
            "nothing rendered: peak {}",
            pass_through.0.iter().fold(0.0f32, |m, v| m.max(v.abs()))
        );
        assert!(
            with_duplicate.0.iter().chain(with_duplicate.1.iter()).all(|v| v.is_finite()),
            "a duplicate delay node produced a non-finite sample"
        );
        let worst = pass_through
            .0
            .iter()
            .zip(with_duplicate.0.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(worst < 1e-4, "the duplicate changed the sound by {worst}");
    }

    /// A patch with every effect switched on and a given chain, so the graph and
    /// the legacy path can be compared on the same signal.
    fn fx_test_engine(chain: [FxKind; FX_SLOTS], parallel: &[usize]) -> Box<Engine> {
        let mut e = new_engine(8);
        e.set_param(id::OSC1_WAVE, 2.0);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::FILTER_CUTOFF, 16000.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.002);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::LFO2_ON, 0.0);
        e.set_param(id::FX_REVERB_ON, 1.0);
        e.set_param(id::FX_REVERB_MIX, 0.3);
        e.set_param(id::FX_DELAY_ON, 1.0);
        e.set_param(id::FX_DELAY_MIX, 0.25);
        e.set_param(id::FX_DELAY_FB, 0.4);
        e.set_param(id::FX_CHORUS_ON, 1.0);
        e.set_param(id::FX_CHORUS_MIX, 0.5);
        e.set_param(id::FX_FLANGER_ON, 1.0);
        e.set_param(id::FX_FLANGER_MIX, 0.4);
        e.set_param(id::FX_PHASER_ON, 1.0);
        e.set_param(id::FX_PHASER_MIX, 0.4);
        e.set_param(id::FX_DRIVE_ON, 1.0);
        e.set_param(id::FX_DRIVE_MIX, 0.5);
        let kinds = [0u32, 1, 2, 3, 4, 5, 6];
        for (slot, kind) in chain.iter().enumerate() {
            let code = match kind {
                FxKind::None => kinds[0],
                FxKind::Delay => kinds[1],
                FxKind::Reverb => kinds[2],
                FxKind::Chorus => kinds[3],
                FxKind::Flanger => kinds[4],
                FxKind::Phaser => kinds[5],
                FxKind::Drive => kinds[6],
            };
            e.set_param(id::FX_CHAIN1 + slot as u32, code as f32);
        }
        for slot in parallel {
            e.set_param(id::FX_PARALLEL1 + *slot as u32, 1.0);
        }
        e
    }

    fn set_graph_input(e: &mut Engine, slot: usize, which: usize, src: u8, gain: f32) {
        let base = if which == 0 { id::FX_NODE_IN1 } else { id::FX_NODE_IN2 };
        let gain_base = if which == 0 { id::FX_NODE_IN1_GAIN } else { id::FX_NODE_IN2_GAIN };
        e.set_param(base + slot as u32, src as f32);
        e.set_param(gain_base + slot as u32, gain);
    }

    /// Clear every default output connection, so a test states the routes it
    /// means instead of inheriting the serial default.
    fn clear_node_routes(e: &mut Engine) {
        for slot in 0..FX_SLOTS {
            e.set_param(id::FX_NODE_TO_OUT + slot as u32, 0.0);
        }
    }

    fn route_node(e: &mut Engine, slot: usize, gain: f32) {
        e.set_param(id::FX_NODE_TO_OUT + slot as u32, 1.0);
        e.set_param(id::FX_NODE_OUT_GAIN + slot as u32, gain);
    }

    /// The graph and the chain have to be the same signal: switching the graph
    /// on after `fx_graph_from_chain` may not change one sample, for every shape
    /// the chain can take (effects off, empty positions, sends).
    #[test]
    fn the_graph_reproduces_the_legacy_chain_exactly() {
        let _guard = lock_engine();
        let cases: [([FxKind; FX_SLOTS], &[usize]); 6] = [
            ([FxKind::None; FX_SLOTS], &[]),
            (
                [
                    FxKind::Delay,
                    FxKind::Reverb,
                    FxKind::Chorus,
                    FxKind::Flanger,
                    FxKind::Phaser,
                    FxKind::Drive,
                ],
                &[],
            ),
            ([FxKind::Reverb, FxKind::None, FxKind::None, FxKind::None, FxKind::None, FxKind::None], &[]),
            ([FxKind::None, FxKind::None, FxKind::None, FxKind::None, FxKind::None, FxKind::Drive], &[]),
            ([FxKind::Chorus, FxKind::None, FxKind::Drive, FxKind::None, FxKind::Reverb, FxKind::None], &[0, 2]),
            ([FxKind::Drive, FxKind::Chorus, FxKind::None, FxKind::Phaser, FxKind::None, FxKind::Delay], &[1, 3]),
        ];
        for (index, (chain, parallel)) in cases.iter().enumerate() {
            let mut legacy = fx_test_engine(*chain, parallel);
            let (ll, lr) = render_all(&mut legacy, 60, 30);

            let mut graph = fx_test_engine(*chain, parallel);
            graph.fx_graph_from_chain();
            let (gl, gr) = render_all(&mut graph, 60, 30);

            assert!(ll.iter().any(|v| v.abs() > 0.01), "case {index}: nothing rendered");
            assert_eq!(
                worst_difference(&ll, &gl),
                0.0,
                "case {index}: the graph changed the left channel"
            );
            assert_eq!(worst_difference(&lr, &gr), 0.0, "case {index}: right channel");
        }
    }

    /// Two inputs are summed with their own gains, which is what makes a graph a
    /// graph rather than a chain.
    #[test]
    fn node_inputs_are_summed_with_their_gains() {
        let _guard = lock_engine();
        let render = |a: f32, b: Option<f32>| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            set_graph_input(&mut e, 0, 0, GRAPH_DRY, a);
            if let Some(b) = b {
                set_graph_input(&mut e, 0, 1, GRAPH_DRY, b);
            }
            route_node(&mut e, 0, 1.0);
            let (l, _) = render_all(&mut e, 60, 12);
            l
        };
        // 0.5 + 0.25 of the same signal is 0.75 of it, sample for sample.
        let summed = render(0.5, Some(0.25));
        let scaled = render(0.75, None);
        assert!(summed.iter().any(|v| v.abs() > 0.01));
        assert_eq!(worst_difference(&summed, &scaled), 0.0);
    }

    /// One node feeding two others that both reach the output is a fan-out: the
    /// mix bus is the sum of what is routed to it.
    #[test]
    fn a_node_can_feed_two_paths_that_sum_at_the_output() {
        let _guard = lock_engine();
        let render = |a: f32, b: f32| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            // Node 1 reads the dry bus; it feeds nodes 2 and 3, both to output.
            set_graph_input(&mut e, 0, 0, GRAPH_DRY, 1.0);
            set_graph_input(&mut e, 1, 0, graph_node_src(0), 1.0);
            set_graph_input(&mut e, 2, 0, graph_node_src(0), 1.0);
            route_node(&mut e, 1, a);
            route_node(&mut e, 2, b);
            let (l, _) = render_all(&mut e, 60, 12);
            l
        };
        // dry * 1 + dry * 0.5 == dry * 1.5, which one path with that gain gives.
        let split = render(1.0, 0.5);
        assert!(split.iter().any(|v| v.abs() > 0.01));
        let single = {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            set_graph_input(&mut e, 0, 0, GRAPH_DRY, 1.0);
            route_node(&mut e, 0, 1.5);
            let (l, _) = render_all(&mut e, 60, 12);
            l
        };
        assert_eq!(worst_difference(&split, &single), 0.0);
    }

    /// A connection that would point at this node or a later one is a loop, so
    /// it is ignored: the order stays fixed and nothing blows up.
    #[test]
    fn a_backward_connection_is_ignored() {
        let _guard = lock_engine();
        for src in [graph_node_src(0), graph_node_src(2), graph_node_src(5)] {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            set_graph_input(&mut e, 0, 0, src, 1.0);
            route_node(&mut e, 0, 1.0);
            let (l, r) = render_all(&mut e, 60, 12);
            assert!(
                l.iter().chain(r.iter()).all(|v| *v == 0.0),
                "a loop input should carry nothing"
            );
        }
    }

    /// Nothing routed to the output is silence, not a stuck or NaN bus.
    #[test]
    fn an_empty_graph_is_silent_rather_than_unstable() {
        let _guard = lock_engine();
        let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
        e.set_param(id::FX_GRAPH, 1.0);
        clear_node_routes(&mut e);
        // Node 1 runs but nothing reaches the output.
        set_graph_input(&mut e, 0, 0, GRAPH_DRY, 1.0);
        let (l, r) = render_all(&mut e, 60, 12);
        assert!(l.iter().chain(r.iter()).all(|v| v.is_finite()));
        assert!(l.iter().chain(r.iter()).all(|v| v.abs() < 1e-6));
    }

    /// Gains are clamped like every other parameter, so a wild value cannot
    /// blow the bus up.
    #[test]
    fn node_gains_are_clamped() {
        let _guard = lock_engine();
        let render = |gain: f32| {
            let mut e = fx_test_engine([FxKind::None; FX_SLOTS], &[]);
            e.set_param(id::FX_GRAPH, 1.0);
            clear_node_routes(&mut e);
            set_graph_input(&mut e, 0, 0, GRAPH_DRY, gain);
            route_node(&mut e, 0, 1.0);
            let (l, _) = render_all(&mut e, 60, 12);
            l
        };
        let clamped = render(4.0);
        assert_eq!(worst_difference(&render(1000.0), &clamped), 0.0);
        assert!(clamped.iter().all(|v| v.is_finite()));
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
        for _ in 0..200 {
            e.process(128);
        }
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

    /// A song layer's pan is per voice, so two layers of one song can sit in
    /// different places at the same time — and it rides on top of the patch's
    /// own position rather than replacing it.
    #[test]
    fn per_voice_pan_places_layers_in_the_image() {
        let _guard = lock_engine();
        let mut e = new_engine(2);
        e.set_param(id::OSC1_WAVE, 2.0);
        e.set_param(id::OSC1_LEVEL, 1.0);
        e.set_param(id::OSC2_ON, 0.0);
        let energy = |e: &mut Engine, blocks: usize| {
            for _ in 0..blocks {
                e.process(128);
            }
            let rms = |samples: &[f32]| {
                (samples.iter().map(|v| (v * v) as f64).sum::<f64>() / samples.len() as f64).sqrt()
                    as f32
            };
            let l = rms(&e.left()[..128]);
            let r = rms(&e.right()[..128]);
            (l, r)
        };

        // Two voices of the same patch, played at opposite ends of the image.
        e.note_on_pan(60, 1.0, -0.9);
        e.note_on_pan(67, 1.0, 0.9);
        let (l, r) = energy(&mut e, 60);
        assert!((l / r.max(1e-6)) < 1.4 && (l / r.max(1e-6)) > 0.7, "a symmetric pair should balance: L={l} R={r}");

        // One voice on its own, hard left: the layer's position is what decides.
        e.all_notes_off();
        e.process(128);
        e.note_on_pan(60, 1.0, -0.9);
        let (l, r) = energy(&mut e, 60);
        assert!(l > r * 4.0, "expected the layer on the left, L={l} R={r}");

        // The patch's own pan still applies: a hard-right patch with a centred
        // voice is on the right, and a hard-left layer moves it back.
        e.all_notes_off();
        e.process(128);
        e.set_param(id::OSC1_PAN, 1.0);
        e.note_on_pan(60, 1.0, 0.0);
        let (l, r) = energy(&mut e, 60);
        assert!(r > l * 4.0, "the patch's pan was lost: L={l} R={r}");
        e.note_on_pan(72, 1.0, -1.0);
        let (l2, r2) = energy(&mut e, 60);
        assert!(
            l2 / r2.max(1e-6) > l / r.max(1e-6),
            "the layer's pan did not pull the voice left: {l2} vs {r2}"
        );

        // Out of range positions are clamped rather than trusted.
        e.all_notes_off();
        e.process(128);
        e.set_param(id::OSC1_PAN, 0.0);
        e.note_on_pan(60, 1.0, 99.0);
        let (l, r) = energy(&mut e, 60);
        assert!(r > l * 4.0, "pan was not clamped: L={l} R={r}");
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

    /// Measured magnitude of one morph position at one sine frequency, with
    /// every other block of the voice patched out so the number is the filter
    /// and nothing else (P6.3a).
    ///
    /// The tone is played by *pitch*, so it is limited to the oscillator's own
    /// range: `OSC1_PITCH` clamps at ±48 semitones around C4, about 16 Hz to
    /// 4.2 kHz. Asking for more does not fail loudly — the pitch clamps and the
    /// measurement silently becomes one of a different frequency, which is how
    /// a first version of these tests reported the oscillator's ceiling as a
    /// filter bug. The grids below stay inside that range.
    fn sem_magnitude(freq: f32, cutoff: f32, res: f32, morph: f32) -> f32 {
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        // C4 is 261.63 Hz, so this pitch offset puts the played note at `freq`.
        let pitch = 12.0 * (freq / 261.6256).log2();
        assert!(pitch.abs() <= 48.0, "test frequency {freq} Hz is outside the oscillator's range");
        e.set_param(id::OSC1_PITCH, pitch);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_TYPE, crate::params::FilterType::Sem as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, cutoff);
        e.set_param(id::FILTER_RES, res);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_MORPH, morph);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::FILTER_KBD, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::LFO2_ON, 0.0);
        e.set_param(id::NOISE_MIX, 0.0);
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
        bin_mag(&buf, freq, 48_000.0)
    }

    /// The morph has to be exactly the weighted sum of the four taps.
    ///
    /// The taps are rendered from the engine itself — which the test above ties
    /// to the discrete band, high and notch responses — and combined here with
    /// the weights the ramp prescribes. That is a stronger statement than a
    /// curve that is "close to" a prototype: a wrong weight, a wrong segment or
    /// a swapped tap changes the samples, and nothing in the comparison shares
    /// code with the C bridge that does the mixing.
    #[test]
    fn sem_mix_is_the_weighted_sum_of_its_taps() {
        let _guard = lock_engine();
        let render = |morph: f32| -> Vec<f32> {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, crate::params::FilterType::Sem as u32 as f32);
            e.set_param(id::FILTER_MORPH, morph);
            e.set_param(id::FILTER_CUTOFF, 900.0);
            e.set_param(id::FILTER_RES, 0.5);
            e.set_param(id::FILTER_DRIVE, 0.0);
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
            for _ in 0..40 {
                e.process(128);
            }
            let mut buf = vec![0.0f32; 4096];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            buf
        };
        let low = render(0.0);
        let band = render(1.0 / 3.0);
        let high = render(1.0);
        // The exact expressions the C bridge uses, in the same order, so a
        // match is bit-for-bit and not merely close.
        let expected = |morph: f32| -> Vec<f32> {
            (0..low.len())
                .map(|i| {
                    let l = low[i];
                    let b = band[i];
                    let h = high[i];
                    if morph <= 0.0 {
                        l
                    } else if morph >= 1.0 {
                        h
                    } else if morph <= 1.0 / 3.0 {
                        let t = 3.0 * morph;
                        (1.0 - t) * l + t * b
                    } else if morph <= 2.0 / 3.0 {
                        let t = 3.0 * morph - 1.0;
                        (1.0 - t) * b + t * (l + h)
                    } else {
                        let t = 3.0 * morph - 2.0;
                        (1.0 - t) * (l + h) + t * h
                    }
                })
                .collect()
        };
        for morph in [0.0f32, 1.0 / 6.0, 1.0 / 3.0, 0.45, 0.55, 2.0 / 3.0, 5.0 / 6.0, 1.0] {
            let actual = render(morph);
            let want = expected(morph);
            let worst = actual
                .iter()
                .zip(&want)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0f32, f32::max);
            assert!(
                worst < 1e-6,
                "morph {morph:.4}: the render is not the weighted sum of the taps (worst {worst:e})"
            );
        }
    }

    /// The endpoints have to be the slopes a 12 dB/oct multimode promises: the
    /// low-pass falls and the high-pass rises by 12 dB per octave, measured on
    /// the rendered signal with the tone's own level divided out.
    #[test]
    fn sem_endpoints_have_twelve_db_per_octave_slopes() {
        let _guard = lock_engine();
        let cutoff = 400.0f32;
        let res = 0.25f32;
        // A cutoff four octaves up is flat across this grid, so it cancels the
        // oscillator's level without colouring the measurement.
        let reference = |freq: f32| sem_magnitude(freq, 6400.0, 0.0, 0.0) as f64;
        let response = |freq: f32, morph: f32| -> f64 {
            (sem_magnitude(freq, cutoff, res, morph) as f64) / reference(freq)
        };
        let octave_pair = [200.0f32, 800.0]; // two octaves, straddling the cutoff
        let low_slope = 20.0 * (response(octave_pair[1], 0.0) / response(octave_pair[0], 0.0)).log10();
        let high_slope = 20.0 * (response(octave_pair[1], 1.0) / response(octave_pair[0], 1.0)).log10();
        assert!(
            (low_slope + 12.0).abs() < 2.5,
            "the low-pass end falls {low_slope:.2} dB over two octaves, not -12"
        );
        assert!(
            (high_slope - 12.0).abs() < 2.5,
            "the high-pass end rises {high_slope:.2} dB over two octaves, not +12"
        );
        // And they are opposite ends of one knob, not two filters.
        assert!(
            response(cutoff / 4.0, 0.0) > response(cutoff / 4.0, 1.0) * 4.0,
            "the low end does not pass what the high end rejects"
        );
    }

    /// At the four canonical morph points the `sem` path has to reproduce the
    /// discrete SVF responses — the band and high taps bit for bit, the notch
    /// to rounding. The low end has no discrete twin to compare against: the
    /// discrete `lp` is a 24 dB/oct Moog ladder, deliberately a *different*
    /// filter from the 12 dB/oct SVF tap `sem` starts at.
    #[test]
    fn sem_canonical_points_are_the_discrete_responses() {
        let _guard = lock_engine();
        let render = |kind: f32, morph: f32| -> Vec<f32> {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, kind);
            e.set_param(id::FILTER_MORPH, morph);
            e.set_param(id::FILTER_CUTOFF, 1200.0);
            e.set_param(id::FILTER_RES, 0.45);
            e.set_param(id::FILTER_DRIVE, 0.0);
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
            for _ in 0..40 {
                e.process(128);
            }
            let mut buf = vec![0.0f32; 4096];
            for chunk in buf.chunks_mut(128) {
                e.process(128);
                chunk.copy_from_slice(&e.out_l[..chunk.len()]);
            }
            buf
        };
        // Sample for sample, not merely close. The band and high points are
        // exact single taps of the same SVF, so those two must be *bit*
        // identical to the discrete types; the notch is the same transfer
        // function derived from `notch_` rather than `band_`, so it agrees to
        // rounding.
        let worst_difference = |a: &[f32], b: &[f32]| -> f32 {
            a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0.0f32, f32::max)
        };
        let sem = |morph: f32| render(crate::params::FilterType::Sem as u32 as f32, morph);
        let band = sem(1.0 / 3.0);
        let notch = sem(2.0 / 3.0);
        let high = sem(1.0);
        let low = sem(0.0);

        let d_band = worst_difference(&band, &render(2.0, 0.0));
        assert!(
            d_band == 0.0,
            "sem at morph 1/3 is not the discrete BP response: worst {d_band:e}"
        );
        let peak = low.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(1e-6);
        let d_notch = worst_difference(&notch, &render(3.0, 0.0));
        assert!(
            d_notch / peak < 1e-4,
            "sem at morph 2/3 is not the discrete notch response: worst {d_notch:e} ({:.1e} relative)",
            d_notch / peak
        );
        let d_high = worst_difference(&high, &render(1.0, 0.0));
        assert!(
            d_high == 0.0,
            "sem at morph 1 is not the discrete HP response: worst {d_high:e}"
        );
        // The four points have to actually differ, or the checks above would
        // pass for a filter that ignores the morph entirely.
        for (name, a, b) in [
            ("low/band", &low, &band),
            ("band/notch", &band, &notch),
            ("notch/high", &notch, &high),
        ] {
            let span = worst_difference(a, b);
            assert!(span > 1e-3, "{name} render the same thing (worst {span:e})");
        }
    }

    /// The notch position is the one morph point a two-line LP→BP→HP mix can
    /// never reach, so it is asserted on its own: a deep minimum at the cutoff
    /// with both ends still at 0 dB.
    #[test]
    fn sem_notch_position_is_a_notch_at_the_cutoff() {
        let _guard = lock_engine();
        let res = 0.3f32;
        // The oscillator's pitch clamps at ±48 semitones (about 4.2 kHz), so
        // both ends of the check stay inside that: a wider sweep would panic in
        // `sem_magnitude` rather than measure a filter.
        for cutoff in [300.0f32, 700.0, 1000.0] {
            let low = sem_magnitude(cutoff / 4.0, cutoff, res, 2.0 / 3.0);
            let high = sem_magnitude(cutoff * 3.0, cutoff, res, 2.0 / 3.0);
            // The notch is an exact zero in the analog prototype, so in the
            // digital filter it sits a little below the nominal cutoff (the
            // bilinear map's warping). Straddle it rather than assuming it
            // lands on the knob value.
            let mut dip = (0.0f32, f32::INFINITY);
            let mut f = cutoff * 0.7;
            while f <= cutoff * 1.3 {
                let m = sem_magnitude(f, cutoff, res, 2.0 / 3.0);
                if m < dip.1 {
                    dip = (f, m);
                }
                f *= 1.01;
            }
            let (dip_f, dip_m) = dip;
            let depth = 20.0 * (dip_m / low.max(1e-12)).log10();
            assert!(
                depth < -40.0,
                "cutoff {cutoff}: the notch position is not a notch — deepest point {dip_f:.0} Hz \
                 is only {depth:.1} dB below the low end (low {low:.6}, dip {dip_m:.6}, high {high:.6})"
            );
            // 0 dB at both ends is what makes it a notch rather than a
            // band-pass with a hole: a 12 dB band-pass would be ~18 dB down
            // eight times below its centre.
            let tilt = 20.0 * (high / low.max(1e-12)).log10();
            assert!(
                tilt.abs() < 3.0,
                "cutoff {cutoff}: notch ends are {tilt:.1} dB apart (low {low:.6}, high {high:.6})"
            );
        }
    }

    #[test]
    fn sem_centre_frequency_follows_the_cutoff_knob() {
        let _guard = lock_engine();
        let res = 0.4f32;
        // At the band position the response *peaks* at the cutoff, and the peak
        // has to travel with the knob. Two octaves either side is roughly 12 dB
        // down at Q = 2, which is far more than the margin asserted here.
        for cutoff in [300.0f32, 700.0, 1200.0] {
            let at = sem_magnitude(cutoff, cutoff, res, 1.0 / 3.0);
            let below = sem_magnitude(cutoff * 0.25, cutoff, res, 1.0 / 3.0);
            let above = sem_magnitude(cutoff * 2.0, cutoff, res, 1.0 / 3.0);
            assert!(
                at > below * 3.0 && at > above * 3.0,
                "cutoff {cutoff}: band peak should sit at the cutoff, got \
                 {below:.6} / {at:.6} / {above:.6}"
            );
        }
        // …and the LP/HP endpoints must attenuate on the side they always did:
        // 12 dB/oct means two octaves out is about 24 dB down. The cutoff stays
        // put across the comparison so the two numbers share one input gain.
        for cutoff in [300.0f32, 700.0, 1200.0] {
            let lp_low = sem_magnitude(cutoff * 0.25, cutoff, res, 0.0);
            let lp_high = sem_magnitude(cutoff * 2.0, cutoff, res, 0.0);
            assert!(
                lp_low > lp_high * 3.0,
                "cutoff {cutoff}: LP endpoint did not roll off ({lp_low:.6} vs {lp_high:.6})"
            );
            let hp_low = sem_magnitude(cutoff * 0.25, cutoff, res, 1.0);
            let hp_high = sem_magnitude(cutoff * 2.0, cutoff, res, 1.0);
            assert!(
                hp_high > hp_low * 3.0,
                "cutoff {cutoff}: HP endpoint did not roll off ({hp_low:.6} vs {hp_high:.6})"
            );
        }
    }

    /// The morph is a knob, not a switch: moving it while a note sounds must
    /// not click. A zipper or an unstable mix shows up as a sample step far
    /// above what the signal itself can produce.
    #[test]
    fn sem_morph_step_is_click_free() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_TYPE, crate::params::FilterType::Sem as u32 as f32);
        e.set_param(id::FILTER_CUTOFF, 800.0);
        e.set_param(id::FILTER_RES, 0.5);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::FILTER_KBD, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::LFO2_ON, 0.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(45, 1.0);
        for _ in 0..120 {
            e.process(128);
        }
        // Slam the knob end to end every block. The smoother's 20 ms time
        // constant is what has to absorb it; without that this is a square
        // wave on the filter's numerator.
        let mut out = Vec::new();
        for block in 0..240 {
            e.set_param(id::FILTER_MORPH, if (block / 8) % 2 == 0 { 0.0 } else { 1.0 });
            e.set_param(id::FILTER_CUTOFF, if (block / 12) % 2 == 0 { 300.0 } else { 6000.0 });
            e.process(128);
            out.extend_from_slice(e.left());
        }
        assert!(out.iter().all(|v| v.is_finite()), "the morph sweep produced a non-finite sample");
        let peak = out.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak < 1.0, "the morph sweep ran away: peak {peak}");
        let worst = out
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f32, f32::max);
        // A 110 Hz saw at unity voice gain cannot step by more than its own
        // reset transient; 0.5 is an order of magnitude above anything the
        // signal does and an order below a step that would be audible as a
        // click at this level.
        assert!(worst < 0.5, "morph step clicked: worst sample step {worst}");
    }

    /// A fast sweep across the whole morph range with the cutoff moving too:
    /// the filter has to stay bounded and finite at 128- and 1024-sample
    /// blocks, which is the block range the worklet may hand it.
    #[test]
    fn sem_sweep_stays_bounded() {
        let _guard = lock_engine();
        for block in [128usize, 1024] {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, crate::params::FilterType::Sem as u32 as f32);
            e.set_param(id::FILTER_RES, 0.9);
            e.set_param(id::FILTER_DRIVE, 1.0);
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
            let mut peak = 0.0f32;
            let mut frames = 0usize;
            while frames < 240_000 {
                // 0..1 over ~0.12 s, and a cutoff sweeping 200 Hz..8 kHz.
                let t = frames as f32 / 48_000.0;
                e.set_param(id::FILTER_MORPH, 0.5 - 0.5 * (t * 8.0 * core::f32::consts::TAU).cos());
                e.set_param(id::FILTER_CUTOFF, 200.0 * (t * 6.0 * core::f32::consts::TAU).sin().abs() * 40.0 + 200.0);
                e.process(block);
                for v in e.left() {
                    assert!(v.is_finite(), "non-finite sample at block {block}");
                    peak = peak.max(v.abs());
                }
                frames += block;
            }
            assert!(peak < 1.0, "sweep at block {block} ran away: peak {peak}");
            assert!(peak > 1e-4, "sweep at block {block} was silent");
        }
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

    /// With nothing playing the meters must report exact silence, not a
    /// residual floor that twitches.
    #[test]
    fn meters_read_silence_when_nothing_plays() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::FX_REVERB_ON, 1.0);
        e.set_param(id::FX_REVERB_MIX, 0.3);
        e.set_param(id::FX_DELAY_ON, 1.0);
        e.set_param(id::FX_DELAY_MIX, 0.3);
        for _ in 0..200 {
            e.process(128);
        }
        assert_eq!(e.true_peak(), 0.0, "true peak should be exactly zero");
        assert_eq!(e.loudness_rms(), 0.0, "loudness should be exactly zero");
        // A note, then silence: the meters must fall back to zero rather than
        // parking on a floor.
        e.note_on(60, 0.9);
        for _ in 0..100 {
            e.process(128);
        }
        assert!(e.loudness_rms() > 0.0);
        e.all_notes_off();
        // `true_peak` is the maximum since the last take, so clear it while the
        // tail is still audible, then let the tail fall below the floor, then
        // check that a *fresh* window reads exact silence instead of parking on
        // a floor forever.
        for _ in 0..3000 {
            e.process(128);
        }
        let _ = e.take_true_peak();
        for _ in 0..4000 {
            e.process(128);
        }
        let decaying = e.take_true_peak();
        assert!(decaying < 1e-6, "tail should have decayed: {decaying:e}");
        for _ in 0..200 {
            e.process(128);
        }
        assert_eq!(e.take_true_peak(), 0.0, "tail should settle to exact silence");
        assert_eq!(e.loudness_rms(), 0.0, "loudness should settle to zero");
    }

    /// The wavetable oscillator must be band-limited: at a high pitch there
    /// must be no energy *between* the table's harmonics, which is where an
    /// aliased partial would land. Measured from the audio, in the frequency
    /// domain, because that is the only place this is visible.
    #[test]
    fn wavetable_is_band_limited_at_high_pitches() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Wavetable as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.9);
        // The pulse-width control picks the recipe; the brightest one is last.
        e.set_param(id::OSC1_PW, 1.0);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(93, 1.0); // A6, high enough that the bank must choose a short table
        let frames = 24_000;
        let mut buffer = vec![0.0f32; frames];
        for chunk in buffer.chunks_mut(128) {
            e.process(128);
            chunk.copy_from_slice(&e.out_l[..chunk.len()]);
        }
        let f0 = note_to_hz(93.0);
        // Probe halfway between harmonics: a band-limited table has nothing
        // there, an aliased one does.
        let magnitude = |freq: f32| {
            let w = core::f32::consts::TAU * freq / 48_000.0;
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (index, value) in buffer.iter().enumerate().skip(frames / 2) {
                re += (*value as f64) * (w * index as f32).cos() as f64;
                im -= (*value as f64) * (w * index as f32).sin() as f64;
            }
            (re * re + im * im).sqrt() / (frames / 2) as f64
        };
        let fundamental = magnitude(f0);
        let mut worst = 0.0f64;
        let mut k = 1;
        while f0 * (k as f32 + 0.5) < 20_000.0 {
            worst = worst.max(magnitude(f0 * (k as f32 + 0.5)));
            k += 1;
        }
        let ratio = 20.0 * (worst / fundamental).log10();
        assert!(
            ratio < -60.0,
            "wavetable aliases: between-harmonic energy {ratio:.1} dB below the fundamental"
        );
    }

    // ------------------------------------------------ imported single cycles

    /// Stage a cycle in engine memory and import it, exactly as the worklet
    /// does: write into the scratch buffer, then ask for the analysis.
    fn import_cycle(e: &mut Engine, cycle: &[f32]) -> i32 {
        let ptr = e.wavetable_scratch_ptr();
        unsafe {
            core::ptr::copy_nonoverlapping(cycle.as_ptr(), ptr, cycle.len());
        }
        e.import_wavetable(cycle.len())
    }

    fn cycle_of(len: usize, f: impl Fn(f32) -> f32) -> Vec<f32> {
        (0..len)
            .map(|index| f(core::f32::consts::TAU * index as f32 / len as f32))
            .collect()
    }

    /// Render one A4 note of a wavetable patch and hand back the left channel.
    fn render_wavetable_note(e: &mut Engine, pw: f32) -> Vec<f32> {
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Wavetable as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.9);
        e.set_param(id::OSC1_PW, pw);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(69, 1.0);
        let frames = 24_000;
        let mut buffer = vec![0.0f32; frames];
        for chunk in buffer.chunks_mut(128) {
            e.process(128);
            chunk.copy_from_slice(&e.out_l[..chunk.len()]);
        }
        buffer
    }

    /// The switch has to actually swap the bank: a sine that was imported is one
    /// harmonic, the factory bank sitting at the same knob position is not, and
    /// with nothing imported the switch changes nothing at all.
    #[test]
    fn the_import_switch_selects_the_imported_cycle() {
        let _guard = lock_engine();
        let cycle = cycle_of(WT_BASE_LEN, |phase| phase.sin());
        let f0 = note_to_hz(69.0);

        // PW 1.0 = the brightest factory bank, so the contrast is unmistakable.
        let mut e = new_engine(16);
        let plain = render_wavetable_note(&mut e, 1.0);

        let mut e = new_engine(16);
        assert_eq!(import_cycle(&mut e, &cycle), 0, "clean cycle should import");
        e.set_param(id::WT_USER, 0.0);
        let factory = render_wavetable_note(&mut e, 1.0);

        let mut e = new_engine(16);
        assert_eq!(import_cycle(&mut e, &cycle), 0, "clean cycle should import");
        e.set_param(id::WT_USER, 1.0);
        let imported = render_wavetable_note(&mut e, 1.0);

        let fifth = |buffer: &[f32]| bin_mag(buffer, f0 * 5.0, 48_000.0);
        let fundamental = |buffer: &[f32]| bin_mag(buffer, f0, 48_000.0);
        assert!(
            fifth(&imported) < fundamental(&imported) * 1e-3,
            "the imported sine should have no fifth harmonic, got {}",
            fifth(&imported)
        );
        assert!(
            fifth(&factory) > fundamental(&factory) * 0.1,
            "the factory bank should still be there with the switch off"
        );
        assert!(
            (fundamental(&plain) - fundamental(&factory)).abs() < fundamental(&plain) * 0.05,
            "loading a table changes nothing until the switch is on"
        );
    }

    /// An imported cycle obeys the same anti-aliasing rule as a factory bank:
    /// nothing between the harmonics at a pitch that forces a short table.
    #[test]
    fn an_imported_cycle_is_band_limited_at_a_high_pitch() {
        let _guard = lock_engine();
        // A saw has energy at every harmonic, so a leaky import shows up here.
        let cycle = cycle_of(WT_BASE_LEN, |phase| {
            let mut sum = 0.0f32;
            for k in 1..=WT_BASE_LEN / 2 {
                sum += (k as f32 * phase).sin() / k as f32;
            }
            sum
        });
        let mut e = new_engine(16);
        assert_eq!(import_cycle(&mut e, &cycle), 0);
        e.set_param(id::WT_USER, 1.0);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Wavetable as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.9);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(93, 1.0); // A6: the bank has to drop to a short table
        let frames = 24_000;
        let mut buffer = vec![0.0f32; frames];
        for chunk in buffer.chunks_mut(128) {
            e.process(128);
            chunk.copy_from_slice(&e.out_l[..chunk.len()]);
        }
        let f0 = note_to_hz(93.0);
        let magnitude = |freq: f32| {
            let w = core::f32::consts::TAU * freq / 48_000.0;
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (index, value) in buffer.iter().enumerate().skip(frames / 2) {
                re += (*value as f64) * (w * index as f32).cos() as f64;
                im -= (*value as f64) * (w * index as f32).sin() as f64;
            }
            (re * re + im * im).sqrt() / (frames / 2) as f64
        };
        let fundamental = magnitude(f0);
        let mut worst = 0.0f64;
        let mut k = 1;
        while f0 * (k as f32 + 0.5) < 20_000.0 {
            worst = worst.max(magnitude(f0 * (k as f32 + 0.5)));
            k += 1;
        }
        let ratio = 20.0 * (worst / fundamental).log10();
        assert!(
            ratio < -60.0,
            "the imported table aliases: between-harmonic energy {ratio:.1} dB down"
        );
    }

    /// Import failures are reported, not silently accepted, and a patch that
    /// asks for a table that is not there keeps making sound.
    #[test]
    fn a_bad_import_is_refused_and_a_missing_table_falls_back() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        assert_eq!(import_cycle(&mut e, &[0.0; 8]), 1, "too short");
        assert_eq!(import_cycle(&mut e, &[0.0; WT_BASE_LEN]), 2, "silent");
        assert_eq!(import_cycle(&mut e, &[0.3; WT_BASE_LEN]), 2, "only DC");
        let mut nan = vec![0.0f32; WT_BASE_LEN];
        nan[5] = f32::NAN;
        assert_eq!(import_cycle(&mut e, &nan), 3, "not finite");
        assert!(!e.has_wavetable(), "a refused import must not install a table");

        // Switch on with nothing imported, and after clearing: still audible.
        for stage in ["nothing imported", "cleared"] {
            if stage == "cleared" {
                assert_eq!(import_cycle(&mut e, &cycle_of(WT_BASE_LEN, f32::sin)), 0);
                e.clear_wavetable();
                assert!(!e.has_wavetable());
            }
            e.set_param(id::WT_USER, 1.0);
            let buffer = render_wavetable_note(&mut e, 1.0);
            let peak = buffer.iter().fold(0.0f32, |peak, value| peak.max(value.abs()));
            assert!(peak > 0.01, "{stage}: the patch fell silent, peak {peak}");
            e.note_off(69);
            for _ in 0..40 {
                e.process(128);
            }
        }
    }

    // ------------------------------------------------------------- delay (A5)

    /// A short pluck, rendered to stereo, with a hook to configure the FX.
    /// 1/16 at 120 BPM is 125 ms, so delay repeats land at 0.125 s intervals.
    fn render_fx(configure: impl FnOnce(&mut Engine)) -> (Vec<f32>, Vec<f32>) {
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        // A pluck: no sustain, so each repeat is a separate event to measure.
        e.set_param(id::ENV_ATTACK, 0.002);
        e.set_param(id::ENV_DECAY, 0.04);
        e.set_param(id::ENV_SUSTAIN, 0.0);
        e.set_param(id::ENV_RELEASE, 0.03);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        e.set_param(id::TEMPO, 120.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        configure(&mut e);
        e.note_on(69, 1.0);
        let frames = 48_000 * 3 / 2;
        let mut left = vec![0.0f32; frames];
        let mut right = vec![0.0f32; frames];
        for chunk in 0..frames / 128 {
            e.process(128);
            let at = chunk * 128;
            left[at..at + 128].copy_from_slice(&e.out_l[..128]);
            right[at..at + 128].copy_from_slice(&e.out_r[..128]);
        }
        (left, right)
    }

    /// The pluck with the delay on, as the delay tests want it.
    fn render_delay_tail(ping_pong: bool, damp: f32) -> (Vec<f32>, Vec<f32>) {
        render_fx(|e| {
            e.set_param(id::FX_DELAY_ON, 1.0);
            e.set_param(id::FX_DELAY_SYNC, 3.0);
            e.set_param(id::FX_DELAY_FB, 0.6);
            e.set_param(id::FX_DELAY_MIX, 0.9);
            e.set_param(id::FX_DELAY_DAMP, damp);
            e.set_param(id::FX_DELAY_PINGPONG, if ping_pong { 1.0 } else { 0.0 });
        })
    }

    fn rms(signal: &[f32], from: usize, to: usize) -> f32 {
        let slice = &signal[from..to.min(signal.len())];
        (slice.iter().map(|v| v * v).sum::<f32>() / slice.len().max(1) as f32).sqrt()
    }

    /// Ping-pong is a stereo feature: the repeats must trade channels, which is
    /// only visible by comparing the two channels window by window.
    #[test]
    fn ping_pong_alternates_the_repeats_in_the_engine() {
        let _guard = lock_engine();
        let (left, right) = render_delay_tail(true, 0.0);
        let echo = 6000; // 125 ms at 48 kHz
        let window = 900;
        let l1 = rms(&left, echo, echo + window);
        let r1 = rms(&right, echo, echo + window);
        let l2 = rms(&left, echo * 2, echo * 2 + window);
        let r2 = rms(&right, echo * 2, echo * 2 + window);
        let l3 = rms(&left, echo * 3, echo * 3 + window);
        let r3 = rms(&right, echo * 3, echo * 3 + window);
        assert!(l1 > r1 * 4.0, "first repeat should sit left: {l1} vs {r1}");
        assert!(r2 > l2 * 4.0, "second repeat should sit right: {r2} vs {l2}");
        assert!(l3 > r3 * 4.0, "third repeat should sit left again: {l3} vs {r3}");
        // And they must still get quieter, not build up.
        assert!(l3 < l1, "repeats should decay: {l3} vs {l1}");

        // Without ping-pong each channel repeats its own input, so a centred
        // note echoes equally on both sides — the contrast with the case above.
        let (plain_l, plain_r) = render_delay_tail(false, 0.0);
        let first = rms(&plain_l, echo, echo + window);
        assert!(first > 0.0);
        for tap in 1..=3 {
            let at = echo * tap;
            let l = rms(&plain_l, at, at + window);
            let r = rms(&plain_r, at, at + window);
            assert!(l > first * 0.2, "repeat {tap} should still be there: {l} vs {first}");
            assert!(
                (l - r).abs() < l * 0.05,
                "repeat {tap} should be equal on both sides without ping-pong: {l} vs {r}"
            );
        }
    }

    /// Damping has to be a tone control on the repeats, not a level control:
    /// measured from the audio, the third repeat loses far more top end than it
    /// loses low end when damping is up.
    #[test]
    fn delay_damping_darkens_the_repeats_in_the_engine() {
        let _guard = lock_engine();
        let spectrum = |damp: f32| {
            let (left, _) = render_delay_tail(false, damp);
            let echo = 6000usize;
            let window = 1200;
            let slice = &left[echo * 3..echo * 3 + window];
            let magnitude = |freq: f32| {
                let (mut re, mut im) = (0.0f64, 0.0f64);
                for (i, value) in slice.iter().enumerate() {
                    let phase = core::f64::consts::TAU * freq as f64 * i as f64 / 48_000.0;
                    re += *value as f64 * phase.cos();
                    im -= *value as f64 * phase.sin();
                }
                (re * re + im * im).sqrt() / window as f64
            };
            // 440 Hz is the note; 8.8 kHz is the 20th harmonic, well inside the
            // saw's spectrum and the band the damping filter acts on.
            (magnitude(440.0), magnitude(8800.0))
        };

        let (low_bright, high_bright) = spectrum(0.0);
        let (low_damped, high_damped) = spectrum(0.9);
        let high_loss = high_damped / high_bright;
        let low_loss = low_damped / low_bright;
        assert!(
            high_loss < low_loss * 0.5,
            "damping should cost the top end much more than the low end: {high_loss:.3} vs {low_loss:.3}"
        );
    }

    // ------------------------------------------------------- chain order (A5)

    /// Set the whole chain at once: `kinds` are chain positions in signal order.
    fn set_chain(e: &mut Engine, kinds: &[u32]) {
        for slot in 0..FX_SLOTS {
            e.set_param(id::FX_CHAIN1 + slot as u32, *kinds.get(slot).unwrap_or(&0) as f32);
        }
    }

    /// Total energy above the second harmonic: a distortion meter for the
    /// repeats, measured where only the repeats are sounding.
    fn harmonics(signal: &[f32], from: usize, to: usize, f0: f32) -> f32 {
        let slice = &signal[from..to.min(signal.len())];
        let magnitude = |freq: f32| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, value) in slice.iter().enumerate() {
                let phase = core::f64::consts::TAU * freq as f64 * i as f64 / 48_000.0;
                re += *value as f64 * phase.cos();
                im -= *value as f64 * phase.sin();
            }
            (re * re + im * im).sqrt() / slice.len().max(1) as f64
        };
        let first = magnitude(f0).max(1e-9);
        let mut out = 0.0;
        for k in 2..8 {
            out += (magnitude(f0 * k as f32) / first) as f32;
        }
        out
    }

    /// The whole point of a chain: the order changes the sound. Distortion does
    /// not commute with a delay, so driving the repeats and driving the mix
    /// cannot come out the same.
    #[test]
    fn reordering_the_chain_changes_the_sound() {
        let _guard = lock_engine();
        let f0 = note_to_hz(69.0);
        let with_drive = |order: [u32; 6]| {
            render_fx(|e| {
                e.set_param(id::FX_DELAY_ON, 1.0);
                e.set_param(id::FX_DELAY_SYNC, 3.0);
                e.set_param(id::FX_DELAY_FB, 0.6);
                e.set_param(id::FX_DELAY_MIX, 0.8);
                e.set_param(id::FX_DELAY_DAMP, 0.0);
                e.set_param(id::FX_DRIVE_ON, 1.0);
                e.set_param(id::FX_DRIVE_AMT, 0.9);
                e.set_param(id::FX_DRIVE_MIX, 1.0);
                set_chain(e, &order);
            })
            .0
        };
        let delay_then_drive = with_drive([1, 6, 0, 0, 0, 0]);
        let drive_then_delay = with_drive([6, 1, 0, 0, 0, 0]);
        // A memoryless distortion applied to the *sum* of a note and its own
        // repeat is not the same as distorting the note and then repeating it:
        // the two renders have to differ across the overlap, where both copies
        // are present at once.
        let reference = rms(&delay_then_drive, 0, 20_000).max(1e-9);
        let difference = {
            let sum: f32 = delay_then_drive
                .iter()
                .zip(drive_then_delay.iter())
                .map(|(a, b)| (a - b) * (a - b))
                .sum();
            (sum / delay_then_drive.len() as f32).sqrt()
        };
        assert!(
            difference > reference * 0.1,
            "reordering should change the sound: difference {difference} vs level {reference}"
        );
        // What an isolated repeat *sounds like* is the same either way — the
        // distortion is applied to one copy of the note in both orders, and a
        // memoryless curve commutes with a delay. Pin that down so nobody later
        // "fixes" the reorder into a no-op by measuring the wrong thing: the
        // difference is real, but it lives in the mix, not in one isolated echo.
        let tail_a = harmonics(&delay_then_drive, 18_000, 19_200, f0);
        let tail_b = harmonics(&drive_then_delay, 18_000, 19_200, f0);
        assert!(
            (tail_a - tail_b).abs() < 0.1 * tail_a.max(tail_b),
            "an isolated repeat should have the same colour: {tail_a} vs {tail_b}"
        );
    }

    /// A position left empty runs nothing, whatever the effect's own switch says.
    #[test]
    fn an_effect_dropped_from_the_chain_does_not_run() {
        let _guard = lock_engine();
        let with_everything = |chain: [u32; 6]| {
            let (left, right) = render_fx(|e| {
                e.set_param(id::FX_DELAY_ON, 1.0);
                e.set_param(id::FX_DELAY_MIX, 0.5);
                e.set_param(id::FX_REVERB_ON, 1.0);
                e.set_param(id::FX_REVERB_MIX, 0.5);
                e.set_param(id::FX_CHORUS_ON, 1.0);
                e.set_param(id::FX_CHORUS_MIX, 0.5);
                e.set_param(id::FX_DRIVE_ON, 1.0);
                e.set_param(id::FX_DRIVE_MIX, 0.5);
                set_chain(e, &chain);
            });
            (rms(&left, 0, 20_000), rms(&right, 0, 20_000))
        };
        // The full chain, and an empty one. The empty chain must equal the dry
        // pluck, which is a different level from four effects at 50%.
        let (full_l, full_r) = with_everything([1, 2, 3, 6, 0, 0]);
        let (dry_l, dry_r) = with_everything([0; 6]);
        assert!(full_l > dry_l * 1.05 || full_r > dry_r * 1.05, "the chain should do something");
        assert!((dry_l - dry_r).abs() < dry_l * 0.02, "an empty chain is a clean pass-through");
        // An effect sitting in the chain but switched off is skipped as well:
        // the render has to match the empty chain, not merely be similar.
        let (off_l, off_r) = render_fx(|e| {
            e.set_param(id::FX_DELAY_ON, 0.0);
            e.set_param(id::FX_DELAY_MIX, 0.9);
            e.set_param(id::FX_REVERB_ON, 0.0);
            e.set_param(id::FX_CHORUS_ON, 0.0);
            e.set_param(id::FX_DRIVE_ON, 0.0);
            set_chain(e, &[1, 2, 3, 6, 0, 0]);
        });
        assert!(
            (rms(&off_l, 0, 20_000) - dry_l).abs() < dry_l * 0.01,
            "a switched-off effect must pass the signal through"
        );
        assert!((rms(&off_r, 0, 20_000) - dry_r).abs() < dry_r * 0.01);
    }

    /// Parallel means *send*: the dry signal stays in the mix instead of being
    /// crossfaded away, so full-wet no longer removes the note itself.
    #[test]
    fn a_parallel_position_adds_instead_of_replacing() {
        let _guard = lock_engine();
        let f0 = note_to_hz(69.0);
        let fundamental = |parallel: bool| {
            let (left, _) = render_fx(|e| {
                // A mild drive at 50%: the dry copy is half of the serial output
                // and all of the parallel one, so the note itself is measurably
                // stronger when the position is a send.
                e.set_param(id::FX_DRIVE_ON, 1.0);
                e.set_param(id::FX_DRIVE_AMT, 0.3);
                e.set_param(id::FX_DRIVE_MIX, 0.5);
                set_chain(e, &[6, 0, 0, 0, 0, 0]);
                if parallel {
                    e.set_param(id::FX_PARALLEL1, 1.0);
                }
            });
            // 0.05 s in: the envelope is open and the effect is running.
            bin_mag(&left[2400..4800], f0, 48_000.0)
        };
        let serial = fundamental(false);
        let parallel = fundamental(true);
        assert!(
            parallel > serial * 1.25,
            "a send should keep the dry note in the mix: {parallel} vs {serial}"
        );
    }

    // --------------------------------------- impulse-response reverb (A5)

    /// A response that rings at one frequency, as an imported IR would.
    fn resonant_ir(freq: f32, decay: f32, len: usize) -> Vec<f32> {
        (0..len)
            .map(|i| {
                let t = i as f32 / 48_000.0;
                (core::f32::consts::TAU * freq * t).sin() * (-t * decay).exp()
            })
            .collect()
    }

    /// Stage an IR the way the worklet does and analyse it.
    fn import_ir(e: &mut Engine, ir: &[f32]) -> i32 {
        let ptr = e.ir_scratch_ptr();
        let len = ir.len().min(e.ir_capacity());
        unsafe {
            core::ptr::copy_nonoverlapping(ir.as_ptr(), ptr, len);
        }
        e.import_ir(len)
    }

    /// The reverb section has two engines. An imported response that rings at
    /// 3 kHz must make the tail ring there; the algorithmic reverb, which has no
    /// idea about that frequency, must not.
    #[test]
    fn an_imported_response_replaces_the_algorithmic_reverb() {
        let _guard = lock_engine();
        // A long, slowly decaying ring, so the tail outlives the source burst.
        let ir = resonant_ir(3000.0, 1.2, 96_000);
        let tail_ratio = |mode: f32, import: bool| {
            let (left, _) = render_fx(|e| {
                if import {
                    assert_eq!(import_ir(e, &ir), 0, "the response should be accepted");
                }
                // A noise burst, not a tone: the tail's spectrum then *is* the
                // response, which is what makes the measurement mean something.
                e.set_param(id::OSC1_WAVE, crate::params::Wave::Noise as u32 as f32);
                e.set_param(id::ENV_DECAY, 0.25);
                e.set_param(id::ENV_SUSTAIN, 0.0);
                e.set_param(id::ENV_RELEASE, 0.15);
                e.set_param(id::FX_REVERB_ON, 1.0);
                e.set_param(id::FX_REVERB_MIX, 1.0);
                e.set_param(id::FX_REVERB_MODE, mode);
                e.set_param(id::FX_CONV_TRIM, 4.0);
                e.set_param(id::FX_REVERB_SIZE, 0.6);
                set_chain(e, &[2, 0, 0, 0, 0, 0]);
            });
            // 0.6–0.9 s: the burst is over, so this is the response alone.
            let slice = &left[28_800..43_200];
            let on_resonance = bin_mag(slice, 3000.0, 48_000.0);
            let off_resonance = bin_mag(slice, 2600.0, 48_000.0).max(1e-9);
            on_resonance / off_resonance
        };

        let impulse = tail_ratio(1.0, true);
        let algorithmic = tail_ratio(0.0, false);
        assert!(
            impulse > algorithmic * 3.0,
            "the imported response should colour the tail: {impulse} vs algorithmic {algorithmic}"
        );
        assert!(impulse > 2.0, "the tail should actually ring at the response's frequency: {impulse}");
    }

    /// A patch that asks for the impulse engine on a machine with no response
    /// loaded must keep its algorithmic reverb, not fall silent.
    #[test]
    fn the_impulse_engine_without_a_response_falls_back() {
        let _guard = lock_engine();
        let render = |mode: f32, import: bool| {
            render_fx(|e| {
                if import {
                    assert_eq!(import_ir(e, &resonant_ir(3000.0, 3.0, 9600)), 0);
                }
                e.set_param(id::FX_REVERB_ON, 1.0);
                e.set_param(id::FX_REVERB_MIX, 0.5);
                e.set_param(id::FX_REVERB_MODE, mode);
                set_chain(e, &[2, 0, 0, 0, 0, 0]);
            })
            .0
        };
        let no_response = rms(&render(1.0, false), 0, 20_000);
        let algorithmic = rms(&render(0.0, false), 0, 20_000);
        assert!(
            (no_response - algorithmic).abs() < algorithmic * 0.01,
            "without a response the section should run the algorithmic reverb: {no_response} vs {algorithmic}"
        );
        let with_response = rms(&render(1.0, true), 0, 20_000);
        assert!(with_response > 0.0, "a loaded response must produce a tail");

        // And clearing it puts the algorithmic engine back.
        let mut e = new_engine(16);
        assert_eq!(import_ir(&mut e, &resonant_ir(3000.0, 3.0, 9600)), 0);
        assert!(e.has_ir());
        e.clear_ir();
        assert!(!e.has_ir());
        assert_eq!(e.import_ir(0), 1, "an empty response is refused");
    }

    // -------------------------------------------------------------- sampler (A)

    /// Stage a sample the way the worklet does and analyse it.
    fn import_sample(e: &mut Engine, samples: &[f32], rate: f32) -> i32 {
        let ptr = e.sample_scratch_ptr();
        let len = samples.len().min(e.sample_capacity());
        unsafe {
            core::ptr::copy_nonoverlapping(samples.as_ptr(), ptr, len);
        }
        e.import_sample(len, rate)
    }

    /// Render one note of a sampler patch and hand back the left channel.
    fn render_sample_note(e: &mut Engine, note: u8, seconds: f32) -> Vec<f32> {
        let frames = (48_000.0 * seconds) as usize;
        e.note_on(note, 1.0);
        let mut out = vec![0.0f32; frames];
        for chunk in 0..frames.div_ceil(128) {
            e.process(128);
            let at = chunk * 128;
            let take = 128.min(frames - at);
            out[at..at + take].copy_from_slice(&e.out_l[..take]);
        }
        out
    }

    fn sampler_engine() -> Box<Engine> {
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sample as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.9);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        e.set_param(id::SMP_ROOT, 69.0); // A4
        e
    }

    /// An imported 440 Hz tone plays at the note it was recorded for, an octave
    /// above it, and an octave below it.
    #[test]
    fn an_imported_sample_follows_the_note() {
        let _guard = lock_engine();
        let source: Vec<f32> = (0..24_000)
            .map(|i| (core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0).sin() * 0.8)
            .collect();

        let measure = |note: u8| -> f32 {
            let mut e = sampler_engine();
            assert_eq!(import_sample(&mut e, &source, 48_000.0), 0, "the sample should import");
            let buffer = render_sample_note(&mut e, note, 0.2);
            // Steady state only: the attack is not a pitch.
            let slice = &buffer[4_800..9_600];
            let magnitude = |freq: f32| {
                let (mut re, mut im) = (0.0f64, 0.0f64);
                for (i, value) in slice.iter().enumerate() {
                    let win = 0.5 - 0.5 * (core::f64::consts::TAU * i as f64 / slice.len() as f64).cos();
                    let v = *value as f64 * win;
                    let phase = core::f64::consts::TAU * freq as f64 * i as f64 / 48_000.0;
                    re += v * phase.cos();
                    im -= v * phase.sin();
                }
                ((re * re + im * im).sqrt() / slice.len() as f64) as f32
            };
            let probes: Vec<f32> = (5..=80).map(|k| k as f32 * 15.0).collect();
            probes
                .into_iter()
                .max_by(|a, b| magnitude(*a).partial_cmp(&magnitude(*b)).unwrap())
                .unwrap()
        };

        let at_root = measure(69);
        assert!((at_root - 440.0).abs() < 20.0, "root note gave {at_root} Hz");
        let octave_up = measure(81);
        assert!((octave_up - 880.0).abs() < 40.0, "an octave up gave {octave_up} Hz");
        let octave_down = measure(57);
        assert!((octave_down - 220.0).abs() < 15.0, "an octave down gave {octave_down} Hz");
    }

    /// The sampler must be silent, not noisy, when a patch asks for a sample and
    /// none is loaded: falling through to the noise generator would be a bug the
    /// player would hear as "the sample is broken".
    #[test]
    fn a_sampler_patch_without_a_sample_is_silent() {
        let _guard = lock_engine();
        let mut e = sampler_engine();
        assert!(!e.has_sample());
        let buffer = render_sample_note(&mut e, 60, 0.1);
        let peak = buffer.iter().fold(0.0f32, |peak, value| peak.max(value.abs()));
        assert!(peak < 1e-6, "an empty sampler should be silent, peak {peak}");
    }

    /// The loop mode is audible: with it on, the note outlives the sample.
    #[test]
    fn a_looped_sample_keeps_playing_past_its_end() {
        let _guard = lock_engine();
        let source: Vec<f32> = (0..2_400)
            .map(|i| (core::f32::consts::TAU * 220.0 * i as f32 / 48_000.0).sin() * 0.8)
            .collect();

        let energy_after_the_sample = |mode: f32| {
            let mut e = sampler_engine();
            assert_eq!(import_sample(&mut e, &source, 48_000.0), 0);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::SMP_MODE, mode);
            let buffer = render_sample_note(&mut e, 69, 0.5);
            // 0.3 s in is well past the 50 ms sample.
            buffer[14_400..24_000].iter().map(|v| v * v).sum::<f32>().sqrt()
        };

        let one_shot = energy_after_the_sample(0.0);
        let looped = energy_after_the_sample(1.0);
        // Not exactly zero: the low-pass keeps ringing for a few milliseconds
        // after the sample stops. The gap to the looped case is ~50 dB.
        assert!(one_shot < 0.01, "a one-shot should have stopped, got {one_shot}");
        assert!(looped > 1.0, "a loop should still be sounding, got {looped}");
    }

    /// Refusals, and clearing: the oscillator stays usable afterwards.
    #[test]
    fn a_bad_sample_is_refused_and_clearing_keeps_the_patch_working() {
        let _guard = lock_engine();
        let mut e = sampler_engine();
        assert_eq!(import_sample(&mut e, &[0.0; 4], 48_000.0), 1, "too short");
        assert_eq!(import_sample(&mut e, &[0.0; 4_800], 48_000.0), 2, "silent");
        let mut broken = vec![0.0f32; 4_800];
        broken[7] = f32::NAN;
        assert_eq!(import_sample(&mut e, &broken, 48_000.0), 3, "not finite");
        assert!(!e.has_sample());

        let source: Vec<f32> = (0..4_800)
            .map(|i| (core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0).sin() * 0.8)
            .collect();
        assert_eq!(import_sample(&mut e, &source, 48_000.0), 0);
        assert!(e.has_sample());
        e.clear_sample();
        assert!(!e.has_sample());
        // And the patch is silent rather than broken.
        let buffer = render_sample_note(&mut e, 69, 0.05);
        assert!(buffer.iter().all(|v| v.is_finite()));
    }

    // ------------------------------------------------- two instances (B/P2)

    /// A patch on instance B that is easy to tell apart from instance A's.
    fn set_square_layer(e: &mut Engine, level: f32) {
        e.set_param_inst(1, id::OSC1_ON, 1.0);
        e.set_param_inst(1, id::OSC1_WAVE, crate::params::Wave::Square as u32 as f32);
        e.set_param_inst(1, id::OSC1_LEVEL, level);
        e.set_param_inst(1, id::OSC2_ON, 0.0);
        e.set_param_inst(1, id::OSC2_LEVEL, 0.0);
        e.set_param_inst(1, id::FILTER_CUTOFF, 18000.0);
        e.set_param_inst(1, id::FILTER_ENV_AMT, 0.0);
        e.set_param_inst(1, id::ENV_ATTACK, 0.001);
        e.set_param_inst(1, id::ENV_SUSTAIN, 1.0);
        e.set_param_inst(1, id::LFO_ON, 0.0);
        e.set_param_inst(1, id::MASTER_VOLUME, 1.0);
    }

    /// The default route is one instance: adding a second one must not change
    /// what an existing patch does.
    #[test]
    fn the_default_route_plays_one_instance() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.note_on(60, 1.0);
        assert_eq!(e.instance_voices(0), 1);
        assert_eq!(e.instance_voices(1), 0);
    }

    /// A layer sounds both timbres for one key.
    #[test]
    fn a_layer_plays_both_instances() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.7);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        for index in 0..crate::params::MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        set_square_layer(&mut e, 0.5);
        e.set_instance_routing(1, 60, 0.0, 1.0, 0.0, 1.0);
        e.note_on(69, 1.0);
        assert_eq!(e.instance_voices(0), 1);
        assert_eq!(e.instance_voices(1), 1);

        let buffer = render_sample_note(&mut e, 69, 0.3);
        let slice = &buffer[4_800..12_000];
        let f0 = note_to_hz(69.0);
        // The square layer puts odd harmonics on top of the sine: without it the
        // third harmonic would be at the noise floor.
        let fundamental = bin_mag(slice, f0, 48_000.0);
        let third = bin_mag(slice, f0 * 3.0, 48_000.0);
        assert!(fundamental > 0.02, "the layer should sound");
        assert!(
            third > fundamental * 0.02,
            "the square layer should add harmonics: {third} vs {fundamental}"
        );
    }

    /// A split sends low notes to A and high notes to B.
    #[test]
    fn a_split_routes_by_note() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.7);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        set_square_layer(&mut e, 0.5);
        e.set_instance_routing(2, 60, 0.0, 1.0, 0.0, 1.0);
        e.set_param(id::ENV_RELEASE, 0.01);
        e.set_param_inst(1, id::ENV_RELEASE, 0.01);

        // Below the split: only A.
        e.note_on(48, 1.0);
        assert_eq!(e.instance_voices(0), 1);
        assert_eq!(e.instance_voices(1), 0);
        let low = render_sample_note(&mut e, 48, 0.2);
        let low_f0 = note_to_hz(48.0);
        let low_third = bin_mag(&low[4_800..9_600], low_f0 * 3.0, 48_000.0);

        // Above the split: only B (the square).
        e.all_notes_off();
        for _ in 0..200 {
            e.process(128);
        }
        e.note_on(72, 1.0);
        assert_eq!(e.instance_voices(0), 0);
        assert_eq!(e.instance_voices(1), 1);
        let high = render_sample_note(&mut e, 72, 0.2);
        let high_f0 = note_to_hz(72.0);
        let high_third = bin_mag(&high[4_800..9_600], high_f0 * 3.0, 48_000.0);

        assert!(
            high_third > low_third * 4.0,
            "the high half should be the square layer: {high_third} vs {low_third}"
        );
    }

    /// The two instances keep their own parameters: instance B's filter cannot
    /// darken a note playing on instance A.
    #[test]
    fn instance_parameters_do_not_leak_between_instances() {
        let _guard = lock_engine();
        let mut e = new_engine(16);
        e.set_param(id::OSC1_ON, 1.0);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);

        // Instance B is the same saw, but heavily filtered.
        e.set_param_inst(1, id::OSC1_ON, 1.0);
        e.set_param_inst(1, id::OSC1_WAVE, crate::params::Wave::Saw as u32 as f32);
        e.set_param_inst(1, id::OSC1_LEVEL, 0.8);
        e.set_param_inst(1, id::OSC2_ON, 0.0);
        e.set_param_inst(1, id::OSC2_LEVEL, 0.0);
        e.set_param_inst(1, id::FILTER_CUTOFF, 350.0);
        e.set_param_inst(1, id::FILTER_DRIVE, 0.0);
        e.set_param_inst(1, id::FILTER_ENV_AMT, 0.0);
        e.set_param_inst(1, id::ENV_ATTACK, 0.001);
        e.set_param_inst(1, id::ENV_SUSTAIN, 1.0);
        e.set_param_inst(1, id::LFO_ON, 0.0);
        e.set_param_inst(1, id::MASTER_VOLUME, 1.0);
        e.set_instance_routing(2, 60, 0.0, 1.0, 0.0, 1.0);
        e.set_param(id::ENV_RELEASE, 0.01);
        e.set_param_inst(1, id::ENV_RELEASE, 0.01);

        let high_energy = |e: &mut Engine, note: u8| {
            e.note_on(note, 1.0);
            let buffer = render_sample_note(e, note, 0.25);
            let f0 = note_to_hz(note as f32);
            let slice = &buffer[4_800..12_000];
            // Energy well above the fundamental: a bright saw has plenty.
            let mut sum = 0.0f32;
            for k in 4..14 {
                sum += bin_mag(slice, f0 * k as f32, 48_000.0);
            }
            e.all_notes_off();
            for _ in 0..200 {
                e.process(128);
            }
            sum
        };
        let bright = high_energy(&mut e, 48); // instance A: open filter
        let dark = high_energy(&mut e, 72); // instance B: closed filter
        assert!(bright > 0.0 && dark >= 0.0);
        assert!(
            bright > dark * 5.0,
            "instance B's filter should not affect A: A {bright} vs B {dark}"
        );
    }

    /// The noise wave ids must actually reach the coloured-noise filters: white
    /// is brighter than pink, which is brighter than brown. A mis-wiring (pink
    /// playing white, say) keeps the level identical and only shows up as
    /// brightness, so measure that.
    #[test]
    fn noise_colours_get_progressively_darker() {
        let _guard = lock_engine();
        let brightness = |wave: crate::params::Wave| -> f32 {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_ON, 1.0);
            e.set_param(id::OSC1_WAVE, wave as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_CUTOFF, 18000.0);
            e.set_param(id::FILTER_DRIVE, 0.0);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::MASTER_VOLUME, 0.75);
            e.note_on(60, 0.9);
            for _ in 0..40 {
                e.process(128);
            }
            // Mean absolute first difference: a high-pass of sorts, so brighter
            // noise scores higher.
            let mut sum = 0.0f32;
            let mut previous = e.out_l[0];
            let mut count = 0.0f32;
            for _ in 0..200 {
                e.process(128);
                for sample in e.out_l[..128].iter() {
                    sum += (sample - previous).abs();
                    previous = *sample;
                    count += 1.0;
                }
            }
            sum / count
        };
        let white = brightness(crate::params::Wave::Noise);
        let pink = brightness(crate::params::Wave::Pink);
        let brown = brightness(crate::params::Wave::Brown);
        assert!(
            white > pink && pink > brown,
            "noise colours are not ordered: white {white:.5} pink {pink:.5} brown {brown:.5}"
        );
        // Not a subtle difference either: pink is measurably darker than white.
        assert!(pink < white * 0.75, "pink is too close to white: {pink:.5} vs {white:.5}");
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


    // ------------------------------------------------- FM / PM and ring (P6.1)

    /// A four-second A4 through a sine pair, with nothing else in the way.
    ///
    /// Both oscillators are sines at the *same* frequency, which is the one
    /// setting where the spectrum says exactly what happened: phase modulation
    /// moves energy into harmonics of the carrier, and ring modulation moves it
    /// to the sum and difference of the two.
    fn fm_patch_with_level(fm: f32, ring: f32, osc2_pitch: f32, osc2_level: f32) -> Box<Engine> {
        let mut e = new_engine(8);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC2_LEVEL, osc2_level);
        e.set_param(id::OSC2_PITCH, osc2_pitch);
        e.set_param(id::OSC_FM, fm);
        e.set_param(id::OSC_RING, ring);
        e.set_param(id::FILTER_CUTOFF, 18_000.0);
        e.set_param(id::FILTER_RES, 0.05);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::ENV_DECAY, 4.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::FX_DELAY_ON, 0.0);
        e.set_param(id::FX_CHORUS_ON, 0.0);
        e.set_param(id::FX_FLANGER_ON, 0.0);
        e.set_param(id::FX_PHASER_ON, 0.0);
        e.set_param(id::FX_DRIVE_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        e
    }

    /// Two sines, OSC 2 turned down to nothing: the classic FM arrangement, where
    /// the modulator is heard only through the carrier and the reference render
    /// is a single clean sine.
    fn fm_patch(fm: f32, ring: f32, osc2_pitch: f32) -> Box<Engine> {
        fm_patch_with_level(fm, ring, osc2_pitch, 0.0)
    }

    /// A steady note's left channel, skipping the attack so the envelope is flat.
    ///
    /// The samples are copied out `frames` at a time on purpose: `left()` hands
    /// back the whole 1024-sample block buffer, so a test that took all of it
    /// would be measuring 896 samples of stale data per block as well.
    fn steady_note(e: &mut Engine, blocks: usize) -> Vec<f32> {
        e.note_on(69, 0.9);
        for _ in 0..8 {
            e.process(128);
        }
        let mut out = Vec::with_capacity(blocks * 128);
        for _ in 0..blocks {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        out
    }

    /// How many carrier harmonics are above `floor` relative to the strongest
    /// partial — the number of audible sidebands, which is what a modulation
    /// index is measured by.
    fn sideband_count(samples: &[f32], f0: f32, floor: f32) -> usize {
        let strongest = (1..=30)
            .map(|k| bin_mag(samples, f0 * k as f32, 48_000.0))
            .fold(0.0f32, f32::max)
            .max(1e-9);
        (1..=30)
            .filter(|k| bin_mag(samples, f0 * *k as f32, 48_000.0) / strongest > floor)
            .count()
    }

    /// Frequency domain: OSC 2 modulating OSC 1's phase moves energy out of the
    /// carrier and into its harmonics, and more depth means more of them.
    #[test]
    fn phase_modulation_adds_sidebands() {
        let _guard = lock_engine();
        let f0 = 440.0f32;

        let clean = {
            let mut e = fm_patch(0.0, 0.0, 0.0);
            steady_note(&mut e, 240)
        };
        let carrier = bin_mag(&clean, f0, 48_000.0);
        assert!(carrier > 0.01, "the plain pair should be loud: {carrier}");
        // With no modulation the two sines are the same frequency, so there is
        // nothing above the fundamental at all.
        for harmonic in [2, 3, 4] {
            let side = bin_mag(&clean, f0 * harmonic as f32, 48_000.0);
            assert!(
                side / carrier < 1e-3,
                "depth 0 must stay a sine, but harmonic {harmonic} is {:.5} of the carrier",
                side / carrier
            );
        }

        let render = |depth: f32| {
            let mut e = fm_patch(depth, 0.0, 0.0);
            steady_note(&mut e, 240)
        };
        let shallow = render(0.3);
        let deep = render(0.9);

        // The first sidebands are there once the depth leaves zero…
        let first = bin_mag(&shallow, f0 * 2.0, 48_000.0) / carrier;
        assert!(first > 0.05, "depth 0.3 should produce a second partial: {first:.4}");
        // …the carrier loses energy to them as the index grows…
        let shallow_carrier = bin_mag(&shallow, f0, 48_000.0);
        let deep_carrier = bin_mag(&deep, f0, 48_000.0);
        assert!(
            deep_carrier < shallow_carrier,
            "a deeper index should eat into the carrier: {deep_carrier:.4} vs {shallow_carrier:.4}"
        );
        // …and the number of audible sidebands grows with it, step by step: a
        // modulation index is exactly "how many harmonics are worth counting".
        let counts: Vec<usize> = [0.0f32, 0.25, 0.5, 0.75, 1.0]
            .iter()
            .map(|depth| {
                let rendered = if *depth == 0.0 { clean.clone() } else { render(*depth) };
                sideband_count(&rendered, f0, 0.02)
            })
            .collect();
        for pair in counts.windows(2) {
            assert!(
                pair[1] > pair[0],
                "the index must open up the spectrum monotonically: {counts:?}"
            );
        }
        assert!(
            counts[0] <= 2 && *counts.last().unwrap() >= 6,
            "the knob should span a sine to an obviously bright tone: {counts:?}"
        );
    }

    /// Time domain: the same thing seen in the waveform. A sine crosses zero
    /// twice per carrier period however deep the modulation, but the *shape*
    /// between crossings gains the extra wiggles the sidebands describe.
    #[test]
    fn phase_modulation_shows_in_the_waveform() {
        let _guard = lock_engine();
        let period = (48_000.0 / 440.0) as usize;

        let clean = {
            let mut e = fm_patch(0.0, 0.0, 0.0);
            steady_note(&mut e, 240)
        };
        let deep = {
            let mut e = fm_patch(0.9, 0.0, 0.0);
            steady_note(&mut e, 240)
        };
        let crossings = |samples: &[f32]| {
            samples[..period * 20]
                .windows(2)
                .filter(|w| (w[0] < 0.0) != (w[1] < 0.0))
                .count()
        };
        let clean_crossings = crossings(&clean);
        let deep_crossings = crossings(&deep);
        assert!(
            deep_crossings > clean_crossings * 2,
            "a modulated carrier wiggles more between crossings: {deep_crossings} vs {clean_crossings}"
        );
        // Phase modulation moves the phase around; it must not add gain, and a
        // deeper index must not walk the level up or down.
        let peak = |samples: &[f32]| samples.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(
            (peak(&deep) - peak(&clean)).abs() < 0.25,
            "phase modulation must not change the level: {:.3} vs {:.3}",
            peak(&deep),
            peak(&clean)
        );
    }

    /// Frequency and time domain for ring modulation: the product of two sines
    /// carries the sum and the difference and *loses* both originals.
    #[test]
    fn ring_modulation_moves_energy_to_sum_and_difference() {
        let _guard = lock_engine();
        let carrier = 440.0f32;
        // A ratio of 1.25: the difference (110 Hz) and the sum (990 Hz) are
        // nowhere near either oscillator, so every measurement is unambiguous.
        let ratio = 1200.0 * (1.25f32).log2() / 100.0;

        let sum = {
            let mut e = fm_patch_with_level(0.0, 0.0, ratio, 0.8);
            steady_note(&mut e, 240)
        };
        let ring = {
            let mut e = fm_patch_with_level(0.0, 1.0, ratio, 0.8);
            steady_note(&mut e, 240)
        };
        let difference = carrier * 0.25;
        let upper = carrier * 2.25;
        let modulator = carrier * 1.25;

        // The plain mix is the two oscillators and nothing else…
        let plain = bin_mag(&sum, carrier, 48_000.0);
        assert!(plain > 0.01, "the plain pair should be loud: {plain}");
        assert!(bin_mag(&sum, modulator, 48_000.0) > 0.01, "and so should the modulator");
        assert!(
            bin_mag(&sum, difference, 48_000.0) / plain < 0.02,
            "an additive mix has nothing at the difference frequency"
        );
        assert!(
            bin_mag(&sum, upper, 48_000.0) / plain < 0.02,
            "an additive mix has nothing at the sum frequency"
        );

        // …and the ring product has the sum and the difference instead.
        let low = bin_mag(&ring, difference, 48_000.0);
        let high = bin_mag(&ring, upper, 48_000.0);
        let strongest = low.max(high).max(1e-9);
        assert!(
            low > plain * 0.1 && high > plain * 0.1,
            "ring modulation should put real energy at 110 and 990: {low:.4}, {high:.4}"
        );
        assert!(
            bin_mag(&ring, carrier, 48_000.0) / strongest < 0.1,
            "the carrier itself should be suppressed by ring modulation"
        );
        assert!(
            bin_mag(&ring, modulator, 48_000.0) / strongest < 0.1,
            "the modulator should be suppressed too"
        );

        // Time domain: multiplication means the output has to vanish wherever
        // the modulator does. A sum cannot do that — its carrier keeps sounding.
        let modulated = {
            let mut e = fm_patch_with_level(0.0, 0.0, ratio, 0.0);
            steady_note(&mut e, 240)
        };
        let quiet_ratio = |samples: &[f32], modulator: &[f32]| {
            // Rank samples by how small the modulator is, then compare the mean
            // level of the quietest tenth with the mean over everything.
            let mut order: Vec<usize> = (0..samples.len().min(modulator.len())).collect();
            order.sort_by(|a, b| modulator[*a].abs().partial_cmp(&modulator[*b].abs()).unwrap());
            let tenth = order.len() / 10;
            let quiet: f32 = order[..tenth].iter().map(|i| samples[*i].abs()).sum::<f32>() / tenth as f32;
            let all: f32 = samples.iter().map(|v| v.abs()).sum::<f32>() / samples.len() as f32;
            quiet / all.max(1e-9)
        };
        let ring_ratio = quiet_ratio(&ring, &modulated);
        let sum_ratio = quiet_ratio(&sum, &modulated);
        assert!(
            ring_ratio < 0.35,
            "a ring-modulated tone is silent where its modulator is: ratio {ring_ratio:.3}"
        );
        assert!(
            sum_ratio > ring_ratio * 1.8,
            "the additive mix keeps sounding there: {sum_ratio:.3} vs {ring_ratio:.3}"
        );
    }

    /// The matrix can drive both, which is what makes an FM patch playable: an
    /// envelope on the index is the classic brightness sweep.
    #[test]
    fn the_matrix_can_drive_fm_and_ring() {
        let _guard = lock_engine();
        let f0 = 440.0f32;

        let mut e = fm_patch(0.0, 0.0, 0.0);
        // Route the (sustained) envelope to the FM index with full amount.
        e.params.routes[0] = crate::params::ModRoute {
            src: crate::params::ModSrc::Env,
            dst: crate::params::ModDst::Fm,
            amount: 1.0,
            enabled: true,
        };
        let modulated = steady_note(&mut e, 240);
        let carrier = bin_mag(&modulated, f0, 48_000.0);
        let second = bin_mag(&modulated, f0 * 2.0, 48_000.0) / carrier.max(1e-9);
        assert!(
            second > 0.05,
            "an envelope on the FM index should produce sidebands: {second:.4}"
        );

        let mut e = fm_patch_with_level(0.0, 0.0, 7.0, 0.8);
        e.params.routes[0] = crate::params::ModRoute {
            src: crate::params::ModSrc::Env,
            dst: crate::params::ModDst::Ring,
            amount: 1.0,
            enabled: true,
        };
        let ring = steady_note(&mut e, 240);
        let difference = bin_mag(&ring, f0 * 0.5, 48_000.0);
        let plain = bin_mag(&ring, f0, 48_000.0);
        assert!(
            difference > plain,
            "an envelope on the ring amount should reach a ring tone: {difference:.4} vs {plain:.4}"
        );
    }

    /// Unison and phase modulation together: every sub-voice is modulated, and
    /// nothing about the stack becomes unstable or silent.
    #[test]
    fn phase_modulation_survives_a_unison_stack() {
        let _guard = lock_engine();
        let mut e = fm_patch(0.7, 0.0, 0.0);
        e.set_param(id::OSC1_UNISON, 5.0);
        e.set_param(id::OSC1_SPREAD, 0.5);
        let rendered = steady_note(&mut e, 120);
        assert!(rendered.iter().all(|v| v.is_finite()), "unison FM must stay finite");
        let peak = rendered.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(peak > 0.05 && peak <= 1.0, "unison FM level: {peak:.3}");
        assert!(
            bin_mag(&rendered, 880.0, 48_000.0) > 1e-4,
            "a unison stack should still show the modulation's sidebands"
        );
    }




    /// The C bridge on its own, against the textbook: phase modulation of a
    /// sine by a sine at the same frequency is
    /// `sin(x + β sin x) = Σ J_n(β) sin((1+n)x)`, so the harmonic *ratios* are
    /// fixed by the index. A block that merely "sounds bright" — one that
    /// integrates the modulator, say — sounds like frequency modulation with a
    /// different index and fails here, which is exactly what happened while this
    /// was being written.
    #[test]
    fn the_phase_modulation_block_matches_the_textbook_spectrum() {
        let _guard = lock_engine();
        let frames = 128usize;
        let blocks = 240usize;
        let depth = 0.18f32; // 1.13 rad of index
        let modulator: Vec<f32> = (0..frames * blocks)
            .map(|i| (core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0).sin())
            .collect();
        let mut carrier = vec![0.0f32; modulator.len()];
        unsafe {
            gs_init(48_000.0, 1);
            gs_voice_osc_set(0, 0, 0, 0, 440.0, 1.0, 0.5);
            for block in 0..blocks {
                let at = block * frames;
                gs_voice_osc_pm_block(
                    0,
                    0,
                    0,
                    modulator[at..].as_ptr(),
                    depth,
                    carrier[at..].as_mut_ptr(),
                    frames as u32,
                );
            }
        }
        let reference: Vec<f32> = (0..frames * blocks)
            .map(|i| {
                let x = core::f32::consts::TAU * 440.0 * i as f32 / 48_000.0;
                (x + core::f32::consts::TAU * depth * x.sin()).sin()
            })
            .collect();
        for harmonic in 1..=4 {
            let freq = 440.0 * harmonic as f32;
            let got = bin_mag(&carrier, freq, 48_000.0);
            let want = bin_mag(&reference, freq, 48_000.0);
            assert!(
                (got - want).abs() <= want * 0.1 + 1e-4,
                "harmonic {harmonic}: phase modulation should match the analytic spectrum, got {got:.5} want {want:.5}"
            );
        }
    }


    // ------------------------------------------- hard sync, sub, noise (P6.2)

    /// A sync'd patch: OSC 1 is the slave, OSC 2 the (silent) master, and the
    /// slave's PITCH knob is the ratio the sync sweeps through.
    fn sync_patch(sync: bool, slave_wave: crate::params::Wave, ratio: f32) -> Box<Engine> {
        let mut e = new_engine(8);
        e.set_param(id::OSC1_WAVE, slave_wave as u32 as f32);
        e.set_param(id::OSC2_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.9);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::OSC2_ON, 1.0);
        e.set_param(id::OSC1_SYNC, if sync { 1.0 } else { 0.0 });
        e.set_param(id::OSC1_PITCH, 12.0 * ratio.log2());
        e.set_param(id::FILTER_CUTOFF, 18_000.0);
        e.set_param(id::FILTER_RES, 0.05);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 1.0);
        e
    }

    /// How much of the signal is *not* on the master's harmonic grid.
    fn off_grid_energy(samples: &[f32], line: f32) -> f64 {
        let energy = |f: f32| (bin_mag(samples, f, 48_000.0) as f64).powi(2);
        let mut harm = 0.0f64;
        let mut between = 0.0f64;
        let mut k = 1;
        while line * k as f32 <= 20_000.0 {
            harm += energy(line * k as f32);
            between += energy(line * (k as f32 + 0.5));
            k += 1;
        }
        10.0 * (between / harm.max(1e-30)).log10()
    }

    /// Correlation of the signal with itself one master period later: 1 means
    /// "this is periodic at the master's rate", which is what sync means.
    fn period_correlation(samples: &[f32], period: usize) -> f64 {
        let (mut num, mut left, mut right) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..samples.len().saturating_sub(period) {
            let a = samples[i] as f64;
            let b = samples[i + period] as f64;
            num += a * b;
            left += a * a;
            right += b * b;
        }
        num / (left.sqrt() * right.sqrt()).max(1e-30)
    }

    /// Time domain: with sync on, the slave's period *is* the master's period.
    #[test]
    fn hard_sync_locks_the_slave_to_the_master() {
        let _guard = lock_engine();
        let period = (48_000.0 / 220.0) as usize;

        // A ratio that is not a multiple of the master: without sync the slave
        // has its own period, with sync it can only have the master's.
        let loose = {
            let mut e = sync_patch(false, crate::params::Wave::Saw, 1.41);
            steady_note_note(&mut e, 57.0, 200)
        };
        let locked = {
            let mut e = sync_patch(true, crate::params::Wave::Saw, 1.41);
            steady_note_note(&mut e, 57.0, 200)
        };
        let loose_corr = period_correlation(&loose, period);
        let locked_corr = period_correlation(&locked, period);
        assert!(
            locked_corr > 0.95,
            "a sync'd slave must be periodic at the master's rate: {locked_corr:.4}"
        );
        assert!(
            locked_corr > loose_corr + 0.5,
            "sync has to change the period, not just the sound: {locked_corr:.4} vs {loose_corr:.4}"
        );

        // Frequency domain, same claim: without sync the slave's own fundamental
        // (660 Hz) is the loudest line; with sync the master's grid replaces it,
        // so 660 — which is not a multiple of 220… it is 3x220, so pick the
        // slave's *detuned* pitch instead: 220 * 1.41 is off the grid.
        let slave_line = |samples: &[f32]| bin_mag(samples, 220.0 * 1.41, 48_000.0);
        let mut detuned = sync_patch(false, crate::params::Wave::Saw, 1.41);
        let before = steady_note_note(&mut detuned, 57.0, 200);
        let mut detuned_sync = sync_patch(true, crate::params::Wave::Saw, 1.41);
        let after = steady_note_note(&mut detuned_sync, 57.0, 200);
        assert!(
            slave_line(&before) > slave_line(&after) * 20.0,
            "the slave's own pitch has to give way to the master's grid: {:.5} vs {:.5}",
            slave_line(&before),
            slave_line(&after)
        );
    }

    /// Every waveform, every ratio: the sync'd slave is periodic at the master's
    /// period, and at a ratio that is not a whole multiple the slave's own lines
    /// give way to the master's grid.
    ///
    /// The "aliasing <= -60 dB" this batch set out for is **not** asserted here:
    /// the off-grid measurement cannot currently resolve it. Run against signals
    /// whose periodicity is not in doubt it reads -41 dB for a plain 220 Hz saw
    /// and -60 dB for a plain sine, so the number it gives for sync says more
    /// about the measurement than about the DSP. That is tracked as P6.2b in
    /// `docs/NEXT-PLAN.md`; what is asserted here is what the measurement *can*
    /// separate.
    #[test]
    fn hard_sync_puts_every_waveform_on_the_masters_grid() {
        let _guard = lock_engine();
        let period = (48_000.0 / 220.0) as usize;
        for wave in [
            crate::params::Wave::Saw,
            crate::params::Wave::Square,
            crate::params::Wave::Pulse,
            crate::params::Wave::Triangle,
        ] {
            for ratio in [0.5f32, 1.41, 2.0, 3.0, 5.0, 8.0, 12.0] {
                let mut loose = sync_patch(false, wave, ratio);
                let before = steady_note_note(&mut loose, 57.0, 200);
                let mut locked = sync_patch(true, wave, ratio);
                let after = steady_note_note(&mut locked, 57.0, 200);
                let corr = period_correlation(&after, period);
                assert!(
                    corr > 0.9,
                    "{wave:?} x{ratio}: a sync'd slave must sit on the master's period: {corr:.3}"
                );
                // A whole multiple puts the slave's own pitch *on* the master's
                // grid, so there is nothing to suppress and that is correct.
                if (ratio.fract()).abs() > 0.01 {
                    let slave = bin_mag(&before, 220.0 * ratio, 48_000.0);
                    let suppressed = bin_mag(&after, 220.0 * ratio, 48_000.0);
                    assert!(
                        slave > suppressed * 10.0,
                        "{wave:?} x{ratio}: the slave's own line should give way: {slave:.5} -> {suppressed:.5}"
                    );
                }
            }
        }
    }

    /// Frequency domain: the sub sits exactly one or two octaves down, and its
    /// level control moves it.
    #[test]
    fn the_sub_oscillator_sits_an_octave_down() {
        let _guard = lock_engine();
        let at = |samples: &[f32], f: f32| bin_mag(samples, f, 48_000.0);
        let render = |octaves: f32, level: f32| {
            let mut e = new_engine(8);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC1_LEVEL, 0.9);
            e.set_param(id::OSC1_SUB, octaves);
            e.set_param(id::OSC1_SUB_LEVEL, level);
            e.set_param(id::FILTER_CUTOFF, 18_000.0);
            e.set_param(id::FILTER_DRIVE, 0.0);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::FX_REVERB_ON, 0.0);
            e.set_param(id::MASTER_VOLUME, 1.0);
            steady_note_note(&mut e, 69.0, 200)
        };

        // A4 = 440: the sub is at 220 (one octave) or 110 (two).
        let none = render(0.0, 0.5);
        assert!(at(&none, 440.0) > 0.05, "the plain sine should be there");
        assert!(at(&none, 220.0) < at(&none, 440.0) * 0.01, "no sub by default");
        assert!(at(&none, 110.0) < at(&none, 440.0) * 0.01, "no sub by default");

        let one = render(1.0, 0.5);
        assert!(at(&one, 220.0) > at(&none, 220.0) * 50.0, "one octave down");
        assert!(at(&one, 110.0) < at(&one, 220.0) * 0.01, "and only one octave");
        // The sub is a sine: nothing appears a fifth above it.
        assert!(at(&one, 330.0) < at(&one, 220.0) * 0.01, "the sub has no harmonics");

        let two = render(2.0, 0.5);
        assert!(at(&two, 110.0) > at(&one, 110.0) * 50.0, "two octaves down");

        let quiet = render(1.0, 0.1);
        assert!(
            at(&quiet, 220.0) < at(&one, 220.0) * 0.5,
            "the level control has to matter"
        );
    }

    /// Noise blend, both domains: it is broadband where the sine is not, and it
    /// raises the level without changing the tone's own partials.
    #[test]
    fn the_noise_blend_adds_broadband_energy() {
        let _guard = lock_engine();
        let render = |mix: f32| {
            let mut e = new_engine(8);
            e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC1_LEVEL, 0.6);
            e.set_param(id::NOISE_MIX, mix);
            e.set_param(id::FILTER_CUTOFF, 18_000.0);
            e.set_param(id::FILTER_DRIVE, 0.0);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::FX_REVERB_ON, 0.0);
            e.set_param(id::MASTER_VOLUME, 1.0);
            steady_note_note(&mut e, 69.0, 200)
        };
        let rms = |samples: &[f32]| {
            (samples.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / samples.len() as f64).sqrt()
        };
        // Energy that is not on the 440 Hz harmonic grid, sampled every 10 Hz so
        // a broadband signal is actually measured, with a guard around each
        // harmonic so the window's own leakage is not mistaken for noise.
        let off_grid = |samples: &[f32]| {
            let energy = |f: f32| (bin_mag(samples, f, 48_000.0) as f64).powi(2);
            let mut line = 0.0;
            let mut k = 1;
            while 440.0 * k as f32 <= 20_000.0 {
                line += energy(440.0 * k as f32);
                k += 1;
            }
            let mut off = 0.0;
            let mut f = 100.0f32;
            while f <= 20_000.0 {
                let near_harmonic = (1..=45).any(|k| (f - 440.0 * k as f32).abs() < 25.0);
                if !near_harmonic {
                    off += energy(f);
                }
                f += 10.0;
            }
            off / line.max(1e-30)
        };

        let clean = render(0.0);
        let noisy = render(0.5);
        assert!(
            off_grid(&clean) < 1e-3,
            "a sine with no noise has no broadband energy: {:.3e}",
            off_grid(&clean)
        );
        assert!(
            off_grid(&noisy) > off_grid(&clean) * 1e3,
            "the blend has to add broadband energy: {:.3e} vs {:.3e}",
            off_grid(&noisy),
            off_grid(&clean)
        );
        assert!(
            rms(&noisy) > rms(&clean),
            "and to raise the level: {:.4} vs {:.4}",
            rms(&noisy),
            rms(&clean)
        );
        // The blend must not move the tone itself: 440 Hz stays where it is.
        let tone = |samples: &[f32]| bin_mag(samples, 440.0, 48_000.0);
        assert!(
            (tone(&noisy) - tone(&clean)).abs() < tone(&clean) * 0.1,
            "the oscillator's own partial should stay put"
        );
    }

    fn steady_note_note(e: &mut Engine, note: f32, blocks: usize) -> Vec<f32> {
        e.note_on(note.round() as u8, 0.9);
        for _ in 0..8 {
            e.process(128);
        }
        let mut out = Vec::with_capacity(blocks * 128);
        for _ in 0..blocks {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        out
    }



    /// A steady sine is exactly periodic, so a spectral measurement over a whole
    /// number of its periods should find *nothing* off its harmonic grid. What
    /// it does find is the engine's phase noise, and that number is a real
    /// quality figure: it was -66 dB with a `float` phase accumulator (a random
    /// walk of the accumulator's own rounding, which shows up as a skirt around
    /// every partial) and -87 dB once the accumulator became double precision.
    ///
    /// This is also the floor under the hard-sync aliasing measurement: until it
    /// is well below the figure being measured, that measurement is meaningless
    /// — which is exactly what P6.2b is about.
    #[test]
    fn a_steady_sine_has_no_phase_noise_skirt() {
        let _guard = lock_engine();
        let mut e = new_engine(8);
        e.set_param(id::OSC1_WAVE, crate::params::Wave::Sine as u32 as f32);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC1_LEVEL, 0.6);
        e.set_param(id::FILTER_CUTOFF, 18_000.0);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::ENV_ATTACK, 0.01);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::MASTER_VOLUME, 0.5);
        // 375 blocks = 48000 samples = one second = 440 whole periods of A4.
        let rendered = steady_note_note(&mut e, 69.0, 375);

        // Total power from the samples, line power from the exact-bin DFT: with
        // a rectangular window over whole periods every harmonic lands on a bin
        // and contributes no leakage at all, so what is left over is genuinely
        // off the grid.
        let n = rendered.len();
        let total: f64 = rendered.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / n as f64;
        let mut lines = 0.0f64;
        let mut k = 1;
        while 440.0 * (k as f32) < 23_900.0 {
            let w = core::f64::consts::TAU * (440.0 * k as f32) as f64 / 48_000.0;
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, v) in rendered.iter().enumerate() {
                let ph = w * i as f64;
                re += *v as f64 * ph.cos();
                im -= *v as f64 * ph.sin();
            }
            let amp = 2.0 * (re * re + im * im).sqrt() / n as f64;
            lines += amp * amp / 2.0;
            k += 1;
        }
        let off_grid = 10.0 * ((total - lines).max(1e-30) / total).log10();
        assert!(
            off_grid < -80.0,
            "a steady sine should have no non-periodic energy: {off_grid:.1} dB"
        );
    }


    /// Off-grid energy measured on a **settled** note, exactly one second of it
    /// (440 whole periods), with a rectangular window and the exact-bin DFT.
    ///
    /// Two things had to be right before this number meant anything: the phase
    /// accumulator had to be double precision (P6.2b step one) and the note had
    /// to be settled — 20 ms after the attack the limiter's peak detector is
    /// still recovering from it, and that recovery is a slow gain change, i.e.
    /// exactly the modulation an off-grid metric picks up.
    fn settled_off_grid(e: &mut Engine, master: f32) -> f64 {
        for _ in 0..200 {
            e.process(128);
        }
        let mut out = Vec::with_capacity(375 * 128);
        for _ in 0..375 {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        let n = out.len();
        let total: f64 = out.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / n as f64;
        let mut lines = 0.0f64;
        let mut k = 1;
        while master * (k as f32) < 23_900.0 {
            let w = core::f64::consts::TAU * (master * k as f32) as f64 / 48_000.0;
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (i, v) in out.iter().enumerate() {
                let ph = w * i as f64;
                re += *v as f64 * ph.cos();
                im -= *v as f64 * ph.sin();
            }
            let amp = 2.0 * (re * re + im * im).sqrt() / n as f64;
            lines += amp * amp / 2.0;
            k += 1;
        }
        10.0 * ((total - lines).max(1e-30) / total).log10()
    }

    /// The sync's own figure, and the calibration that makes it readable: the
    /// *unsynced* slave at the same non-integer ratio is entirely off the
    /// master's grid (its whole signal is elsewhere), while the synced one keeps
    /// all but about -32 dB of its energy on it. That -32 dB is the honest
    /// current figure for hard sync in this engine — the plan's target is -60 dB
    /// and it is **not** met, which `docs/notes/hard-sync-aliasing.md` records
    /// along with what the remaining work is (band-limiting the restart itself,
    /// not just the decimation).
    #[test]
    fn hard_sync_keeps_the_slave_on_the_masters_grid() {
        let _guard = lock_engine();
        for wave in [
            crate::params::Wave::Saw,
            crate::params::Wave::Square,
            crate::params::Wave::Triangle,
        ] {
            let mut sync = sync_patch(true, wave, 1.41);
            sync.note_on(57, 0.9);
            let locked = settled_off_grid(&mut sync, 220.0);
            let mut loose = sync_patch(false, wave, 1.41);
            loose.note_on(57, 0.9);
            let free = settled_off_grid(&mut loose, 220.0);
            assert!(
                free > -3.0,
                "{wave:?}: an unsynced 1.41x slave is nowhere near the master's grid: {free:.1} dB"
            );
            assert!(
                locked < -25.0,
                "{wave:?}: the sync should put the slave on the master's grid: {locked:.1} dB"
            );
        }
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
