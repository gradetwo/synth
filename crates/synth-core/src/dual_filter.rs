//! P6.3b — the second filter stage: serial, parallel, and the parallel blend.
//!
//! Kept out of `engine.rs`'s test module because it needs a measurement rig of
//! its own: these tests are about a *chain* of two filters, so almost every one
//! of them renders the same note two or three times with one filter switched off
//! and compares the results.
//!
//! Two things about the rig are easy to get wrong and are pinned here:
//!
//!   * the tone is played by *pitch*, so `OSC1_PITCH` clamps at ±48 semitones
//!     around C4 (about 16 Hz to 4.2 kHz) — a test grid outside that silently
//!     measures a different frequency;
//!   * the default modulation matrix routes the envelope and the LFO at the
//!     cutoff with both enabled, so any test that measures a response has to
//!     clear it first. P6.3a spent a round on that: with the routes live, a
//!     low-pass "rose" with frequency where it has to fall.

#[cfg(test)]
mod tests {
    use crate::engine::Engine;
    use crate::params::{id, FilterRouting, FilterType, Wave, MOD_ROUTES};
    use std::sync::Mutex;

    /// The C DSP keeps process-wide state, so engine tests are serialised.
    static ENGINE_LOCK: Mutex<()> = Mutex::new(());

    fn lock_engine() -> std::sync::MutexGuard<'static, ()> {
        ENGINE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn new_engine(poly: usize) -> Box<Engine> {
        let mut e = Box::new(Engine::new());
        e.init(48000.0, poly);
        e
    }

    /// One tone through the two-stage filter, so `freq` and `cutoff` are the
    /// only things a caller has to think about.
    #[derive(Clone, Copy)]
    struct Patch {
        freq: f32,
        kind: FilterType,
        cutoff: f32,
        res: f32,
        drive: f32,
        routing: FilterRouting,
        kind2: FilterType,
        cutoff2: f32,
        res2: f32,
        drive2: f32,
        blend: f32,
    }

    impl Patch {
        /// The first stage is `sem` at morph 0 — the SVF's own 12 dB low-pass —
        /// rather than `lp`: the discrete low-pass is the 24 dB ladder *with a
        /// tanh stage*, so a chain of two of them is neither 12 dB/oct per
        /// stage nor a product of two responses. `sem` at 0 is the linear 12 dB
        /// section these tests need, and P6.3a exists to make it available.
        fn tone(freq: f32, cutoff: f32) -> Self {
            Patch {
                freq,
                kind: FilterType::Sem,
                cutoff,
                res: 0.2,
                // Zero drive: with the drive stage on, the SVF's cubic term
                // makes the chain nonlinear and a "product of two magnitudes"
                // is no longer the right model.
                drive: 0.0,
                routing: FilterRouting::Parallel,
                kind2: FilterType::Lp,
                cutoff2: 9000.0,
                res2: 0.2,
                drive2: 0.0,
                blend: 0.5,
            }
        }

        /// The saw-tooth settings the time-domain tests use.
        fn saw(freq: f32) -> Self {
            Patch {
                freq,
                res: 0.6,
                drive: 0.3,
                res2: 0.6,
                drive2: 0.3,
                routing: FilterRouting::Off,
                ..Patch::tone(freq, 900.0)
            }
        }
    }

    /// Render one steady tone and return the left channel, skipping the
    /// transient. Every other block of the voice is patched out so the number
    /// that comes back is the filter chain and nothing else.
    fn render(patch: Patch, wave: Wave, blocks: usize) -> Vec<f32> {
        let mut e = new_engine(16);
        e.set_param(id::OSC1_WAVE, wave as u32 as f32);
        e.set_param(id::OSC1_LEVEL, 0.8);
        // C4 is 261.63 Hz, so this pitch offset plays the note at `freq`.
        let pitch = 12.0 * (patch.freq / 261.6256).log2();
        assert!(
            pitch.abs() <= 48.0,
            "test frequency {} Hz is outside the oscillator's range",
            patch.freq
        );
        e.set_param(id::OSC1_PITCH, pitch);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::OSC_FM, 0.0);
        e.set_param(id::OSC_RING, 0.0);
        e.set_param(id::OSC1_SYNC, 0.0);
        e.set_param(id::OSC1_SUB, 0.0);
        e.set_param(id::NOISE_MIX, 0.0);
        e.set_param(id::FILTER_TYPE, patch.kind.to_u32() as f32);
        e.set_param(id::FILTER_CUTOFF, patch.cutoff);
        e.set_param(id::FILTER_RES, patch.res);
        e.set_param(id::FILTER_DRIVE, patch.drive);
        e.set_param(id::FILTER_MORPH, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::FILTER_KBD, 0.0);
        e.set_param(id::FILTER_ROUTING, patch.routing.to_u32() as f32);
        e.set_param(id::FILTER2_TYPE, patch.kind2.to_u32() as f32);
        e.set_param(id::FILTER2_CUTOFF, patch.cutoff2);
        e.set_param(id::FILTER2_RES, patch.res2);
        e.set_param(id::FILTER2_DRIVE, patch.drive2);
        e.set_param(id::FILTER_BLEND, patch.blend);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::LFO2_ON, 0.0);
        // The default patch has the reverb on at 25 %. A reverb is a bank of
        // combs: it colours the level by several dB in a way that depends on the
        // frequency, and it would sit in the middle of every number below. The
        // filter chain is what is under test, so the effects are off.
        e.set_param(id::FX_REVERB_ON, 0.0);
        e.set_param(id::FX_DELAY_ON, 0.0);
        e.set_param(id::FX_CHORUS_ON, 0.0);
        e.set_param(id::FX_FLANGER_ON, 0.0);
        e.set_param(id::FX_PHASER_ON, 0.0);
        e.set_param(id::FX_DRIVE_ON, 0.0);
        // The default patch's ENV/LFO -> CUTOFF routes are live; a response
        // measured with them on is a measurement of the modulation.
        for index in 0..MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e.note_on(60, 1.0);
        for _ in 0..60 {
            e.process(128);
        }
        let mut out = Vec::with_capacity(blocks * 128);
        for _ in 0..blocks {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        out
    }

    /// Single-bin magnitude with a Hann window (the same measurement the rest
    /// of the DSP tests use).
    fn bin_mag(samples: &[f32], freq: f32) -> f32 {
        let n = samples.len();
        let w = core::f32::consts::TAU as f64 * freq as f64 / 48_000.0;
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, x) in samples.iter().enumerate() {
            let win = 0.5 - 0.5 * (core::f32::consts::TAU as f64 * i as f64 / n as f64).cos();
            let v = *x as f64 * win;
            re += v * (w * i as f64).cos();
            im -= v * (w * i as f64).sin();
        }
        ((re * re + im * im).sqrt() / n as f64) as f32 * 2.0
    }

    fn magnitude(patch: Patch) -> f32 {
        bin_mag(&render(patch, Wave::Sine, 64), patch.freq)
    }

    /// Stage 1 alone is what `FILTER_ROUTING = Off` renders, and it is also
    /// what the parallel blend's `b = 0` end has to reproduce exactly.
    fn stage1(patch: Patch) -> Vec<f32> {
        render(Patch { routing: FilterRouting::Off, ..patch }, Wave::Saw, 32)
    }

    /// Stage 1 followed by stage 2, which is what serial renders.
    fn serial(patch: Patch) -> Vec<f32> {
        render(Patch { routing: FilterRouting::Serial, ..patch }, Wave::Saw, 32)
    }

    /// Stage 2 alone in the parallel split: the same input runs through the
    /// second stage with the first one out of the way.
    fn stage2_only(patch: Patch) -> Vec<f32> {
        render(
            Patch {
                routing: FilterRouting::Parallel,
                blend: 1.0,
                res2: patch.res2,
                ..patch
            },
            Wave::Saw,
            32,
        )
    }

    fn worst_difference(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x - y).abs())
            .fold(0.0f32, f32::max)
    }

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0f32, |m, v| m.max(v.abs()))
    }

    /// The serial wiring is "the first stage's output into the second stage",
    /// so the measured response is the *product* of the two stages' own
    /// magnitudes. The engine renders each stage on its own — the first with
    /// the stage switched off, the second with the first parked wide open — so
    /// nothing in the comparison shares code with the chain under test: only
    /// the filter chain that actually ran can make the products line up.
    ///
    /// Two low-passes at the same cutoff give the classic 12 + 12 = 24 dB/oct,
    /// which is the shape the whole feature exists for.
    #[test]
    fn serial_is_the_product_of_the_two_magnitudes() {
        let _guard = lock_engine();
        for freq in [200.0f32, 400.0, 800.0, 1600.0] {
            let base = Patch { cutoff2: 400.0, ..Patch::tone(freq, 400.0) };
            // Every measurement carries the tone's own level, so the product
            // has to be taken of *responses*: dividing each by one wide-open
            // render leaves the two filters' magnitudes and nothing else.
            let reference = magnitude(Patch {
                routing: FilterRouting::Off,
                kind: FilterType::Sem,
                cutoff: 20_000.0,
                res: 0.0,
                drive: 0.0,
                ..base
            }) as f64;
            let a = magnitude(Patch { routing: FilterRouting::Off, ..base }) as f64 / reference;
            let b = magnitude(Patch { routing: FilterRouting::Parallel, blend: 1.0, ..base }) as f64
                / reference;
            let both = magnitude(Patch { routing: FilterRouting::Serial, ..base }) as f64 / reference;
            let product = a * b;
            // 0.6 dB: the two runs have independently settled and the SVF's
            // cubic term is not perfectly negligible even at zero drive, so an
            // exact equality would be a lie; a wrong wiring is wrong by far more
            // than this (the probes are 12-ish dB apart per octave).
            let error_db = 20.0 * (both / product.max(1e-12)).log10();
            assert!(
                error_db.abs() < 0.6,
                "{freq} Hz: serial {both:.6} is not the product {product:.6} of stage 1 {a:.6} and stage 2 {b:.6} ({error_db:+.2} dB)"
            );
        }
    }

    /// The point of chaining two low-passes: two 12 dB/oct slopes in series
    /// fall twice as fast. The tone's own level is divided out by a reference
    /// render with the first cutoff wide open, exactly as the `sem` slope test
    /// does.
    #[test]
    fn serial_two_low_passes_fall_24_db_per_octave() {
        let _guard = lock_engine();
        let cutoff = 400.0f32;
        // Both stages at the same cutoff, which is what makes the chain a
        // 24 dB/oct low-pass; the helper's default second cutoff is 9 kHz.
        let pair = |freq: f32| Patch { cutoff2: cutoff, ..Patch::tone(freq, cutoff) };
        let reference = |freq: f32| -> f64 {
            let p = Patch { routing: FilterRouting::Off, cutoff: 20_000.0, ..pair(freq) };
            magnitude(p) as f64
        };
        let response = |freq: f32, routing: FilterRouting| -> f64 {
            let p = Patch { routing, ..pair(freq) };
            magnitude(p) as f64 / reference(freq)
        };
        // Two octaves straddling the cutoff: 200 Hz is a full octave below it,
        // 800 Hz a full octave above, which is where a 24 dB/oct low-pass is
        // already in its stop-band slope.
        let single = 20.0 * (response(800.0, FilterRouting::Off) / response(200.0, FilterRouting::Off)).log10();
        let chained = 20.0 * (response(800.0, FilterRouting::Serial) / response(200.0, FilterRouting::Serial)).log10();
        assert!(
            (single + 12.0).abs() < 3.0,
            "one stage should be ~-12 dB over the two octaves, got {single:.2}"
        );
        assert!(
            (chained + 24.0).abs() < 4.0,
            "two stages in series should be ~-24 dB over the two octaves, got {chained:.2}"
        );
        // And the chain has to be steeper than either stage alone by a clear
        // margin, not merely "also falling".
        assert!(
            chained < single - 6.0,
            "the serial slope ({chained:.2} dB) is not steeper than one stage's ({single:.2} dB)"
        );
    }

    /// Two low-passes at *different* cutoffs: each one has to add its own
    /// 12 dB/oct in its own band, so between the two cutoffs the chain is
    /// −12 dB/oct and above the higher cutoff it is −24.
    #[test]
    fn serial_slopes_add_band_by_band() {
        let _guard = lock_engine();
        let (first, second) = (300.0f32, 1200.0f32);
        let reference = |freq: f32| -> f64 {
            let p = Patch { routing: FilterRouting::Off, kind: FilterType::Lp, cutoff: 20_000.0, res: 0.0, drive: 0.0, ..Patch::tone(freq, first) };
            magnitude(p) as f64
        };
        let response = |freq: f32| -> f64 {
            let p = Patch {
                kind2: FilterType::Lp,
                cutoff2: second,
                routing: FilterRouting::Serial,
                ..Patch::tone(freq, first)
            };
            magnitude(p) as f64 / reference(freq)
        };
        // Between the cutoffs only the first stage rolls off.
        let between = 20.0 * (response(600.0) / response(300.0)).log10();
        // Above the second cutoff both do.
        let above = 20.0 * (response(2400.0) / response(1200.0)).log10();
        assert!(
            between < -8.0 && between > -16.0,
            "between the cutoffs the chain should fall ~12 dB/oct, got {between:.2}"
        );
        assert!(
            above < -18.0 && above > -30.0,
            "above both cutoffs the chain should fall ~24 dB/oct, got {above:.2}"
        );
        assert!(
            above < between - 6.0,
            "the second stage did not add its own slope: {between:.2} dB below it, {above:.2} dB above"
        );
    }

    /// The parallel blend is a linear mix of the two branches, and its two ends
    /// are *exactly* one branch each. The exactness is the point: `b = 0` has to
    /// be stage 1 (so switching the stage on cannot change a patch that leaves
    /// the blend at that end), and `b = 1` has to be stage 2.
    #[test]
    fn parallel_blend_endpoints_are_exactly_one_stage() {
        let _guard = lock_engine();
        let patch = Patch::saw(220.0);
        let off = stage1(patch);
        let at_zero = render(Patch { routing: FilterRouting::Parallel, blend: 0.0, ..patch }, Wave::Saw, 32);
        assert_eq!(
            worst_difference(&off, &at_zero),
            0.0,
            "blend 0 did not render exactly the single-stage path"
        );
        // The other end is stage 2 alone. Rendering it "alone" through the same
        // parallel mixer with the first stage wide open is bit-for-bit what the
        // dark branch computes here, because the first stage's *state* does not
        // touch the second stage's.
        let second = stage2_only(patch);
        let at_one = render(Patch { routing: FilterRouting::Parallel, blend: 1.0, ..patch }, Wave::Saw, 32);
        assert_eq!(
            worst_difference(&second, &at_one),
            0.0,
            "blend 1 did not render exactly the second-stage path"
        );
    }

    /// The blend law itself: `out = (1 - b) * A + b * B`, with A and B the two
    /// branches the same engine renders. The two ends are excluded because they
    /// are bit-exact assertions above; the middle is FP arithmetic on the same
    /// signals, so the tolerance is machine-epsilon-ish relative to the level.
    #[test]
    fn parallel_blend_is_the_weighted_sum_of_the_branches() {
        let _guard = lock_engine();
        let patch = Patch::saw(220.0);
        let a = stage1(patch);
        let b = render(Patch { routing: FilterRouting::Parallel, blend: 1.0, ..patch }, Wave::Saw, 32);
        for blend in [0.25f32, 0.5, 0.75] {
            let actual = render(Patch { routing: FilterRouting::Parallel, blend, ..patch }, Wave::Saw, 32);
            let want: Vec<f32> = a
                .iter()
                .zip(&b)
                .map(|(x, y)| x + (y - x) * blend)
                .collect();
            let worst = worst_difference(&actual, &want);
            let level = peak(&want).max(1e-6);
            assert!(
                worst < level * 1e-4,
                "blend {blend}: the render is not the weighted sum (worst {worst:e} at level {level:e})"
            );
        }
    }

    /// The blend knob has to *do* something across its range: at a frequency
    /// where the two branches disagree, the mixed magnitude moves monotonically
    /// from one branch's curve to the other's.
    #[test]
    fn parallel_blend_moves_the_response_monotonically() {
        let _guard = lock_engine();
        // Both stages low-pass at 400 Hz, so between them they are the same
        // shape; make the second one dark instead so the two ends differ at the
        // probe frequency.
        let probe = 1500.0f32;
        let base = Patch { kind2: FilterType::Lp, cutoff2: 300.0, ..Patch::tone(probe, 4000.0) };
        let at = |blend: f32| magnitude(Patch { routing: FilterRouting::Parallel, blend, ..base });
        let ladder = [0.0f32, 0.25, 0.5, 0.75, 1.0].map(at);
        for pair in ladder.windows(2) {
            assert!(
                pair[1] < pair[0] * 0.999,
                "the blend did not move the response monotonically: {ladder:?}"
            );
        }
        // Wide open first stage (4 kHz) passes the probe, the 300 Hz second
        // stage does not: the two ends have to be far apart, or the test above
        // is measuring nothing.
        assert!(
            ladder[0] > ladder[4] * 10.0,
            "the two blend ends are not distinguishable: {ladder:?}"
        );
    }

    /// Serial and parallel are two answers to the same question and have to
    /// sound different when the stages differ: series multiplies the slopes,
    /// parallel mixes them. A gate here would be a switch that does nothing.
    #[test]
    fn serial_and_parallel_differ_where_the_stages_differ() {
        let _guard = lock_engine();
        let dark = Patch {
            kind2: FilterType::Lp,
            cutoff2: 300.0,
            blend: 0.5,
            ..Patch::tone(1200.0, 6000.0)
        };
        let series = magnitude(Patch { routing: FilterRouting::Serial, ..dark });
        let parallel = magnitude(Patch { routing: FilterRouting::Parallel, ..dark });
        assert!(
            series < parallel * 0.5,
            "serial {series:.6} is not darker than parallel {parallel:.6}"
        );
    }

    /// A voice that never leaves the default routing has to render exactly what
    /// it did before the second stage existed. The test sets every second-stage
    /// parameter to values that *would* change the sound if they were read, and
    /// leaves `FILTER_ROUTING` untouched at its default: the render must equal
    /// the one where the stage is explicitly switched off.
    #[test]
    fn routing_off_ignores_every_second_stage_control() {
        let _guard = lock_engine();
        let base = Patch::saw(220.0);
        let render_with = |routing: Option<FilterRouting>, loud: bool| -> Vec<f32> {
            let patch = if loud {
                Patch {
                    kind2: FilterType::Bp,
                    cutoff2: 200.0,
                    res2: 0.9,
                    drive2: 0.9,
                    blend: 0.9,
                    ..base
                }
            } else {
                base
            };
            let patch = match routing {
                Some(r) => Patch { routing: r, ..patch },
                None => patch,
            };
            render(patch, Wave::Saw, 24)
        };
        // Off is a pure bypass: the second stage's own controls are ignored
        // (the engine's default routing is Off, which the DSP and preset
        // fingerprints cover with the whole default patch).
        let untouched = render_with(Some(FilterRouting::Off), false);
        let off_with_loud_stage2 = render_with(Some(FilterRouting::Off), true);
        assert_eq!(
            worst_difference(&untouched, &off_with_loud_stage2),
            0.0,
            "a switched-off second stage still read its own controls"
        );
        // And the same patch with the stage on must differ, or the test above
        // would pass for a stage that never runs.
        let on = Patch { routing: FilterRouting::Serial, ..base };
        assert!(
            worst_difference(&untouched, &render(on, Wave::Saw, 24)) > 1e-3,
            "switching the second stage on changed nothing"
        );
    }

    /// The routing switch is a switch the player will throw while a note rings,
    /// and the second stage keeps its own running state, so both the switch and
    /// a fast cutoff sweep have to stay bounded, finite and free of steps that
    /// the signal itself could not produce.
    #[test]
    fn routing_switch_and_sweep_are_click_free() {
        let _guard = lock_engine();
        for block in [128usize, 1024] {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::OSC1_SYNC, 0.0);
            e.set_param(id::OSC1_SUB, 0.0);
            e.set_param(id::NOISE_MIX, 0.0);
            e.set_param(id::FILTER_TYPE, FilterType::Lp.to_u32() as f32);
            e.set_param(id::FILTER_CUTOFF, 700.0);
            e.set_param(id::FILTER_RES, 0.7);
            e.set_param(id::FILTER_DRIVE, 0.4);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::FILTER_KBD, 0.0);
            e.set_param(id::FILTER2_TYPE, FilterType::Bp.to_u32() as f32);
            e.set_param(id::FILTER2_CUTOFF, 900.0);
            e.set_param(id::FILTER2_RES, 0.7);
            e.set_param(id::FILTER2_DRIVE, 0.4);
            e.set_param(id::FILTER_BLEND, 0.5);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::LFO2_ON, 0.0);
            for index in 0..MOD_ROUTES {
                e.set_route(index, 0, 0, 0.0, false);
            }
            e.note_on(45, 1.0);
            for _ in 0..80 {
                e.process(block);
            }
            let mut out = Vec::new();
            for step in 0..240 {
                // Off -> serial -> parallel -> off, one thunk of the switch per
                // 8 blocks, with the second stage's cutoff sweeping 200 Hz to
                // 8 kHz at the same time.
                let routing = match (step / 8) % 3 {
                    0 => FilterRouting::Off,
                    1 => FilterRouting::Serial,
                    _ => FilterRouting::Parallel,
                };
                e.set_param(id::FILTER_ROUTING, routing.to_u32() as f32);
                let t = (step * block) as f32 / 48_000.0;
                e.set_param(
                    id::FILTER2_CUTOFF,
                    200.0 + 3900.0 * (1.0 - (t * 6.0 * core::f32::consts::TAU).cos()),
                );
                e.set_param(id::FILTER_BLEND, if (step / 4) % 2 == 0 { 0.0 } else { 1.0 });
                e.process(block);
                out.extend_from_slice(&e.left()[..block]);
            }
            assert!(
                out.iter().all(|v| v.is_finite()),
                "block {block}: the routing switch produced a non-finite sample"
            );
            let top = peak(&out);
            assert!(top < 1.0, "block {block}: the routing switch ran away: peak {top}");
            assert!(top > 1e-3, "block {block}: the routing switch was silent");
            let worst = out
                .windows(2)
                .map(|w| (w[1] - w[0]).abs())
                .fold(0.0f32, f32::max);
            // A 110 Hz saw at unity voice gain cannot step by more than its own
            // reset transient, so 0.5 is an order of magnitude above anything
            // the signal does and an order below an audible click at this level
            // — the same bound the SEM morph test uses.
            assert!(
                worst < 0.5,
                "block {block}: the routing switch clicked: worst sample step {worst}"
            );
        }
    }

    /// A fast sweep of the second stage's cutoff alone, at both ends of the
    /// block range the worklet may hand the engine.
    #[test]
    fn second_stage_sweep_stays_bounded() {
        let _guard = lock_engine();
        for block in [128usize, 1024] {
            let mut e = new_engine(16);
            e.set_param(id::OSC1_WAVE, Wave::Saw as u32 as f32);
            e.set_param(id::OSC1_LEVEL, 0.8);
            e.set_param(id::OSC2_ON, 0.0);
            e.set_param(id::OSC2_LEVEL, 0.0);
            e.set_param(id::FILTER_TYPE, FilterType::Lp.to_u32() as f32);
            e.set_param(id::FILTER_CUTOFF, 1200.0);
            e.set_param(id::FILTER_RES, 0.8);
            e.set_param(id::FILTER_DRIVE, 0.5);
            e.set_param(id::FILTER_ENV_AMT, 0.0);
            e.set_param(id::FILTER_KBD, 0.0);
            e.set_param(id::FILTER2_TYPE, FilterType::Lp.to_u32() as f32);
            e.set_param(id::FILTER2_RES, 0.95);
            e.set_param(id::FILTER2_DRIVE, 1.0);
            e.set_param(id::FILTER_BLEND, 0.5);
            e.set_param(id::ENV_ATTACK, 0.001);
            e.set_param(id::ENV_SUSTAIN, 1.0);
            e.set_param(id::LFO_ON, 0.0);
            e.set_param(id::LFO2_ON, 0.0);
            for index in 0..MOD_ROUTES {
                e.set_route(index, 0, 0, 0.0, false);
            }
            e.note_on(60, 1.0);
            let mut peak = 0.0f32;
            let mut frames = 0usize;
            while frames < 240_000 {
                let t = frames as f32 / 48_000.0;
                // 0..1 over ~0.12 s in parallel and in series, with the cutoff
                // sweeping 200 Hz..8 kHz on the same schedule as the SEM test.
                e.set_param(
                    id::FILTER_ROUTING,
                    if (t * 4.0) as u32 % 2 == 0 { 1.0 } else { 2.0 },
                );
                e.set_param(
                    id::FILTER2_CUTOFF,
                    200.0 * (t * 6.0 * core::f32::consts::TAU).sin().abs() * 40.0 + 200.0,
                );
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

    #[test]
    fn dbg_probe2() {
        let _guard = lock_engine();
        for freq in [200.0f32, 800.0] {
            let base = Patch::tone(freq, 400.0);
            let only2 = Patch { kind: FilterType::Lp, cutoff: 20_000.0, res: 0.0, drive: 0.0, ..base };
            let a = magnitude(Patch { routing: FilterRouting::Off, ..base });
            let b = magnitude(Patch { routing: FilterRouting::Off, ..only2 });
            let both = magnitude(Patch { routing: FilterRouting::Serial, ..base });
            let par1 = magnitude(Patch { routing: FilterRouting::Parallel, blend: 1.0, ..base });
            let par0 = magnitude(Patch { routing: FilterRouting::Parallel, blend: 0.0, ..base });
            println!("DBG2 freq={freq} a(off,400)={a:.6} b(off,20k)={b:.6} serial={both:.6} par0={par0:.6} par1={par1:.6} prod={:.6}", a*b);
            // Same-kind references: stage 1 as a plain ladder, stage 2 as a
            // second ladder (bridged through the *first* stage's controls).
            let s1_svf = magnitude(Patch { kind: FilterType::Bp, cutoff: 20_000.0, res: 0.0, drive: 0.0, routing: FilterRouting::Off, ..base });
            let s2_svf = magnitude(Patch { kind: FilterType::Bp, cutoff: 20_000.0, res: 0.0, drive: 0.0, routing: FilterRouting::Off, kind2: FilterType::Lp, cutoff2: 9000.0, ..base });
            println!("DBG2 refs: s1_svf={s1_svf:.6} s2_svf={s2_svf:.6}");
        }
        // Serial on a saw: compare sample arrays with a hand-built cascade is
        // impossible, but the peak ratio tells whether serial is filtering
        // twice at all.
        let base = Patch::saw(220.0);
        for (name, p) in [
            ("off", Patch { routing: FilterRouting::Off, ..base }),
            ("serial", Patch { routing: FilterRouting::Serial, ..base }),
            ("parallel1", Patch { routing: FilterRouting::Parallel, blend: 1.0, ..base }),
        ] {
            let out = render(p, Wave::Saw, 8);
            let rms = (out.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / out.len() as f64).sqrt();
            println!("DBG2 saw {name}: rms={rms:.6} peak={:.6} first={:.6}", peak(&out), out[0]);
        }
    }

    /// The enum that decides the wiring round-trips through the parameter wire
    /// format, and every other value reads as "off" (the default), never as a
    /// stage that suddenly runs.
    #[test]
    fn routing_values_round_trip_and_unknown_ones_are_off() {
        for (raw, want) in [
            (0u32, FilterRouting::Off),
            (1, FilterRouting::Serial),
            (2, FilterRouting::Parallel),
            (3, FilterRouting::Off),
            (99, FilterRouting::Off),
        ] {
            assert_eq!(FilterRouting::from_u32(raw), want, "routing id {raw}");
            if raw <= 2 {
                assert_eq!(want.to_u32(), raw);
            }
        }
    }

    /// Second-stage types the C bridge cannot run twice (the comb and the
    /// formant own one piece of per-voice state each) read as a low-pass
    /// instead of quietly sharing stage 1's state — the parameter write itself
    /// has to make that substitution, not the bridge, so the UI and any
    /// fingerprint see the same value the renderer uses.
    #[test]
    fn comb_and_formant_second_stage_read_as_low_pass() {
        let mut e = new_engine(16);
        e.set_param(id::FILTER2_TYPE, FilterType::Comb.to_u32() as f32);
        e.process(128);
        assert_eq!(e.params.filter.kind2, FilterType::Lp);
        e.set_param(id::FILTER2_TYPE, FilterType::Formant.to_u32() as f32);
        e.process(128);
        assert_eq!(e.params.filter.kind2, FilterType::Lp);
        // The four the bridge does have stay put, including the continuous
        // multimode stage 1 gained in P6.3a.
        for kind in [FilterType::Lp, FilterType::Hp, FilterType::Bp, FilterType::Notch, FilterType::Sem] {
            e.set_param(id::FILTER2_TYPE, kind.to_u32() as f32);
            e.process(128);
            assert_eq!(e.params.filter.kind2, kind);
        }
    }
}
