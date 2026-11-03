//! Pure-table tests: parameter mapping, preset table, route table.
//! These never touch the engine.

use synth_vst3::{
    merged_preset, DEFAULT_ROUTES, PARAM_ACCESSORS, PARAM_DEFAULTS, PARAM_IS_DISCRETE, PARAM_NAMES,
    PARAM_RANGES, PRESETS,
};

#[test]
fn accessors_cover_all_224_ids() {
    assert_eq!(PARAM_ACCESSORS.len(), 224);
    let mut ids: Vec<u32> = PARAM_ACCESSORS.iter().map(|a| a.id).collect();
    ids.sort_unstable();
    for (i, id) in ids.iter().enumerate() {
        assert_eq!(*id, i as u32, "accessor ids must be exactly 0..223");
    }
}

#[test]
fn tables_have_224_entries_with_sane_ranges() {
    assert_eq!(PARAM_NAMES.len(), 224);
    assert_eq!(PARAM_DEFAULTS.len(), 224);
    assert_eq!(PARAM_RANGES.len(), 224);
    assert_eq!(PARAM_IS_DISCRETE.len(), 224);
    for id in 0..224 {
        let (min, max) = PARAM_RANGES[id];
        assert!(min < max, "id {id} has degenerate range [{min}, {max}]");
        let def = PARAM_DEFAULTS[id];
        assert!(
            def >= min && def <= max,
            "id {} default {def} outside [{min}, {max}]",
            PARAM_NAMES[id]
        );
        assert!(!PARAM_NAMES[id].is_empty());
    }
}

#[test]
fn presets_are_120_unique_starting_with_pluck() {
    assert_eq!(PRESETS.len(), 120);
    assert_eq!(PRESETS[0].id, "pluck");
    let mut ids: Vec<&str> = PRESETS.iter().map(|p| p.id).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 120, "preset ids must be unique");
    for preset in PRESETS {
        assert!(!preset.name.is_empty());
        for &(id, value) in preset.overlay {
            assert!(
                id < 224,
                "preset {} overlay id {id} out of range",
                preset.id
            );
            let (min, max) = PARAM_RANGES[id as usize];
            assert!(
                value >= min && value <= max,
                "preset {} overlay {value} for id {id} outside [{min}, {max}]",
                preset.id
            );
            if PARAM_IS_DISCRETE[id as usize] && !(min == 0.0 && max == 1.0) {
                assert_eq!(
                    value,
                    value.round(),
                    "preset {} overlay {value} for discrete Int id {id} is not an integer",
                    preset.id
                );
            }
        }
    }
}

#[test]
fn default_routes_are_engine_rust_codes() {
    // lfo=0 env=1 modwheel=2 velocity=3 lfo2=4 ...; cutoff=0 pitch=1 ...
    // (NOT the TS MOD_SOURCES order, where lfo2=1 and env=2.)
    assert_eq!(
        DEFAULT_ROUTES,
        [
            (0, 0, 0.8, true),   // lfo -> cutoff
            (1, 0, 0.55, true),  // env -> cutoff
            (0, 1, 0.18, false), // lfo -> pitch
            (2, 0, 0.4, false),  // modwheel -> cutoff
        ]
    );
}

#[test]
fn merged_preset_applies_overlay_over_defaults() {
    let pluck = merged_preset(0);
    // Spot values from the pluck overlay (see generated.rs).
    assert_eq!(pluck[2], 1.0); // osc1Wave: triangle
    assert_eq!(pluck[8], 4.0); // osc2Wave
    assert_eq!(pluck[78], 3.862); // patchGain trim
                                  // Untouched ids keep their defaults.
    assert_eq!(pluck[0], PARAM_DEFAULTS[0]); // masterVolume
    assert_eq!(pluck[38], PARAM_DEFAULTS[38]); // pitchBendRange
}
