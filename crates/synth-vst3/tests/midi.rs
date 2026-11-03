//! MIDI tests: note on/off, velocity, pitch bend, mod wheel, all-notes-off.
//! Driven through the plugin's own render path (render_with_events) with
//! an explicit preset index; the engine is re-inited per case.

#[path = "common/mod.rs"]
mod common;

use common::{db, goertzel, lock_engine, rms, SR};
use synth_core::params::ModDst;
use synth_core::params::ModSrc;
use synth_vst3::{merged_preset, render_with_events, Gs1Params, MidiEvent, RenderState};

const FRAMES: usize = 86400; // 1.8 s

fn render(preset: i32, events: &[(usize, MidiEvent)], frames: usize) -> (Vec<f32>, Vec<f32>) {
    let params = Gs1Params::default();
    let engine = synth_core::engine::engine();
    engine.init(SR, 16);
    let mut state = RenderState::new();
    let mut left = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    render_with_events(
        &params, engine, &mut state, preset, events, &mut left, &mut right,
    );
    (left, right)
}

#[test]
fn note_on_off_is_not_silent() {
    let _guard = lock_engine();
    let (left, _) = render(
        0,
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
        FRAMES,
    );
    assert!(
        db(rms(&left)) > -60.0,
        "pluck note must be audible, got {} dB",
        db(rms(&left))
    );
}

#[test]
fn velocity_scales_output() {
    let _guard = lock_engine();
    let (loud, _) = render(
        0,
        &[
            (
                0,
                MidiEvent::NoteOn {
                    note: 60,
                    velocity: 1.0,
                },
            ),
            (33600, MidiEvent::NoteOff { note: 60 }),
        ],
        FRAMES,
    );
    let (quiet, _) = render(
        0,
        &[
            (
                0,
                MidiEvent::NoteOn {
                    note: 60,
                    velocity: 0.3,
                },
            ),
            (33600, MidiEvent::NoteOff { note: 60 }),
        ],
        FRAMES,
    );
    let dl = db(rms(&loud));
    let dq = db(rms(&quiet));
    assert!(
        dl > dq + 3.0,
        "velocity 1.0 ({dl:.2} dB) must be clearly louder than 0.3 ({dq:.2} dB)"
    );
}

#[test]
fn pitch_bend_moves_the_fundamental() {
    let _guard = lock_engine();
    // Pluck does not overlay pitch bend range, so it is the default 2.
    let range = merged_preset(0)[38];
    assert_eq!(range, 2.0);
    let up = 0.5 + 2.0 / (2.0 * range); // +2 semitones
    let (plain, _) = render(
        0,
        &[
            (
                0,
                MidiEvent::NoteOn {
                    note: 69,
                    velocity: 0.9,
                },
            ),
            (33600, MidiEvent::NoteOff { note: 69 }),
        ],
        FRAMES,
    );
    let (bent, _) = render(
        0,
        &[
            (0, MidiEvent::PitchBend { value: up }),
            (
                0,
                MidiEvent::NoteOn {
                    note: 69,
                    velocity: 0.9,
                },
            ),
            (33600, MidiEvent::NoteOff { note: 69 }),
        ],
        FRAMES,
    );
    let plain_440 = db(goertzel(&plain, 440.0));
    let plain_494 = db(goertzel(&plain, 493.88));
    let bent_440 = db(goertzel(&bent, 440.0));
    let bent_494 = db(goertzel(&bent, 493.88));
    assert!(
        plain_440 > plain_494 + 3.0,
        "unbent: 440 Hz ({plain_440:.2}) must dominate 493.88 Hz ({plain_494:.2})"
    );
    assert!(
        bent_494 > bent_440 + 3.0,
        "bent +2st: 493.88 Hz ({bent_494:.2}) must dominate 440 Hz ({bent_440:.2})"
    );
}

#[test]
fn mod_wheel_changes_output_once_its_route_is_enabled() {
    let _guard = lock_engine();
    // The default routes leave modwheel->cutoff disabled, so enable it the
    // way a host patch would: after the preset is applied, before rendering.
    let run = |wheel: f32| -> Vec<f32> {
        let params = Gs1Params::default();
        let engine = synth_core::engine::engine();
        engine.init(SR, 16);
        let mut state = RenderState::new();
        // Prime the preset (no audible output needed).
        let mut tmp_l = vec![0.0f32; 128];
        let mut tmp_r = vec![0.0f32; 128];
        render_with_events(&params, engine, &mut state, 0, &[], &mut tmp_l, &mut tmp_r);
        // Slot 3, modwheel -> cutoff, amount 0.4, enabled.
        engine.set_route(3, 2, 0, 0.4, true);
        let mut left = vec![0.0f32; FRAMES];
        let mut right = vec![0.0f32; FRAMES];
        render_with_events(
            &params,
            engine,
            &mut state,
            0,
            &[
                (
                    0,
                    MidiEvent::ControlChange {
                        cc: 1,
                        value: wheel,
                    },
                ),
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
    };
    let hi = run(1.0);
    let lo = run(0.0);
    let diff = (db(rms(&hi)) - db(rms(&lo))).abs();
    assert!(
        diff > 0.5,
        "mod wheel 1.0 vs 0.0 must change RMS by > 0.5 dB, got {diff:.2} dB"
    );
    // Sanity: the route the test enabled is really there.
    let engine = synth_core::engine::engine();
    let route = &engine.params.routes[3];
    assert_eq!(route.src, ModSrc::ModWheel);
    assert_eq!(route.dst, ModDst::Cutoff);
    assert!(route.enabled);
}

#[test]
fn all_notes_off_stops_the_voice() {
    let _guard = lock_engine();
    let (left, _) = render(
        0,
        &[
            (
                0,
                MidiEvent::NoteOn {
                    note: 60,
                    velocity: 0.9,
                },
            ),
            (
                24000,
                MidiEvent::ControlChange {
                    cc: 123,
                    value: 0.0,
                },
            ),
        ],
        FRAMES,
    );
    let sustain = db(rms(&left[0..24000]));
    let tail = db(rms(&left[48000..]));
    assert!(
        tail < sustain - 20.0,
        "tail ({tail:.2} dB) must sit 20 dB below the sustain ({sustain:.2} dB) after CC123"
    );
}
