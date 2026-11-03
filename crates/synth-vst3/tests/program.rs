//! Program (preset selector) tests: switching presets changes the engine
//! state to the target preset's merged values and default routes, and
//! changes the sound.

#[path = "common/mod.rs"]
mod common;

use common::{db, lock_engine, rms, SR};
use synth_core::params::{ModDst, ModSrc};
use synth_vst3::{
    merged_preset, render_with_events, Gs1Params, MidiEvent, RenderState, DEFAULT_ROUTES,
};

const FRAMES: usize = 86400;

fn render_preset(preset: i32, state: &mut RenderState) -> Vec<f32> {
    let params = Gs1Params::default();
    let engine = synth_core::engine::engine();
    let mut left = vec![0.0f32; FRAMES];
    let mut right = vec![0.0f32; FRAMES];
    render_with_events(
        &params,
        engine,
        state,
        preset,
        &[
            (
                0,
                MidiEvent::NoteOn {
                    note: 60,
                    velocity: 0.9,
                },
            ),
            (33600, MidiEvent::NoteOff { note: 60 }),
        ],
        &mut left,
        &mut right,
    );
    left
}

fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    v.clamp(lo, hi)
}

#[test]
fn switching_applies_merged_values_and_routes() {
    let _guard = lock_engine();
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let mut state = RenderState::new();
    // Preset 0 (pluck) first.
    let _ = render_preset(0, &mut state);
    let merged = merged_preset(0);
    assert_eq!(engine.params.master_volume, clamp(merged[0], 0.0, 1.0));
    assert_eq!(engine.params.patch_gain, clamp(merged[78], 0.0, 8.0));
    assert_eq!(engine.params.master_tune, clamp(merged[41], -24.0, 24.0));
    assert_eq!(engine.params.pitch_bend_range, clamp(merged[38], 0.0, 24.0));
    assert_eq!(engine.params.tempo, clamp(merged[37], 20.0, 300.0));
    // Then switch mid-stream to preset 1 with the same state object.
    let _ = render_preset(1, &mut state);
    let merged1 = merged_preset(1);
    assert_eq!(engine.params.patch_gain, clamp(merged1[78], 0.0, 8.0));
    assert_eq!(engine.params.tempo, clamp(merged1[37], 20.0, 300.0));
    // Routes read back from the engine equal the default routes.
    let expected_src = [ModSrc::Lfo, ModSrc::Env, ModSrc::Lfo, ModSrc::ModWheel];
    let expected_dst = [
        ModDst::Cutoff,
        ModDst::Cutoff,
        ModDst::Pitch,
        ModDst::Cutoff,
    ];
    for (i, (_, _, amount, enabled)) in DEFAULT_ROUTES.iter().enumerate() {
        let route = &engine.params.routes[i];
        assert_eq!(route.src, expected_src[i]);
        assert_eq!(route.dst, expected_dst[i]);
        assert_eq!(route.amount, *amount);
        assert_eq!(route.enabled, *enabled);
    }
}

#[test]
fn switching_changes_the_sound() {
    let _guard = lock_engine();
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let mut state = RenderState::new();
    let a = render_preset(0, &mut state);
    let b = render_preset(1, &mut state);
    let diff = (db(rms(&a)) - db(rms(&b))).abs();
    assert!(
        diff > 0.5,
        "preset 0 vs 1 must differ by > 0.5 dB RMS, got {diff:.2} dB"
    );
}

#[test]
fn stale_host_values_do_not_overwrite_a_preset() {
    let _guard = lock_engine();
    // This is the core of the host-tracking design: after a preset switch,
    // host parameters still holding their pre-switch values must NOT push
    // those values back into the engine on the next block.
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let mut state = RenderState::new();
    let _ = render_preset(0, &mut state);
    let after_first = engine.params.patch_gain;
    // A second block with identical host values (defaults) must leave the
    // preset's patch gain alone.
    let params = Gs1Params::default();
    let mut left = vec![0.0f32; 4096];
    let mut right = vec![0.0f32; 4096];
    render_with_events(&params, engine, &mut state, 0, &[], &mut left, &mut right);
    assert_eq!(engine.params.patch_gain, after_first);
}
