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
    /* SEM-style continuous multimode: one SVF, its low/band/high outputs mixed
     * by `morph` (see gs_voice_filter_block). Appended so the four ids above
     * keep the numbering every existing patch stores. */
    GS_FILTER_SEM = 4,
    /* The two types that keep per-voice state only stage 1 can own. They never
     * reach the bridge (Rust branches on them first); the second-stage entry
     * point maps them to a low-pass instead of running them twice. */
    GS_FILTER_COMB = 5,
    GS_FILTER_FORMANT = 6,
};

/* How the second filter stage is wired (P6.3b), matching `FilterRouting` in
 * params.rs. The ids are positional in that enum, so this cast is safe — unlike
 * the filter *types*, whose wire ids and bridge ids differ on purpose. */
#define GS_FILTER_ROUTING_OFF 0
#define GS_FILTER_ROUTING_SERIAL 1
#define GS_FILTER_ROUTING_PARALLEL 2

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
/// Render OSC 2 (the master) and OSC 1 (the slave) as a hard-synced pair, the
/// slave's cycle restarting whenever the master completes one. Both are
/// oversampled by GS_SYNC_OS and decimated through a half-band filter, because
/// the restart is a discontinuity and a naive one aliases; `mod`/`depth` apply
/// the same phase modulation as `gs_voice_osc_pm_block` to the slave, or pass
/// NULL for none. The frequencies must already be set through
/// `gs_voice_osc_set` for one *oversampled* step, i.e. divided by GS_SYNC_OS:
/// the block calls Process() that many times per output sample.
void gs_voice_osc_sync_block(int v, int sub, const float *mod, float depth, float *master_out,
                             float *slave_out, uint32_t frames);

/// Render one oscillator as a band-limited naive saw/square/triangle (P9.1b).
///
/// Same machinery as the sync pair -- the naive shape plus a BLEP at every step
/// (the cycle wrap, the square/pulse edge) and a BLAMP at the triangle's slope
/// kinks, 2x oversampled and decimated through the shared 95-tap Kaiser filter
/// -- but with no restart, so a plain saw/square/triangle loses the two-point
/// polyBLEP's -40 dB folding floor. `mod`/`depth` are the same carrier phase
/// modulation as `gs_voice_osc_pm_block`; pass NULL for none. Only saw, ramp,
/// square/pulse and triangle are meaningful; the engine keeps sine, wavetable,
/// sample and noise on their old paths.
///
/// Latency: `gs_osc_bandlimit_latency()` base-rate samples (23.5 at 48 kHz).
void gs_voice_osc_bandlimit_block(int v, int which, int sub, const float *mod, float depth,
                                  float *out, uint32_t frames);
/// Fixed latency of `gs_voice_osc_bandlimit_block`, in base-rate samples.
float gs_osc_bandlimit_latency(void);
/// Delay `io` in place by exactly that latency (23.5 samples), for the paths
/// that still come from DaisySP: a 23-sample integer delay plus a 4-tap cubic
/// Lagrange half-sample interpolator. Mixing an undelayed sine with a delayed
/// band-limited saw would comb; this is what keeps them aligned.
void gs_voice_osc_delay_block(int v, int which, int sub, float *io, uint32_t frames);

/* --- per-voice filter ------------------------------------------------------ */
/* `morph` (0..1) is only read for GS_FILTER_SEM: it walks four canonical
 * points — 0 low-pass, 1/3 band-pass, 2/3 notch (low + high), 1 high-pass —
 * with linear ramps between them (see sem_mix). Every other type ignores it,
 * which is what lets the engine pass the same parameter block to both paths. */
void gs_voice_filter_set(int v, int side, int type, float freq, float res, float drive);
void gs_voice_filter_block(int v, int side, int type, float morph, const float *in, float *out,
                           uint32_t frames);
/* The optional second filter stage (P6.3b). This is just the *second* stage —
 * stage 1 stays `gs_voice_filter_block`, so both wirings call each stage exactly
 * once and a routing change cannot make stage 1 run (and advance its state)
 * twice for the same samples. The caller wires them: serial points this at the
 * first stage's output, parallel points it at the same signal the first stage
 * read, and the mix law lives in Rust either way.
 *
 * The stage is always 12 dB/oct (the SVF), even for `lp`: stage 1's `lp` is the
 * 24 dB/oct ladder, and a second one per side would cost twice the state for a
 * shape two chained 12 dB stages already reach. A comb or formant here renders
 * as that same SVF low-pass rather than sharing stage 1's single instance. */
void gs_voice_filter2_set(int v, int side, int type, float freq, float res, float drive);
void gs_voice_filter2_block(int v, int side, int type, float morph, const float *in, float *out,
                            uint32_t frames);

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
