/*
 * gs_soundpipe.h — block-processing C ABI over the vendored Soundpipe subset.
 *
 * Drives Soundpipe's Csound-derived `reverbsc` stereo reverb plus a pair of
 * `sp_delay` lines (prd.md §2.1: "延迟类、混响类效果器"). All state is static;
 * buffers are allocated once through Soundpipe's own `sp_auxdata_alloc`.
 */
#ifndef GS_SOUNDPIPE_H
#define GS_SOUNDPIPE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

void gs_sp_init(float sample_rate);

/* reverb: feedback 0..0.98, low-pass damping frequency in Hz, wet mix 0..1 */

/* delay: time in seconds (<= GS_SP_MAX_DELAY), feedback 0..0.95, wet mix 0..1 */
void gs_sp_set_delay(float time_s, float feedback, float mix);

/* Stereo block render: adds the wet reverb + delay tail onto the dry input. */
void gs_sp_process_block(const float *in_l,
                         const float *in_r,
                         float *out_l,
                         float *out_r,
                         uint32_t frames);

/* Diagnostics */
float gs_sp_max_delay(void);

/* Number of buffer allocations performed so far (init only, never per block). */
uint32_t gs_sp_alloc_events(void);

#ifdef __cplusplus
}
#endif

#endif /* GS_SOUNDPIPE_H */
