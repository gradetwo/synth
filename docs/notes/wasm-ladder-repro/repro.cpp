/*
 * Minimal reproducer: the DaisySP LadderFilter loses its z0_/z1_ state at every
 * block boundary when linked into a wasm module the same way crates/synth-core
 * links it (clang -> wasm-ld, no entry point, no reactor, no __wasm_call_ctors
 * export).
 *
 * Root cause: LadderFilter has in-class member initializers
 *
 *     float beta_[4] = {0,0,0,0};
 *     float z0_[4]   = {0,0,0,0};
 *     float z1_[4]   = {0,0,0,0};
 *
 * so a namespace-scope *array* of LadderFilter needs dynamic initialization.
 * clang emits `_GLOBAL__sub_I_repro.cpp`; wasm-ld folds it into
 * `__wasm_call_ctors` and, because the module has no start/entry and does not
 * export `__wasm_call_ctors`, wraps every export in a `<name>.command_export`
 * shim that calls `__wasm_call_ctors` first.  `__wasm_call_ctors` is NOT
 * idempotent, so every exported call re-runs the global ctor, which zeroes the
 * filter state.  Native/ELF runs `.init_array` exactly once, which is why the
 * same C++ is clean natively.
 */
#include "Filters/ladder.h"

namespace {
// Exactly the shape of crates/synth-core/c_bridge/gs_daisy.cpp's g_voice[].
daisysp::LadderFilter g_voice[32];
} // namespace

extern "C" {

void r_init(float sr) {
    for (int i = 0; i < 32; ++i) g_voice[i].Init(sr);
}

void r_set(int v, float freq, float res, float drive) {
    g_voice[v].SetFilterMode(daisysp::LadderFilter::FilterMode::LP24);
    g_voice[v].SetFreq(freq);
    g_voice[v].SetRes(res);
    g_voice[v].SetInputDrive(drive);
    g_voice[v].SetPassbandGain(0.5f);
}

// Two different voice slots are used for the two runs so that the comparison
// starts from the same (all-zero) state in both; Init() does not clear z0_/z1_.
void r_block(int v, const float *in, float *out, unsigned n) {
    for (unsigned i = 0; i < n; ++i) out[i] = g_voice[v].Process(in[i]);
}

} // extern "C"

#ifndef __wasm__
// Native control: same two runs, same chunking.  Expected: max diff == 0.
extern "C" int printf(const char *, ...);
#include <math.h>
int main(void) {
    const int N = 4096, SR = 48000, CHUNK = 128;
    static float in[N], chunked[N], single[N];
    for (int i = 0; i < N; ++i) in[i] = 0.8f * sinf(2.0f * 3.14159265358979f * 440.0f * i / SR);
    r_init(SR);
    r_set(0, 1200, 0.4f, 0.3f);
    for (int off = 0; off < N; off += CHUNK) r_block(0, in + off, chunked + off, CHUNK);
    r_init(SR);
    r_set(1, 1200, 0.4f, 0.3f);
    r_block(1, in, single, N);
    float maxd = 0; int maxi = -1;
    for (int i = 0; i < N; ++i) { float d = fabsf(chunked[i] - single[i]); if (d > maxd) { maxd = d; maxi = i; } }
    printf("native: max |chunked - single| = %g at %d (expect 0)\n", maxd, maxi);
    printf("native: sample 128 single=%f chunked=%f\n", single[128], chunked[128]);
    return 0;
}
#endif
