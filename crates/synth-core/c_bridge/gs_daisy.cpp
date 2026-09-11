/*
 * gs_daisy.cpp — C ABI wrappers around the vendored DaisySP modules.
 *
 * Vendored sources (MIT):
 *   vendor/daisysp/Source/Synthesis/oscillator.{h,cpp}
 *   vendor/daisysp/Source/Filters/ladder.{h,cpp}
 *   vendor/daisysp/Source/Filters/svf.{h,cpp}
 *   vendor/daisysp/Source/Utility/dcblock.{h,cpp}
 *   vendor/daisysp/Source/Utility/dsp.h
 */
#include "gs_daisy.h"

#include "Synthesis/oscillator.h"
#include "Filters/ladder.h"
#include "Filters/svf.h"
#include "Utility/dcblock.h"
#include "Effects/chorus.h"
#include "Effects/flanger.h"
#include "Effects/phaser.h"
#include "Effects/overdrive.h"

namespace {

struct VoiceDsp {
    /// [sub-voice][oscillator]; unison stacks up to GS_MAX_UNISON copies.
    daisysp::Oscillator osc[GS_MAX_UNISON][2];
    /// One filter chain per oscillator (side 0 = OSC 1, side 1 = OSC 2) so a
    /// patch that pans its oscillators apart is filtered independently per
    /// oscillator instead of sharing one mono filter.
    daisysp::LadderFilter ladder[2];
    daisysp::Svf svf[2];
    /// Three band-passes per side for the vowel formant filter.
    daisysp::Svf formant[2][3];
    float formant_gain[2][3];
    daisysp::DcBlock dc[2];
};

VoiceDsp g_voice[GS_MAX_VOICES];
float g_sample_rate = 48000.0f;

// One instance per channel so the stereo image survives the effect chain.
// One instance per effect *node*, not one per effect: the routing graph can put
// the same effect in two places (two choruses in parallel, for instance), and
// sharing one state would make them cross-talk. `GS_FX_SLOTS` matches the
// engine's `FX_SLOTS` (a Rust test asserts it).
daisysp::Chorus g_chorus[GS_FX_SLOTS][2];
daisysp::Flanger g_flanger[GS_FX_SLOTS][2];
daisysp::Phaser g_phaser[GS_FX_SLOTS][2];
daisysp::Overdrive g_overdrive[GS_FX_SLOTS][2];
unsigned g_init_calls = 0;
unsigned g_slot_init_calls = 0;

inline VoiceDsp &voice(int v) {
    if (v < 0) v = 0;
    if (v >= GS_MAX_VOICES) v = GS_MAX_VOICES - 1;
    return g_voice[v];
}

inline int clamp_type(int type) {
    if (type < GS_FILTER_LP || type > GS_FILTER_NOTCH) return GS_FILTER_LP;
    return type;
}

void init_slot(int i, float sample_rate) {
    g_slot_init_calls++;
    VoiceDsp &d = g_voice[i];
    for (int s = 0; s < GS_MAX_UNISON; ++s) {
        d.osc[s][0].Init(sample_rate);
        d.osc[s][1].Init(sample_rate);
    }
    for (int side = 0; side < 2; ++side) {
        d.ladder[side].Init(sample_rate);
        d.svf[side].Init(sample_rate);
        d.dc[side].Init(sample_rate);
        for (int band = 0; band < 3; ++band) {
            d.formant[side][band].Init(sample_rate);
            d.formant_gain[side][band] = 0.0f;
        }
    }
}

} // namespace

extern "C" {



void gs_daisy_init(float sample_rate) {
    g_init_calls++;
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;
    g_sample_rate = sample_rate;
    for (int i = 0; i < GS_MAX_VOICES; ++i) init_slot(i, sample_rate);
}

void gs_voice_reset(int v) {
    VoiceDsp &d = voice(v);
    for (int s = 0; s < GS_MAX_UNISON; ++s) {
        d.osc[s][0].Init(g_sample_rate);
        d.osc[s][1].Init(g_sample_rate);
    }
    for (int side = 0; side < 2; ++side) {
        d.ladder[side].Init(g_sample_rate);
        d.svf[side].Init(g_sample_rate);
        d.dc[side].Init(g_sample_rate);
        for (int band = 0; band < 3; ++band) {
            d.formant[side][band].Init(g_sample_rate);
            d.formant_gain[side][band] = 0.0f;
        }
    }
}

void gs_voice_phase(int v, float p0, float p1) {
    VoiceDsp &d = voice(v);
    // Sub-voice 0 gets the caller's phases; the rest are spread by the golden
    // ratio so a unison stack never starts in phase.
    for (int s = 0; s < GS_MAX_UNISON; ++s) {
        float spread = static_cast<float>(s) * 0.618034f;
        d.osc[s][0].Reset(fmodf(p0 + spread, 1.0f));
        d.osc[s][1].Reset(fmodf(p1 + spread, 1.0f));
    }
}

void gs_voice_osc_set(int v, int which, int sub, uint32_t wave, float freq, float amp, float pw) {
    VoiceDsp &d = voice(v);
    if (sub < 0 || sub >= GS_MAX_UNISON) return;
    daisysp::Oscillator &o = d.osc[sub][which ? 1 : 0];
    o.SetWaveform(static_cast<uint8_t>(wave));
    o.SetFreq(freq);
    o.SetAmp(amp);
    o.SetPw(pw);
}

void gs_voice_osc_reset(int v, int which, float phase) {
    voice(v).osc[0][which ? 1 : 0].Reset(phase);
}

void gs_voice_osc_block(int v, int which, int sub, float *out, uint32_t frames) {
    if (sub < 0 || sub >= GS_MAX_UNISON) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = 0.0f;
        return;
    }
    daisysp::Oscillator &o = voice(v).osc[sub][which ? 1 : 0];
    for (uint32_t i = 0; i < frames; ++i) out[i] = o.Process();
}

void gs_voice_filter_set(int v, int side, int type, float freq, float res, float drive) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    type = clamp_type(type);
    if (type == GS_FILTER_LP) {
        d.ladder[s].SetFilterMode(daisysp::LadderFilter::FilterMode::LP24);
        d.ladder[s].SetFreq(freq);
        d.ladder[s].SetRes(res * 1.7f);
        // DaisySP scales the input by the drive value, so 0 would be silence.
        // UI drive 0..1 maps to unity..2.5x into the tanh stage.
        d.ladder[s].SetInputDrive(1.0f + drive * 1.5f);
        d.ladder[s].SetPassbandGain(0.5f);
    } else {
        d.svf[s].SetFreq(freq);
        d.svf[s].SetRes(res * 0.97f);
        d.svf[s].SetDrive(drive);
    }
}

void gs_voice_filter_block(int v, int side, int type, const float *in, float *out, uint32_t frames) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    type = clamp_type(type);
    if (type == GS_FILTER_LP) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = d.ladder[s].Process(in[i]);
        return;
    }
    for (uint32_t i = 0; i < frames; ++i) {
        d.svf[s].Process(in[i]);
        switch (type) {
            case GS_FILTER_HP:    out[i] = d.svf[s].High();  break;
            case GS_FILTER_BP:    out[i] = d.svf[s].Band();  break;
            case GS_FILTER_NOTCH: out[i] = d.svf[s].Notch(); break;
            default:              out[i] = d.svf[s].Low();   break;
        }
    }
}

void gs_voice_dc_block(int v, int side, const float *in, float *out, uint32_t frames) {
    daisysp::DcBlock &dc = voice(v).dc[side ? 1 : 0];
    for (uint32_t i = 0; i < frames; ++i) out[i] = dc.Process(in[i]);
}

namespace {
/// Vowel formants: F1/F2/F3 in Hz with their relative levels (A E I O U).
const float kVowel[5][3] = {
    {800.0f, 1150.0f, 2900.0f},
    {400.0f, 1600.0f, 2700.0f},
    {350.0f, 1700.0f, 2700.0f},
    {450.0f, 800.0f, 2830.0f},
    {325.0f, 700.0f, 2530.0f},
};
const float kVowelGain[5][3] = {
    {1.0f, 0.63f, 0.10f},
    {1.0f, 0.40f, 0.15f},
    {1.0f, 0.35f, 0.20f},
    {1.0f, 0.50f, 0.10f},
    {1.0f, 0.35f, 0.08f},
};
} // namespace

void gs_voice_formant_set(int v, int side, float vowel, float res) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    const float t = (vowel < 0.0f ? 0.0f : (vowel > 1.0f ? 1.0f : vowel)) * 4.0f;
    const int i0 = static_cast<int>(t);
    const int i1 = i0 >= 4 ? 4 : i0 + 1;
    const float f = t - static_cast<float>(i0);
    // A little Q goes a long way: the bands must stay narrow enough to read as
    // vowels, and wide enough not to whistle.
    const float q = 0.72f - (res < 0.0f ? 0.0f : (res > 1.0f ? 1.0f : res)) * 0.32f;
    for (int band = 0; band < 3; ++band) {
        const float freq = kVowel[i0][band] + (kVowel[i1][band] - kVowel[i0][band]) * f;
        const float gain = kVowelGain[i0][band] + (kVowelGain[i1][band] - kVowelGain[i0][band]) * f;
        d.formant[s][band].SetFreq(freq);
        d.formant[s][band].SetRes(q);
        d.formant[s][band].SetDrive(0.0f);
        d.formant_gain[s][band] = gain;
    }
}

void gs_voice_formant_block(int v, int side, const float *in, float *out, uint32_t frames) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    for (uint32_t i = 0; i < frames; ++i) {
        float sum = 0.0f;
        for (int band = 0; band < 3; ++band) {
            d.formant[s][band].Process(in[i]);
            sum += d.formant[s][band].Band() * d.formant_gain[s][band];
        }
        out[i] = sum;
    }
}

int gs_daisy_voice_slots(void) { return GS_MAX_VOICES; }

// --- global modulation effects ---------------------------------------------

int gs_fx_slots(void) { return GS_FX_SLOTS; }

void gs_fx_init(float sample_rate) {
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;
    for (int slot = 0; slot < GS_FX_SLOTS; ++slot) {
        for (int ch = 0; ch < 2; ++ch) {
            g_chorus[slot][ch].Init(sample_rate);
            g_flanger[slot][ch].Init(sample_rate);
            g_phaser[slot][ch].Init(sample_rate);
            g_overdrive[slot][ch].Init();
        }
    }
}

/** A slot outside the array reads as slot 0, which keeps a bad index from
 *  reaching out of bounds while still making the mistake visible in tests. */
static int slot_of(int slot) {
    return (slot >= 0 && slot < GS_FX_SLOTS) ? slot : 0;
}

void gs_fx_chorus_set(int slot, float depth, float freq, float delay_ms, float feedback) {
    const int s = slot_of(slot);
    for (int ch = 0; ch < 2; ++ch) {
        g_chorus[s][ch].SetLfoDepth(depth);
        g_chorus[s][ch].SetLfoFreq(freq);
        g_chorus[s][ch].SetDelayMs(delay_ms);
        g_chorus[s][ch].SetFeedback(feedback);
    }
}

void gs_fx_chorus_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    const int s = slot_of(slot);
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_chorus[s][0].Process(in_l[i]);
        out_r[i] = g_chorus[s][1].Process(in_r[i]);
    }
}

void gs_fx_flanger_set(int slot, float depth, float freq, float delay_ms, float feedback) {
    const int s = slot_of(slot);
    for (int ch = 0; ch < 2; ++ch) {
        g_flanger[s][ch].SetLfoDepth(depth);
        g_flanger[s][ch].SetLfoFreq(freq);
        g_flanger[s][ch].SetDelayMs(delay_ms);
        g_flanger[s][ch].SetFeedback(feedback);
    }
}

void gs_fx_flanger_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    const int s = slot_of(slot);
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_flanger[s][0].Process(in_l[i]);
        out_r[i] = g_flanger[s][1].Process(in_r[i]);
    }
}

void gs_fx_phaser_set(int slot, float depth, float freq, float feedback, int poles) {
    const int s = slot_of(slot);
    for (int ch = 0; ch < 2; ++ch) {
        g_phaser[s][ch].SetLfoDepth(depth);
        g_phaser[s][ch].SetLfoFreq(freq);
        g_phaser[s][ch].SetFeedback(feedback);
        g_phaser[s][ch].SetPoles(poles);
    }
}

void gs_fx_phaser_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    const int s = slot_of(slot);
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_phaser[s][0].Process(in_l[i]);
        out_r[i] = g_phaser[s][1].Process(in_r[i]);
    }
}

void gs_fx_overdrive_set(int slot, float drive) {
    const int s = slot_of(slot);
    for (int ch = 0; ch < 2; ++ch) g_overdrive[s][ch].SetDrive(drive);
}

void gs_fx_overdrive_block(int slot, const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    const int s = slot_of(slot);
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_overdrive[s][0].Process(in_l[i]);
        out_r[i] = g_overdrive[s][1].Process(in_r[i]);
    }
}

} // extern "C"
