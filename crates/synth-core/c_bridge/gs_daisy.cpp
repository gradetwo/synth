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


// A 95-tap Kaiser-windowed low-pass (beta 6, cutoff 0.229 of the oversampled
// rate), used to decimate the oversampled hard-sync pair. The passband is flat
// to 19.2 kHz and the stopband is below -72 dB from 24 kHz, which is what a
// sync reset needs: it is a discontinuity, and everything it throws above the
// base Nyquist has to be gone before the pair is decimated, or it folds back
// into the audible band as broadband hash.
//
// A half-band filter was the first attempt and is not enough: it has no guard
// band, so the octave just below Nyquist folds onto itself with barely any
// attenuation. This one costs 47 multiply-adds per output sample (the
// coefficients are symmetric) and is the price of shipping sync at all.
#define GS_SYNC_OS 2
#define GS_SYNC_TAPS 95
static const float GS_SYNC_H[GS_SYNC_TAPS] = {
    -0.000099741f, -0.000039086f, 0.000184196f, 0.000134602f, -0.000268980f,
    -0.000307211f, 0.000321500f, 0.000568299f, -0.000295986f, -0.000913282f,
    0.000137354f, 0.001314628f, 0.000211489f, -0.001716680f, -0.000799195f,
    0.002033740f, 0.001653315f, -0.002152588f, -0.002766906f, 0.001940100f,
    0.004086262f, -0.001255865f, -0.005501646f, -0.000031137f, 0.006842571f,
    0.002023576f, -0.007878331f, -0.004776923f, 0.008323109f, 0.008283465f,
    -0.007842903f, -0.012461851f, 0.006058127f, 0.017154332f, -0.002529277f,
    -0.022132978f, -0.003302059f, 0.027114975f, 0.012288422f, -0.031785825f,
    -0.026095010f, 0.035828112f, 0.049004750f, -0.038952515f, -0.096970518f,
    0.040927346f, 0.315226368f, 0.458431718f, 0.315226368f, 0.040927346f,
    -0.096970518f, -0.038952515f, 0.049004750f, 0.035828112f, -0.026095010f,
    -0.031785825f, 0.012288422f, 0.027114975f, -0.003302059f, -0.022132978f,
    -0.002529277f, 0.017154332f, 0.006058127f, -0.012461851f, -0.007842903f,
    0.008283465f, 0.008323109f, -0.004776923f, -0.007878331f, 0.002023576f,
    0.006842571f, -0.000031137f, -0.005501646f, -0.001255865f, 0.004086262f,
    0.001940100f, -0.002766906f, -0.002152588f, 0.001653315f, 0.002033740f,
    -0.000799195f, -0.001716680f, 0.000211489f, 0.001314628f, 0.000137354f,
    -0.000913282f, -0.000295986f, 0.000568299f, 0.000321500f, -0.000307211f,
    -0.000268980f, 0.000134602f, 0.000184196f, -0.000039086f, -0.000099741f,
};

/// Push `count` oversampled samples and read one decimated sample.
///
/// The history is a plain shifted buffer: at two samples per output sample the
/// moves are cheaper than the modulo arithmetic a ring buffer would need, and
/// the symmetric coefficients halve the multiply-adds.
static inline float sync_decimate(float *history, const float *input, int count) {
    for (int i = GS_SYNC_TAPS - 1; i >= count; --i) history[i] = history[i - count];
    for (int k = 0; k < count; ++k) history[k] = input[k];
    const int centre = GS_SYNC_TAPS / 2;
    float out = GS_SYNC_H[centre] * history[centre];
    for (int i = 0; i < centre; ++i) {
        out += GS_SYNC_H[i] * (history[i] + history[GS_SYNC_TAPS - 1 - i]);
    }
    return out;
}

struct VoiceDsp {
    /// [sub-voice][oscillator]; unison stacks up to GS_MAX_UNISON copies.
    daisysp::Oscillator osc[GS_MAX_UNISON][2];
    /// Phase-modulation state: the carrier's own free-running phase, kept here
    /// because a modulated oscillator cannot read it back from DaisySP (the
    /// offset would be inside it). `pm_ready` re-syncs after a voice reset.
    float pm_phase[GS_MAX_UNISON][2];
    bool pm_ready[GS_MAX_UNISON][2];
    /// Hard-sync state: the slave's free-running phase and one decimation
    /// history per oscillator (see `gs_voice_osc_sync_block`).
    float sync_base[GS_MAX_UNISON];
    bool sync_ready[GS_MAX_UNISON];
    float sync_hist_m[GS_MAX_UNISON][GS_SYNC_TAPS];
    float sync_hist_s[GS_MAX_UNISON][GS_SYNC_TAPS];
    /// One filter chain per oscillator (side 0 = OSC 1, side 1 = OSC 2) so a
    /// patch that pans its oscillators apart is filtered independently per
    /// oscillator instead of sharing one mono filter.
    daisysp::LadderFilter ladder[2];
    daisysp::Svf svf[2];
    /// The second, optional filter stage (P6.3b): one state-variable filter per
    /// side. It is always 12 dB/oct, deliberately — stage 1's `lp` is our own
    /// 24 dB/oct ladder, and a second ladder per side would double the filter's
    /// memory and its cost for a shape the 12 dB SVF already reaches when two
    /// stages are chained (12 + 12 = the 24 dB/oct the ladder gives on its own).
    daisysp::Svf svf2[2];
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
    if (type < GS_FILTER_LP || type > GS_FILTER_SEM) return GS_FILTER_LP;
    return type;
}

/// Blend the three SVF outputs for the SEM-style continuous multimode filter.
///
/// Four canonical responses, in the order the knob travels — low (L), band (B),
/// notch (N = L + H), high (H) — joined by straight weight lines. The notch is
/// what makes four points necessary: it is `L + H`, so the two are *not*
/// independent, and a two-line L→B→H mix can only reach it where wL + wH is not
/// forced to zero (`wL = 1 - 2m`, `wH = 2m - 1` cancel everywhere).
///
///   p ∈ [0, 1/3]    t = 3p          out = (1-t)L       + t B
///   p ∈ [1/3, 2/3]  t = 3p - 1      out = (1-t)B       + t (L + H)
///   p ∈ [2/3, 1]    t = 3p - 2      out = (1-t)(L + H) + t H
///
/// Every segment is a straight line in the weights, the seams agree on both
/// sides (p = 1/3 is B, p = 2/3 is L + H), and no segment normalises: the three
/// taps are one filter's outputs, so their mix is continuous by construction.
/// The endpoints are exact single taps, which is what lets `sem` reproduce the
/// discrete BP/HP responses bit for bit there.
///
/// Note that the p = 0 end is the 12 dB/oct *SVF* low-pass, not the discrete
/// `lp` type (a 24 dB/oct Moog ladder) — different filter, deliberately.
inline float sem_mix(float low, float band, float high, float morph) {
    if (!(morph > 0.0f)) return low;   // also catches NaN
    if (morph >= 1.0f) return high;
    if (morph <= 1.0f / 3.0f) {
        const float t = 3.0f * morph;
        return (1.0f - t) * low + t * band;
    }
    if (morph <= 2.0f / 3.0f) {
        const float t = 3.0f * morph - 1.0f;
        return (1.0f - t) * band + t * (low + high);
    }
    const float t = 3.0f * morph - 2.0f;
    return (1.0f - t) * (low + high) + t * high;
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
        d.svf2[side].Init(sample_rate);
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
        d.pm_phase[s][0] = 0.0f;
        d.pm_phase[s][1] = 0.0f;
        d.pm_ready[s][0] = false;
        d.pm_ready[s][1] = false;
        d.sync_ready[s] = false;
        for (int t = 0; t < GS_SYNC_TAPS; ++t) {
            d.sync_hist_m[s][t] = 0.0f;
            d.sync_hist_s[s][t] = 0.0f;
        }
    }
    for (int side = 0; side < 2; ++side) {
        d.ladder[side].Init(g_sample_rate);
        d.svf[side].Init(g_sample_rate);
        d.svf2[side].Init(g_sample_rate);
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
        d.pm_ready[s][0] = false;
        d.pm_ready[s][1] = false;
        d.sync_ready[s] = false;
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

void gs_voice_osc_pm_block(int v, int which, int sub, const float *mod, float depth,
                           float *out, uint32_t frames) {
    if (sub < 0 || sub >= GS_MAX_UNISON) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = 0.0f;
        return;
    }
    VoiceDsp &d = voice(v);
    const int side = which ? 1 : 0;
    daisysp::Oscillator &o = d.osc[sub][side];
    // The carrier's own phase, advanced by its own increment: the modulation
    // is *added to the read phase* for one sample and then gone. Adding it to
    // the oscillator's phase instead would integrate the modulator, which is
    // frequency modulation by the integral of the signal — a different, much
    // brighter sound than the one the knob promises.
    float base = d.pm_phase[sub][side];
    if (!d.pm_ready[sub][side]) {
        base = o.Phase();
        d.pm_ready[sub][side] = true;
    }
    const float inc = o.PhaseInc();
    for (uint32_t i = 0; i < frames; ++i) {
        float phase = fmodf(base + mod[i] * depth, 1.0f);
        if (phase < 0.0f) phase += 1.0f;
        o.Reset(phase);
        out[i] = o.Process();
        base += inc;
        if (base >= 1.0f) base -= 1.0f;
    }
    d.pm_phase[sub][side] = base;
}

void gs_voice_osc_sync_block(int v, int sub, const float *mod, float depth, float *master_out,
                             float *slave_out, uint32_t frames) {
    if (sub < 0 || sub >= GS_MAX_UNISON) {
        for (uint32_t i = 0; i < frames; ++i) {
            master_out[i] = 0.0f;
            slave_out[i] = 0.0f;
        }
        return;
    }
    VoiceDsp &d = voice(v);
    daisysp::Oscillator &master = d.osc[sub][1];
    daisysp::Oscillator &slave = d.osc[sub][0];
    // The oscillators are already set to their real frequency divided by
    // GS_SYNC_OS, so calling Process() that many times per output sample *is*
    // the oversampling. The slave's phase is tracked here rather than read back,
    // because a reset would otherwise be inside it.
    float base = d.sync_ready[sub] ? d.sync_base[sub] : slave.Phase();
    d.sync_ready[sub] = true;
    const float inc = slave.PhaseInc();
    const float master_inc = master.PhaseInc();
    float hi_m[GS_SYNC_OS];
    float hi_s[GS_SYNC_OS];
    for (uint32_t i = 0; i < frames; ++i) {
        for (int k = 0; k < GS_SYNC_OS; ++k) {
            hi_m[k] = master.Process();
            // The master's own wrap *is* the sync point. It lands *between*
            // oversampled steps, and resetting to phase 0 at the step boundary
            // instead was the whole difference between a clean sync and a
            // broadband hash: the restart moved by up to half a step every
            // period, which is jitter, and jitter is exactly what shows up
            // between the harmonics. `Phase()` is how far past the wrap the
            // master already is, so the slave restarts that far into its own
            // step.
            if (master.IsEOC()) {
                base = inc * (master.Phase() / master_inc);
            }
            float phase = base + (mod != nullptr ? mod[i] * depth : 0.0f);
            phase = fmodf(phase, 1.0f);
            if (phase < 0.0f) phase += 1.0f;
            slave.Reset(phase);
            hi_s[k] = slave.Process();
            base += inc;
            if (base >= 1.0f) base -= 1.0f;
        }
        master_out[i] = sync_decimate(d.sync_hist_m[sub], hi_m, GS_SYNC_OS);
        slave_out[i] = sync_decimate(d.sync_hist_s[sub], hi_s, GS_SYNC_OS);
    }
    d.sync_base[sub] = base;
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

void gs_voice_filter_block(int v, int side, int type, float morph, const float *in, float *out,
                           uint32_t frames) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    type = clamp_type(type);
    if (type == GS_FILTER_LP) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = d.ladder[s].Process(in[i]);
        return;
    }
    if (type == GS_FILTER_SEM) {
        // One Process() per sample feeds all three taps, so the morph is a
        // weighted sum of one filter's outputs rather than three filters in
        // parallel: the poles (and therefore the resonance peak) stay put
        // while the zeros travel, which is what makes the sweep continuous.
        for (uint32_t i = 0; i < frames; ++i) {
            d.svf[s].Process(in[i]);
            out[i] = sem_mix(d.svf[s].Low(), d.svf[s].Band(), d.svf[s].High(), morph);
        }
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

namespace {
/// Stage 1's shape: the 24 dB/oct ladder for `lp`, the SVF taps for everything
/// else (morph included, for the continuous multimode type).
inline float stage1_shape(daisysp::LadderFilter &ladder, daisysp::Svf &svf, int type, float morph,
                          float x) {
    if (type == GS_FILTER_LP) return ladder.Process(x);
    svf.Process(x);
    switch (type) {
        case GS_FILTER_HP:    return svf.High();
        case GS_FILTER_BP:    return svf.Band();
        case GS_FILTER_NOTCH: return svf.Notch();
        case GS_FILTER_SEM:   return sem_mix(svf.Low(), svf.Band(), svf.High(), morph);
        default:              return svf.Low();
    }
}

/// Stage 2's shape: always the SVF, so it is 12 dB/oct even for `lp`. Stage 1's
/// `lp` is the 24 dB/oct ladder, and a second ladder per side would cost twice
/// the state for a shape two chained 12 dB stages already reach; `lp` therefore
/// falls through to the SVF low-pass here, as do the comb and formant, which
/// have no second instance to run at all.
inline float stage2_shape(daisysp::Svf &svf, int type, float morph, float x) {
    svf.Process(x);
    switch (type) {
        case GS_FILTER_HP:    return svf.High();
        case GS_FILTER_BP:    return svf.Band();
        case GS_FILTER_NOTCH: return svf.Notch();
        case GS_FILTER_SEM:   return sem_mix(svf.Low(), svf.Band(), svf.High(), morph);
        default:              return svf.Low();
    }
}
} // namespace

void gs_voice_filter2_set(int v, int side, int type, float freq, float res, float drive) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    (void)type; // every second-stage shape comes from the same SVF state
    d.svf2[s].SetFreq(freq);
    d.svf2[s].SetRes(res * 0.97f);
    d.svf2[s].SetDrive(drive);
}

void gs_voice_filter2_block(int v, int side, int type, float morph, const float *in, float *out,
                            uint32_t frames) {
    VoiceDsp &d = voice(v);
    const int s = side ? 1 : 0;
    type = clamp_type(type);
    // The comb and the formant have no second instance to run (one delay line
    // and one filter bank per voice, both already used by stage 1), so they read
    // as a low-pass here rather than silently sharing stage 1's state.
    if (type == GS_FILTER_COMB || type == GS_FILTER_FORMANT) type = GS_FILTER_LP;
    for (uint32_t i = 0; i < frames; ++i) {
        out[i] = stage2_shape(d.svf2[s], type, morph, in[i]);
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
