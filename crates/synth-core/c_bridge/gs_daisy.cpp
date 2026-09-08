/*
 * gs_daisy.cpp — C ABI wrappers around the vendored DaisySP modules.
 *
 * Vendored sources (MIT):
 *   vendor/daisysp/Source/Synthesis/oscillator.{h,cpp}
 *   vendor/daisysp/Source/Filters/ladder.{h,cpp}
 *   vendor/daisysp/Source/Filters/svf.{h,cpp}
 *   vendor/daisysp/Source/Control/adsr.{h,cpp}
 *   vendor/daisysp/Source/Utility/dcblock.{h,cpp}
 *   vendor/daisysp/Source/Utility/dsp.h
 */
#include "gs_daisy.h"

#include "Synthesis/oscillator.h"
#include "Filters/ladder.h"
#include "Filters/svf.h"
#include "Control/adsr.h"
#include "Utility/dcblock.h"

namespace {

struct VoiceDsp {
    daisysp::Oscillator osc[2];
    daisysp::LadderFilter ladder;
    daisysp::Svf svf;
    daisysp::Adsr env;
    daisysp::DcBlock dc;
};

VoiceDsp g_voice[GS_MAX_VOICES];
float g_sample_rate = 48000.0f;

inline VoiceDsp &voice(int v) {
    if (v < 0) v = 0;
    if (v >= GS_MAX_VOICES) v = GS_MAX_VOICES - 1;
    return g_voice[v];
}

inline int clamp_type(int type) {
    if (type < GS_LADDER_LP24 || type > GS_LADDER_HP12) return GS_LADDER_LP24;
    return type;
}

} // namespace

extern "C" {

void gs_daisy_init(float sample_rate) {
    if (sample_rate < 1000.0f) sample_rate = 48000.0f;
    g_sample_rate = sample_rate;
    for (int i = 0; i < GS_MAX_VOICES; ++i) {
        VoiceDsp &d = g_voice[i];
        d.osc[0].Init(sample_rate);
        d.osc[1].Init(sample_rate);
        d.ladder.Init(sample_rate);
        d.svf.Init(sample_rate);
        d.env.Init(sample_rate);
        d.dc.Init(sample_rate);
    }
}

void gs_voice_osc_set(int v, int which, uint32_t wave, float freq, float amp, float pw) {
    VoiceDsp &d = voice(v);
    daisysp::Oscillator &o = d.osc[which ? 1 : 0];
    o.SetWaveform(static_cast<uint8_t>(wave));
    o.SetFreq(freq);
    o.SetAmp(amp);
    o.SetPw(pw);
}

void gs_voice_osc_reset(int v, int which, float phase) {
    voice(v).osc[which ? 1 : 0].Reset(phase);
}

void gs_voice_osc_block(int v, int which, float *out, uint32_t frames) {
    daisysp::Oscillator &o = voice(v).osc[which ? 1 : 0];
    for (uint32_t i = 0; i < frames; ++i) out[i] = o.Process();
}

void gs_voice_env_set(int v, float attack_s, float decay_s, float sustain, float release_s) {
    daisysp::Adsr &e = voice(v).env;
    e.SetAttackTime(attack_s);
    e.SetDecayTime(decay_s);
    e.SetSustainLevel(sustain);
    e.SetReleaseTime(release_s);
}

void gs_voice_env_retrigger(int v, int hard) {
    voice(v).env.Retrigger(hard != 0);
}

void gs_voice_env_block(int v, int gate, float *out, uint32_t frames) {
    daisysp::Adsr &e = voice(v).env;
    const bool g = gate != 0;
    for (uint32_t i = 0; i < frames; ++i) out[i] = e.Process(g);
}

int gs_voice_env_segment(int v) {
    return static_cast<int>(voice(v).env.GetCurrentSegment());
}

int gs_voice_env_running(int v) {
    return voice(v).env.IsRunning() ? 1 : 0;
}

void gs_voice_filter_set(int v, int type, float freq, float res, float drive) {
    VoiceDsp &d = voice(v);
    type = clamp_type(type);
    if (type == GS_LADDER_LP24) {
        d.ladder.SetFilterMode(daisysp::LadderFilter::FilterMode::LP24);
        d.ladder.SetFreq(freq);
        d.ladder.SetRes(res);
        d.ladder.SetInputDrive(drive);
        d.ladder.SetPassbandGain(0.5f);
    } else if (type == GS_LADDER_LP12) {
        d.ladder.SetFilterMode(daisysp::LadderFilter::FilterMode::LP12);
        d.ladder.SetFreq(freq);
        d.ladder.SetRes(res);
        d.ladder.SetInputDrive(drive);
        d.ladder.SetPassbandGain(0.5f);
    } else {
        d.svf.SetFreq(freq);
        d.svf.SetRes(res);
        d.svf.SetDrive(drive);
    }
}

void gs_voice_filter_block(int v, int type, const float *in, float *out, uint32_t frames) {
    VoiceDsp &d = voice(v);
    type = clamp_type(type);
    if (type == GS_LADDER_LP24 || type == GS_LADDER_LP12) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = d.ladder.Process(in[i]);
        return;
    }
    for (uint32_t i = 0; i < frames; ++i) {
        d.svf.Process(in[i]);
        switch (type) {
            case GS_SVF_HIGH:  out[i] = d.svf.High();  break;
            case GS_SVF_BAND:  out[i] = d.svf.Band();  break;
            case GS_SVF_NOTCH: out[i] = d.svf.Notch(); break;
            case GS_SVF_PEAK:  out[i] = d.svf.Peak();  break;
            default:           out[i] = d.svf.Low();   break;
        }
    }
}

void gs_voice_dc_block(int v, const float *in, float *out, uint32_t frames) {
    daisysp::DcBlock &dc = voice(v).dc;
    for (uint32_t i = 0; i < frames; ++i) out[i] = dc.Process(in[i]);
}

int gs_daisy_voice_slots(void) { return GS_MAX_VOICES; }

} // extern "C"
