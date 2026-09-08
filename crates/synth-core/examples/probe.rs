use synth_core::engine::Engine;
use synth_core::params::{id, Wave};
fn peak(x: &[f32]) -> f32 { x.iter().fold(0f32, |a, &v| a.max(v.abs())) }
fn main() {
    let mut e = Box::new(Engine::new());
    e.init(48000.0, 16);
    e.set_param(id::OSC1_WAVE, Wave::Saw as u32 as f32);
    e.set_param(id::OSC1_LEVEL, 0.8);
    e.set_param(id::FILTER_CUTOFF, 12000.0);
    e.note_on(60, 1.0);
    for b in 0..200 {
        e.process(128);
        if b % 20 == 0 || b > 190 {
            println!("b={b} voices={} out={:.5} env={:.4} cutoffmod_ok", e.active_voices(), peak(&e.left()[..128]), e.debug_env()[127]);
        }
    }
}
