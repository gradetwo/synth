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
}

/// Highest parameter id + 1 (ids are 0..=79).
pub const PARAM_COUNT: usize = 80;

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
            Wave::Noise | Wave::Pink | Wave::Brown | Wave::Wavetable => None,
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
}

impl ModDst {
    pub fn from_u32(v: u32) -> Self {
        match v {
            1 => ModDst::Pitch,
            2 => ModDst::Volume,
            3 => ModDst::Pwm,
            4 => ModDst::Pan,
            5 => ModDst::Resonance,
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

#[derive(Clone, Copy, Debug)]
pub struct FxParams {
    pub reverb_on: bool,
    pub reverb_size: f32,
    pub reverb_mix: f32,
    pub reverb_damp: f32,
    pub reverb_width: f32,
    pub reverb_predelay: f32,
    pub delay_on: bool,
    pub delay_sync: u32,
    pub delay_fb: f32,
    pub delay_mix: f32,
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
    pub master_tune: f32,
    /// 0 = poly, 1 = mono (retrigger), 2 = legato.
    pub voice_mode: u32,
    pub pitch_bend_range: f32,
    pub tempo: f32,
    pub glide: f32,
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
            master_tune: 0.0,
            voice_mode: 0,
            pitch_bend_range: 2.0,
            tempo: 120.0,
            glide: 0.0,
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
                delay_on: false,
                delay_sync: 2,
                delay_fb: 0.3,
                delay_mix: 0.1,
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
        match param_id {
            p::MASTER_VOLUME => self.master_volume = clamp01(value),
            p::PATCH_GAIN => self.patch_gain = value.clamp(0.0, 8.0),
            p::WT_USER => self.wt_user = value >= 0.5,
            p::MASTER_TUNE => self.master_tune = value.clamp(-24.0, 24.0),
            p::VOICE_MODE => self.voice_mode = (value as u32).min(2),
            p::PITCH_BEND_RANGE => self.pitch_bend_range = value.clamp(0.0, 24.0),
            p::TEMPO => self.tempo = value.clamp(20.0, 300.0),
            p::GLIDE => self.glide = clamp01(value),
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
            p::FX_DELAY_ON => self.fx.delay_on = value > 0.5,
            p::FX_DELAY_SYNC => self.fx.delay_sync = (value as u32).min(3),
            p::FX_DELAY_FB => self.fx.delay_fb = value.clamp(0.0, 0.95),
            p::FX_DELAY_MIX => self.fx.delay_mix = clamp01(value),
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
