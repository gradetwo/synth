/*
 * gs_soundpipe.c — C ABI wrappers around the vendored Soundpipe modules.
 *
 * Vendored sources (MIT):
 *   vendor/soundpipe/h/{base,delay,allpass,comb,revsc}.h
 *   vendor/soundpipe/modules/{base,delay,allpass,comb,revsc}.c
 *
 * `soundpipe.h` is generated at build time by build.rs (upstream's Makefile does
 * the same concatenation), so the vendored headers stay byte-identical.
 */
#include "gs_soundpipe.h"

#include "soundpipe.h"

#define GS_SP_MAX_DELAY 2.0f

static sp_data g_sp;
static sp_revsc g_rev;
static sp_delay g_dly[2];

static int g_rev_ready = 0;
static int g_dly_ready = 0;
static float g_dly_time = -1.0f;
static float g_rev_mix = 0.0f;
static float g_dly_mix = 0.0f;

static void gs_sp_reinit_data(float sample_rate)
{
    g_sp.out = 0;
    g_sp.sr = (int)(sample_rate + 0.5f);
    g_sp.nchan = 2;
    g_sp.len = 0;
    g_sp.pos = 0;
    g_sp.rand = 1u;
    g_sp.filename[0] = 0;
}

void gs_sp_init(float sample_rate)
{
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;
    gs_sp_reinit_data(sample_rate);

    sp_revsc_init(&g_sp, &g_rev);
    g_rev.feedback = 0.90f;
    g_rev.lpfreq = 9000.0f;
    g_rev_ready = 1;

    for (int ch = 0; ch < 2; ++ch) {
        sp_delay_init(&g_sp, &g_dly[ch], GS_SP_MAX_DELAY);
        g_dly[ch].feedback = 0.0f;
    }
    g_dly_time = GS_SP_MAX_DELAY;
    g_dly_ready = 1;
    g_rev_mix = 0.0f;
    g_dly_mix = 0.0f;
}

void gs_sp_set_reverb(float feedback, float lpfreq, float mix)
{
    if (!g_rev_ready) return;
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
    if (!g_dly_ready) return;
    if (time_s < 0.001f) time_s = 0.001f;
    if (time_s > GS_SP_MAX_DELAY) time_s = GS_SP_MAX_DELAY;
    if (feedback < 0.0f) feedback = 0.0f;
    if (feedback > 0.95f) feedback = 0.95f;
    if (mix < 0.0f) mix = 0.0f;
    if (mix > 1.0f) mix = 1.0f;

    if (time_s > g_dly_time + 0.0005f || time_s < g_dly_time - 0.0005f) {
        for (int ch = 0; ch < 2; ++ch) {
            uint32_t pos = g_dly[ch].bufpos;
            float fb = g_dly[ch].feedback;
            sp_auxdata_free(&g_dly[ch].buf);
            sp_delay_init(&g_sp, &g_dly[ch], time_s);
            g_dly[ch].bufpos = pos % (g_dly[ch].bufsize ? g_dly[ch].bufsize : 1);
            g_dly[ch].feedback = fb;
        }
        g_dly_time = time_s;
    }

    for (int ch = 0; ch < 2; ++ch) g_dly[ch].feedback = feedback;
    g_dly_mix = mix;
}

void gs_sp_process_block(const float *in_l,
                         const float *in_r,
                         float *out_l,
                         float *out_r,
                         uint32_t frames)
{
    if (!g_rev_ready || !g_dly_ready) {
        for (uint32_t i = 0; i < frames; ++i) {
            out_l[i] = in_l[i];
            out_r[i] = in_r[i];
        }
        return;
    }

    const float rev_mix = g_rev_mix;
    const float dly_mix = g_dly_mix;

    for (uint32_t i = 0; i < frames; ++i) {
        float l = in_l[i];
        float r = in_r[i];
        float rvl = 0.0f, rvr = 0.0f;
        float dl = 0.0f, dr = 0.0f;

        sp_revsc_compute(&g_sp, &g_rev, &l, &r, &rvl, &rvr);
        sp_delay_compute(&g_sp, &g_dly[0], &l, &dl);
        sp_delay_compute(&g_sp, &g_dly[1], &r, &dr);

        out_l[i] = l + rvl * rev_mix + dl * dly_mix;
        out_r[i] = r + rvr * rev_mix + dr * dly_mix;
    }
}

float gs_sp_max_delay(void) { return GS_SP_MAX_DELAY; }
