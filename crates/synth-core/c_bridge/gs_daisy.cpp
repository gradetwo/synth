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
    daisysp::LadderFilter ladder;
    daisysp::Svf svf;
    daisysp::DcBlock dc;
};

VoiceDsp g_voice[GS_MAX_VOICES];
float g_sample_rate = 48000.0f;

// One instance per channel so the stereo image survives the effect chain.
daisysp::Chorus g_chorus[2];
daisysp::Flanger g_flanger[2];
daisysp::Phaser g_phaser[2];
daisysp::Overdrive g_overdrive[2];
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
    d.ladder.Init(sample_rate);
    d.svf.Init(sample_rate);
    d.dc.Init(sample_rate);
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
    d.ladder.Init(g_sample_rate);
    d.svf.Init(g_sample_rate);
    d.dc.Init(g_sample_rate);
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

void gs_voice_filter_set(int v, int type, float freq, float res, float drive) {
    VoiceDsp &d = voice(v);
    type = clamp_type(type);
    if (type == GS_FILTER_LP) {
        d.ladder.SetFilterMode(daisysp::LadderFilter::FilterMode::LP24);
        d.ladder.SetFreq(freq);
        d.ladder.SetRes(res * 1.7f);
        // DaisySP scales the input by the drive value, so 0 would be silence.
        // UI drive 0..1 maps to unity..2.5x into the tanh stage.
        d.ladder.SetInputDrive(1.0f + drive * 1.5f);
        d.ladder.SetPassbandGain(0.5f);
    } else {
        d.svf.SetFreq(freq);
        d.svf.SetRes(res * 0.97f);
        d.svf.SetDrive(drive);
    }
}

void gs_voice_filter_block(int v, int type, const float *in, float *out, uint32_t frames) {
    VoiceDsp &d = voice(v);
    type = clamp_type(type);
    if (type == GS_FILTER_LP) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = d.ladder.Process(in[i]);
        return;
    }
    for (uint32_t i = 0; i < frames; ++i) {
        d.svf.Process(in[i]);
        switch (type) {
            case GS_FILTER_HP:    out[i] = d.svf.High();  break;
            case GS_FILTER_BP:    out[i] = d.svf.Band();  break;
            case GS_FILTER_NOTCH: out[i] = d.svf.Notch(); break;
            default:              out[i] = d.svf.Low();   break;
        }
    }
}

void gs_voice_dc_block(int v, const float *in, float *out, uint32_t frames) {
    daisysp::DcBlock &dc = voice(v).dc;
    for (uint32_t i = 0; i < frames; ++i) out[i] = dc.Process(in[i]);
}

int gs_daisy_voice_slots(void) { return GS_MAX_VOICES; }

// --- global modulation effects ---------------------------------------------

void gs_fx_init(float sample_rate) {
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;
    for (int ch = 0; ch < 2; ++ch) {
        g_chorus[ch].Init(sample_rate);
        g_flanger[ch].Init(sample_rate);
        g_phaser[ch].Init(sample_rate);
        g_overdrive[ch].Init();
    }
}

void gs_fx_chorus_set(float depth, float freq, float delay_ms, float feedback) {
    for (int ch = 0; ch < 2; ++ch) {
        g_chorus[ch].SetLfoDepth(depth);
        g_chorus[ch].SetLfoFreq(freq);
        g_chorus[ch].SetDelayMs(delay_ms);
        g_chorus[ch].SetFeedback(feedback);
    }
}

void gs_fx_chorus_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_chorus[0].Process(in_l[i]);
        out_r[i] = g_chorus[1].Process(in_r[i]);
    }
}

void gs_fx_flanger_set(float depth, float freq, float delay_ms, float feedback) {
    for (int ch = 0; ch < 2; ++ch) {
        g_flanger[ch].SetLfoDepth(depth);
        g_flanger[ch].SetLfoFreq(freq);
        g_flanger[ch].SetDelayMs(delay_ms);
        g_flanger[ch].SetFeedback(feedback);
    }
}

void gs_fx_flanger_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_flanger[0].Process(in_l[i]);
        out_r[i] = g_flanger[1].Process(in_r[i]);
    }
}

void gs_fx_phaser_set(float depth, float freq, float feedback, int poles) {
    for (int ch = 0; ch < 2; ++ch) {
        g_phaser[ch].SetLfoDepth(depth);
        g_phaser[ch].SetLfoFreq(freq);
        g_phaser[ch].SetFeedback(feedback);
        g_phaser[ch].SetPoles(poles);
    }
}

void gs_fx_phaser_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_phaser[0].Process(in_l[i]);
        out_r[i] = g_phaser[1].Process(in_r[i]);
    }
}

void gs_fx_overdrive_set(float drive) {
    for (int ch = 0; ch < 2; ++ch) g_overdrive[ch].SetDrive(drive);
}

void gs_fx_overdrive_block(const float *in_l, const float *in_r, float *out_l, float *out_r, uint32_t frames) {
    for (uint32_t i = 0; i < frames; ++i) {
        out_l[i] = g_overdrive[0].Process(in_l[i]);
        out_r[i] = g_overdrive[1].Process(in_r[i]);
    }
}

} // extern "C"
