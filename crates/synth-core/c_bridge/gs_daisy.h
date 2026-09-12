/*
 * gs_daisy.h — block-processing C ABI over the vendored DaisySP subset.
 *
 * This is the cross-language boundary described in prd.md §2.2: every call
 * processes a whole block (128..1024 frames) so per-sample FFI overhead is
 * amortised. All DSP state lives in statically allocated voice slots, so the
 * audio thread performs zero heap allocation.
 */
#ifndef GS_DAISY_H
#define GS_DAISY_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define GS_MAX_VOICES 32

/* Oscillator waveform ids — mirror daisysp::Oscillator::WAVE_* */
enum {
    GS_WAVE_SIN = 0,
    GS_WAVE_TRI = 1,
    GS_WAVE_SAW = 2,
    GS_WAVE_RAMP = 3,
    GS_WAVE_SQUARE = 4,
    GS_WAVE_POLYBLEP_TRI = 5,
    GS_WAVE_POLYBLEP_SAW = 6,
    GS_WAVE_POLYBLEP_SQUARE = 7,
};

/* Filter ids used by the engine. LP uses the Moog ladder (DaisySP LadderFilter,
 * LP24); the rest use the double-sampled SVF. */
enum {
    GS_FILTER_LP = 0,
    GS_FILTER_HP = 1,
    GS_FILTER_BP = 2,
    GS_FILTER_NOTCH = 3,
};

/* SVF outputs */
enum {
    GS_SVF_LOW = 0,
    GS_SVF_HIGH = 1,
    GS_SVF_BAND = 2,
    GS_SVF_NOTCH = 3,
    GS_SVF_PEAK = 4,
};

/* Initialise every voice slot for a given sample rate. */
void gs_daisy_init(float sample_rate);

/* Clear the DSP state of one voice slot (called when a slot is reallocated). */
void gs_voice_reset(int v);
/** Seed the two oscillator phases (0..1) so stacked voices do not start in
    phase, which would make every chord attack peak N times instead of sqrt(N). */
/// Highest number of unison sub-voices per oscillator (keep in sync with
/// `MAX_UNISON` in params.rs).
#define GS_MAX_UNISON 7
void gs_voice_phase(int v, float p0, float p1);

/* --- per-voice oscillators ------------------------------------------------- */
void gs_voice_osc_set(int v, int which, int sub, uint32_t wave, float freq, float amp, float pw);
void gs_voice_osc_reset(int v, int which, float phase);
void gs_voice_osc_block(int v, int which, int sub, float *out, uint32_t frames);
/// Render one oscillator with its phase modulated by `mod` (one value per
/// sample, usually -1..1) times `depth` cycles. The phase is *placed* for each
/// sample rather than added, so the carrier keeps running at its own frequency
/// and the 0..1 range the band-limited shapes need is never left.
void gs_voice_osc_pm_block(int v, int which, int sub, const float *mod, float depth,
                           float *out, uint32_t frames);

/* --- per-voice filter ------------------------------------------------------ */
void gs_voice_filter_set(int v, int side, int type, float freq, float res, float drive);
void gs_voice_filter_block(int v, int side, int type, const float *in, float *out, uint32_t frames);

/* --- per-voice DC blocker -------------------------------------------------- */
void gs_voice_dc_block(int v, int side, const float *in, float *out, uint32_t frames);
/// Vowel formant filter: three parallel band-passes. `vowel` morphs 0..1 across
/// A→E→I→O→U, `res` sets the band Q.
void gs_voice_formant_set(int v, int side, float vowel, float res);
void gs_voice_formant_block(int v, int side, const float *in, float *out, uint32_t frames);

/* --- global modulation effects (DaisySP) ---------------------------------- */
#define GS_FX_SLOTS 6

void gs_fx_init(float sample_rate);
/** How many effect nodes have their own state (`FX_SLOTS` on the Rust side). */
int gs_fx_slots(void);
void gs_fx_chorus_set(int slot, float depth, float freq, float delay_ms, float feedback);
void gs_fx_chorus_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_flanger_set(int slot, float depth, float freq, float delay_ms, float feedback);
void gs_fx_flanger_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_phaser_set(int slot, float depth, float freq, float feedback, int poles);
void gs_fx_phaser_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_overdrive_set(int slot, float drive);
void gs_fx_overdrive_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);

/* Diagnostics: number of voices currently allocated in the static pool. */
int gs_daisy_voice_slots(void);

#ifdef __cplusplus
}
#endif

#endif /* GS_DAISY_H */
