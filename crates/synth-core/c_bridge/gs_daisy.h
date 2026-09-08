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

/* Ladder filter modes — mirror daisysp::LadderFilter::FilterMode */
enum {
    GS_LADDER_LP24 = 0,
    GS_LADDER_LP12 = 1,
    GS_LADDER_BP24 = 2,
    GS_LADDER_BP12 = 3,
    GS_LADDER_HP24 = 4,
    GS_LADDER_HP12 = 5,
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

/* --- per-voice oscillators ------------------------------------------------- */
void gs_voice_osc_set(int v, int which, uint32_t wave, float freq, float amp, float pw);
void gs_voice_osc_reset(int v, int which, float phase);
void gs_voice_osc_block(int v, int which, float *out, uint32_t frames);

/* --- per-voice amplitude envelope ----------------------------------------- */
void gs_voice_env_set(int v, float attack_s, float decay_s, float sustain, float release_s);
void gs_voice_env_retrigger(int v, int hard);
void gs_voice_env_block(int v, int gate, float *out, uint32_t frames);
int  gs_voice_env_segment(int v);
int  gs_voice_env_running(int v);

/* --- per-voice filter ------------------------------------------------------ */
void gs_voice_filter_set(int v, int type, float freq, float res, float drive);
void gs_voice_filter_block(int v, int type, const float *in, float *out, uint32_t frames);

/* --- per-voice DC blocker -------------------------------------------------- */
void gs_voice_dc_block(int v, const float *in, float *out, uint32_t frames);

/* Diagnostics: number of voices currently allocated in the static pool. */
int gs_daisy_voice_slots(void);

#ifdef __cplusplus
}
#endif

#endif /* GS_DAISY_H */
