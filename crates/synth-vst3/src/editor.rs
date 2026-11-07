//! Custom egui editor for GS1 (phase 2, item 1).
//!
//! The host's generic UI stays usable; this editor is additive. It gives
//! the preset selector a real program dropdown (the 120 factory presets by
//! name, instead of the bare `0..=119` integer parameter), groups the 224
//! parameters into tabs with a search box instead of laying them all out at
//! once, and shows the pitch-bend range and the polyphony next to the
//! preset. Every widget writes through the host via [`ParamSetter`], so
//! automation, undo, and host state save/restore all keep working — the
//! editor never writes engine state behind the host's back.
//!
//! The editor runs on the GUI thread only. It never touches the audio
//! thread or the engine singleton.

use std::sync::Arc;

use nih_plug::prelude::*;
use nih_plug_egui::{create_egui_editor, egui, widgets::ParamSlider};

use crate::{Gs1Params, POLYPHONY, PRESETS};

/// Parameter groups shown as tabs. Order is the display order.
pub const GROUPS: &[&str] = &[
    "Osc 1",
    "Osc 2",
    "Osc Mix",
    "Filter",
    "Filter Env",
    "Envelope",
    "LFO 1",
    "LFO 2",
    "Modulation",
    "FX · Reverb",
    "FX · Delay",
    "FX · Chorus",
    "FX · Flanger",
    "FX · Phaser",
    "FX · Drive",
    "FX · Crush",
    "FX · EQ",
    "FX · Transient",
    "FX · Chain",
    "FX · Override",
    "Master",
    "Sampler",
    "Wavetable",
];

/// Group for a TS parameter id (the camelCase name from `PARAM_NAMES`).
/// `None` means the parameter has no group yet: adding a parameter must
/// extend this table (the `every_param_has_a_group` test enforces it).
/// Prefix order matters: `filterEnv*` before `filter*`, `lfo2*` before
/// `lfo*`, the specific FX families before the generic `fx*` catch-alls.
pub fn group_for_param(name: &str) -> Option<&'static str> {
    if name.starts_with("osc1") {
        Some("Osc 1")
    } else if name.starts_with("osc2") {
        Some("Osc 2")
    } else if matches!(name, "oscFm" | "oscRing" | "noiseMix") {
        Some("Osc Mix")
    } else if name.starts_with("filterEnv") {
        Some("Filter Env")
    } else if name.starts_with("filter") {
        Some("Filter")
    } else if name.starts_with("env") {
        Some("Envelope")
    } else if name.starts_with("lfo2") {
        Some("LFO 2")
    } else if name.starts_with("lfo") {
        Some("LFO 1")
    } else if name.starts_with("fxMod") {
        Some("Modulation")
    } else if name.starts_with("fxReverb") || name == "fxConvTrim" {
        Some("FX · Reverb")
    } else if name.starts_with("fxDelay") {
        Some("FX · Delay")
    } else if name.starts_with("fxChorus") {
        Some("FX · Chorus")
    } else if name.starts_with("fxFlanger") {
        Some("FX · Flanger")
    } else if name.starts_with("fxPhaser") {
        Some("FX · Phaser")
    } else if name.starts_with("fxDrive") {
        Some("FX · Drive")
    } else if name.starts_with("fxCrush") {
        Some("FX · Crush")
    } else if name.starts_with("fxEq") {
        Some("FX · EQ")
    } else if name.starts_with("fxTransient") {
        Some("FX · Transient")
    } else if name.starts_with("fxOvr") {
        Some("FX · Override")
    } else if name.starts_with("fxChain")
        || name.starts_with("fxParallel")
        || name.starts_with("fxNode")
        || name == "fxGraph"
    {
        Some("FX · Chain")
    } else if name.starts_with("smp") {
        Some("Sampler")
    } else if name == "wtUser" {
        Some("Wavetable")
    } else if matches!(
        name,
        "masterVolume"
            | "masterTune"
            | "patchGain"
            | "tempo"
            | "glide"
            | "pitchBendRange"
            | "voiceMode"
            | "oversample"
    ) {
        Some("Master")
    } else {
        None
    }
}

/// Per-editor UI state (selected tab + search text). Lives on the GUI
/// thread only, inside the `nih_plug_egui` user state.
#[derive(Default)]
struct EditorState {
    group: usize,
    search: String,
}

/// Build the editor for a plugin instance. Returns `None` only if the
/// backend cannot be created (same contract as `create_egui_editor`).
pub fn create_editor(params: Arc<Gs1Params>) -> Option<Box<dyn Editor>> {
    create_egui_editor(
        params.editor_state.clone(),
        EditorState::default(),
        |_, _| {},
        move |ctx, setter, state| {
            egui::CentralPanel::default().show(ctx, |ui| {
                draw_editor(ui, &params, setter, state);
            });
        },
    )
}

fn draw_editor(
    ui: &mut egui::Ui,
    params: &Gs1Params,
    setter: &ParamSetter,
    state: &mut EditorState,
) {
    // Top row: preset dropdown (the real program list), bend range, polyphony.
    ui.horizontal(|ui| {
        let current = params.preset.unmodulated_plain_value() as usize;
        let current = current.min(PRESETS.len() - 1);
        let mut selected = current;
        egui::ComboBox::from_label("Preset")
            .selected_text(PRESETS[current].name)
            .show_ui(ui, |ui| {
                for (i, preset) in PRESETS.iter().enumerate() {
                    ui.selectable_value(&mut selected, i, preset.name);
                }
            });
        if selected != current {
            setter.begin_set_parameter(&params.preset);
            setter.set_parameter(&params.preset, selected as i32);
            setter.end_set_parameter(&params.preset);
        }
        ui.separator();
        ui.label(format!(
            "Bend ±{:.0} st",
            params.pitchBendRange.unmodulated_plain_value()
        ));
        ui.separator();
        ui.label(format!("Polyphony {POLYPHONY}"));
    });
    ui.separator();

    // Group tabs.
    egui::ScrollArea::horizontal().show(ui, |ui| {
        ui.horizontal(|ui| {
            for (i, group) in GROUPS.iter().enumerate() {
                if ui.selectable_label(state.group == i, *group).clicked() {
                    state.group = i;
                }
            }
        });
    });

    // Search across all groups; a non-empty query replaces the tab filter.
    ui.horizontal(|ui| {
        ui.label("Search");
        ui.text_edit_singleline(&mut state.search);
    });
    ui.separator();

    let query = state.search.trim().to_lowercase();
    let want_group = GROUPS[state.group];
    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| {
            for (id, param_ptr, _) in params.param_map() {
                // The preset selector lives in the dropdown above.
                if id == "preset" {
                    continue;
                }
                if query.is_empty() {
                    if group_for_param(&id) != Some(want_group) {
                        continue;
                    }
                } else if !id.to_lowercase().contains(&query) {
                    continue;
                }
                ui.horizontal(|ui| {
                    // The display label is the parameter's host-facing name.
                    ui.label(unsafe { param_ptr.name() });
                    unsafe { add_param_widget(ui, &param_ptr, setter) };
                });
            }
        });
}

/// Render one parameter's widget. Mirrors
/// `nih_plug_egui::widgets::generic_ui`'s dispatch: sliders for
/// continuous/stepped parameters, a checkbox for booleans.
///
/// # Safety
///
/// `param_ptr` must point at a live parameter of `params` (it comes from
/// `params.param_map()` in the same frame, and the `Arc<Gs1Params>` is
/// kept alive by the editor).
unsafe fn add_param_widget(ui: &mut egui::Ui, param_ptr: &ParamPtr, setter: &ParamSetter) {
    match param_ptr {
        ParamPtr::FloatParam(p) => {
            ui.add(ParamSlider::for_param(&**p, setter).with_width(220.0));
        }
        ParamPtr::IntParam(p) => {
            ui.add(ParamSlider::for_param(&**p, setter).with_width(220.0));
        }
        ParamPtr::BoolParam(p) => {
            let mut value = (**p).unmodulated_plain_value();
            if ui.checkbox(&mut value, "").changed() {
                setter.begin_set_parameter(&**p);
                setter.set_parameter(&**p, value);
                setter.end_set_parameter(&**p);
            }
        }
        ParamPtr::EnumParam(p) => {
            ui.add(ParamSlider::for_param(&**p, setter).with_width(220.0));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PARAM_NAMES;

    /// The editor object constructs (EguiState wiring + closure capture).
    /// Opening the window needs a host and is verified separately; see the
    /// crate README.
    #[test]
    fn editor_constructs() {
        let params = Arc::new(Gs1Params::default());
        assert!(create_editor(params).is_some());
    }

    #[test]
    fn every_param_has_a_group() {
        for name in PARAM_NAMES {
            assert!(
                group_for_param(name).is_some(),
                "parameter {name} has no editor group; extend group_for_param"
            );
        }
    }

    #[test]
    fn every_group_is_used() {
        for group in GROUPS {
            assert!(
                PARAM_NAMES
                    .iter()
                    .any(|name| group_for_param(name) == Some(*group)),
                "editor group {group} has no parameters"
            );
        }
    }

    #[test]
    fn group_spot_checks() {
        assert_eq!(group_for_param("osc1On"), Some("Osc 1"));
        assert_eq!(group_for_param("osc2Level"), Some("Osc 2"));
        assert_eq!(group_for_param("oscFm"), Some("Osc Mix"));
        assert_eq!(group_for_param("noiseMix"), Some("Osc Mix"));
        assert_eq!(group_for_param("filterCutoff"), Some("Filter"));
        assert_eq!(group_for_param("filterEnvAttack"), Some("Filter Env"));
        assert_eq!(group_for_param("envAttack"), Some("Envelope"));
        assert_eq!(group_for_param("lfoRate"), Some("LFO 1"));
        assert_eq!(group_for_param("lfo2Rate"), Some("LFO 2"));
        assert_eq!(group_for_param("fxMod1Src"), Some("Modulation"));
        assert_eq!(group_for_param("fxReverbMix"), Some("FX · Reverb"));
        assert_eq!(group_for_param("fxConvTrim"), Some("FX · Reverb"));
        assert_eq!(group_for_param("fxDelayFb"), Some("FX · Delay"));
        assert_eq!(group_for_param("fxChorusDepth"), Some("FX · Chorus"));
        assert_eq!(group_for_param("fxFlangerFb"), Some("FX · Flanger"));
        assert_eq!(group_for_param("fxPhaserRate"), Some("FX · Phaser"));
        assert_eq!(group_for_param("fxDriveAmt"), Some("FX · Drive"));
        assert_eq!(group_for_param("fxCrushBits"), Some("FX · Crush"));
        assert_eq!(group_for_param("fxEqMidQ"), Some("FX · EQ"));
        assert_eq!(group_for_param("fxTransientAttack"), Some("FX · Transient"));
        assert_eq!(group_for_param("fxChain3"), Some("FX · Chain"));
        assert_eq!(group_for_param("fxNode2In1"), Some("FX · Chain"));
        assert_eq!(group_for_param("fxGraph"), Some("FX · Chain"));
        assert_eq!(group_for_param("fxOvrSrc"), Some("FX · Override"));
        assert_eq!(group_for_param("fxOvr3_2"), Some("FX · Override"));
        assert_eq!(group_for_param("masterVolume"), Some("Master"));
        assert_eq!(group_for_param("pitchBendRange"), Some("Master"));
        assert_eq!(group_for_param("oversample"), Some("Master"));
        assert_eq!(group_for_param("smpRoot"), Some("Sampler"));
        assert_eq!(group_for_param("wtUser"), Some("Wavetable"));
    }
}
