//! CLAP export tests: descriptor identity and the shared parameter /
//! preset set. The render path is shared with the VST3 export, so the
//! fingerprint / midi / params / program suites cover rendering for both
//! exports; this file only pins what is CLAP-specific.
//!
//! These tests only compile with the `clap` feature enabled:
//!   cargo test --release -p synth-vst3 --features clap --test clap
//! or the clap-only build:
//!   cargo test --release -p synth-vst3 --no-default-features --features clap
#![cfg(feature = "clap")]

use nih_plug::prelude::{ClapFeature, ClapPlugin};
use synth_vst3::{Gs1, PARAM_COUNT, PRESETS};

#[test]
fn clap_descriptor_is_stable() {
    // The CLAP ID is what hosts use to identify the plugin across
    // versions; it must not change once hosts have seen it.
    assert_eq!(Gs1::CLAP_ID, "dev.gradetwo.gs1");
    assert_eq!(Gs1::CLAP_DESCRIPTION, Some("GROOVE SYNTH GS-1 instrument"));
    assert_eq!(
        Gs1::CLAP_MANUAL_URL,
        Some("https://github.com/gradetwo/synth")
    );
    assert_eq!(
        Gs1::CLAP_SUPPORT_URL,
        Some("https://github.com/gradetwo/synth")
    );
    assert!(Gs1::CLAP_FEATURES.contains(&ClapFeature::Instrument));
    assert!(Gs1::CLAP_FEATURES.contains(&ClapFeature::Synthesizer));
}

#[test]
fn clap_shares_vst3_params_and_presets() {
    // Same 224 TS parameters and the same 120 factory presets as the
    // VST3 export: one plugin, two entry points.
    assert_eq!(PARAM_COUNT, 224);
    assert_eq!(PRESETS.len(), 120);
}
