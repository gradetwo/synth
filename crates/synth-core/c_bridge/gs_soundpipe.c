/*
 * gs_soundpipe.c — C ABI wrappers around the vendored Soundpipe modules.
 *
 * Vendored sources (MIT):
 *   vendor/soundpipe/h/{base,delay,allpass,comb,revsc}.h
 *   vendor/soundpipe/modules/{base,delay,allpass,comb,revsc}.c
 *
 * Reverb is Soundpipe's Csound-derived `reverbsc`. The delay line is built on
 * Soundpipe's own `sp_auxdata` storage but uses a fractional read pointer, so
 * changing the tempo-synced delay time is click-free and, crucially, never
 * reallocates on the audio thread (prd.md §1.1).
 */
#include "gs_soundpipe.h"

#include "soundpipe.h"

#define GS_SP_MAX_DELAY 2.0f
/* One-pole smoothing coefficient for delay-time changes (~20 ms). */
#define GS_SP_TIME_SLEW 0.0008f

static sp_data g_sp;
static sp_revsc g_rev;
static sp_auxdata g_dly_buf[2];
static uint32_t g_dly_size = 0;
static uint32_t g_dly_write = 0;
static float g_dly_samples = 0.0f;
static float g_dly_target = 0.0f;
static float g_dly_fb = 0.0f;
static float g_dly_mix = 0.0f;
static float g_rev_mix = 0.0f;
static int g_ready = 0;
static uint32_t g_alloc_events = 0;

void gs_sp_init(float sample_rate)
{
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;

    g_sp.out = 0;
    g_sp.sr = (int)(sample_rate + 0.5f);
    g_sp.nchan = 2;
    g_sp.len = 0;
    g_sp.pos = 0;
    g_sp.rand = 1u;
    g_sp.filename[0] = 0;

    sp_revsc_init(&g_sp, &g_rev);
    g_rev.feedback = 0.90f;
    g_rev.lpfreq = 9000.0f;

    g_dly_size = (uint32_t)(GS_SP_MAX_DELAY * sample_rate) + 4;
    for (int ch = 0; ch < 2; ++ch) {
        sp_auxdata_alloc(&g_dly_buf[ch], g_dly_size * sizeof(SPFLOAT));
        ++g_alloc_events;
    }
    /* sp_revsc_init allocates its eight delay lines through sp_auxdata_alloc. */
    ++g_alloc_events;
    g_dly_write = 0;
    g_dly_samples = g_dly_size - 1;
    g_dly_target = g_dly_samples;
    g_dly_fb = 0.0f;
    g_dly_mix = 0.0f;
    g_rev_mix = 0.0f;
    g_ready = 1;
}

void gs_sp_set_reverb(float feedback, float lpfreq, float mix)
{
    if (!g_ready) return;
    if (feedback < 0.0f) feedback = 0.0f;
    if (feedback > 0.98f) feedback = 0.98f;
    if (lpfreq < 200.0f) lpfreq = 200.0f;
    if (lpfreq > 20000.0f) lpfreq = 20000.0f;
    if (mix < 0.0f) mix = 0.0f;
    if (mix > 1.0f) mix = 1.0f;
    g_rev.feedback = feedback;
    g_rev.lpfreq = lpfreq;
    g_rev_mix = mix;
}

void gs_sp_set_delay(float time_s, float feedback, float mix)
{
    if (!g_ready) return;
    if (time_s < 0.001f) time_s = 0.001f;
    if (time_s > GS_SP_MAX_DELAY) time_s = GS_SP_MAX_DELAY;
    if (feedback < 0.0f) feedback = 0.0f;
    if (feedback > 0.95f) feedback = 0.95f;
    if (mix < 0.0f) mix = 0.0f;
    if (mix > 1.0f) mix = 1.0f;

    g_dly_target = time_s * (float)g_sp.sr;
    if (g_dly_target > (float)(g_dly_size - 2)) g_dly_target = (float)(g_dly_size - 2);
    g_dly_fb = feedback;
    g_dly_mix = mix;
}

static inline float gs_sp_read(const SPFLOAT *buf, float delay_samples)
{
    float read = (float)g_dly_write - delay_samples;
    while (read < 0.0f) read += (float)g_dly_size;
    uint32_t i0 = (uint32_t)read;
    if (i0 >= g_dly_size) i0 %= g_dly_size;
    uint32_t i1 = (i0 + 1u) % g_dly_size;
    float frac = read - (float)i0;
    return buf[i0] * (1.0f - frac) + buf[i1] * frac;
}

void gs_sp_process_block(const float *in_l,
                         const float *in_r,
                         float *out_l,
                         float *out_r,
                         uint32_t frames)
{
    if (!g_ready) {
        for (uint32_t i = 0; i < frames; ++i) {
            out_l[i] = in_l[i];
            out_r[i] = in_r[i];
        }
        return;
    }

    SPFLOAT *bl = (SPFLOAT *)g_dly_buf[0].ptr;
    SPFLOAT *br = (SPFLOAT *)g_dly_buf[1].ptr;
    const float rev_mix = g_rev_mix;
    const float dly_mix = g_dly_mix;
    const float fb = g_dly_fb;

    for (uint32_t i = 0; i < frames; ++i) {
        float l = in_l[i];
        float r = in_r[i];
        float rvl = 0.0f, rvr = 0.0f;

        sp_revsc_compute(&g_sp, &g_rev, &l, &r, &rvl, &rvr);

        float dl = gs_sp_read(bl, g_dly_samples);
        float dr = gs_sp_read(br, g_dly_samples);
        bl[g_dly_write] = l + dl * fb;
        br[g_dly_write] = r + dr * fb;

        out_l[i] = l + rvl * rev_mix + dl * dly_mix;
        out_r[i] = r + rvr * rev_mix + dr * dly_mix;

        g_dly_write = (g_dly_write + 1u) % g_dly_size;
        g_dly_samples += (g_dly_target - g_dly_samples) * GS_SP_TIME_SLEW;
    }
}

float gs_sp_max_delay(void) { return GS_SP_MAX_DELAY; }

uint32_t gs_sp_alloc_events(void) { return g_alloc_events; }
