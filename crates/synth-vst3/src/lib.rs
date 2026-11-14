// The nih_export_vst3 macro of this nih-plug rev leaves a trailing semicolon
// in expression position (its vst3_com::vtable expansion); that warning is
// inherent to the macro, not to this crate.
#![allow(semicolon_in_expressions_from_non_local_macros)]

//! GS1 instrument plugin (VST3 and CLAP exports of the same plugin).
//!
//! A nih-plug wrapper around `synth-core`. See the crate README for the
//! framework choice, the licensing consequences (the VST3 binary is GPLv3
//! through `vst3-sys`; the CLAP-only binary links no `vst3-sys` and is not
//! GPLv3-bound), the per-instance bridge slice, the parameter mapping, and
//! the preset-selector-instead-of-program-list design.
//!
//! Both exports share one `Plugin` implementation and one render core
//! ([`render_with_events`] and friends), decoupled from nih-plug's
//! `Buffer`/`ProcessContext` types so the headless tests can drive the
//! plugin's own render path directly. Which entry point a built binary
//! exposes is a Cargo feature decision: `vst3` (default) exports
//! `GetPluginFactory`, `clap` exports `clap_entry`, both together export
//! both. The render path is identical either way, so the fingerprint tests
//! (which drive `render_with_events` directly) cover both exports.

mod editor;
mod generated;

use std::sync::Arc;

use nih_plug::prelude::*;
use serde::{Deserialize, Serialize};
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

/// Engine-effective parameter values, persisted with the plugin state.
///
/// The host only saves its own parameter values, which go stale when a
/// preset switch leaves pre-switch values behind. The engine is the source
/// of truth, so every process block mirrors the effective values here (see
/// [`render_with_events`]); on the first block after a host state restore
/// the blob is applied to the engine instead of the bare preset, so
/// post-switch host tweaks survive the round trip. `None` in
/// `Gs1Params::engine_state` means no block has run yet (a fresh instance,
/// or a state saved by the v1 plugin): the old preset-wins behaviour
/// applies.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineState {
    /// Preset selector value the effective values belong to.
    pub preset: i32,
    /// Effective value per TS parameter id (0..223), in id order. A `Vec`
    /// because serde only implements array (de)serialization up to length
    /// 32; a blob whose length is not `PARAM_COUNT` is treated as absent
    /// on restore.
    pub values: Vec<f32>,
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
/// The v1 state loss (host tweaks made after a preset switch lived in the
/// engine only and did not survive a host state save/reload) is closed by
/// the `engine_state` persist blob: every block mirrors the engine-effective
/// values into it, and the first block after a restore applies the blob
/// instead of the bare preset (see [`render_with_events`]).
pub struct RenderState {
    pub last_host: [f32; PARAM_COUNT],
    pub last_preset: i32,
    pub first_block: bool,
    /// Mirror of what the engine currently holds, per TS parameter id.
    /// This is what the `engine_state` persist blob is written from.
    pub effective: [f32; PARAM_COUNT],
}

impl RenderState {
    pub fn new() -> Self {
        // NaN never equals a real value, so the first tracking pass records
        // the baseline without pushing anything.
        Self {
            last_host: [f32::NAN; PARAM_COUNT],
            last_preset: -1,
            first_block: true,
            effective: PARAM_DEFAULTS,
        }
    }
}

/// Mirror the engine-effective values into the `engine_state` persist blob
/// so the host's next state save carries the tweaks, not just the preset.
/// The blob lives in `Gs1Params` (shared with the editor), so this only
/// takes a shared reference; a poisoned lock is impossible in practice
/// (no code path panics while holding it) and is skipped, never fatal.
fn sync_engine_state_blob(params: &Gs1Params, state: &RenderState) {
    if let Ok(mut slot) = params.engine_state.write() {
        *slot = Some(EngineState {
            preset: state.last_preset,
            values: state.effective.to_vec(),
        });
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
///
/// CLAP bend path (decided for this nih-plug rev, `de42101`): the CLAP
/// wrapper does NOT translate `CLAP_NOTE_EXPRESSION_PITCH_BEND` — its
/// note-expression match has no pitch-bend arm, so a host-sent bend
/// expression is dropped. Bend therefore arrives as a CLAP MIDI event
/// (`CLAP_EVENT_MIDI`, status `0xE0`), which the wrapper parses into the
/// same `NoteEvent::MidiPitchBend` (normalized `[0, 1]`, `0.5` = center)
/// the VST3 path produces, and the translation below applies unchanged.
/// No plugin-side change is needed for CLAP bend; per-note expression
/// bend stays unsupported until nih-plug gains that arm.
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
        // Fresh instance, or first block after a host state restore. A
        // restored engine-state blob carries the true effective values
        // (preset + post-switch host tweaks): apply those instead of the
        // bare preset, so the tweaks survive the round trip. A blob whose
        // preset no longer matches the selector is stale (the host switched
        // presets after the restore); the selector wins then, as on a
        // fresh instance.
        let restored = match params.engine_state.read() {
            Ok(slot) => (*slot)
                .clone()
                .filter(|blob| blob.preset == preset && blob.values.len() == PARAM_COUNT),
            Err(_) => None,
        };
        match restored {
            Some(blob) => {
                for acc in PARAM_ACCESSORS {
                    engine.set_param(acc.id, blob.values[acc.id as usize]);
                }
                apply_routes(engine);
                state.effective.copy_from_slice(&blob.values);
                state.last_preset = preset;
            }
            None => {
                // No blob (fresh instance, or a state saved by the v1
                // plugin): the preset wins, host values become the baseline
                // for later change tracking.
                apply_preset_to_engine(engine, preset as usize);
                state.effective = merged_preset(preset as usize);
                state.last_preset = preset;
            }
        }
        state.last_host = host;
        state.first_block = false;
    } else {
        if preset != state.last_preset {
            apply_preset_to_engine(engine, preset as usize);
            state.effective = merged_preset(preset as usize);
            state.last_preset = preset;
        }
        // Only genuine host changes since the previous block reach the
        // engine; stale values left over from before a preset switch are
        // ignored (they equal the recorded baseline).
        for acc in PARAM_ACCESSORS {
            let value = host[acc.id as usize];
            if value != state.last_host[acc.id as usize] {
                engine.set_param(acc.id, value);
                state.effective[acc.id as usize] = value;
            }
        }
        state.last_host = host;
    }
    // Mirror the effective values into the persist blob so the host's next
    // state save carries the tweaks, not just the preset.
    sync_engine_state_blob(params, state);

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
    /// This instance's own engine (phase 2, true multi-instance). The
    /// engine owns a bridge slice (voice range + effect instance) claimed
    /// at `initialize()` and released when the engine is dropped; two live
    /// `Gs1` instances render through disjoint C++ slots and cannot bleed
    /// into each other. The process-singleton `engine()` in synth-core is
    /// only for the web worklet path now, not for the plugin.
    engine: Box<Engine>,
}

impl Default for Gs1 {
    fn default() -> Self {
        Self {
            params: Arc::new(Gs1Params::default()),
            state: RenderState::new(),
            engine: Box::new(Engine::new()),
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

    fn editor(&mut self, _async_executor: AsyncExecutor<Self>) -> Option<Box<dyn Editor>> {
        editor::create_editor(self.params.clone())
    }

    fn initialize(
        &mut self,
        _audio_io_layout: &AudioIOLayout,
        buffer_config: &BufferConfig,
        _context: &mut impl InitContext<Self>,
    ) -> bool {
        if !self.engine.init(buffer_config.sample_rate, POLYPHONY) {
            // No bridge slice free (a third live instance) or the rate
            // conflicts with a live instance: fail cleanly, do not render
            // through another instance's slots.
            return false;
        }
        // Sound like the current preset right away; the first process call
        // re-applies it if the host changed the selector meanwhile.
        apply_preset_to_engine(
            &mut self.engine,
            self.params.preset.unmodulated_plain_value() as usize,
        );
        // A re-initialize (e.g. a sample-rate change) just wiped the engine
        // back to the preset, so the next process block must re-sync from
        // the persist blob (or the preset, if there is no blob) instead of
        // trusting the pre-reinit tracking state.
        self.state.first_block = true;
        true
    }

    fn reset(&mut self) {
        // init() allocates, so it must not run on the audio thread; silence
        // the voices and let the next process call re-sync parameters.
        self.engine.all_notes_off();
    }

    fn deactivate(&mut self) {
        // Replacing the engine in place drops the old one, which releases
        // its bridge slice, so another instance may claim the voice range
        // and effect instance. (Assigning into the Box reuses the
        // allocation; `Box::new` here would trip clippy::replace_box.)
        *self.engine = Engine::new();
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
            &mut self.engine,
            &mut self.state,
            preset,
            &events,
            out_l,
            out_r,
        );
        ProcessStatus::KeepAlive
    }
}

#[cfg(feature = "vst3")]
impl Vst3Plugin for Gs1 {
    const VST3_CLASS_ID: [u8; 16] = *b"GS1SynthVST3Plug";
    const VST3_SUBCATEGORIES: &'static [Vst3SubCategory] =
        &[Vst3SubCategory::Instrument, Vst3SubCategory::Synth];
}

#[cfg(feature = "vst3")]
nih_export_vst3!(Gs1);

/// CLAP export: same plugin, same parameters, same state, same preset
/// selector as the VST3 export. The CLAP ID is stable across releases;
/// do not change it once hosts have seen it.
#[cfg(feature = "clap")]
impl ClapPlugin for Gs1 {
    const CLAP_ID: &'static str = "dev.gradetwo.gs1";
    const CLAP_DESCRIPTION: Option<&'static str> = Some("GROOVE SYNTH GS-1 instrument");
    const CLAP_MANUAL_URL: Option<&'static str> = Some("https://github.com/gradetwo/synth");
    const CLAP_SUPPORT_URL: Option<&'static str> = Some("https://github.com/gradetwo/synth");
    const CLAP_FEATURES: &'static [ClapFeature] =
        &[ClapFeature::Instrument, ClapFeature::Synthesizer];
}

#[cfg(feature = "clap")]
nih_export_clap!(Gs1);
