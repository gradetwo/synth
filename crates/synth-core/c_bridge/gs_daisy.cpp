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

// --- minBLEP / minBLAMP kernels for the dedicated hard-sync oscillator -------
//
// Hard sync restarts the slave's cycle at the master's wrap, and a restarted
// saw/square steps at that instant while a triangle only kinks. Correcting a
// step *after* the fact does not work (the two retired attempts in
// `docs/notes/hard-sync-aliasing.md` both patched DaisySP's already
// band-limited output and measured -1.6 dB): the discontinuity has to be
// band-limited where it is generated. This oscillator therefore emits the
// *naive* waveform and adds a kernel correction at every discontinuity — the
// slave's own wrap, the master's wrap (which restarts the slave), and a
// triangle's slope kinks.
//
// The kernel is the residual of a windowed-sinc low-pass step, tabulated at
// start-up (a plain static array, no dynamic initialisation): the BLEP table is
// the step residual, the BLAMP table its integral for slope discontinuities.
// Its cutoff (0.22 of the oversampled rate, i.e. 21 kHz at 96 kHz) sits just
// above the decimator's 19.2 kHz passband, so what survives decimation is
// already alias-free. The support is +/-32 oversampled samples; together with
// the ring accumulator's 32-sample delay that is what makes the correction
// causal without truncating the kernel's leading half.
// The kernel is tabulated at GS_BLEP_R points per sample. P9.1b raised this from
// 64: the regression's corrections are *step* residuals, whose interpolation
// error is drowned by their own sharpness, but the triangle's BLAMP correction is
// a smooth ramp, and a 1/64-sample interpolation error in it is a fractional
// delay of the correction -- i.e. a residual slope of the triangle's own
// derivative. Measured on the engine's own ruler at 2x, a 3520 Hz triangle reads
// -70 dB off-grid at 128 points per sample against -64 dB at 64 (and -56 dB
// before the triangle had a BLAMP at all), and 110 Hz goes -109 -> -121 dB.
// Doubling again to 256 buys another 6 dB for twice the table, so the table stays
// at 128: 64 KB of BSS for both kernels, built once in `gs_daisy_init`.
#define GS_BLEP_N 32
#define GS_BLEP_R 128
#define GS_BLEP_M (2 * GS_BLEP_N * GS_BLEP_R + 1)
#define GS_BLEP_OFF (GS_BLEP_N * GS_BLEP_R)
#define GS_BLEP_FC 0.22
#define GS_SYNC_RING 128 /* power of two: the emit loop masks instead of branching (P9.1b) */
#define GS_SYNC_DELAY GS_BLEP_N
/// Fixed latency of the ordinary band-limited oscillator (P9.1b), in *base-rate*
/// samples. The decimator is a symmetric 95-tap FIR: its centre tap reads the
/// oversampled sample 47 steps back, i.e. 47 / GS_SYNC_OS = 23.5 output samples.
/// (The hard-sync pair carries GS_SYNC_DELAY more, because its ring accumulator
/// holds the naive signal 32 oversampled samples ahead of the read head; the
/// ordinary path emits straight from the head and does not need that, because it
/// has no restart whose correction must be seen before the sample is emitted.)
///
/// This is reported to Rust (`gs_osc_bandlimit_latency`) so paths that still
/// come from DaisySP can be delayed to match it instead of comb-filtering
/// against the band-limited oscillator when a patch mixes the two.
#define GS_BL_DELAY_NUM (GS_SYNC_TAPS / 2)
#define GS_BL_DELAY_DEN GS_SYNC_OS
/// Base-rate latency, as a float: 23.5 samples at 48 kHz.
#define GS_BL_LATENCY ((float)GS_BL_DELAY_NUM / (float)GS_BL_DELAY_DEN)
/// Whole-sample part of the delay, and the fractional part the 4-tap Lagrange
/// interpolator supplies. `GS_BL_DELAY_FRAC_PREV` is how many samples *before*
/// the integer-delayed one the interpolator reads: the fractional offset
/// `1 - mu` lies between hist[mu_prev] and hist[mu_prev - 1], so a 4-point
/// interpolation needs `mu_prev + 2` past samples, which is why the history is
/// four floats. With 23.5 the numbers are 23, 2 and 0.5.
#define GS_BL_DELAY_WHOLE (GS_BL_DELAY_NUM / GS_BL_DELAY_DEN)
#define GS_BL_DELAY_FRAC ((double)(GS_BL_DELAY_NUM % GS_BL_DELAY_DEN) / (double)GS_BL_DELAY_DEN)
#define GS_BL_DELAY_PREV ((int)(1.0 - GS_BL_DELAY_FRAC) + 1)
static const double GS_PI = 3.14159265358979323846;

static float g_blep[GS_BLEP_M];
static float g_blamp[GS_BLEP_M];
static bool g_blep_ready = false;

static inline double sync_sinc(double x) {
    return x == 0.0 ? 1.0 : sin(x * GS_PI) / (x * GS_PI);
}

/// Build the two kernels once. `g_blep` is the windowed-sinc step residual,
/// `g_blamp` its running integral (the correction a slope discontinuity needs).
#if defined(__clang__)
__attribute__((noinline))
#endif
static void build_blep_kernels() {
    if (g_blep_ready) return;
    // The table is float but the maths is double: the window tail is what sets
    // the kernel's stopband, and rounding it out in float costs ~3 dB of alias
    // rejection (measured).
    double sum = 0.0;
    for (int k = 0; k < GS_BLEP_M; ++k) {
        double d = (k - GS_BLEP_OFF) / (double)GS_BLEP_R;
        double w = 0.42 + 0.5 * cos(GS_PI * d / GS_BLEP_N) +
                   0.08 * cos(2.0 * GS_PI * d / GS_BLEP_N);
        if (fabs(d) >= GS_BLEP_N) w = 0.0;
        float v = (float)(2.0 * GS_BLEP_FC * sync_sinc(2.0 * GS_BLEP_FC * d) * w /
                          (double)GS_BLEP_R);
        g_blep[k] = v;
        sum += v;
    }
    float inv = (float)(1.0 / sum);
    float acc = 0.0f;
    for (int k = 0; k < GS_BLEP_M; ++k) {
        acc += g_blep[k] * inv;
        g_blep[k] = acc - (k >= GS_BLEP_OFF ? 1.0f : 0.0f);
    }
    float a = 0.0f;
    for (int k = 0; k < GS_BLEP_M; ++k) {
        a += g_blep[k] / (float)GS_BLEP_R;
        g_blamp[k] = a;
    }
    float tail = g_blamp[GS_BLEP_M - 1];
    for (int k = 0; k < GS_BLEP_M; ++k) {
        g_blamp[k] -= tail * ((float)k / (float)(GS_BLEP_M - 1));
    }
    g_blep_ready = true;
}

/// Kernel sample at offset `d` (in oversampled samples) from the discontinuity.
///
/// The BLEP table is the *residual* `step_bandlimited - step_naive`, so it has
/// a genuine jump at `d = 0`: the node there carries the right-hand limit and
/// the node just below it the left-hand one. Interpolating that table straight
/// across the jump -- which is what this did before P9.1c -- reads the wrong
/// side for any query landing in the last 1/64 of a sample before the
/// discontinuity, and hands back a correction of the wrong sign and nearly full
/// magnitude. That is exactly what a master wrap does when its sub-sample
/// position `xm` drifts through (0, 1/64) instead of sitting on a sample
/// boundary: one oversampled sample per restart got a whole-step error, so the
/// residual burst to about the naive saw's own level (-33 dB, `docs/notes/
/// hard-sync-aliasing.md`) and back.
///
/// The one cell that spans the jump is `i == GS_BLEP_OFF - 1` (`d` in
/// `[-1/64, 0)`). There the continuous band-limited step, which is what the
/// table holds below the jump, runs from `tab[i]` to `tab[i + 1] + 1` -- the
/// `+ 1` is the naive step the table has already taken out at the node above --
/// so the interpolation is the plain one *plus* `f`. Everywhere else the plain
/// interpolation is already exact, including for `d >= 0`, where the table
/// carries the right-hand limit. `xm` still walks (the increment is f32), but
/// the correction no longer cares.
static inline float sync_kernel(const float *tab, float d, bool slope) {
    float t = (d + GS_BLEP_N) * GS_BLEP_R;
    if (t <= 0.0f || t >= (float)(GS_BLEP_M - 1)) return 0.0f;
    int i = (int)t;
    float f = t - (float)i;
    float v = tab[i] + f * (tab[i + 1] - tab[i]);
    // BLAMP is the integral of the residual and therefore continuous: there is
    // no step to put back.
    if (!slope && i == GS_BLEP_OFF - 1) v += f;
    return v;
}

/// Add one discontinuity's correction to a ring accumulator.
///
/// The accumulator holds the samples still to be emitted, `head` being the next
/// one; the naive signal itself is written GS_SYNC_DELAY slots ahead, so by the
/// time a sample reaches the head every discontinuity that can touch it has
/// already been seen and both halves of the kernel can be applied.
///
/// P9.1b optimisation: this runs GS_SYNC_OS times per output sample on the
/// ordinary path (and twice per sample on the sync path), so its inner loop is
/// the oscillator's hot spot. `d` advances by exactly one sample per tap, so the
/// table position walks by exactly `GS_BLEP_R` and is carried in a float counter
/// instead of a fresh `(d + N) * R` multiply and two float range tests per tap;
/// the ring is a power of two, so its wrap is a mask instead of a compare and
/// subtract. Measured on this machine's `verify:bench` scene, the pair cut the
/// 16-voice load from 86 % of the block budget to 49 %. A pure fixed-point form
/// was tried first and was 80 dB *worse*: the correction is built from
/// differences of adjacent table nodes, so half a table step of rounding error
/// in the walk is not half a table step in the result.
#if defined(__clang__)
__attribute__((noinline))
#endif
static void sync_emit(float *acc, int head, double x, float amp, int slope) {
    const float *tab = slope ? g_blamp : g_blep;
    float t = ((float)(-GS_BLEP_N + 1) - (float)x + (float)GS_BLEP_N) * (float)GS_BLEP_R;
    int idx = (head + 1) & (GS_SYNC_RING - 1);
    const bool jumped = !slope;
    for (int k = 0; k < 2 * GS_BLEP_N; ++k, t += (float)GS_BLEP_R) {
        const int i = (int)t;
        if (i > 0 && i < GS_BLEP_M - 1) {
            const float f = t - (float)i;
            float v = tab[i] + f * (tab[i + 1] - tab[i]);
            if (jumped && i == GS_BLEP_OFF - 1) v += f;
            acc[idx] += amp * v;
        }
        idx = (idx + 1) & (GS_SYNC_RING - 1);
    }
}

/// The naive (un-band-limited) shape the sync oscillator corrects, and the one
/// the ordinary band-limited oscillator emits before its own corrections. The
/// bridge waveform ids mirror `daisysp::Oscillator::WAVE_*` (see gs_daisy.h).
#if defined(__clang__)
__attribute__((noinline))
#endif
static float sync_naive(int wave, double p, float pw) {
    switch (wave) {
        case GS_WAVE_SIN:
            return sinf((float)(p * 2.0 * GS_PI));
        case GS_WAVE_TRI:
        case GS_WAVE_POLYBLEP_TRI: {
            double t = -1.0 + 2.0 * p;
            return (float)(2.0 * (fabs(t) - 0.5));
        }
        case GS_WAVE_RAMP:
            return (float)(2.0 * p - 1.0);
        case GS_WAVE_SQUARE:
            return p < pw ? 1.0f : -1.0f;
        case GS_WAVE_POLYBLEP_SQUARE:
            // DaisySP scales its band-limited square by 0.707; keep the level
            // the sync path had before this oscillator existed.
            return (p < pw ? 1.0f : -1.0f) * 0.70710678f;
        case GS_WAVE_SAW:
        case GS_WAVE_POLYBLEP_SAW:
        default:
            return (float)(1.0 - 2.0 * p);
    }
}

/// Slope of the naive triangle in value per sample, for its BLAMP kinks.
static inline double sync_slope(int wave, double p, double inc) {
    if (wave == GS_WAVE_TRI || wave == GS_WAVE_POLYBLEP_TRI) {
        return (p < 0.5 ? -4.0 : 4.0) * inc;
    }
    return 0.0;
}

struct VoiceDsp {
    /// [sub-voice][oscillator]; unison stacks up to GS_MAX_UNISON copies.
    daisysp::Oscillator osc[GS_MAX_UNISON][2];
    /// Phase-modulation state: the carrier's own free-running phase, kept here
    /// because a modulated oscillator cannot read it back from DaisySP (the
    /// offset would be inside it). `pm_ready` re-syncs after a voice reset.
    float pm_phase[GS_MAX_UNISON][2];
    bool pm_ready[GS_MAX_UNISON][2];
    /// Hard-sync state (see `gs_voice_osc_sync_block`): the slave's naive shape
    /// and the two free-running phases in double precision (so the restart
    /// lands on the master's exact sub-sample wrap), the ring accumulator of
    /// samples still to be emitted, and one decimation history per oscillator.
    uint8_t sync_wave[GS_MAX_UNISON];
    float sync_pw[GS_MAX_UNISON];
    float sync_amp[GS_MAX_UNISON];
    double sync_mphase[GS_MAX_UNISON];
    double sync_sphase[GS_MAX_UNISON];
    float sync_sacc[GS_MAX_UNISON][GS_SYNC_RING];
    int sync_head[GS_MAX_UNISON];
    bool sync_ready[GS_MAX_UNISON];
    float sync_hist_m[GS_MAX_UNISON][GS_SYNC_TAPS];
    float sync_hist_s[GS_MAX_UNISON][GS_SYNC_TAPS];
    /// Ordinary band-limited oscillator state (P9.1b). The saw/square/triangle
    /// path shares the sync oscillator's kernels and decimator but needs its own
    /// phase (double, so the wrap lands on the same sub-sample position the
    /// DaisySP path would have used), its own ring accumulator -- the two paths
    /// are mutually exclusive per note, but a mode change mid-note must not
    /// inherit the other one's tail -- and two decimation histories per
    /// oscillator side. `bl_hist` is indexed [side][sub].
    double bl_phase[2][GS_MAX_UNISON];
    bool bl_ready[2][GS_MAX_UNISON];
    float bl_acc[2][GS_MAX_UNISON][GS_SYNC_RING];
    int bl_head[2][GS_MAX_UNISON];
    float bl_hist[2][GS_MAX_UNISON][GS_SYNC_TAPS];
    /// The naive shape the band-limited oscillator emits, for side 1 (side 0
    /// reuses the sync mirror `sync_wave`/`sync_pw`, which is what the sync path
    /// already keeps). [sub] indexed like the others.
    uint8_t bl_wave[GS_MAX_UNISON];
    float bl_pw[GS_MAX_UNISON];
    /// Latency alignment for the paths that do *not* go through the decimator
    /// (sine, wavetable, sample): a fractional 23.5-sample delay so a patch that
    /// mixes them with the band-limited oscillator cannot comb. `dl_hist` keeps
    /// the three previous input samples the 4-tap Lagrange interpolator needs,
    /// indexed [side][sub].
    float dl_hist[2][GS_MAX_UNISON][4];
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
        d.sync_ready[s] = false;
        for (int side = 0; side < 2; ++side) {
            d.bl_ready[side][s] = false;
            d.bl_head[side][s] = 0;
            for (int t = 0; t < GS_SYNC_RING; ++t) d.bl_acc[side][s][t] = 0.0f;
            for (int t = 0; t < GS_SYNC_TAPS; ++t) d.bl_hist[side][s][t] = 0.0f;
            for (int t = 0; t < 4; ++t) d.dl_hist[side][s][t] = 0.0f;
        }
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
    build_blep_kernels();
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
        d.sync_head[s] = 0;
        for (int t = 0; t < GS_SYNC_RING; ++t) {
            d.sync_sacc[s][t] = 0.0f;
        }
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
        d.sync_head[s] = 0;
        for (int t = 0; t < GS_SYNC_RING; ++t) {
            d.sync_sacc[s][t] = 0.0f;
        }
        for (int side = 0; side < 2; ++side) {
            d.bl_ready[side][s] = false;
            d.bl_head[side][s] = 0;
            for (int t = 0; t < GS_SYNC_RING; ++t) d.bl_acc[side][s][t] = 0.0f;
            for (int t = 0; t < GS_SYNC_TAPS; ++t) d.bl_hist[side][s][t] = 0.0f;
            for (int t = 0; t < 4; ++t) d.dl_hist[side][s][t] = 0.0f;
        }
    }
}

void gs_voice_osc_set(int v, int which, int sub, uint32_t wave, float freq, float amp, float pw) {
    VoiceDsp &d = voice(v);
    if (sub < 0 || sub >= GS_MAX_UNISON) return;
    const int side = which ? 1 : 0;
    daisysp::Oscillator &o = d.osc[sub][side];
    o.SetWaveform(static_cast<uint8_t>(wave));
    o.SetFreq(freq);
    o.SetAmp(amp);
    o.SetPw(pw);
    // The dedicated sync oscillator reads the *slave's* naive shape back by id;
    // DaisySP does not expose what it was set to. The master keeps DaisySP's
    // own band-limited output, so only side 0 needs the mirror for sync -- but
    // the ordinary band-limited oscillator (P9.1b) can run on either side, so
    // the mirror is kept per side. It is only read for waves the naive shapes
    // cover; anything else is stored as a sine and never reaches this path.
    const int id = wave < GS_WAVE_POLYBLEP_SQUARE + 1 ? (int)wave : GS_WAVE_SIN;
    const float clamped_pw = pw < 0.0f ? 0.0f : (pw > 1.0f ? 1.0f : pw);
    if (side == 0) {
        d.sync_wave[sub] = static_cast<uint8_t>(id);
        d.sync_pw[sub] = clamped_pw;
        d.sync_amp[sub] = amp;
    } else {
        d.bl_wave[sub] = static_cast<uint8_t>(id);
        d.bl_pw[sub] = clamped_pw;
    }
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
    if (!d.sync_ready[sub]) {
        d.sync_mphase[sub] = master.Phase();
        d.sync_sphase[sub] = slave.Phase();
        d.sync_head[sub] = 0;
        for (int t = 0; t < GS_SYNC_RING; ++t) d.sync_sacc[sub][t] = 0.0f;
        d.sync_ready[sub] = true;
    }
    // The master keeps DaisySP's own band-limited output (it is never
    // restarted, so its polyBLEP is what it always was) but its *phase* is
    // tracked here in double: the slave's restart has to land on the master's
    // exact sub-sample wrap, and `IsEOC()` cannot express that.
    double mph = d.sync_mphase[sub];
    double sph = d.sync_sphase[sub];
    int head = d.sync_head[sub];
    const double minc = master.PhaseInc();
    const double sinc = slave.PhaseInc();
    const int swave = d.sync_wave[sub];
    const float spw = d.sync_pw[sub];
    const float samp = d.sync_amp[sub];
    float *sacc = d.sync_sacc[sub];
    float hi_m[GS_SYNC_OS];
    float hi_s[GS_SYNC_OS];
    const bool stri = swave == GS_WAVE_TRI || swave == GS_WAVE_POLYBLEP_TRI;
    const bool ssq = swave == GS_WAVE_SQUARE || swave == GS_WAVE_POLYBLEP_SQUARE;
    // A whole-cycle step: the jump the naive shape makes where its cycle wraps.
    const float s_wrap = sync_naive(swave, 0.0, spw) - sync_naive(swave, 1.0 - 1e-9, spw);
    // The pulse edge's jump (square/pulse only).
    const float s_edge = sync_naive(swave, spw + 1e-6, spw) - sync_naive(swave, spw - 1e-6, spw);

    for (uint32_t i = 0; i < frames; ++i) {
        for (int k = 0; k < GS_SYNC_OS; ++k) {
            // ---- master: DaisySP waveform at the phase we track ----
            const double m0 = mph;
            const double m1 = m0 + minc;
            const bool mwrap = m1 >= 1.0;
            const double xm = mwrap ? (1.0 - m0) / minc : 0.0;
            master.Reset((float)m0);
            hi_m[k] = master.Process();
            mph = mwrap ? m1 - 1.0 : m1;

            // ---- slave: free-running, restarted by the master's wrap ----
            const double s0 = sph;
            double sNext;
            if (mwrap) {
                const double pPre = s0 + sinc * xm;
                const bool slwrap = pPre >= 1.0;
                const double pAt = slwrap ? pPre - 1.0 : pPre;
                if (slwrap) {
                    const double xw = (1.0 - s0) / sinc;
                    if (s_wrap != 0.0f) sync_emit(sacc, head, xw, samp * s_wrap, 0);
                    if (stri) sync_emit(sacc, head, xw, samp * (float)(-8.0 * sinc), 1);
                    if (ssq && spw < pAt) {
                        sync_emit(sacc, head, xw + spw / sinc, samp * s_edge, 0);
                    }
                } else {
                    if (ssq) {
                        double e = spw - s0;
                        if (e < 0.0) e += 1.0;
                        if (e < sinc * xm) sync_emit(sacc, head, e / sinc, samp * s_edge, 0);
                    }
                    if (stri && s0 < 0.5 && pAt >= 0.5) {
                        sync_emit(sacc, head, (0.5 - s0) / sinc, samp * (float)(8.0 * sinc), 1);
                    }
                }
                // The restart itself: the naive shape jumps from where the
                // slave already was to where phase 0 reads. The same instant
                // also bends a triangle's slope, which is its BLAMP half.
                const float reset = sync_naive(swave, 0.0, spw) - sync_naive(swave, pAt, spw);
                if (reset != 0.0f) sync_emit(sacc, head, xm, samp * reset, 0);
                if (stri) {
                    const double dslope = sync_slope(swave, 0.0, sinc) - sync_slope(swave, pAt, sinc);
                    if (dslope != 0.0) sync_emit(sacc, head, xm, samp * (float)dslope, 1);
                }
                sNext = sinc * (1.0 - xm);
                if (ssq && spw < sNext) {
                    sync_emit(sacc, head, xm + spw / sinc, samp * s_edge, 0);
                }
            } else {
                const double s1 = s0 + sinc;
                if (s1 >= 1.0) {
                    const double xw = (1.0 - s0) / sinc;
                    if (s_wrap != 0.0f) sync_emit(sacc, head, xw, samp * s_wrap, 0);
                    if (stri) sync_emit(sacc, head, xw, samp * (float)(-8.0 * sinc), 1);
                    sNext = s1 - 1.0;
                } else {
                    if (stri && s0 < 0.5 && s1 >= 0.5) {
                        sync_emit(sacc, head, (0.5 - s0) / sinc, samp * (float)(8.0 * sinc), 1);
                    }
                    sNext = s1;
                }
                if (ssq) {
                    double e = spw - s0;
                    if (e < 0.0) e += 1.0;
                    if (e < sinc) sync_emit(sacc, head, e / sinc, samp * s_edge, 0);
                }
            }
            // The slave's read phase carries the same phase modulation the
            // other oscillators use; its discontinuities are the oscillator's
            // own and use the unmodulated phase.
            double read = s0;
            if (mod != nullptr) {
                read += (double)mod[i] * depth;
                read -= floor(read);
            }
            sacc[(head + GS_SYNC_DELAY) % GS_SYNC_RING] += sync_naive(swave, read, spw) * samp;
            sph = sNext;

            hi_s[k] = sacc[head];
            sacc[head] = 0.0f;
            if (++head >= GS_SYNC_RING) head -= GS_SYNC_RING;
        }
        master_out[i] = sync_decimate(d.sync_hist_m[sub], hi_m, GS_SYNC_OS);
        slave_out[i] = sync_decimate(d.sync_hist_s[sub], hi_s, GS_SYNC_OS);
    }
    d.sync_mphase[sub] = mph;
    d.sync_sphase[sub] = sph;
    d.sync_head[sub] = head;
}

/// Band-limited ordinary oscillator (P9.1b): the same machinery the hard-sync
/// pair uses, minus the restart.
///
/// The post-mortem in `.tmp/noise-floor-report.md` traced the -37...-49 dB
/// off-grid floor of the saw/square/triangle to DaisySP's two-point polyBLEP:
/// its residual is a first-order correction, so what is left at high harmonics
/// folds back at about -40 dB. The fix is the one already proven on hard sync
/// (measured -88 dB or better in every 4 s window): emit the *naive* shape and
/// correct each discontinuity where it is generated -- the cycle wrap (BLEP for
/// saw/square, BLAMP for the triangle's slope kink) and the square/pulse edge --
/// in the 2x domain, then decimate through the same 95-tap Kaiser filter.
///
/// The three wave shapes here are the same `sync_naive` the sync path reads
/// back, so both paths agree on level and phase convention, and the correction
/// kernels are the shared `g_blep`/`g_blamp` tables (built once in
/// `gs_daisy_init`). Sine, wavetable, sample and noise keep their old paths:
/// they are already clean, and the report's section 4.1 shows a sine's apparent
/// floor is the *ruler*, not the oscillator.
///
/// Latency: this block is a linear-phase 95-tap decimator, so its output is
/// `GS_BL_LATENCY` (23.5 base-rate samples) later than the DaisySP path's. See
/// `gs_osc_bandlimit_latency`; Rust compensates every path that has to line up
/// with this one.
void gs_voice_osc_bandlimit_block(int v, int which, int sub, const float *mod, float depth,
                                  float *out, uint32_t frames) {
    VoiceDsp &d = voice(v);
    if (sub < 0 || sub >= GS_MAX_UNISON) {
        for (uint32_t i = 0; i < frames; ++i) out[i] = 0.0f;
        return;
    }
    const int side = which ? 1 : 0;
    daisysp::Oscillator &o = d.osc[sub][side];
    if (!d.bl_ready[side][sub]) {
        // Seed from the oscillator's own phase: `gs_voice_phase` / `Reset` set it
        // when the note starts, so the band-limited shape starts where the
        // DaisySP shape would have. After that the phase lives here and DaisySP's
        // is not advanced (Process() is not called on this path).
        d.bl_phase[side][sub] = o.Phase();
        d.bl_head[side][sub] = 0;
        for (int t = 0; t < GS_SYNC_RING; ++t) d.bl_acc[side][sub][t] = 0.0f;
        d.bl_ready[side][sub] = true;
    }
    const int wave = (side == 0) ? (int)d.sync_wave[sub] : (int)d.bl_wave[sub];
    const float pw = (side == 0) ? d.sync_pw[sub] : d.bl_pw[sub];
    // `gs_voice_osc_set` always passes unity here (the oscillator's level is a
    // mixer value in Rust), and the sync path reads the same mirror for side 0.
    const float amp = (side == 0) ? d.sync_amp[sub] : 1.0f;
    // `PhaseInc()` is per *output* sample (`f * 1/sr`); this loop takes
    // GS_SYNC_OS steps per output sample, so the per-step increment is that
    // divided by the factor -- which is exactly what the sync block gets by
    // passing `freq / GS_SYNC_OS` to `gs_voice_osc_set`. Without the division the
    // phase advances twice per output sample and the oscillator plays an octave
    // up (measured: a "220 Hz" saw walked 109 samples per cycle, i.e. 440 Hz).
    const double inc = o.PhaseInc() / (double)GS_SYNC_OS;
    double p = d.bl_phase[side][sub];
    if (!(p >= 0.0) || p >= 1.0) p = 0.0;
    int head = d.bl_head[side][sub];
    float *sacc = d.bl_acc[side][sub];
    const bool saw = wave == GS_WAVE_SAW || wave == GS_WAVE_POLYBLEP_SAW ||
                     wave == GS_WAVE_RAMP;
    const bool tri = wave == GS_WAVE_TRI || wave == GS_WAVE_POLYBLEP_TRI;
    const bool sq = wave == GS_WAVE_SQUARE || wave == GS_WAVE_POLYBLEP_SQUARE;
    // The whole-cycle step, and the pulse edge's step (a square's two edges are
    // both of them: the wrap, and the pw crossing). Both are read from the naive
    // shape itself. For the saw that is +2: `sync_naive` runs from -1 up to +1
    // across the cycle, so the wrap steps *up*. Getting this sign wrong does not
    // merely halve the rejection, it doubles the step (measured -18 dB instead of
    // -77 dB on the offline model), which is why it is spelled out here.
    const float wrap = sync_naive(wave, 0.0, pw) - sync_naive(wave, 1.0 - 1e-9, pw);
    const float edge = sync_naive(wave, pw + 1e-6, pw) - sync_naive(wave, pw - 1e-6, pw);
    // The triangle's two slope reversals, in *value per unit phase*: the wrap
    // flips +4 to -4 and the peak at p = 0.5 flips -4 to +4, so the two jumps
    // are -8 and +8 (signs measured against the engine's own ruler: swapping
    // either one costs 30 dB or more). The emitted amplitude is the jump *per
    // oversampled sample*, hence the `inc` factor at the call sites.
    const double tri_wrap = -8.0;
    const double tri_kink = 8.0;
    for (uint32_t i = 0; i < frames; ++i) {
        float hi[GS_SYNC_OS];
        for (int k = 0; k < GS_SYNC_OS; ++k) {
            const double p0 = p;
            const double p1 = p + inc;
            const bool wrapped = p1 >= 1.0;
            p = wrapped ? p1 - 1.0 : p1;
            if (wrapped) {
                // Where in this step the wrap sits, as a fraction of one step
                // measured *forward* from the sample whose naive value is read at
                // `p0`: `p1 >= 1` means the wrap is `1 - p0` of a step ahead of
                // that read, and `(1 - p0)/inc` is exactly the `xm` the hard-sync
                // path feeds its restart correction for the same reason.
                const double xw = (1.0 - p0) / inc;
                if (saw) {
                    sync_emit(sacc, head, xw, amp * wrap, 0);
                } else if (tri) {
                    // The wrap reverses the slope: a BLAMP. The amplitude is in
                    // value-per-oversampled-sample, i.e. the slope jump itself,
                    // which is why `tri_wrap` carries the increment.
                    sync_emit(sacc, head, xw, amp * (float)(tri_wrap * inc), 1);
                } else if (sq) {
                    sync_emit(sacc, head, xw, amp * wrap, 0);
                }
            }
            if (tri && p0 < 0.5 && p1 >= 0.5) {
                // The triangle's peak, the other slope reversal. Fixing the wrap
                // alone is not enough: a 440 Hz triangle still measured -63 dB
                // (its own naive floor) without this, and -91 dB with it.
                sync_emit(sacc, head, (0.5 - p0) / inc, amp * (float)(tri_kink * inc), 1);
            }
            if (sq) {
                // The pw crossing inside this step, if any.
                double e = (double)pw - p0;
                if (e < 0.0) e += 1.0;
                if (e > 0.0 && e < inc) sync_emit(sacc, head, e / inc, amp * edge, 0);
            }
            // The carrier's phase modulation is *added to the read phase*, as in
            // `gs_voice_osc_pm_block`: the oscillator keeps running at its own
            // frequency, so a deep index cannot pull it out of tune.
            double read = p0;
            if (mod != nullptr) {
                read += (double)mod[i] * depth;
                read -= floor(read);
            }
            sacc[(head + GS_SYNC_DELAY) % GS_SYNC_RING] += sync_naive(wave, read, pw) * amp;
            hi[k] = sacc[head];
            sacc[head] = 0.0f;
            if (++head >= GS_SYNC_RING) head -= GS_SYNC_RING;
        }
        out[i] = sync_decimate(d.bl_hist[side][sub], hi, GS_SYNC_OS);
    }
    d.bl_phase[side][sub] = p;
    d.bl_head[side][sub] = head;
}

/// Fixed latency of [`gs_voice_osc_bandlimit_block`], in base-rate samples
/// (23.5 at 48 kHz). A host that compares the band-limited oscillator with the
/// DaisySP one has to delay the latter by this much.
float gs_osc_bandlimit_latency(void) {
    return GS_BL_LATENCY;
}

/// Delay a block by exactly [`gs_osc_bandlimit_latency`] (P9.1b).
///
/// The engine calls this on the oscillator paths that still come from DaisySP
/// (sine, wavetable, sample), so that mixing them with the band-limited
/// saw/square/triangle lines up in time instead of comb-filtering. The split is
/// 23 whole samples plus a half: four points at mu = 0.5 make a *symmetric*
/// cubic Lagrange interpolator, `[-1/16, 9/16, 9/16, -1/16]`, whose response is
/// flat (within 0.15 dB) to about 0.4 of Nyquist and has no DC error. It does
/// roll off towards Nyquist -- a half-sample shift has to -- which is a 24 kHz
/// shelf on a sine that nothing else in the chain can hear.
///
/// Zero allocation, four floats of state per oscillator per unison voice.
void gs_voice_osc_delay_block(int v, int which, int sub, float *io, uint32_t frames) {
    VoiceDsp &d = voice(v);
    if (sub < 0 || sub >= GS_MAX_UNISON) return;
    const int side = which ? 1 : 0;
    float *h = d.dl_hist[side][sub];
    for (uint32_t i = 0; i < frames; ++i) {
        h[3] = h[2];
        h[2] = h[1];
        h[1] = h[0];
        h[0] = io[i];
        // The interpolated output is the *previous* sample's frame: with 23.5
        // samples of delay the half sits between h[2] and h[1], so the four taps
        // are h[3..0] and one sample of the delay is spent by the interpolation
        // reading one step back (see GS_BL_DELAY_PREV).
        const float x0 = h[1];
        const float x1 = h[2];
        const float x2 = h[3];
        const float x3 = h[0];
        io[i] = (9.0f * (x0 + x1) - (x2 + x3)) * 0.0625f;
    }
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
