//! Multi-instance tests (phase 2): two live plugin instances render
//! independently through disjoint C++ bridge slots, a third instance's
//! init fails cleanly, and dropping releases the slice.
//!
//! These tests use fresh `Engine::default()` instances, never the process
//! singleton, so the two claims land on bridge instances 0 and 1. Tests in
//! this file share one process, so they serialize on `ENGINE_LOCK` like the
//! other engine-touching tests; each test binary is its own process and
//! cannot interfere with the others.

#[path = "common/mod.rs"]
mod common;

use common::{db, goertzel, lock_engine, rms, SR};
use synth_core::engine::Engine;
use synth_vst3::{merged_preset, render_with_events, Gs1Params, MidiEvent, RenderState};

const BLOCK: usize = 128;
const FRAMES: usize = 86400; // 1.8 s

/// Render `frames` samples through one engine in 128-frame blocks, the way
/// a host calls `process()` per block.
fn render_blocks(
    engine: &mut Engine,
    params: &Gs1Params,
    state: &mut RenderState,
    preset: i32,
    events: &[(usize, MidiEvent)],
    out_l: &mut [f32],
    out_r: &mut [f32],
) {
    let frames = out_l.len();
    let mut block = 0;
    while block * BLOCK < frames {
        let start = block * BLOCK;
        let end = ((block + 1) * BLOCK).min(frames);
        let block_events: Vec<(usize, MidiEvent)> = events
            .iter()
            .filter(|(t, _)| *t >= start && *t < end)
            .map(|(t, e)| (t - start, *e))
            .collect();
        render_with_events(
            params,
            engine,
            state,
            preset,
            &block_events,
            &mut out_l[start..end],
            &mut out_r[start..end],
        );
        block += 1;
    }
}

/// Render two engines block by block, alternating A block / B block, the
/// way a host interleaves two live plugin instances.
#[allow(clippy::too_many_arguments)]
fn render_dual(
    a: &mut Engine,
    b: &mut Engine,
    params_a: &Gs1Params,
    params_b: &Gs1Params,
    state_a: &mut RenderState,
    state_b: &mut RenderState,
    preset_a: i32,
    preset_b: i32,
    events_a: &[(usize, MidiEvent)],
    events_b: &[(usize, MidiEvent)],
    out_a_l: &mut [f32],
    out_a_r: &mut [f32],
    out_b_l: &mut [f32],
    out_b_r: &mut [f32],
) {
    let frames = out_a_l.len();
    let mut block = 0;
    while block * BLOCK < frames {
        let start = block * BLOCK;
        let end = ((block + 1) * BLOCK).min(frames);
        let ev_a: Vec<(usize, MidiEvent)> = events_a
            .iter()
            .filter(|(t, _)| *t >= start && *t < end)
            .map(|(t, e)| (t - start, *e))
            .collect();
        let ev_b: Vec<(usize, MidiEvent)> = events_b
            .iter()
            .filter(|(t, _)| *t >= start && *t < end)
            .map(|(t, e)| (t - start, *e))
            .collect();
        render_with_events(
            params_a,
            a,
            state_a,
            preset_a,
            &ev_a,
            &mut out_a_l[start..end],
            &mut out_a_r[start..end],
        );
        render_with_events(
            params_b,
            b,
            state_b,
            preset_b,
            &ev_b,
            &mut out_b_l[start..end],
            &mut out_b_r[start..end],
        );
        block += 1;
    }
}

fn note_events(note: u8) -> Vec<(usize, MidiEvent)> {
    vec![
        (
            0,
            MidiEvent::NoteOn {
                note,
                velocity: 0.9,
            },
        ),
        (33600, MidiEvent::NoteOff { note }),
    ]
}

#[test]
fn two_instances_render_bit_identically_with_and_without_each_other() {
    let _guard = lock_engine();
    let params_a = Gs1Params::default();
    let params_b = Gs1Params::default();
    let ev_a = note_events(60);
    let ev_b = note_events(67);

    // Interleaved: A and B live at the same time, different presets/notes.
    let mut a = Engine::default();
    assert!(a.init(SR, 16), "first instance must claim a slice");
    let mut b = Engine::default();
    assert!(b.init(SR, 16), "second instance must claim a slice");
    let mut state_a = RenderState::new();
    let mut state_b = RenderState::new();
    let mut a_dual_l = vec![0.0f32; FRAMES];
    let mut a_dual_r = vec![0.0f32; FRAMES];
    let mut b_dual_l = vec![0.0f32; FRAMES];
    let mut b_dual_r = vec![0.0f32; FRAMES];
    render_dual(
        &mut a,
        &mut b,
        &params_a,
        &params_b,
        &mut state_a,
        &mut state_b,
        0,
        1,
        &ev_a,
        &ev_b,
        &mut a_dual_l,
        &mut a_dual_r,
        &mut b_dual_l,
        &mut b_dual_r,
    );
    drop(a);
    drop(b);

    // Solo: each engine alone, same blocks, same events.
    let mut a2 = Engine::default();
    assert!(a2.init(SR, 16));
    let mut state_a2 = RenderState::new();
    let mut a_solo_l = vec![0.0f32; FRAMES];
    let mut a_solo_r = vec![0.0f32; FRAMES];
    render_blocks(
        &mut a2,
        &params_a,
        &mut state_a2,
        0,
        &ev_a,
        &mut a_solo_l,
        &mut a_solo_r,
    );
    drop(a2);
    let mut b2 = Engine::default();
    assert!(b2.init(SR, 16));
    let mut state_b2 = RenderState::new();
    let mut b_solo_l = vec![0.0f32; FRAMES];
    let mut b_solo_r = vec![0.0f32; FRAMES];
    render_blocks(
        &mut b2,
        &params_b,
        &mut state_b2,
        1,
        &ev_b,
        &mut b_solo_l,
        &mut b_solo_r,
    );
    drop(b2);

    // Any shared-state bleed changes samples: the interleaved render must
    // be bit-identical to the solo renders.
    assert_eq!(
        a_dual_l, a_solo_l,
        "A left must be bit-identical solo vs dual"
    );
    assert_eq!(
        a_dual_r, a_solo_r,
        "A right must be bit-identical solo vs dual"
    );
    assert_eq!(
        b_dual_l, b_solo_l,
        "B left must be bit-identical solo vs dual"
    );
    assert_eq!(
        b_dual_r, b_solo_r,
        "B right must be bit-identical solo vs dual"
    );

    // And the two outputs really are different notes, not both silent.
    assert!(db(rms(&a_dual_l)) > -60.0, "A must be audible");
    assert!(db(rms(&b_dual_l)) > -60.0, "B must be audible");
    let a_261 = db(goertzel(&a_dual_l, 261.63));
    let a_392 = db(goertzel(&a_dual_l, 392.0));
    let b_261 = db(goertzel(&b_dual_l, 261.63));
    let b_392 = db(goertzel(&b_dual_l, 392.0));
    assert!(
        a_261 > a_392 + 3.0,
        "A (note 60) must dominate 261.63 Hz ({a_261:.2}) over 392 Hz ({a_392:.2})"
    );
    assert!(
        b_392 > b_261 + 3.0,
        "B (note 67) must dominate 392 Hz ({b_392:.2}) over 261.63 Hz ({b_261:.2})"
    );
}

#[test]
fn third_instance_init_fails_and_drop_releases() {
    let _guard = lock_engine();
    let mut a = Engine::default();
    assert!(a.init(SR, 16));
    let mut b = Engine::default();
    assert!(b.init(SR, 16));
    let mut c = Engine::default();
    assert!(!c.init(SR, 16), "a third live instance must fail cleanly");
    // A failed init leaves the engine un-initialised: process() is a no-op.
    assert_eq!(c.process(128), 0);
    drop(a);
    drop(b);
    drop(c);
    let mut d = Engine::default();
    assert!(d.init(SR, 16), "a fresh init must succeed after release");
    let params = Gs1Params::default();
    let mut state = RenderState::new();
    let mut left = vec![0.0f32; FRAMES];
    let mut right = vec![0.0f32; FRAMES];
    render_blocks(
        &mut d,
        &params,
        &mut state,
        0,
        &note_events(60),
        &mut left,
        &mut right,
    );
    assert!(db(rms(&left)) > -60.0, "re-claimed engine must render");
}

#[test]
fn presets_and_params_are_per_instance() {
    let _guard = lock_engine();
    let params_a = Gs1Params::default();
    let params_b = Gs1Params::default();
    let mut a = Engine::default();
    assert!(a.init(SR, 16));
    let mut b = Engine::default();
    assert!(b.init(SR, 16));
    let mut state_a = RenderState::new();
    let mut state_b = RenderState::new();
    let mut a_l = vec![0.0f32; FRAMES];
    let mut a_r = vec![0.0f32; FRAMES];
    let mut b_l = vec![0.0f32; FRAMES];
    let mut b_r = vec![0.0f32; FRAMES];
    render_dual(
        &mut a,
        &mut b,
        &params_a,
        &params_b,
        &mut state_a,
        &mut state_b,
        0,
        1,
        &note_events(60),
        &note_events(60),
        &mut a_l,
        &mut a_r,
        &mut b_l,
        &mut b_r,
    );
    // Each engine holds its own preset's merged values.
    let m0 = merged_preset(0);
    let m1 = merged_preset(1);
    assert_eq!(a.params.patch_gain, m0[78].clamp(0.0, 8.0));
    assert_eq!(b.params.patch_gain, m1[78].clamp(0.0, 8.0));
    assert_eq!(a.params.tempo, m0[37].clamp(20.0, 300.0));
    assert_eq!(b.params.tempo, m1[37].clamp(20.0, 300.0));
    // And the two presets sound different.
    let diff = (db(rms(&a_l)) - db(rms(&b_l))).abs();
    assert!(
        diff > 0.5,
        "preset 0 vs 1 must differ by > 0.5 dB, got {diff:.2}"
    );
}

#[test]
fn rate_conflict_fails_while_live_and_clears_after_drop() {
    let _guard = lock_engine();
    let mut a = Engine::default();
    assert!(a.init(48000.0, 16));
    let mut b = Engine::default();
    assert!(!b.init(44100.0, 16), "a second rate must be refused");
    drop(a);
    assert!(b.init(44100.0, 16), "the rate is free once nothing is live");
}
