//! Host state save/reload round trip (phase 2, item 1): post-preset-switch
//! host tweaks must survive a save/reload. The v1 plugin lost them: the
//! host saved the stale pre-switch parameter values, and the first block
//! after a restore re-applied the bare preset. The `engine_state` persist
//! blob closes that gap.

#[path = "common/mod.rs"]
mod common;

use common::{lock_engine, SR};
use nih_plug::params::{FloatParam, IntParam, Params};
use nih_plug::prelude::{FloatRange, IntRange};
use synth_vst3::{merged_preset, render_with_events, Gs1Params, RenderState};

const PRESET: i32 = 5;
/// patchGain id (TS param 78); the tweak target.
const PATCH_GAIN_ID: usize = 78;

fn params_with_patch_gain(value: f32) -> Gs1Params {
    Gs1Params {
        preset: IntParam::new("Preset", PRESET, IntRange::Linear { min: 0, max: 119 }),
        patchGain: FloatParam::new(
            "patchGain",
            value,
            FloatRange::Linear { min: 0.0, max: 8.0 },
        ),
        ..Gs1Params::default()
    }
}

fn render_block(params: &Gs1Params, state: &mut RenderState) {
    let engine = synth_core::engine::engine();
    let mut left = vec![0.0f32; 4096];
    let mut right = vec![0.0f32; 4096];
    render_with_events(params, engine, state, PRESET, &[], &mut left, &mut right);
}

/// A tweak value clearly different from the preset's patch gain.
fn tweak_value() -> f32 {
    let merged = merged_preset(PRESET as usize);
    if (merged[PATCH_GAIN_ID] - 2.5).abs() > 0.5 {
        2.5
    } else {
        5.0
    }
}

#[test]
fn post_switch_tweak_survives_save_reload() {
    let _guard = lock_engine();
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let merged = merged_preset(PRESET as usize);
    let tweak = tweak_value();

    // Block 1: preset switch. Block 2: host tweak (patchGain only).
    let mut state = RenderState::new();
    render_block(&Gs1Params::default(), &mut state);
    assert_eq!(
        engine.params.patch_gain,
        merged[PATCH_GAIN_ID].clamp(0.0, 8.0)
    );
    let tweaked = params_with_patch_gain(tweak);
    render_block(&tweaked, &mut state);
    assert_eq!(engine.params.patch_gain, tweak);

    // Host save: the persist blob must be in the serialized fields.
    let fields = tweaked.serialize_fields();
    assert!(
        fields.contains_key("engine-state"),
        "engine-state blob must be persisted"
    );

    // Host restore into a fresh plugin instance: the selector is restored
    // by the wrapper from the saved parameter values (simulated here with
    // the struct update), the blob via deserialize_fields, fresh render
    // state.
    let restored = Gs1Params::default();
    restored.deserialize_fields(&fields);
    let restored = Gs1Params {
        preset: IntParam::new("Preset", PRESET, IntRange::Linear { min: 0, max: 119 }),
        ..restored
    };
    let mut state2 = RenderState::new();
    render_block(&restored, &mut state2);
    // The tweak survived: patch gain is the tweaked value, not the preset's.
    assert_eq!(engine.params.patch_gain, tweak);
    // And the preset itself survived: another preset value is intact.
    assert_eq!(
        engine.params.master_volume,
        merged[0].clamp(0.0, 1.0),
        "preset values must also survive the round trip"
    );
}

#[test]
fn fresh_state_without_blob_loses_the_tweak() {
    // Same sequence, but the "restored" params carry no blob: the first
    // block re-applies the bare preset, so the tweak is lost. This is the
    // v1 behaviour, kept for fresh instances and states saved by the v1
    // plugin — and it proves the round-trip test above is not vacuous.
    let _guard = lock_engine();
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let merged = merged_preset(PRESET as usize);
    let tweak = tweak_value();

    let mut state = RenderState::new();
    render_block(&Gs1Params::default(), &mut state);
    render_block(&params_with_patch_gain(tweak), &mut state);
    assert_eq!(engine.params.patch_gain, tweak);

    // Fresh instance, no blob: preset wins, tweak lost.
    let fresh = params_with_patch_gain(tweak);
    let mut state2 = RenderState::new();
    render_block(&fresh, &mut state2);
    assert_eq!(
        engine.params.patch_gain,
        merged[PATCH_GAIN_ID].clamp(0.0, 8.0)
    );
}
