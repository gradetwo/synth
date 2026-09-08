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

/* --- per-voice oscillators ------------------------------------------------- */
void gs_voice_osc_set(int v, int which, uint32_t wave, float freq, float amp, float pw);
void gs_voice_osc_reset(int v, int which, float phase);
void gs_voice_osc_block(int v, int which, float *out, uint32_t frames);

/* --- per-voice filter ------------------------------------------------------ */
void gs_voice_filter_set(int v, int type, float freq, float res, float drive);
void gs_voice_filter_block(int v, int type, const float *in, float *out, uint32_t frames);

/* --- per-voice DC blocker -------------------------------------------------- */
void gs_voice_dc_block(int v, const float *in, float *out, uint32_t frames);

/* --- global modulation effects (DaisySP) ---------------------------------- */
void gs_fx_init(float sample_rate);
void gs_fx_chorus_set(float depth, float freq, float delay_ms, float feedback);
void gs_fx_chorus_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_flanger_set(float depth, float freq, float delay_ms, float feedback);
void gs_fx_flanger_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_phaser_set(float depth, float freq, float feedback, int poles);
void gs_fx_phaser_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);
void gs_fx_overdrive_set(float drive);
void gs_fx_overdrive_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames);

/* Diagnostics: number of voices currently allocated in the static pool. */
int gs_daisy_voice_slots(void);

#ifdef __cplusplus
}
#endif

#endif /* GS_DAISY_H */
