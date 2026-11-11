// The nih_export_vst3 macro of this nih-plug rev leaves a trailing semicolon
// in expression position (its vst3_com::vtable expansion); that warning is
// inherent to the macro, not to this crate.
#![allow(semicolon_in_expressions_from_non_local_macros)]

//! GS1 VST3 instrument plugin.
//!
//! A nih-plug wrapper around `synth-core`. See the crate README for the
//! framework choice, the licensing consequences (the distributed plugin
//! binary is GPLv3 through `vst3-sys`), the single-instance guard, the
//! parameter mapping, and the preset-selector-instead-of-program-list design.
//!
//! The render core ([`render_with_events`] and friends) is decoupled from
//! nih-plug's `Buffer`/`ProcessContext` types so the headless tests can drive
//! the plugin's own render path directly.

mod generated;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use nih_plug::prelude::*;
use synth_core::engine::Engine;
use synth_core::params::MAX_BLOCK_SIZE;

pub use generated::{
    Gs1Params, ParamAccessor, PresetDef, DEFAULT_ROUTES, PARAM_ACCESSORS, PARAM_COUNT,
    PARAM_DEFAULTS, PARAM_IS_DISCRETE, PARAM_NAMES, PARAM_RANGES, PRESETS,
};

/// Polyphony used for engine init (matches the web engine default).
pub const POLYPHONY: usize = 16;

/// MIDI CC number for the modulation wheel.
pub const CC_MOD_WHEEL: u8 = 1;
/// MIDI CC number for all-notes-off.
pub const CC_ALL_NOTES_OFF: u8 = 123;

/// Whether the process singleton engine is currently owned by a live plugin
/// instance. The C++ voice state behind `synth-core` is process-global, so a
/// second live instance would share voice slots with the first and the two
/// would bleed into each other. The guard makes the second `initialize()`
/// fail cleanly instead.
static ENGINE_TAKEN: AtomicBool = AtomicBool::new(false);

/// A MIDI event in plugin terms, decoupled from nih-plug so tests can build
/// event lists without a host context.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MidiEvent {
    NoteOn {
        note: u8,
        velocity: f32,
    },
    NoteOff {
        note: u8,
    },
    /// Normalized pitch bend in `[0, 1]`; `0.5` means no bend.
    PitchBend {
        value: f32,
    },
    /// Normalized CC value in `[0, 1]`.
    ControlChange {
        cc: u8,
        value: f32,
    },
    /// Normalized channel pressure in `[0, 1]`.
    ChannelPressure {
        pressure: f32,
    },
}

/// Per-render mutable state.
///
/// nih-plug parameters are host-owned: plugin code can read them but cannot
/// write them (`ParamMut` is `pub(crate)`), so a preset switch cannot push
/// merged values back into the host parameters. The engine state is therefore
/// the source of truth, and host parameters are treated as wishes:
/// - On the first block, the current preset is applied unconditionally and
///   the host values are recorded as the baseline.
/// - On later blocks, only host values that changed since the previous block
///   are pushed to the engine. A host value that merely stayed at its
///   pre-switch value is stale, not a wish, and is ignored.
/// - The preset selector itself IS a host parameter, so it always restores
///   correctly across a host state save/reload.
///
/// Known v1 limitation: host-side tweaks made after a preset switch live in
/// the engine only and do not survive a host state save/reload (the host
/// saves the stale parameter values). The preset itself always restores.
/// Closing this needs a custom state blob (see the crate README).
pub struct RenderState {
    pub last_host: [f32; PARAM_COUNT],
    pub last_preset: i32,
    pub first_block: bool,
}

impl RenderState {
    pub fn new() -> Self {
        // NaN never equals a real value, so the first tracking pass records
        // the baseline without pushing anything.
        Self {
            last_host: [f32::NAN; PARAM_COUNT],
            last_preset: -1,
            first_block: true,
        }
    }
}

impl Default for RenderState {
    fn default() -> Self {
        Self::new()
    }
}

/// Apply the engine-correct default modulation routes (Rust codes, not TS
/// codes — see the crate README).
pub fn apply_routes(engine: &mut Engine) {
    for (index, (src, dst, amount, enabled)) in DEFAULT_ROUTES.iter().enumerate() {
        engine.set_route(index, *src, *dst, *amount, *enabled);
    }
}

/// The merged parameter values of a factory preset: `DEFAULT_PARAMS` plus
/// the preset overlay.
pub fn merged_preset(index: usize) -> [f32; PARAM_COUNT] {
    let mut merged = PARAM_DEFAULTS;
    for &(id, value) in PRESETS[index].overlay {
        merged[id as usize] = value;
    }
    merged
}

/// Apply a factory preset to the engine only (see [`RenderState`] for why
/// the nih-plug parameters are not written back): reset to `DEFAULT_PARAMS`,
/// overlay the preset, set the default routes.
pub fn apply_preset_to_engine(engine: &mut Engine, index: usize) {
    let merged = merged_preset(index);
    for acc in PARAM_ACCESSORS {
        engine.set_param(acc.id, merged[acc.id as usize]);
    }
    apply_routes(engine);
}

/// Apply one MIDI event.
///
/// Pitch bend: the engine's `pitch_bend` field is a NORMALIZED wheel value,
/// not semitones — the render path multiplies it by PITCH_BEND_RANGE
/// (engine.rs render: `pitch_mod = self.pitch_bend * params.pitch_bend_range`).
/// The setter's `semitones` parameter name and the ABI's are misleading, and
/// the web app's own path double-applies the range because of it (it sends
/// normalized * range into the same field). The plugin maps the normalized
/// nih-plug value to the normalized wheel, so the engine applies the range
/// exactly once: full wheel = +/- PITCH_BEND_RANGE semitones.
pub fn apply_midi_event(engine: &mut Engine, event: &MidiEvent) {
    match *event {
        MidiEvent::NoteOn { note, velocity } => engine.note_on(note, velocity),
        MidiEvent::NoteOff { note } => engine.note_off(note),
        // The engine has no choke input; release is the closest semantic.
        MidiEvent::PitchBend { value } => engine.pitch_bend((value - 0.5) * 2.0),
        MidiEvent::ControlChange { cc, value } => match cc {
            CC_MOD_WHEEL => engine.mod_wheel(value),
            CC_ALL_NOTES_OFF => engine.all_notes_off(),
            _ => {}
        },
        MidiEvent::ChannelPressure { pressure } => engine.aftertouch(pressure),
    }
}

/// Render `frames` samples into `out_l`/`out_r`, chunked to the engine's
/// `MAX_BLOCK_SIZE`.
pub fn render_segment(engine: &mut Engine, frames: usize, out_l: &mut [f32], out_r: &mut [f32]) {
    let mut done = 0;
    while done < frames {
        let chunk = (frames - done).min(MAX_BLOCK_SIZE);
        engine.process(chunk);
        out_l[done..done + chunk].copy_from_slice(&engine.left()[..chunk]);
        out_r[done..done + chunk].copy_from_slice(&engine.right()[..chunk]);
        done += chunk;
    }
}

/// The plugin's own render path: preset switch first, then parameter sync,
/// then event-sliced rendering. Events are sorted stably by sample offset;
/// an event at offset `t` is applied before the samples starting at `t`.
/// Events at or past the buffer end are applied after rendering (they affect
/// state for the next call, e.g. a trailing all-notes-off).
///
/// `preset` is passed explicitly (the plugin's `process()` reads it from the
/// preset selector parameter) so tests can drive any preset without a host:
/// nih-plug parameters are host-owned and have no plugin-side setter.
pub fn render_with_events(
    params: &Gs1Params,
    engine: &mut Engine,
    state: &mut RenderState,
    preset: i32,
    events: &[(usize, MidiEvent)],
    out_l: &mut [f32],
    out_r: &mut [f32],
) {
    assert_eq!(out_l.len(), out_r.len());
    let total = out_l.len();

    // Read all host parameter values once per block.
    let mut host = [0.0f32; PARAM_COUNT];
    for acc in PARAM_ACCESSORS {
        host[acc.id as usize] = (acc.get)(params);
    }

    if state.first_block {
        // Fresh instance (or first block after a host state restore, where
        // the selector restored correctly but the other parameters may be
        // stale pre-switch values): the preset wins, host values become the
        // baseline for later change tracking.
        apply_preset_to_engine(engine, preset as usize);
        state.last_preset = preset;
        state.last_host = host;
        state.first_block = false;
    } else {
        if preset != state.last_preset {
            apply_preset_to_engine(engine, preset as usize);
            state.last_preset = preset;
        }
        // Only genuine host changes since the previous block reach the
        // engine; stale values left over from before a preset switch are
        // ignored (they equal the recorded baseline).
        for acc in PARAM_ACCESSORS {
            let value = host[acc.id as usize];
            if value != state.last_host[acc.id as usize] {
                engine.set_param(acc.id, value);
            }
        }
        state.last_host = host;
    }

    let mut ordered: Vec<(usize, MidiEvent)> = events.to_vec();
    ordered.sort_by_key(|(t, _)| *t);
    let mut cursor = 0;
    for (t, event) in &ordered {
        let t = (*t).min(total);
        if t > cursor {
            render_segment(
                engine,
                t - cursor,
                &mut out_l[cursor..t],
                &mut out_r[cursor..t],
            );
            cursor = t;
        }
        apply_midi_event(engine, event);
    }
    if cursor < total {
        render_segment(
            engine,
            total - cursor,
            &mut out_l[cursor..],
            &mut out_r[cursor..],
        );
    }
}

pub struct Gs1 {
    params: Arc<Gs1Params>,
    state: RenderState,
    engine_owned: bool,
}

impl Default for Gs1 {
    fn default() -> Self {
        Self {
            params: Arc::new(Gs1Params::default()),
            state: RenderState::new(),
            engine_owned: false,
        }
    }
}

impl Plugin for Gs1 {
    const NAME: &'static str = "GS1";
    const VENDOR: &'static str = "gradetwo";
    const URL: &'static str = "https://github.com/gradetwo/synth";
    const EMAIL: &'static str = "";
    const VERSION: &'static str = "0.1.0";

    type SysExMessage = ();
    type BackgroundTask = ();

    const AUDIO_IO_LAYOUTS: &'static [AudioIOLayout] = &[AudioIOLayout {
        main_input_channels: None,
        main_output_channels: NonZeroU32::new(2),
        ..AudioIOLayout::const_default()
    }];

    const MIDI_INPUT: MidiConfig = MidiConfig::MidiCCs;

    fn params(&self) -> Arc<dyn Params> {
        self.params.clone()
    }

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        if !self.engine_owned {
            if ENGINE_TAKEN.swap(true, Ordering::SeqCst) {
                // Another live instance owns the process singleton engine.
                return false;
            }
            self.engine_owned = true;
        }
        let engine = synth_core::engine::engine();
        engine.init(buffer_config.sample_rate, POLYPHONY);
        // Sound like the current preset right away; the first process call
        // re-applies it if the host changed the selector meanwhile.
        apply_preset_to_engine(
            engine,
            self.params.preset.unmodulated_plain_value() as usize,
        );
        true
    }

    fn reset(&mut self) {
        // init() allocates, so it must not run on the audio thread; silence
        // the voices and let the next process call re-sync parameters.
        synth_core::engine::engine().all_notes_off();
    }

    fn deactivate(&mut self) {
        if self.engine_owned {
            ENGINE_TAKEN.store(false, Ordering::SeqCst);
            self.engine_owned = false;
        }
    }

    fn process(
        &mut self,
        buffer: &mut Buffer,
        _aux: &mut AuxiliaryBuffers,
        context: &mut impl ProcessContext<Self>,
    ) -> ProcessStatus {
        let total = buffer.samples();
        if total == 0 {
            return ProcessStatus::KeepAlive;
        }
        let channels = buffer.as_slice();
        if channels.len() < 2 {
            return ProcessStatus::Error("GS1 needs a stereo output");
        }

        let mut events: Vec<(usize, MidiEvent)> = Vec::new();
        while let Some(event) = context.next_event() {
            let translated = match event {
                NoteEvent::NoteOn {
                    timing,
                    note,
                    velocity,
                    ..
                } => Some((timing as usize, MidiEvent::NoteOn { note, velocity })),
                NoteEvent::NoteOff { timing, note, .. } => {
                    Some((timing as usize, MidiEvent::NoteOff { note }))
                }
                NoteEvent::Choke { timing, note, .. } => {
                    Some((timing as usize, MidiEvent::NoteOff { note }))
                }
                NoteEvent::MidiPitchBend { timing, value, .. } => {
                    Some((timing as usize, MidiEvent::PitchBend { value }))
                }
                NoteEvent::MidiCC {
                    timing, cc, value, ..
                } => Some((timing as usize, MidiEvent::ControlChange { cc, value })),
                NoteEvent::MidiChannelPressure {
                    timing, pressure, ..
                } => Some((timing as usize, MidiEvent::ChannelPressure { pressure })),
                _ => None,
            };
            if let Some(translated) = translated {
                events.push(translated);
            }
        }

        // Split the channel borrows so render_with_events can write both.
        let (out_l, rest) = channels.split_at_mut(1);
        let out_l = &mut out_l[0][..total];
        let out_r = &mut rest[0][..total];
        let preset = self.params.preset.unmodulated_plain_value();
        render_with_events(
            &self.params,
            synth_core::engine::engine(),
            &mut self.state,
            preset,
            &events,
            out_l,
            out_r,
        );
        ProcessStatus::KeepAlive
    }
}

impl Vst3Plugin for Gs1 {
    const VST3_CLASS_ID: [u8; 16] = *b"GS1SynthVST3Plug";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] =
        &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

nih_export_vst3!(Gs1);
