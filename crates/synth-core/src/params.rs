//! Parameter model shared with the TypeScript UI.
//!
//! The numeric ids below are the wire format for `gs_set_param`; they must stay
//! in sync with `src/audio/params.ts`. The engine keeps a plain struct so the
//! render loop never touches a map or allocates.

pub const MAX_VOICES: usize = 32;
pub const MAX_BLOCK_SIZE: usize = 1024;
pub const SPECTRUM_BINS: usize = 36;
pub const MOD_ROUTES: usize = 8;

/// Highest unison stack size per oscillator (keep in sync with GS_MAX_UNISON).
pub const MAX_UNISON: u32 = 7;

/// Numeric parameter identifiers (`gs_set_param` / `gs_set_int_param`).
pub mod id {
    pub const MASTER_VOLUME: u32 = 0;
    pub const OSC1_ON: u32 = 1;
    pub const OSC1_WAVE: u32 = 2;
    pub const OSC1_PITCH: u32 = 3;
    pub const OSC1_DETUNE: u32 = 4;
    pub const OSC1_LEVEL: u32 = 5;
    pub const OSC1_PW: u32 = 6;
    pub const OSC2_ON: u32 = 7;
    pub const OSC2_WAVE: u32 = 8;
    pub const OSC2_PITCH: u32 = 9;
    pub const OSC2_DETUNE: u32 = 10;
    pub const OSC2_LEVEL: u32 = 11;
    pub const OSC2_PW: u32 = 12;
    pub const FILTER_TYPE: u32 = 13;
    pub const FILTER_CUTOFF: u32 = 14;
    pub const FILTER_RES: u32 = 15;
    pub const FILTER_DRIVE: u32 = 16;
    pub const FILTER_ENV_AMT: u32 = 17;
    pub const FILTER_KBD: u32 = 18;
    pub const ENV_ATTACK: u32 = 19;
    pub const ENV_DECAY: u32 = 20;
    pub const ENV_SUSTAIN: u32 = 21;
    pub const ENV_RELEASE: u32 = 22;
    pub const LFO_ON: u32 = 23;
    pub const LFO_WAVE: u32 = 24;
    pub const LFO_RATE: u32 = 25;
    pub const LFO_DEPTH: u32 = 26;
    pub const LFO_TARGET: u32 = 27;
    pub const LFO_SYNC: u32 = 28;
    pub const FX_REVERB_ON: u32 = 29;
    pub const FX_REVERB_SIZE: u32 = 30;
    pub const FX_REVERB_MIX: u32 = 31;
    pub const FX_DELAY_ON: u32 = 32;
    pub const FX_DELAY_SYNC: u32 = 33;
    pub const FX_DELAY_FB: u32 = 34;
    pub const FX_DELAY_MIX: u32 = 35;
    pub const GLIDE: u32 = 36;
    pub const TEMPO: u32 = 37;
    pub const PITCH_BEND_RANGE: u32 = 38;
    pub const OSC1_PAN: u32 = 39;
    pub const OSC2_PAN: u32 = 40;
    pub const MASTER_TUNE: u32 = 41;
    pub const VOICE_MODE: u32 = 42;
    pub const FX_CHORUS_ON: u32 = 43;
    pub const FX_CHORUS_DEPTH: u32 = 44;
    pub const FX_CHORUS_RATE: u32 = 45;
    pub const FX_CHORUS_MIX: u32 = 46;
    pub const FX_FLANGER_ON: u32 = 47;
    pub const FX_FLANGER_RATE: u32 = 48;
    pub const FX_FLANGER_FB: u32 = 49;
    pub const FX_FLANGER_MIX: u32 = 50;
    pub const FX_PHASER_ON: u32 = 51;
    pub const FX_PHASER_RATE: u32 = 52;
    pub const FX_PHASER_FB: u32 = 53;
    pub const FX_PHASER_MIX: u32 = 54;
    pub const FX_DRIVE_ON: u32 = 55;
    pub const FX_DRIVE_AMT: u32 = 56;
    pub const FX_DRIVE_MIX: u32 = 57;
    pub const FILTER_ENV_ATTACK: u32 = 58;
    pub const FILTER_ENV_DECAY: u32 = 59;
    pub const FILTER_ENV_SUSTAIN: u32 = 60;
    pub const FILTER_ENV_RELEASE: u32 = 61;
    pub const LFO2_ON: u32 = 62;
    pub const LFO2_WAVE: u32 = 63;
    pub const LFO2_RATE: u32 = 64;
    pub const LFO2_DEPTH: u32 = 65;
    pub const LFO2_TARGET: u32 = 66;
    pub const FX_REVERB_DAMP: u32 = 67;
    pub const FX_REVERB_WIDTH: u32 = 68;
    pub const FX_REVERB_PREDELAY: u32 = 69;
    pub const OSC1_UNISON: u32 = 70;
    pub const OSC1_SPREAD: u32 = 71;
    pub const OSC2_UNISON: u32 = 72;
    pub const OSC2_SPREAD: u32 = 73;
    pub const LFO_RETRIG: u32 = 74;
    pub const LFO_ONESHOT: u32 = 75;
    pub const LFO2_RETRIG: u32 = 76;
    pub const LFO2_ONESHOT: u32 = 77;
    /// Per-patch output trim (presets only; no UI control).
    pub const PATCH_GAIN: u32 = 78;
    /// Play the imported single-cycle wavetable instead of a factory bank
    /// (A6.2). Ignored when nothing has been imported.
    pub const WT_USER: u32 = 79;
    /// Delay feedback damping: how much top end each repeat loses (A5).
    pub const FX_DELAY_DAMP: u32 = 80;
    /// Delay ping-pong: cross-feed the channels so echoes alternate (A5).
    pub const FX_DELAY_PINGPONG: u32 = 81;
    /// Chain position 1..6: which effect runs there (`FxKind`).
    pub const FX_CHAIN1: u32 = 82;
    pub const FX_CHAIN2: u32 = 83;
    pub const FX_CHAIN3: u32 = 84;
    pub const FX_CHAIN4: u32 = 85;
    pub const FX_CHAIN5: u32 = 86;
    pub const FX_CHAIN6: u32 = 87;
    /// Which engine the reverb section runs: 0 = algorithmic, 1 = an imported
    /// impulse response (A5).
    pub const FX_REVERB_MODE: u32 = 94;
    /// Output trim for the impulse-response reverb, whose level depends on the
    /// response rather than on a `SIZE` control.
    pub const FX_CONV_TRIM: u32 = 95;
    /// Sampler: the MIDI note at which the imported sample plays at its recorded
    /// pitch (A).
    pub const SMP_ROOT: u32 = 96;
    /// Sampler: 0 = one-shot, 1 = loop, 2 = ping-pong.
    pub const SMP_MODE: u32 = 97;
    pub const SMP_LOOP_START: u32 = 98;
    pub const SMP_LOOP_END: u32 = 99;
    /// 1 = the effect at that position runs as a *send* (its wet output is added
    /// to the unprocessed signal) instead of an insert.
    pub const FX_PARALLEL1: u32 = 88;
    pub const FX_PARALLEL2: u32 = 89;
    pub const FX_PARALLEL3: u32 = 90;
    pub const FX_PARALLEL4: u32 = 91;
    pub const FX_PARALLEL5: u32 = 92;
    pub const FX_PARALLEL6: u32 = 93;
    /// 1 = route the effect positions through the graph below instead of the
    /// legacy chain (A1). 0 keeps every old patch exactly as it was.
    pub const FX_GRAPH: u32 = 100;
    /// Node input 1 source, one per node: 0 = nothing, 1 = the dry bus,
    /// 2..=7 = the output of node 1..6.
    pub const FX_NODE_IN1: u32 = 101;
    /// Gain on node input 1.
    pub const FX_NODE_IN1_GAIN: u32 = 107;
    /// Node input 2 source (same encoding); 0 unless a node sums two signals.
    pub const FX_NODE_IN2: u32 = 113;
    pub const FX_NODE_IN2_GAIN: u32 = 119;
    /// 1 = this node's output reaches the mix bus.
    pub const FX_NODE_TO_OUT: u32 = 125;
    /// Gain on the way to the mix bus.
    pub const FX_NODE_OUT_GAIN: u32 = 131;
    /// How far OSC 2 pushes OSC 1's phase around, 0..1 (P6.1). 0 keeps the
    /// oscillators exactly as they were before this existed, which is why the
    /// parameter is appended here rather than slotted in next to the other
    /// oscillator controls: ids are the share-code wire format.
    pub const OSC_FM: u32 = 137;
    /// Ring modulation between OSC 1 and OSC 2, 0 = the plain mix, 1 = only the
    /// product (P6.1).
    pub const OSC_RING: u32 = 138;
    /// Hard sync: OSC 2 restarts OSC 1's cycle (P6.2).
    pub const OSC1_SYNC: u32 = 139;
    /// Sub oscillator per oscillator: 0 = off, 1 = one octave down, 2 = two.
    pub const OSC1_SUB: u32 = 140;
    pub const OSC1_SUB_LEVEL: u32 = 141;
    pub const OSC2_SUB: u32 = 142;
    pub const OSC2_SUB_LEVEL: u32 = 143;
    /// White noise blended into the voice, after the oscillators (P6.2).
    pub const NOISE_MIX: u32 = 144;
}

/// Highest parameter id + 1.
pub const PARAM_COUNT: usize = 145;

/// Positions in the effect chain (A5). Six is one per effect: the chain is a
/// permutation, so reordering can never lose an effect or double one up.
pub const FX_SLOTS: usize = 6;

/// Which effect runs at a chain position.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FxKind {
    /// Empty position: nothing runs here.
    None,
    Delay,
    Reverb,
    Chorus,
    Flanger,
    Phaser,
    Drive,
}

impl FxKind {
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => FxKind::Delay,
            2 => FxKind::Reverb,
            3 => FxKind::Chorus,
            4 => FxKind::Flanger,
            5 => FxKind::Phaser,
            6 => FxKind::Drive,
            _ => FxKind::None,
        }
    }

    /// Insert effects are blended with the dry signal; a send is added.
    ///
    /// Delay and reverb already add their wet signal inside their own mix, so
    /// for them the parallel switch has nothing to change (and the UI does not
    /// offer it).
    pub fn can_be_parallel(self) -> bool {
        matches!(self, FxKind::Chorus | FxKind::Flanger | FxKind::Phaser | FxKind::Drive)
    }
}

/// Number of keys the tuning table covers (MIDI 0..127).
pub const TUNING_NOTES: usize = 128;

/// Continuous parameters are smoothed across blocks (one-pole, ~20 ms) so the
/// host can drag a knob without producing zipper noise. Discrete/stepped
/// parameters (waveforms, switches, sync, voice mode) change immediately.
pub fn is_continuous(param_id: u32) -> bool {
    use id as p;
    matches!(
        param_id,
        p::OSC1_PITCH
            | p::OSC1_DETUNE
            | p::OSC1_LEVEL
            | p::OSC1_PW
            | p::OSC1_PAN
            | p::OSC2_PITCH
            | p::OSC2_DETUNE
            | p::OSC2_LEVEL
            | p::OSC2_PW
            | p::OSC2_PAN
            | p::FILTER_CUTOFF
            | p::FILTER_RES
            | p::FILTER_DRIVE
            | p::FILTER_ENV_AMT
            | p::ENV_ATTACK
            | p::ENV_DECAY
            | p::ENV_SUSTAIN
            | p::ENV_RELEASE
            | p::LFO_RATE
            | p::LFO_DEPTH
            | p::FX_REVERB_SIZE
            | p::FX_REVERB_MIX
            | p::FX_REVERB_DAMP
            | p::FX_REVERB_WIDTH
            | p::FX_REVERB_PREDELAY
            | p::OSC1_SPREAD
            | p::OSC2_SPREAD
            | p::OSC_FM
            | p::OSC_RING
            | p::OSC1_SUB_LEVEL
            | p::OSC2_SUB_LEVEL
            | p::NOISE_MIX
            | p::FX_DELAY_FB
            | p::FX_DELAY_MIX
            | p::GLIDE
            | p::TEMPO
            | p::PITCH_BEND_RANGE
            | p::MASTER_TUNE
            | p::FX_CHORUS_DEPTH
            | p::FX_CHORUS_RATE
            | p::FX_CHORUS_MIX
            | p::FX_FLANGER_RATE
            | p::FX_FLANGER_FB
            | p::FX_FLANGER_MIX
            | p::FX_PHASER_RATE
            | p::FX_PHASER_FB
            | p::FX_PHASER_MIX
            | p::FX_DRIVE_AMT
            | p::FX_DRIVE_MIX
            | p::FILTER_ENV_ATTACK
            | p::FILTER_ENV_DECAY
            | p::FILTER_ENV_SUSTAIN
            | p::FILTER_ENV_RELEASE
            | p::LFO2_RATE
            | p::LFO2_DEPTH
    )
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wave {
    Sine,
    Triangle,
    Saw,
    Square,
    Pulse,
    Noise,
    /// Pink noise (-3 dB/octave), generated in Rust.
    Pink,
    /// Brown noise (-6 dB/octave), generated in Rust.
    Brown,
    /// Harmonic-table oscillator (A6.2). The pulse-width control picks the
    /// recipe, since a table has no pulse width of its own.
    Wavetable,
    /// Imported sample, played back at the note's rate (A). Needs a file: with
    /// nothing imported it is silent rather than a factory sound.
    Sample,
}

impl Wave {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => Wave::Triangle,
            2 => Wave::Saw,
            3 => Wave::Square,
            4 => Wave::Pulse,
            5 => Wave::Noise,
            6 => Wave::Pink,
            7 => Wave::Brown,
            8 => Wave::Wavetable,
            9 => Wave::Sample,
            _ => Wave::Sine,
        }
    }

    /// Waveform id understood by the DaisySP bridge, or `None` for noise, which
    /// is generated in Rust.
    pub fn daisy_id(self) -> Option<u32> {
        match self {
            Wave::Sine => Some(0),                    // WAVE_SIN
            Wave::Triangle => Some(5),                // WAVE_POLYBLEP_TRI
            Wave::Saw => Some(6),                     // WAVE_POLYBLEP_SAW
            Wave::Square => Some(7),                  // WAVE_POLYBLEP_SQUARE
            Wave::Pulse => Some(7),                   // POLYBLEP_SQUARE + narrow pw
            Wave::Noise | Wave::Pink | Wave::Brown | Wave::Wavetable | Wave::Sample => None,
        }
    }

    pub fn is_pulse(self) -> bool {
        matches!(self, Wave::Pulse)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FilterType {
    Lp,
    Hp,
    Bp,
    Notch,
    /// Feedback comb tuned to the cutoff: rings at that pitch.
    Comb,
    /// Three parallel band-passes tuned to the vowels A-E-I-O-U; the cutoff
    /// knob morphs between them.
    Formant,
}

impl FilterType {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => FilterType::Hp,
            2 => FilterType::Bp,
            3 => FilterType::Notch,
            4 => FilterType::Comb,
            5 => FilterType::Formant,
            _ => FilterType::Lp,
        }
    }

    pub fn to_u32(self) -> u32 {
        match self {
            FilterType::Lp => 0,
            FilterType::Hp => 1,
            FilterType::Bp => 2,
            FilterType::Notch => 3,
            FilterType::Comb => 4,
            FilterType::Formant => 5,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LfoTarget {
    Cutoff,
    Pitch,
    Volume,
    Pwm,
}

impl LfoTarget {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => LfoTarget::Pitch,
            2 => LfoTarget::Volume,
            3 => LfoTarget::Pwm,
            _ => LfoTarget::Cutoff,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LfoWave {
    Sine,
    Triangle,
    Square,
    Saw,
}

impl LfoWave {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => LfoWave::Triangle,
            2 => LfoWave::Square,
            3 => LfoWave::Saw,
            _ => LfoWave::Sine,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModSrc {
    Lfo,
    Env,
    ModWheel,
    Velocity,
    /// Second LFO (free-running, same signal for every voice).
    Lfo2,
    /// Channel pressure from the controller.
    Aftertouch,
    /// A different random value per note, held for the note's lifetime.
    Random,
    /// Note position relative to middle C, ±1 over ±48 semitones.
    KeyTrack,
}

impl ModSrc {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => ModSrc::Env,
            2 => ModSrc::ModWheel,
            3 => ModSrc::Velocity,
            4 => ModSrc::Lfo2,
            5 => ModSrc::Aftertouch,
            6 => ModSrc::Random,
            7 => ModSrc::KeyTrack,
            _ => ModSrc::Lfo,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModDst {
    Cutoff,
    Pitch,
    Volume,
    Pwm,
    Pan,
    Resonance,
    /// Phase-modulation depth (P6.1) — an envelope here is the classic FM
    /// brightness sweep.
    Fm,
    /// Ring-modulation amount (P6.1).
    Ring,
}

impl ModDst {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => ModDst::Pitch,
            2 => ModDst::Volume,
            3 => ModDst::Pwm,
            4 => ModDst::Pan,
            5 => ModDst::Resonance,
            6 => ModDst::Fm,
            7 => ModDst::Ring,
            _ => ModDst::Cutoff,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ModRoute {
    pub src: ModSrc,
    pub dst: ModDst,
    pub amount: f32,
    pub enabled: bool,
}

impl ModRoute {
    pub const fn empty() -> Self {
        Self {
            src: ModSrc::Lfo,
            dst: ModDst::Cutoff,
            amount: 0.0,
            enabled: false,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct OscParams {
    pub on: bool,
    pub wave: Wave,
    pub pitch: f32,
    pub detune: f32,
    pub level: f32,
    pub pw: f32,
    pub pan: f32,
    /// Unison stack size, 1..=MAX_UNISON.
    pub unison: u32,
    /// Detune spread across the stack, 0..1 (±35 cents at full).
    pub spread: f32,
    /// Sub oscillator: 0 = off, 1 = one octave below, 2 = two octaves below.
    pub sub: u32,
    /// Sub oscillator level, 0..1.
    pub sub_level: f32,
}

impl OscParams {
    pub const fn new(wave: Wave) -> Self {
        Self {
            on: true,
            wave,
            pitch: 0.0,
            detune: 0.0,
            level: 0.6,
            pw: 0.5,
            pan: 0.0,
            unison: 1,
            spread: 0.35,
            sub: 0,
            sub_level: 0.4,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct FilterParams {
    pub kind: FilterType,
    pub cutoff: f32,
    pub res: f32,
    pub drive: f32,
    pub env_amt: f32,
    pub kbd: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct EnvParams {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct LfoParams {
    pub on: bool,
    pub wave: LfoWave,
    pub rate: f32,
    pub depth: f32,
    pub target: LfoTarget,
    pub sync: bool,
    /// Restart the cycle for every new note (per-voice LFO) instead of running
    /// free for the whole patch.
    pub retrigger: bool,
    /// Run a single cycle and hold its final value.
    pub one_shot: bool,
}

/// Where a node input takes its signal from (A1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GraphInput {
    /// 0 = nothing, 1 = the dry (pre-effect) bus, 2..=7 = node 1..=6.
    pub src: u8,
    pub gain: f32,
}

impl GraphInput {
    pub const NONE: Self = Self { src: 0, gain: 1.0 };
}

/// The dry bus; the first source a node can read.
pub const GRAPH_DRY: u8 = 1;
/// Source code for node `slot` (0-based).
pub const fn graph_node_src(slot: usize) -> u8 {
    slot as u8 + 2
}

/// Which per-node graph field a parameter id addresses.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GraphParam {
    In1Src,
    In1Gain,
    In2Src,
    In2Gain,
    ToOut,
    OutGain,
}

/// Decode a graph parameter id into (node index, field). `None` for every other
/// parameter.
pub fn graph_param_field(param_id: u32) -> Option<(u32, GraphParam)> {
    let ranges: [(u32, GraphParam); 6] = [
        (id::FX_NODE_IN1, GraphParam::In1Src),
        (id::FX_NODE_IN1_GAIN, GraphParam::In1Gain),
        (id::FX_NODE_IN2, GraphParam::In2Src),
        (id::FX_NODE_IN2_GAIN, GraphParam::In2Gain),
        (id::FX_NODE_TO_OUT, GraphParam::ToOut),
        (id::FX_NODE_OUT_GAIN, GraphParam::OutGain),
    ];
    for (base, field) in ranges {
        if param_id >= base && param_id < base + FX_SLOTS as u32 {
            return Some((param_id - base, field));
        }
    }
    None
}

/// Clamp a written value into a valid source code. A code that names nothing
/// reads as "not connected", which is what the renderer does with it anyway.
pub fn graph_src_code(value: f32) -> u8 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    (value as u32).min(FX_SLOTS as u32 + 1) as u8
}

#[derive(Clone, Copy, Debug)]
pub struct FxParams {
    pub reverb_on: bool,
    pub reverb_size: f32,
    pub reverb_mix: f32,
    pub reverb_damp: f32,
    pub reverb_width: f32,
    pub reverb_predelay: f32,
    /// 0 = algorithmic reverb, 1 = imported impulse response.
    pub reverb_mode: u32,
    pub conv_trim: f32,
    pub delay_on: bool,
    pub delay_sync: u32,
    pub delay_fb: f32,
    pub delay_mix: f32,
    pub delay_damp: f32,
    pub delay_ping_pong: bool,
    /// Effect chain, one [`FxKind`] per position, in signal order (A5).
    pub chain: [FxKind; FX_SLOTS],
    /// Positions that run as sends rather than inserts.
    pub parallel: [bool; FX_SLOTS],
    /// Feed-forward routing for the effect nodes (A1). While this is false the
    /// chain above runs exactly as it always has, which is how every patch
    /// written before the graph existed keeps its sound.
    pub graph: bool,
    /// Up to two inputs per node. An input's `src` may only point at the dry
    /// bus or at an *earlier* node; anything else is ignored when rendering, so
    /// the graph can never contain a loop.
    pub node_in: [[GraphInput; 2]; FX_SLOTS],
    /// Nodes whose output reaches the mix bus, and at what gain.
    pub node_to_out: [bool; FX_SLOTS],
    pub node_out_gain: [f32; FX_SLOTS],
    pub chorus_on: bool,
    pub chorus_depth: f32,
    pub chorus_rate: f32,
    pub chorus_mix: f32,
    pub flanger_on: bool,
    pub flanger_rate: f32,
    pub flanger_fb: f32,
    pub flanger_mix: f32,
    pub phaser_on: bool,
    pub phaser_rate: f32,
    pub phaser_fb: f32,
    pub phaser_mix: f32,
    pub drive_on: bool,
    pub drive_amt: f32,
    pub drive_mix: f32,
}

/// Complete engine parameter snapshot. `Copy` keeps the render loop allocation
/// free and lets the ABI publish a consistent view.
#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub master_volume: f32,
    /// Per-patch output trim, set by presets so switching patches does not jump
    /// in level. Deliberately not a UI control: it belongs to the patch, not to
    /// the player's master volume.
    pub patch_gain: f32,
    /// Prefer the imported single-cycle wavetable over the factory banks.
    pub wt_user: bool,
    /// Sampler settings (A): the note the imported sample plays at its recorded
    /// pitch, how it loops, and where the loop sits inside it.
    pub sample_root: f32,
    pub sample_mode: u32,
    pub sample_loop_start: f32,
    pub sample_loop_end: f32,
    pub master_tune: f32,
    /// 0 = poly, 1 = mono (retrigger), 2 = legato.
    pub voice_mode: u32,
    pub pitch_bend_range: f32,
    pub tempo: f32,
    pub glide: f32,
    /// OSC 2 -> OSC 1 phase-modulation depth, 0..1 (0 = no modulation).
    pub osc_fm: f32,
    /// Ring-modulation amount between the two oscillators, 0..1.
    pub osc_ring: f32,
    /// Hard sync: OSC 2 restarts OSC 1's cycle (P6.2).
    pub osc_sync: bool,
    /// White noise blended into the voice after the oscillators, 0..1.
    pub noise_mix: f32,
    pub osc: [OscParams; 2],
    pub filter: FilterParams,
    pub env: EnvParams,
    pub lfo: LfoParams,
    pub lfo2: LfoParams,
    pub filter_env: EnvParams,
    pub fx: FxParams,
    pub routes: [ModRoute; MOD_ROUTES],
}

impl Params {
    pub const fn new() -> Self {
        Self {
            master_volume: 0.75,
            patch_gain: 1.0,
            wt_user: false,
            // C4 is the note most one-shots are played at, and the default loop
            // covers the whole sample.
            sample_root: 60.0,
            sample_mode: 0,
            sample_loop_start: 0.0,
            sample_loop_end: 1.0,
            master_tune: 0.0,
            voice_mode: 0,
            pitch_bend_range: 2.0,
            tempo: 120.0,
            glide: 0.0,
            osc_fm: 0.0,
            osc_ring: 0.0,
            osc_sync: false,
            noise_mix: 0.0,
            osc: [OscParams::new(Wave::Sine), OscParams::new(Wave::Saw)],
            filter: FilterParams {
                kind: FilterType::Lp,
                cutoff: 18000.0,
                res: 0.05,
                drive: 0.0,
                env_amt: 0.0,
                kbd: false,
            },
            env: EnvParams {
                attack: 0.002,
                decay: 0.2,
                sustain: 0.8,
                release: 0.3,
            },
            lfo: LfoParams {
                on: false,
                wave: LfoWave::Sine,
                rate: 5.0,
                depth: 0.3,
                target: LfoTarget::Cutoff,
                sync: false,
                retrigger: false,
                one_shot: false,
            },
            lfo2: LfoParams {
                on: false,
                wave: LfoWave::Triangle,
                rate: 0.5,
                depth: 0.3,
                target: LfoTarget::Cutoff,
                sync: false,
                retrigger: false,
                one_shot: false,
            },
            filter_env: EnvParams {
                attack: 0.01,
                decay: 0.3,
                sustain: 0.5,
                release: 0.3,
            },
            fx: FxParams {
                reverb_on: false,
                reverb_size: 0.4,
                reverb_mix: 0.1,
                reverb_damp: 0.35,
                reverb_width: 0.8,
                reverb_predelay: 0.012,
                reverb_mode: 0,
                conv_trim: 1.0,
                delay_on: false,
                delay_sync: 2,
                delay_fb: 0.3,
                delay_mix: 0.1,
                delay_damp: 0.35,
                delay_ping_pong: false,
                // The order effects have always run in. Keeping it as the
                // default is what makes every existing patch sound the same.
                chain: [
                    FxKind::Delay,
                    FxKind::Reverb,
                    FxKind::Chorus,
                    FxKind::Flanger,
                    FxKind::Phaser,
                    FxKind::Drive,
                ],
                parallel: [false; FX_SLOTS],
                graph: false,
                // The default graph is the legacy chain: node 1 reads the dry
                // bus, each later node reads the one before it, and the last
                // node feeds the output.
                node_in: [
                    [GraphInput { src: GRAPH_DRY, gain: 1.0 }, GraphInput::NONE],
                    [GraphInput { src: graph_node_src(0), gain: 1.0 }, GraphInput::NONE],
                    [GraphInput { src: graph_node_src(1), gain: 1.0 }, GraphInput::NONE],
                    [GraphInput { src: graph_node_src(2), gain: 1.0 }, GraphInput::NONE],
                    [GraphInput { src: graph_node_src(3), gain: 1.0 }, GraphInput::NONE],
                    [GraphInput { src: graph_node_src(4), gain: 1.0 }, GraphInput::NONE],
                ],
                node_to_out: [false, false, false, false, false, true],
                node_out_gain: [1.0; FX_SLOTS],
                chorus_on: false,
                chorus_depth: 0.5,
                chorus_rate: 0.6,
                chorus_mix: 0.4,
                flanger_on: false,
                flanger_rate: 0.3,
                flanger_fb: 0.5,
                flanger_mix: 0.4,
                phaser_on: false,
                phaser_rate: 0.4,
                phaser_fb: 0.6,
                phaser_mix: 0.5,
                drive_on: false,
                drive_amt: 0.4,
                drive_mix: 0.6,
            },
            routes: [
                ModRoute {
                    src: ModSrc::Lfo,
                    dst: ModDst::Cutoff,
                    amount: 0.8,
                    enabled: true,
                },
                ModRoute {
                    src: ModSrc::Env,
                    dst: ModDst::Cutoff,
                    amount: 0.55,
                    enabled: true,
                },
                ModRoute {
                    src: ModSrc::Lfo,
                    dst: ModDst::Pitch,
                    amount: 0.18,
                    enabled: false,
                },
                ModRoute {
                    src: ModSrc::ModWheel,
                    dst: ModDst::Cutoff,
                    amount: 0.4,
                    enabled: false,
                },
                ModRoute::empty(),
                ModRoute::empty(),
                ModRoute::empty(),
                ModRoute::empty(),
            ],
        }
    }

    /// Apply a continuous parameter. Out-of-range values are clamped so a
    /// malformed message can never destabilise the DSP.
    pub fn set(&mut self, param_id: u32, value: f32) {
        use id as p;
        // A non-finite value can never reach the DSP (f32::clamp propagates NaN).
        let value = if value.is_finite() { value } else { 0.0 };
        // The graph parameters are contiguous per-node ranges, and Rust match
        // patterns cannot hold a range bound computed from a constant.
        if let Some((index, field)) = graph_param_field(param_id) {
            let slot = index as usize;
            if slot < FX_SLOTS {
                match field {
                    GraphParam::In1Src => self.fx.node_in[slot][0].src = graph_src_code(value),
                    GraphParam::In1Gain => self.fx.node_in[slot][0].gain = value.clamp(0.0, 4.0),
                    GraphParam::In2Src => self.fx.node_in[slot][1].src = graph_src_code(value),
                    GraphParam::In2Gain => self.fx.node_in[slot][1].gain = value.clamp(0.0, 4.0),
                    GraphParam::ToOut => self.fx.node_to_out[slot] = value >= 0.5,
                    GraphParam::OutGain => self.fx.node_out_gain[slot] = value.clamp(0.0, 4.0),
                }
            }
            return;
        }
        match param_id {
            p::MASTER_VOLUME => self.master_volume = clamp01(value),
            p::PATCH_GAIN => self.patch_gain = value.clamp(0.0, 8.0),
            p::WT_USER => self.wt_user = value >= 0.5,
            p::MASTER_TUNE => self.master_tune = value.clamp(-24.0, 24.0),
            p::VOICE_MODE => self.voice_mode = (value as u32).min(2),
            p::PITCH_BEND_RANGE => self.pitch_bend_range = value.clamp(0.0, 24.0),
            p::TEMPO => self.tempo = value.clamp(20.0, 300.0),
            p::GLIDE => self.glide = clamp01(value),
            p::OSC_FM => self.osc_fm = clamp01(value),
            p::OSC_RING => self.osc_ring = clamp01(value),
            p::OSC1_SYNC => self.osc_sync = value >= 0.5,
            p::NOISE_MIX => self.noise_mix = clamp01(value),
            p::OSC1_SUB => self.osc[0].sub = (value as u32).min(2),
            p::OSC1_SUB_LEVEL => self.osc[0].sub_level = clamp01(value),
            p::OSC2_SUB => self.osc[1].sub = (value as u32).min(2),
            p::OSC2_SUB_LEVEL => self.osc[1].sub_level = clamp01(value),
            p::OSC1_ON => self.osc[0].on = value > 0.5,
            p::OSC1_WAVE => self.osc[0].wave = Wave::from_u32(value as u32),
            p::OSC1_PITCH => self.osc[0].pitch = value.clamp(-48.0, 48.0),
            p::OSC1_DETUNE => self.osc[0].detune = value.clamp(-100.0, 100.0),
            p::OSC1_LEVEL => self.osc[0].level = clamp01(value),
            p::OSC1_PW => self.osc[0].pw = value.clamp(0.05, 0.95),
            p::OSC1_PAN => self.osc[0].pan = value.clamp(-1.0, 1.0),
            p::OSC1_UNISON => self.osc[0].unison = (value as u32).clamp(1, MAX_UNISON),
            p::OSC1_SPREAD => self.osc[0].spread = clamp01(value),
            p::OSC2_ON => self.osc[1].on = value > 0.5,
            p::OSC2_WAVE => self.osc[1].wave = Wave::from_u32(value as u32),
            p::OSC2_PITCH => self.osc[1].pitch = value.clamp(-48.0, 48.0),
            p::OSC2_DETUNE => self.osc[1].detune = value.clamp(-100.0, 100.0),
            p::OSC2_LEVEL => self.osc[1].level = clamp01(value),
            p::OSC2_PW => self.osc[1].pw = value.clamp(0.05, 0.95),
            p::OSC2_PAN => self.osc[1].pan = value.clamp(-1.0, 1.0),
            p::OSC2_UNISON => self.osc[1].unison = (value as u32).clamp(1, MAX_UNISON),
            p::OSC2_SPREAD => self.osc[1].spread = clamp01(value),
            p::FILTER_TYPE => self.filter.kind = FilterType::from_u32(value as u32),
            p::FILTER_CUTOFF => self.filter.cutoff = value.clamp(20.0, 20000.0),
            p::FILTER_RES => self.filter.res = clamp01(value),
            p::FILTER_DRIVE => self.filter.drive = clamp01(value),
            p::FILTER_ENV_AMT => self.filter.env_amt = clamp01(value),
            p::FILTER_KBD => self.filter.kbd = value > 0.5,
            p::ENV_ATTACK => self.env.attack = value.clamp(0.0005, 8.0),
            p::ENV_DECAY => self.env.decay = value.clamp(0.001, 12.0),
            p::ENV_SUSTAIN => self.env.sustain = clamp01(value),
            p::ENV_RELEASE => self.env.release = value.clamp(0.005, 16.0),
            p::LFO_ON => self.lfo.on = value > 0.5,
            p::LFO_WAVE => self.lfo.wave = LfoWave::from_u32(value as u32),
            p::LFO_RATE => self.lfo.rate = value.clamp(0.02, 40.0),
            p::LFO_DEPTH => self.lfo.depth = clamp01(value),
            p::LFO_TARGET => self.lfo.target = LfoTarget::from_u32(value as u32),
            p::LFO_SYNC => self.lfo.sync = value > 0.5,
            p::FX_REVERB_ON => self.fx.reverb_on = value > 0.5,
            p::FX_REVERB_SIZE => self.fx.reverb_size = clamp01(value),
            p::FX_REVERB_MIX => self.fx.reverb_mix = clamp01(value),
            p::FX_REVERB_DAMP => self.fx.reverb_damp = clamp01(value),
            p::FX_REVERB_WIDTH => self.fx.reverb_width = clamp01(value),
            p::FX_REVERB_PREDELAY => self.fx.reverb_predelay = value.clamp(0.0, 0.1),
            p::FX_REVERB_MODE => self.fx.reverb_mode = if value >= 0.5 { 1 } else { 0 },
            p::FX_CONV_TRIM => self.fx.conv_trim = value.clamp(0.0, 4.0),
            p::SMP_ROOT => self.sample_root = value.clamp(0.0, 127.0),
            p::SMP_MODE => self.sample_mode = (value as u32).min(2),
            p::SMP_LOOP_START => self.sample_loop_start = clamp01(value),
            p::SMP_LOOP_END => self.sample_loop_end = clamp01(value),
            p::FX_DELAY_ON => self.fx.delay_on = value > 0.5,
            p::FX_DELAY_SYNC => self.fx.delay_sync = (value as u32).min(3),
            p::FX_DELAY_FB => self.fx.delay_fb = value.clamp(0.0, 0.95),
            p::FX_DELAY_MIX => self.fx.delay_mix = clamp01(value),
            p::FX_DELAY_DAMP => self.fx.delay_damp = clamp01(value),
            p::FX_DELAY_PINGPONG => self.fx.delay_ping_pong = value >= 0.5,
            p::FX_CHAIN1..=p::FX_CHAIN6 => {
                let slot = (param_id - p::FX_CHAIN1) as usize;
                self.fx.chain[slot] = FxKind::from_u32(value as u32);
            }
            p::FX_PARALLEL1..=p::FX_PARALLEL6 => {
                let slot = (param_id - p::FX_PARALLEL1) as usize;
                self.fx.parallel[slot] = value >= 0.5;
            }
            p::FX_GRAPH => self.fx.graph = value >= 0.5,
            p::FX_CHORUS_ON => self.fx.chorus_on = value > 0.5,
            p::FX_CHORUS_DEPTH => self.fx.chorus_depth = clamp01(value),
            p::FX_CHORUS_RATE => self.fx.chorus_rate = value.clamp(0.02, 10.0),
            p::FX_CHORUS_MIX => self.fx.chorus_mix = clamp01(value),
            p::FX_FLANGER_ON => self.fx.flanger_on = value > 0.5,
            p::FX_FLANGER_RATE => self.fx.flanger_rate = value.clamp(0.02, 10.0),
            p::FX_FLANGER_FB => self.fx.flanger_fb = value.clamp(0.0, 0.95),
            p::FX_FLANGER_MIX => self.fx.flanger_mix = clamp01(value),
            p::FX_PHASER_ON => self.fx.phaser_on = value > 0.5,
            p::FX_PHASER_RATE => self.fx.phaser_rate = value.clamp(0.02, 10.0),
            p::FX_PHASER_FB => self.fx.phaser_fb = value.clamp(0.0, 0.95),
            p::FX_PHASER_MIX => self.fx.phaser_mix = clamp01(value),
            p::FX_DRIVE_ON => self.fx.drive_on = value > 0.5,
            p::FX_DRIVE_AMT => self.fx.drive_amt = clamp01(value),
            p::FX_DRIVE_MIX => self.fx.drive_mix = clamp01(value),
            p::FILTER_ENV_ATTACK => self.filter_env.attack = value.clamp(0.0005, 8.0),
            p::FILTER_ENV_DECAY => self.filter_env.decay = value.clamp(0.001, 12.0),
            p::FILTER_ENV_SUSTAIN => self.filter_env.sustain = clamp01(value),
            p::FILTER_ENV_RELEASE => self.filter_env.release = value.clamp(0.005, 16.0),
            p::LFO2_ON => self.lfo2.on = value > 0.5,
            p::LFO2_WAVE => self.lfo2.wave = LfoWave::from_u32(value as u32),
            p::LFO2_RATE => self.lfo2.rate = value.clamp(0.02, 40.0),
            p::LFO2_DEPTH => self.lfo2.depth = clamp01(value),
            p::LFO2_TARGET => self.lfo2.target = LfoTarget::from_u32(value as u32),
            p::LFO_RETRIG => self.lfo.retrigger = value > 0.5,
            p::LFO_ONESHOT => self.lfo.one_shot = value > 0.5,
            p::LFO2_RETRIG => self.lfo2.retrigger = value > 0.5,
            p::LFO2_ONESHOT => self.lfo2.one_shot = value > 0.5,
            _ => {}
        }
    }

    pub fn set_route(&mut self, index: usize, src: u32, dst: u32, amount: f32, enabled: bool) {
        if index >= MOD_ROUTES {
            return;
        }
        self.routes[index] = ModRoute {
            src: ModSrc::from_u32(src),
            dst: ModDst::from_u32(dst),
            amount: amount.clamp(-1.0, 1.0),
            enabled,
        };
    }

    /// Delay time in seconds for the current sync division and tempo.
    pub fn delay_time_seconds(&self) -> f32 {
        let quarter = 60.0 / self.tempo.max(20.0);
        match self.fx.delay_sync {
            0 => quarter,          // 1/4
            1 => quarter * 0.75,   // 1/8 dotted
            2 => quarter * 0.5,    // 1/8
            _ => quarter * 0.25,   // 1/16
        }
    }
}

impl Default for Params {
    fn default() -> Self {
        Self::new()
    }
}

#[inline]
pub fn clamp01(v: f32) -> f32 {
    if v.is_nan() {
        0.0
    } else {
        v.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_extreme_values() {
        let mut p = Params::new();
        p.set(id::FILTER_CUTOFF, 1.0e9);
        assert_eq!(p.filter.cutoff, 20000.0);
        p.set(id::FILTER_CUTOFF, -5.0);
        assert_eq!(p.filter.cutoff, 20.0);
        p.set(id::ENV_SUSTAIN, f32::NAN);
        assert_eq!(p.env.sustain, 0.0);
        p.set(id::ENV_ATTACK, 0.0);
        assert!(p.env.attack >= 0.0005);
    }

    #[test]
    fn delay_sync_maps_to_tempo() {
        let mut p = Params::new();
        p.set(id::TEMPO, 120.0);
        p.set(id::FX_DELAY_SYNC, 0.0);
        assert!((p.delay_time_seconds() - 0.5).abs() < 1e-6);
        p.set(id::FX_DELAY_SYNC, 3.0);
        assert!((p.delay_time_seconds() - 0.125).abs() < 1e-6);
    }

    #[test]
    fn wave_and_filter_enums_round_trip() {
        for (raw, wave) in [
            (0, Wave::Sine),
            (1, Wave::Triangle),
            (2, Wave::Saw),
            (3, Wave::Square),
            (4, Wave::Pulse),
            (5, Wave::Noise),
        ] {
            assert_eq!(Wave::from_u32(raw), wave);
        }
        for (raw, kind) in [
            (0, FilterType::Lp),
            (1, FilterType::Hp),
            (2, FilterType::Bp),
            (3, FilterType::Notch),
        ] {
            assert_eq!(FilterType::from_u32(raw), kind);
            assert_eq!(kind.to_u32(), raw);
        }
    }
}
