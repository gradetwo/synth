//! P6.4 — the bit-crusher, the shaping EQ and the transient shaper.
//!
//! All three live in the effect-node pool next to the C effects, but they are
//! plain Rust: one fixed-size state block per node, no allocation, no C bridge
//! entry. Each node keeps its own state, which is what lets the routing graph
//! put a crusher and an EQ in two different places without them sharing a
//! filter.
//!
//! ## Bit-crusher
//!
//! A quantiser at `bits` (4..16) followed by a sample-and-hold at `down`
//! (1..64) — the sample rate is divided by `down`, so a sine at `f` gains
//! images at `k·(sr/down) ± f`, and anything above the decimated Nyquist folds
//! back in. The anti-alias control `aa` mixes in two cascaded one-pole
//! low-passes *before* the divider, with their corner at the decimated Nyquist,
//! and two more *after* it to interpolate the staircase. At `aa = 0` the
//! crusher is the raw, aliased one, which is what makes the "the mirror falls
//! as aa rises" assertions meaningful.
//!
//! ## Shaping EQ
//!
//! Three RBJ biquads in series: low shelf, sweepable peaking mid, high shelf.
//! The coefficients are computed per block in `f32` (and via `exp2`, not `pow`,
//! so no libm `pow` is linked for four EQ controls) and normalised by `a0`. A
//! band whose gain is 0 dB comes out as a mathematical identity, so a flat EQ
//! (or the wet/dry mix at 0, which skips the node entirely) is a true bypass.
//!
//! The measurement caveat from P6.3a applies to every test below: the default
//! patch routes the envelope and the LFO at the cutoff with both enabled, so a
//! response measured without clearing the matrix is a measurement of the
//! modulation, not of the filter.

//! ## Transient shaper
//!
//! A fast envelope follower on the rectified signal and a slower one that
//! chases the fast one: on a rise the fast one leads, on a fall it lags, and on
//! a settled note the two are equal and the difference is exactly zero.
//! `attack_amt` scales the leading half of that difference, `sustain_amt` the
//! trailing half, both as a number of decibels, so `+1` is the strongest lift
//! and `-1` the strongest cut. `0` for both is a mathematical identity — the
//! gain is exactly 1 and the output is the input — which is what makes a
//! default patch (both amounts at 0) render bit for bit unchanged.
//!
//! The rectifier is smoothed with two poles well above every note's carrier, so
//! the ripple of a held tone is gone before the transient is taken; without
//! that the shaper would gain-modulate a steady note at twice its own frequency
//! and the gate would read it as harmonic distortion. The two followers then
//! only see the envelope, and because the slower one tracks the fast one rather
//! than the raw signal, a held note relaxes back to unity within a few tens of
//! milliseconds instead of staying lifted for the length of the note.
//!
//! The gain is `2^(dB/6)`, i.e. exactly `dB` decibels, computed with `exp2`
//! (a wasm instruction) rather than `powf`, and it is hard-clamped to `[0, 8]`
//! so no combination of controls can invert the signal or send it to infinity.
//! `MIX = 0` skips the node entirely, which keeps the dry path bit for bit.

use crate::dsp::util::exp2;
use core::f32::consts::TAU;

/// `10^(db/40)` — the amplitude the RBJ cookbook wants, via `exp2` so no libm
/// `pow` is linked into the wasm for four EQ controls.
fn gain_to_a(db: f32) -> f32 {
    // log2(10) / 40, through `exp2`.
    exp2(db * 0.083_048_2)
}

/// Longest sample-and-hold divisor the crusher offers.
pub const MAX_DIVISOR: f32 = 64.0;

/// One block's worth of bit-crusher controls.
#[derive(Clone, Copy)]
pub struct CrushParams {
    pub bits: f32,
    pub down: f32,
    pub aa: f32,
}

/// One block's worth of shaping-EQ controls.
#[derive(Clone, Copy)]
pub struct EqParams {
    pub low_gain: f32,
    pub low_freq: f32,
    pub mid_gain: f32,
    pub mid_freq: f32,
    pub mid_q: f32,
    pub high_gain: f32,
    pub high_freq: f32,
}

fn quantise(x: f32, step: f32, limit: f32) -> f32 {
    // Mid-tread with `2^bits` steps across full scale, so full scale itself is
    // on the grid: +1 is exactly `limit` steps from the centre and the clamp
    // can never land between two grid points. 16 bits is a 3.05e-5 step and
    // 4 bits is 0.125.
    (x / step).round().clamp(-limit, limit) * step
}

/// Bit-crusher state, one per effect node.
#[derive(Clone, Copy)]
pub struct BitCrusher {
    /// Two cascaded one-pole anti-alias low-pass states, per channel.
    pre: [[f32; 2]; 2],
    /// Sample-and-hold value, per channel.
    hold: [f32; 2],
    /// Two cascaded one-pole interpolation states, per channel.
    post: [[f32; 2]; 2],
    /// Position inside the current held sample, in input samples.
    phase: f32,
}

impl BitCrusher {
    pub const fn new() -> Self {
        Self {
            pre: [[0.0; 2]; 2],
            hold: [0.0; 2],
            post: [[0.0; 2]; 2],
            // Larger than any divisor, so the very first sample is captured
            // instead of the crusher starting with `down` samples of silence.
            phase: MAX_DIVISOR,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Render the wet (crushed) signal. The dry/wet crossfade is the caller's
    /// job, which is what keeps `mix = 0` a bit-for-bit bypass.
    ///
    /// `inline(never)`: this is called from two places that both end up inside
    /// the (already enormous) render loop, and inlining it twice is several
    /// hundred bytes of duplicated wasm for no speed that matters here.
    #[inline(never)]
    pub fn process(
        &mut self,
        in_l: &[f32],
        in_r: &[f32],
        out_l: &mut [f32],
        out_r: &mut [f32],
        frames: usize,
        params: CrushParams,
        sample_rate: f32,
    ) {
        let bits = params.bits.clamp(4.0, 16.0);
        let down = params.down.clamp(1.0, MAX_DIVISOR);
        let aa = params.aa.clamp(0.0, 1.0);
        // `exp2` is a wasm instruction; `powf` would pull in a libm routine for
        // a control range that is only 4..16.
        let levels = exp2(bits);
        let step = 2.0 / levels;
        let limit = levels * 0.5;
        // The anti-alias corner sits at the decimated Nyquist; the
        // interpolation corner is a little lower, which buys the extra
        // stop-band attenuation a single pole cannot give.
        let decimated = sample_rate / down;
        let pre_coeff = (1.0 - (-TAU * 0.45 * decimated / sample_rate).exp()).clamp(0.0, 1.0);
        let post_coeff = (1.0 - (-TAU * 0.30 * decimated / sample_rate).exp()).clamp(0.0, 1.0);
        for i in 0..frames {
            let raw = [in_l[i], in_r[i]];
            self.phase += 1.0;
            let capture = self.phase >= down;
            if capture {
                self.phase -= down;
            }
            let mut wet = [0.0f32; 2];
            for ch in 0..2 {
                let x = raw[ch];
                self.pre[ch][0] += pre_coeff * (x - self.pre[ch][0]);
                self.pre[ch][1] += pre_coeff * (self.pre[ch][0] - self.pre[ch][1]);
                // `aa = 0` keeps the raw input, so the quantiser and the
                // divider are the only things shaping the signal.
                let source = x + aa * (self.pre[ch][1] - x);
                if capture {
                    self.hold[ch] = quantise(source, step, limit);
                }
                self.post[ch][0] += post_coeff * (self.hold[ch] - self.post[ch][0]);
                self.post[ch][1] += post_coeff * (self.post[ch][0] - self.post[ch][1]);
                wet[ch] = self.hold[ch] + aa * (self.post[ch][1] - self.hold[ch]);
            }
            out_l[i] = wet[0];
            out_r[i] = wet[1];
        }
    }
}

/// One RBJ biquad section, direct form II transposed, normalised by `a0`.
#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    /// `[v1, v2]` per channel.
    v: [[f32; 2]; 2],
}

impl Biquad {
    const fn identity() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            v: [[0.0; 2]; 2],
        }
    }

    fn set(&mut self, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) {
        let inv = 1.0 / a0;
        self.b0 = b0 * inv;
        self.b1 = b1 * inv;
        self.b2 = b2 * inv;
        self.a1 = a1 * inv;
        self.a2 = a2 * inv;
    }

    /// RBJ low shelf with slope `S = 1` (a 12 dB/octave asymptote).
    fn low_shelf(&mut self, sample_rate: f32, freq: f32, gain_db: f32) {
        let a = gain_to_a(gain_db);
        let w0 = TAU * (freq / sample_rate);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin * 0.5 * core::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        self.set(
            a * ((a + 1.0) - (a - 1.0) * cos + two_sqrt_a_alpha),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
            a * ((a + 1.0) - (a - 1.0) * cos - two_sqrt_a_alpha),
            (a + 1.0) + (a - 1.0) * cos + two_sqrt_a_alpha,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos),
            (a + 1.0) + (a - 1.0) * cos - two_sqrt_a_alpha,
        );
    }

    /// RBJ high shelf with slope `S = 1`.
    fn high_shelf(&mut self, sample_rate: f32, freq: f32, gain_db: f32) {
        let a = gain_to_a(gain_db);
        let w0 = TAU * (freq / sample_rate);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin * 0.5 * core::f32::consts::SQRT_2;
        let two_sqrt_a_alpha = 2.0 * a.sqrt() * alpha;
        self.set(
            a * ((a + 1.0) + (a - 1.0) * cos + two_sqrt_a_alpha),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - two_sqrt_a_alpha),
            (a + 1.0) - (a - 1.0) * cos + two_sqrt_a_alpha,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - two_sqrt_a_alpha,
        );
    }

    /// RBJ peaking EQ at `freq` with bandwidth `q`.
    fn peaking(&mut self, sample_rate: f32, freq: f32, q: f32, gain_db: f32) {
        let a = gain_to_a(gain_db);
        let w0 = TAU * (freq / sample_rate);
        let (sin, cos) = w0.sin_cos();
        let alpha = sin / (2.0 * q.max(0.05));
        self.set(
            1.0 + alpha * a,
            -2.0 * cos,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos,
            1.0 - alpha / a,
        );
    }

    #[inline(never)]
    fn process_in_place(&mut self, l: &mut [f32], r: &mut [f32], frames: usize) {
        for i in 0..frames {
            for (ch, x) in [l[i], r[i]].into_iter().enumerate() {
                let v1 = self.v[ch][0];
                let v2 = self.v[ch][1];
                let v = x - self.a1 * v1 - self.a2 * v2;
                let y = self.b0 * v + self.b1 * v1 + self.b2 * v2;
                self.v[ch][0] = v;
                self.v[ch][1] = v1;
                if ch == 0 {
                    l[i] = y;
                } else {
                    r[i] = y;
                }
            }
        }
    }
}

/// Shaping-EQ state, one per effect node.
#[derive(Clone, Copy)]
pub struct ShapingEq {
    low: Biquad,
    mid: Biquad,
    high: Biquad,
}

impl ShapingEq {
    pub const fn new() -> Self {
        Self {
            low: Biquad::identity(),
            mid: Biquad::identity(),
            high: Biquad::identity(),
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Render the wet (equalised) signal into `out_*`; the caller crossfades.
    #[inline(never)]
    pub fn process(
        &mut self,
        in_l: &[f32],
        in_r: &[f32],
        out_l: &mut [f32],
        out_r: &mut [f32],
        frames: usize,
        params: EqParams,
        sample_rate: f32,
    ) {
        // Recomputing per block is what makes the four sweep controls audible
        // without a coefficient-smoothing scheme: the engine already smooths
        // the parameters themselves, so the coefficients move smoothly too.
        self.low
            .low_shelf(sample_rate, params.low_freq.clamp(20.0, 1000.0), params.low_gain.clamp(-18.0, 18.0));
        self.mid.peaking(
            sample_rate,
            params.mid_freq.clamp(200.0, 8000.0),
            params.mid_q.clamp(0.3, 6.0),
            params.mid_gain.clamp(-18.0, 18.0),
        );
        self.high.high_shelf(
            sample_rate,
            params.high_freq.clamp(1000.0, 16000.0),
            params.high_gain.clamp(-18.0, 18.0),
        );
        out_l[..frames].copy_from_slice(&in_l[..frames]);
        out_r[..frames].copy_from_slice(&in_r[..frames]);
        self.low.process_in_place(out_l, out_r, frames);
        self.mid.process_in_place(out_l, out_r, frames);
        self.high.process_in_place(out_l, out_r, frames);
    }
}

/// One block's worth of transient-shaper controls.
#[derive(Clone, Copy)]
pub struct TransientParams {
    /// How hard a rising transient is lifted (`+`) or pushed down (`-`), -1..1.
    pub attack_amt: f32,
    /// The same for a falling envelope, -1..1.
    pub sustain_amt: f32,
}

/// Rectifier-smoothing corner, in Hz. Above the carrier of every note (the
/// lowest is 65 Hz, whose rectified ripple is at 130 Hz), so a steady tone's
/// ripple is gone before the transient is taken and the shaper is not a
/// distortion box on held notes.
const RECT_HZ: f32 = 200.0;
/// The fast follower's corner: it follows the envelope within a few
/// milliseconds.
const FAST_HZ: f32 = 60.0;
/// The difference between the fast envelope and *its own* slow average is the
/// transient. A held note settles to zero within a few tens of milliseconds —
/// a slow reference that only catches up after a second would leave a note's
/// first second permanently lifted, which is not what "attack" means.
const SLOW_HZ: f32 = 4.0;
/// Decibels of gain at a full-scale onset when `attack` is 1: `attack = 0.5`
/// then moves the onset by about 3 dB. `attack = -1` is the mirror image.
const ATTACK_DB: f32 = 8.5;
/// The same for a falling envelope. The detector's excursion on a release is
/// only about a quarter of its excursion on an onset — the fast follower has
/// the slow one's tail to fall through — so the release needs a much larger
/// number of decibels per unit for `sustain = ±0.5` to land in the same
/// ±3 dB window as `attack = ±0.5`. Both branches stay bounded by
/// [`MAX_GAIN`], so the worst case is still a finite gain.
const SUSTAIN_DB: f32 = 22.0;
/// `log2(10) / 20`: converts decibels to the exponent of a base-2 power.
const DB_TO_LOG2: f32 = 0.166_096_2;
/// Hard ceiling on the gain, so no control combination can invert the signal.
const MAX_GAIN: f32 = 8.0;

/// Transient-shaper state, one per effect node.
#[derive(Clone, Copy)]
pub struct TransientShaper {
    /// Two-pole rectifier smoothing, per channel.
    rect: [[f32; 2]; 2],
    /// The fast envelope follower, per channel.
    fast: [f32; 2],
    /// The slow envelope follower, per channel.
    slow: [f32; 2],
}

impl TransientShaper {
    pub const fn new() -> Self {
        Self {
            rect: [[0.0; 2]; 2],
            fast: [0.0; 2],
            slow: [0.0; 2],
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Render the wet (shaped) signal into `out_*`; the caller crossfades.
    ///
    /// `inline(never)` for the same reason as the crusher: it is reached from
    /// two places inside the already enormous render loop.
    #[inline(never)]
    pub fn process(
        &mut self,
        in_l: &[f32],
        in_r: &[f32],
        out_l: &mut [f32],
        out_r: &mut [f32],
        frames: usize,
        params: TransientParams,
        sample_rate: f32,
    ) {
        let rect_coeff = one_pole(RECT_HZ, sample_rate);
        let fast_coeff = one_pole(FAST_HZ, sample_rate);
        let slow_coeff = one_pole(SLOW_HZ, sample_rate);
        let attack = params.attack_amt.clamp(-1.0, 1.0);
        let sustain = params.sustain_amt.clamp(-1.0, 1.0);
        // Both amounts at zero is a true identity: the gain below is exactly
        // `exp2(0) = 1` and the output is the input sample for sample.
        let neutral = attack == 0.0 && sustain == 0.0;
        for i in 0..frames {
            let raw = [in_l[i], in_r[i]];
            let mut wet = [0.0f32; 2];
            for ch in 0..2 {
                // Rectify and smooth first: the carrier ripple of a steady tone
                // has to be gone before the transient is taken, or a held note
                // would be gain-modulated at twice its own frequency.
                self.rect[ch][0] += rect_coeff * (raw[ch].abs() - self.rect[ch][0]);
                self.rect[ch][1] += rect_coeff * (self.rect[ch][0] - self.rect[ch][1]);
                let source = self.rect[ch][1];
                self.fast[ch] += fast_coeff * (source - self.fast[ch]);
                // The slow follower chases the fast one, not the rectified
                // signal: both reach the same value once the envelope settles,
                // so a held note has nothing to shift.
                self.slow[ch] += slow_coeff * (self.fast[ch] - self.slow[ch]);
                let fast = self.fast[ch];
                let slow = self.slow[ch];
                // The difference, normalised by the louder follower (so the
                // shaper is level independent) and bounded to ±1 by
                // construction. The floor keeps silence from dividing by zero:
                // with nothing to shape the gain stays exactly 1.
                let scale = 1.0 / fast.max(slow).max(1e-6);
                let db = if neutral {
                    0.0
                } else if fast > slow {
                    attack * (fast - slow) * scale * ATTACK_DB
                } else {
                    sustain * (fast - slow) * scale * SUSTAIN_DB
                };
                // `exp2` is a wasm instruction; `powf` would link libm.
                let gain = exp2(db * DB_TO_LOG2).clamp(0.0, MAX_GAIN);
                wet[ch] = raw[ch] * gain;
            }
            out_l[i] = wet[0];
            out_r[i] = wet[1];
        }
    }
}

/// The one-pole coefficient for a corner at `hz`.
fn one_pole(hz: f32, sample_rate: f32) -> f32 {
    (1.0 - (-TAU * hz / sample_rate).exp()).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::Engine;
    use crate::params::{id, FxKind, Wave, MOD_ROUTES};
    use std::sync::Mutex;

    const SR: f32 = 48_000.0;
    /// The oscillator's pitch control clamps at ±48 semitones around C4, so the
    /// rig plays from C6 (1046.5 Hz) instead: ±48 semitones lands on 65 Hz ..
    /// 16.7 kHz, which covers every frequency these tests measure.
    const BASE_HZ: f32 = 261.6256 * 4.0;

    static ENGINE_LOCK: Mutex<()> = Mutex::new(());

    fn lock_engine() -> std::sync::MutexGuard<'static, ()> {
        ENGINE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Single-bin magnitude with a Hann window (the measurement the rest of the
    /// DSP tests use).
    fn bin_mag(samples: &[f32], freq: f32, sr: f32) -> f32 {
        let n = samples.len();
        let w = core::f32::consts::TAU as f64 * freq as f64 / sr as f64;
        let (mut re, mut im) = (0.0f64, 0.0f64);
        for (i, x) in samples.iter().enumerate() {
            let win = 0.5 - 0.5 * (core::f32::consts::TAU as f64 * i as f64 / n as f64).cos();
            let v = *x as f64 * win;
            re += v * (w * i as f64).cos();
            im -= v * (w * i as f64).sin();
        }
        ((re * re + im * im).sqrt() / n as f64) as f32 * 2.0
    }

    fn db(ratio: f32) -> f32 {
        20.0 * ratio.max(1e-12).log10()
    }

    fn first_difference(a: &[f32], b: &[f32]) -> Option<usize> {
        if a.len() != b.len() {
            return Some(a.len().min(b.len()));
        }
        a.iter().zip(b).position(|(x, y)| x != y)
    }

    fn sine(freq: f32, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (TAU * freq * i as f32 / SR).sin())
            .collect()
    }

    /// A pure-DSP gain measurement: run `n` samples of a sine through a fresh
    /// state block and compare the settled output bin with the input bin.
    fn dsp_gain(freq: f32, mut run: impl FnMut(&[f32], &mut [f32])) -> f32 {
        let n = 8192;
        let input = sine(freq, n);
        let mut out = vec![0.0f32; n];
        run(&input, &mut out);
        // The first half is transient; measure the second.
        let settled = &out[n / 2..];
        let reference = bin_mag(&input[n / 2..], freq, SR);
        bin_mag(settled, freq, SR) / reference
    }

    // ------------------------------------------------------------ bit-crusher

    #[test]
    fn bit_depth_sets_the_quantisation_step() {
        // A full-scale ramp with no anti-aliasing and no divider. Two things
        // pin the depth: every output sits on the `2 / (2^bits - 1)` grid, and
        // the error against the input never exceeds half a step. The ramp is
        // long enough (2^17) that at 16 bits it still moves by less than one
        // quantum per sample — otherwise the grid check would be measuring the
        // ramp's own resolution.
        for bits in [4.0f32, 6.0, 8.0, 12.0, 16.0] {
            let n = 1 << 17;
            let input: Vec<f32> = (0..n).map(|i| -1.0 + 2.0 * i as f32 / (n - 1) as f32).collect();
            let mut out = vec![0.0f32; n];
            let mut out_r = vec![0.0f32; n];
            BitCrusher::new().process(
                &input,
                &input,
                &mut out,
                &mut out_r,
                n,
                CrushParams { bits, down: 1.0, aa: 0.0 },
                SR,
            );
            let step = 2.0 / 2.0f32.powf(bits);
            let mut worst_grid = 0.0f32;
            let mut worst_error = 0.0f32;
            for (&x, &y) in input.iter().zip(&out).skip(64) {
                let grid = y / step;
                worst_grid = worst_grid.max((grid - grid.round()).abs());
                worst_error = worst_error.max((y - x).abs());
            }
            assert!(
                worst_grid < 1e-2,
                "{bits} bits: an output is {worst_grid} of a step off the {step} grid"
            );
            assert!(
                worst_error <= step * 0.5 + step * 1e-3,
                "{bits} bits: error {worst_error} exceeds half a step ({})",
                step * 0.5
            );
        }
    }

    #[test]
    fn divisor_and_anti_alias_move_the_mirror() {
        // Two different artefacts come out of the divider:
        //   * the sample-and-hold's *image* of an in-band tone, at sr/down - f
        //     (1 kHz becomes 5 kHz at down = 8), which the interpolation filter
        //     removes;
        //   * true *aliasing* of a tone above the decimated Nyquist: 8 kHz folds
        //     to 6 kHz - 8 kHz = -2 kHz, i.e. 2 kHz, which the pre-filter
        //     removes.
        // The reference is the same tone with no divider at all, so every
        // number below is a level relative to the input, not to whatever the
        // crusher happens to leave at the input frequency (an 8 kHz tone
        // divided by 8 is *gone* at 8 kHz, so a per-run tone reference would
        // divide by nothing).
        let reference = |freq: f32| {
            let n = 8192;
            let input = sine(freq, n);
            let mut out = vec![0.0f32; n];
            let mut out_r = vec![0.0f32; n];
            BitCrusher::new().process(
                &input,
                &input,
                &mut out,
                &mut out_r,
                n,
                CrushParams { bits: 16.0, down: 1.0, aa: 0.0 },
                SR,
            );
            bin_mag(&out[n / 2..], freq, SR)
        };
        let level = |freq: f32, probe: f32, down: f32, aa: f32| {
            let n = 8192;
            let input = sine(freq, n);
            let mut out = vec![0.0f32; n];
            let mut out_r = vec![0.0f32; n];
            BitCrusher::new().process(
                &input,
                &input,
                &mut out,
                &mut out_r,
                n,
                CrushParams { bits: 8.0, down, aa },
                SR,
            );
            db(bin_mag(&out[n / 2..], probe, SR) / reference(freq))
        };
        // No divider: neither artefact is there.
        let no_divisor = level(1000.0, 5000.0, 1.0, 0.0);
        assert!(
            no_divisor < -40.0,
            "down = 1 still mirrors at {no_divisor:.1} dB"
        );
        // The divider's image, with and without anti-aliasing.
        let raw_image = level(1000.0, 5000.0, 8.0, 0.0);
        let smooth_image = level(1000.0, 5000.0, 8.0, 1.0);
        assert!(
            raw_image > -30.0,
            "the divider's image is only {raw_image:.1} dB down"
        );
        assert!(
            raw_image - smooth_image > 12.0,
            "anti-aliasing removed only {:.1} dB of image",
            raw_image - smooth_image
        );
        // True aliasing: an 8 kHz tone is above the 3 kHz decimated Nyquist.
        let raw_alias = level(8000.0, 2000.0, 8.0, 0.0);
        let smooth_alias = level(8000.0, 2000.0, 8.0, 1.0);
        assert!(
            raw_alias > -30.0,
            "the folded 8 kHz tone is only {raw_alias:.1} dB down"
        );
        assert!(
            raw_alias - smooth_alias > 12.0,
            "anti-aliasing removed only {:.1} dB of aliasing",
            raw_alias - smooth_alias
        );
    }

    #[test]
    fn deeper_divisors_push_the_mirror_lower_in_level_and_frequency() {
        let freq = 700.0f32;
        let measure = |down: f32| {
            let n = 8192;
            let input = sine(freq, n);
            let mut out = vec![0.0f32; n];
            let mut out_r = vec![0.0f32; n];
            BitCrusher::new().process(
                &input,
                &input,
                &mut out,
                &mut out_r,
                n,
                CrushParams { bits: 16.0, down, aa: 0.0 },
                SR,
            );
            let fold = 48_000.0 / down - freq;
            let tone = bin_mag(&out[n / 2..], freq, SR);
            (fold, db(bin_mag(&out[n / 2..], fold, SR) / tone))
        };
        // The mirror sits at sr/down - f, and it is there for every divisor
        // above one.
        for down in [2.0f32, 4.0, 8.0, 16.0] {
            let (fold, level) = measure(down);
            assert!(
                (fold - (48_000.0 / down - freq)).abs() < 1.0,
                "down {down}: fold at {fold}"
            );
            assert!(level > -40.0, "down {down}: no mirror found ({level:.1} dB)");
        }
    }

    // ---------------------------------------------------------------- shaping EQ

    fn eq_gain(freq: f32, params: EqParams) -> f32 {
        dsp_gain(freq, |input, out| {
            let zeros = vec![0.0f32; input.len()];
            ShapingEq::new().process(input, &zeros, out, &mut vec![0.0; input.len()], input.len(), params, SR);
        })
    }

    fn flat_eq() -> EqParams {
        EqParams {
            low_gain: 0.0,
            low_freq: 200.0,
            mid_gain: 0.0,
            mid_freq: 1000.0,
            mid_q: 0.9,
            high_gain: 0.0,
            high_freq: 4000.0,
        }
    }

    #[test]
    fn eq_flat_is_unity() {
        // Every band at 0 dB is an identity, so the whole section must not
        // colour the signal at all.
        for freq in [65.0f32, 200.0, 1000.0, 4000.0, 12000.0] {
            let gain = db(eq_gain(freq, flat_eq()));
            assert!(gain.abs() < 0.05, "flat EQ {freq} Hz: {gain:.3} dB");
        }
    }

    #[test]
    fn eq_band_gains_match_the_cookbook() {
        // A shelf reaches its *full* gain at the far end and half of it (in dB)
        // at the corner, so the gain is measured well away from the corner.
        let low = db(eq_gain(65.0, EqParams { low_gain: 12.0, low_freq: 400.0, ..flat_eq() }));
        assert!((low - 12.0).abs() < 1.0, "low shelf end: {low:.2} dB");
        let corner = db(eq_gain(400.0, EqParams { low_gain: 12.0, low_freq: 400.0, ..flat_eq() }));
        assert!((corner - 6.0).abs() < 1.0, "low shelf corner: {corner:.2} dB");
        // A peaking band is exact at its centre.
        let mid = db(eq_gain(1000.0, EqParams { mid_gain: -9.0, mid_freq: 1000.0, ..flat_eq() }));
        assert!((mid + 9.0).abs() < 0.5, "mid peak centre: {mid:.2} dB");
        let high = db(eq_gain(16000.0, EqParams { high_gain: 9.0, high_freq: 3000.0, ..flat_eq() }));
        assert!((high - 9.0).abs() < 1.0, "high shelf end: {high:.2} dB");
        // Off-centre, a peaking band has fallen back towards unity.
        let away = db(eq_gain(4000.0, EqParams { mid_gain: 9.0, mid_freq: 1000.0, mid_q: 1.0, ..flat_eq() }));
        assert!(away < 1.0, "mid peak two octaves away: {away:.2} dB");
    }

    #[test]
    fn eq_shelves_reach_their_gain_at_the_ends_and_slope_back() {
        let params = EqParams { low_gain: 12.0, low_freq: 400.0, ..flat_eq() };
        let bottom = db(eq_gain(65.0, params));
        let corner = db(eq_gain(400.0, params));
        let above = db(eq_gain(3200.0, params));
        let top = db(eq_gain(16000.0, params));
        assert!((bottom - 12.0).abs() < 1.0, "low shelf at 65 Hz: {bottom:.2} dB");
        assert!((top).abs() < 1.0, "low shelf at 16 kHz: {top:.2} dB");
        // A shelf, not a peak: it is monotone on the way down and the corner
        // sits near the half-gain point.
        assert!(
            bottom > corner && corner > above && above > top,
            "low shelf is not monotone: {bottom:.2} {corner:.2} {above:.2} {top:.2}"
        );
        assert!(
            (corner - 6.0).abs() < 1.5,
            "the low shelf's corner should sit near half gain: {corner:.2} dB"
        );
        assert!(
            bottom - above > 6.0,
            "the low shelf only fell {:.2} dB over three octaves",
            bottom - above
        );
        // The high shelf mirrors it.
        let params = EqParams { high_gain: -12.0, high_freq: 3000.0, ..flat_eq() };
        let low_end = db(eq_gain(65.0, params));
        let high_end = db(eq_gain(16000.0, params));
        assert!((low_end).abs() < 1.0, "high shelf at 65 Hz: {low_end:.2} dB");
        assert!((high_end + 12.0).abs() < 1.0, "high shelf at 16 kHz: {high_end:.2} dB");
    }

    // ----------------------------------------------------- through the engine

    /// A fresh engine with slot 1 holding `kind` (or nothing), the oscillators
    /// and filter parked so only the effect is under test, and the default
    /// ENV/LFO -> CUTOFF routes cleared.
    fn new_rig(kind: Option<FxKind>, freq: f32) -> Box<Engine> {
        let mut e = Box::new(Engine::new());
        e.init(SR, 16);
        e.set_param(id::OSC1_WAVE, Wave::Sine as u32 as f32);
        // Loud enough that a 4-bit crusher still has several levels to work
        // with: at the default 0.3 the whole tone rounds to zero at 4 bits.
        e.set_param(id::OSC1_LEVEL, 1.0);
        e.set_param(id::OSC2_ON, 0.0);
        e.set_param(id::OSC2_LEVEL, 0.0);
        e.set_param(id::OSC_FM, 0.0);
        e.set_param(id::OSC_RING, 0.0);
        e.set_param(id::OSC1_SYNC, 0.0);
        e.set_param(id::OSC1_SUB, 0.0);
        e.set_param(id::NOISE_MIX, 0.0);
        e.set_param(id::FILTER_TYPE, 0.0);
        e.set_param(id::FILTER_CUTOFF, 18_000.0);
        e.set_param(id::FILTER_RES, 0.05);
        e.set_param(id::FILTER_DRIVE, 0.0);
        e.set_param(id::FILTER_ENV_AMT, 0.0);
        e.set_param(id::FILTER_KBD, 0.0);
        e.set_param(id::FILTER_ROUTING, 0.0);
        e.set_param(id::ENV_ATTACK, 0.001);
        e.set_param(id::ENV_DECAY, 0.2);
        e.set_param(id::ENV_SUSTAIN, 1.0);
        e.set_param(id::LFO_ON, 0.0);
        e.set_param(id::LFO2_ON, 0.0);
        for on in [
            id::FX_REVERB_ON,
            id::FX_DELAY_ON,
            id::FX_CHORUS_ON,
            id::FX_FLANGER_ON,
            id::FX_PHASER_ON,
            id::FX_DRIVE_ON,
        ] {
            e.set_param(on, 0.0);
        }
        // Only slot 1 runs, and it runs the effect under test.
        let code = match kind {
            Some(FxKind::Crush) => 7.0,
            Some(FxKind::Eq) => 8.0,
            Some(FxKind::Transient) => 9.0,
            _ => 0.0,
        };
        for slot in 0..crate::params::FX_SLOTS {
            e.set_param(id::FX_CHAIN1 + slot as u32, if slot == 0 { code } else { 0.0 });
        }
        let semis = 12.0 * (freq / BASE_HZ).log2();
        assert!(semis.abs() <= 48.0, "test frequency {freq} Hz is out of range");
        e.set_param(id::OSC1_PITCH, semis);
        // The default patch's ENV/LFO -> CUTOFF routes are live; a response
        // measured with them on is a measurement of the modulation.
        for index in 0..MOD_ROUTES {
            e.set_route(index, 0, 0, 0.0, false);
        }
        e
    }

    /// Build, start the note and render in one go. The C DSP keeps
    /// process-wide oscillator state, so an engine that is built now and
    /// rendered after another engine has run would start from a different
    /// phase; doing both here is what makes two renders comparable.
    fn render_slot(kind: Option<FxKind>, freq: f32, params: &[(u32, f32)], blocks: usize) -> Vec<f32> {
        let mut e = new_rig(kind, freq);
        e.note_on(84, 1.0);
        for (param, value) in params {
            e.set_param(*param, *value);
        }
        for _ in 0..48 {
            e.process(128);
        }
        let mut out = Vec::with_capacity(blocks * 128);
        for _ in 0..blocks {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        out
    }

    /// The gain the effect applies at `freq`, against the same engine with the
    /// slot empty.
    fn slot_gain_db(freq: f32, kind: FxKind, params: &[(u32, f32)]) -> f32 {
        let dry = bin_mag(&render_slot(None, freq, &[], 64), freq, SR);
        let wet = bin_mag(&render_slot(Some(kind), freq, params, 64), freq, SR);
        db(wet / dry)
    }

    /// The magnitude at `probe_hz`, relative to the same tone with the slot
    /// empty. Used for the crusher's mirror, which is not at the input
    /// frequency.
    fn slot_relative(freq: f32, probe_hz: f32, kind: FxKind, params: &[(u32, f32)]) -> f32 {
        let dry = bin_mag(&render_slot(None, freq, &[], 64), freq, SR);
        let wet = bin_mag(&render_slot(Some(kind), freq, params, 64), probe_hz, SR);
        db(wet / dry)
    }

    #[test]
    fn engine_dry_path_is_bit_exact_when_the_mix_is_zero() {
        let _guard = lock_engine();
        let reference = render_slot(None, 1000.0, &[], 64);
        let crushed = render_slot(
            Some(FxKind::Crush),
            1000.0,
            &[
                (id::FX_CRUSH_ON, 1.0),
                (id::FX_CRUSH_MIX, 0.0),
                (id::FX_CRUSH_BITS, 4.0),
                (id::FX_CRUSH_DOWN, 16.0),
            ],
            64,
        );
        let equalised = render_slot(
            Some(FxKind::Eq),
            1000.0,
            &[
                (id::FX_EQ_ON, 1.0),
                (id::FX_EQ_MIX, 0.0),
                (id::FX_EQ_MID_GAIN, 12.0),
            ],
            64,
        );
        assert!(
            first_difference(&reference, &crushed).is_none(),
            "crush mix = 0 is not a bypass (first difference at {:?})",
            first_difference(&reference, &crushed)
        );
        assert!(
            first_difference(&reference, &equalised).is_none(),
            "eq mix = 0 is not a bypass (first difference at {:?})",
            first_difference(&reference, &equalised)
        );
        // The transient shaper with the mix at 0, and also the *neutral* shaper
        // (mix 1, both amounts 0): both have to be bit-for-bit the empty slot.
        let shaped = render_slot(
            Some(FxKind::Transient),
            1000.0,
            &[
                (id::FX_TRANSIENT_ON, 1.0),
                (id::FX_TRANSIENT_MIX, 0.0),
                (id::FX_TRANSIENT_ATTACK, 1.0),
                (id::FX_TRANSIENT_SUSTAIN, -1.0),
            ],
            64,
        );
        assert!(
            first_difference(&reference, &shaped).is_none(),
            "transient mix = 0 is not a bypass (first difference at {:?})",
            first_difference(&reference, &shaped)
        );
        let neutral = render_slot(
            Some(FxKind::Transient),
            1000.0,
            &[
                (id::FX_TRANSIENT_ON, 1.0),
                (id::FX_TRANSIENT_MIX, 1.0),
                (id::FX_TRANSIENT_ATTACK, 0.0),
                (id::FX_TRANSIENT_SUSTAIN, 0.0),
            ],
            64,
        );
        assert!(
            first_difference(&reference, &neutral).is_none(),
            "a neutral transient shaper is not an identity (first difference at {:?})",
            first_difference(&reference, &neutral)
        );
    }

    // -------------------------------------------------------- transient shaper

    /// Render a note from silence, block by block, without the warm-up skip the
    /// other rigs use — for the onset there is nothing to warm up, the first
    /// block *is* the measurement. The parameter callbacks run before the note
    /// starts, so the smoothed amounts have arrived by the time it does.
    fn render_onset(params: &[(u32, f32)], blocks: usize) -> Vec<f32> {
        let mut e = new_rig(Some(FxKind::Transient), 1000.0);
        for (param, value) in params {
            e.set_param(*param, *value);
        }
        e.note_on(84, 1.0);
        let mut out = Vec::with_capacity(blocks * 128);
        for _ in 0..blocks {
            e.process(128);
            out.extend_from_slice(&e.left()[..128]);
        }
        out
    }

    /// The transient shaper's gain over a block range, against the same run
    /// with a neutral shaper, as dB.
    fn transient_window_gain(params: &[(u32, f32)], from: usize, to: usize) -> f32 {
        let base = [(id::FX_TRANSIENT_ON, 1.0), (id::FX_TRANSIENT_MIX, 1.0)];
        let wet_params: Vec<(u32, f32)> = base.iter().copied().chain(params.iter().copied()).collect();
        let wet = render_onset(&wet_params, to);
        let dry = render_onset(&base, to);
        let rms = |samples: &[f32]| {
            let slice = &samples[from * 128..to * 128];
            (slice.iter().map(|v| v * v).sum::<f32>() / slice.len() as f32).sqrt()
        };
        db(rms(&wet) / rms(&dry))
    }

    #[test]
    fn engine_transient_attack_moves_the_onset() {
        let _guard = lock_engine();
        // Blocks 2..8 are the note's onset: the fast envelope has left the slow
        // one behind and the gain is at its highest.
        let loud = transient_window_gain(&[(id::FX_TRANSIENT_ATTACK, 0.5)], 2, 8);
        let quiet = transient_window_gain(&[(id::FX_TRANSIENT_ATTACK, -0.5)], 2, 8);
        assert!(
            (loud - 3.0).abs() <= 1.0,
            "attack = +0.5 lifted the onset by {loud:.2} dB, not about 3"
        );
        assert!(
            (quiet + 3.0).abs() <= 1.0,
            "attack = -0.5 cut the onset by {quiet:.2} dB, not about -3"
        );
        // The settled tail is not the onset: an attack-only setting must leave
        // it much closer to unity than the onset was.
        let tail = transient_window_gain(&[(id::FX_TRANSIENT_ATTACK, 0.5)], 40, 56);
        assert!(
            tail.abs() < 1.0,
            "attack = +0.5 moved the settled tail by {tail:.2} dB"
        );
    }

    #[test]
    fn engine_transient_sustain_moves_the_release() {
        let _guard = lock_engine();
        // The release is the other half: render a held note, let go of it, and
        // measure the falling tail, where the fast follower has dropped below
        // the slow one.
        let tail = |params: &[(u32, f32)]| {
            let base = [(id::FX_TRANSIENT_ON, 1.0), (id::FX_TRANSIENT_MIX, 1.0)];
            let mut e = new_rig(Some(FxKind::Transient), 1000.0);
            for (param, value) in base.iter().chain(params.iter()) {
                e.set_param(*param, *value);
            }
            e.note_on(84, 1.0);
            for _ in 0..48 {
                e.process(128);
            }
            e.note_off(84);
            let mut energy = 0.0f32;
            let mut count = 0usize;
            for block in 0..24 {
                e.process(128);
                // Skip the first few blocks: the envelope release takes a
                // moment to develop enough to be the dominant term.
                if block < 4 {
                    continue;
                }
                for &v in &e.left()[..128] {
                    energy += v * v;
                    count += 1;
                }
            }
            energy / count as f32
        };
        let neutral = tail(&[]);
        let shortened = tail(&[(id::FX_TRANSIENT_SUSTAIN, 0.5)]);
        let lengthened = tail(&[(id::FX_TRANSIENT_SUSTAIN, -0.5)]);
        let short_db = db((shortened / neutral).sqrt());
        let long_db = db((lengthened / neutral).sqrt());
        assert!(
            (short_db + 3.0).abs() <= 1.0,
            "sustain = +0.5 took {short_db:.2} dB off the release, not about -3"
        );
        assert!(
            (long_db - 3.0).abs() <= 1.0,
            "sustain = -0.5 added {long_db:.2} dB to the release, not about +3"
        );
    }

    #[test]
    fn engine_transient_is_harmonically_clean() {
        let _guard = lock_engine();
        // A held sine, with the shaper on but neutral: the detector must have
        // settled and the gain must be exactly 1, so the tone's harmonic
        // content cannot change. (This is the engine-level version of the
        // `neutral` bit-for-bit check above, measured where the gate measures.)
        let freq = 1000.0f32;
        let base = [(id::FX_TRANSIENT_ON, 1.0), (id::FX_TRANSIENT_MIX, 1.0)];
        let harmonic = |extra: &[(u32, f32)]| {
            let mut params = base.to_vec();
            params.extend_from_slice(extra);
            let out = render_slot(Some(FxKind::Transient), freq, &params, 64);
            let fund = bin_mag(&out, freq, SR);
            let mut rest = 0.0f32;
            let mut k = 2;
            while (freq * k as f32) < SR * 0.5 {
                rest += bin_mag(&out, freq * k as f32, SR).powi(2);
                k += 1;
            }
            (rest.sqrt() / fund) * 100.0
        };
        let off = harmonic(&[]);
        let neutral = harmonic(&[
            (id::FX_TRANSIENT_ATTACK, 0.0),
            (id::FX_TRANSIENT_SUSTAIN, 0.0),
        ]);
        // A setting that is *not* neutral, but has long since settled: the gain
        // is a constant by then, so it is still a clean gain on the tone.
        let active = harmonic(&[
            (id::FX_TRANSIENT_ATTACK, 0.5),
            (id::FX_TRANSIENT_SUSTAIN, -0.5),
        ]);
        assert!(
            neutral - off <= 0.5,
            "a neutral shaper added {:.3} points of THD",
            neutral - off
        );
        println!("NUM thd off {off:.5}% neutral {neutral:.5}% active {active:.5}%");
        assert!(
            active - off <= 0.5,
            "an active shaper added {:.3} points of THD on a held tone",
            active - off
        );
    }

    #[test]
    fn engine_crush_quantises_and_mirrors() {
        let _guard = lock_engine();
        let base = [
            (id::FX_CRUSH_ON, 1.0),
            (id::FX_CRUSH_MIX, 1.0),
            (id::FX_CRUSH_AA, 0.0),
            (id::FX_CRUSH_DOWN, 1.0),
        ];
        let with_bits = |bits: f32| {
            let mut params = base.to_vec();
            params.push((id::FX_CRUSH_BITS, bits));
            params
        };
        // 16 bits is transparent to within the noise floor; 4 bits is not.
        let fine = slot_gain_db(1000.0, FxKind::Crush, &with_bits(16.0));
        let coarse = slot_gain_db(1000.0, FxKind::Crush, &with_bits(4.0));
        assert!(fine.abs() < 0.5, "16-bit crusher changed the level by {fine:.2} dB");
        assert!(
            coarse > -6.0 && coarse < 6.0,
            "4-bit crusher changed the level by {coarse:.2} dB"
        );
        // The divisor puts a mirror at sr/down - f, and it is far weaker with
        // the anti-alias control in.
        let fold = SR / 8.0 - 1000.0;
        let mirror = |aa: f32| {
            let mut params = with_bits(8.0);
            params.retain(|(param, _)| *param != id::FX_CRUSH_DOWN);
            params.push((id::FX_CRUSH_DOWN, 8.0));
            params.push((id::FX_CRUSH_AA, aa));
            slot_relative(1000.0, fold, FxKind::Crush, &params)
        };
        let raw = mirror(0.0);
        let smooth = mirror(1.0);
        assert!(raw > -30.0, "the engine's crusher mirror is {raw:.1} dB down");
        assert!(
            raw - smooth > 10.0,
            "anti-aliasing only removed {:.1} dB in the engine",
            raw - smooth
        );
    }

    #[test]
    fn engine_eq_bands_match_their_gain() {
        let _guard = lock_engine();
        let base = [(id::FX_EQ_ON, 1.0), (id::FX_EQ_MIX, 1.0)];
        let params = |extra: &[(u32, f32)]| {
            let mut all = base.to_vec();
            all.extend_from_slice(extra);
            all
        };
        // Low shelf: the corner is the half-gain point, so the gain is measured
        // an octave and a half below it.
        let low = slot_gain_db(
            100.0,
            FxKind::Eq,
            &params(&[
                (id::FX_EQ_LOW_GAIN, 12.0),
                (id::FX_EQ_LOW_FREQ, 300.0),
                (id::FX_EQ_MID_GAIN, 0.0),
                (id::FX_EQ_HIGH_GAIN, 0.0),
            ]),
        );
        assert!((low - 12.0).abs() < 1.5, "low shelf at 100 Hz: {low:.2} dB");
        // Mid peak, measured at its centre and an octave up.
        let mid_params = |gain: f32| {
            params(&[
                (id::FX_EQ_MID_GAIN, gain),
                (id::FX_EQ_MID_FREQ, 1000.0),
                (id::FX_EQ_MID_Q, 1.2),
            ])
        };
        let mid = slot_gain_db(1000.0, FxKind::Eq, &mid_params(-9.0));
        let away = slot_gain_db(2000.0, FxKind::Eq, &mid_params(-9.0));
        assert!((mid + 9.0).abs() < 1.5, "mid peak centre: {mid:.2} dB");
        assert!(away > mid + 3.0, "the mid peak does not fall away: {away:.2} dB");
        // High shelf.
        let high = slot_gain_db(
            16000.0,
            FxKind::Eq,
            &params(&[(id::FX_EQ_HIGH_GAIN, 9.0), (id::FX_EQ_HIGH_FREQ, 3000.0)]),
        );
        assert!((high - 9.0).abs() < 1.5, "high shelf at 16 kHz: {high:.2} dB");
    }

    #[test]
    fn abrupt_changes_stay_bounded_and_finite() {
        let _guard = lock_engine();
        for kind in [FxKind::Crush, FxKind::Eq, FxKind::Transient] {
            let mut e = new_rig(Some(kind), 1000.0);
            e.note_on(84, 1.0);
            let on = match kind {
                FxKind::Crush => id::FX_CRUSH_ON,
                FxKind::Eq => id::FX_EQ_ON,
                _ => id::FX_TRANSIENT_ON,
            };
            let mix = match kind {
                FxKind::Crush => id::FX_CRUSH_MIX,
                FxKind::Eq => id::FX_EQ_MIX,
                _ => id::FX_TRANSIENT_MIX,
            };
            e.set_param(on, 1.0);
            e.set_param(mix, 1.0);
            e.set_param(id::FX_CRUSH_BITS, 4.0);
            e.set_param(id::FX_CRUSH_DOWN, 32.0);
            e.set_param(id::FX_EQ_LOW_GAIN, 18.0);
            e.set_param(id::FX_EQ_MID_GAIN, -18.0);
            e.set_param(id::FX_EQ_HIGH_GAIN, 18.0);
            let mut previous = 0.0f32;
            let mut peak = 0.0f32;
            let mut step = 0.0f32;
            for block in 0..400 {
                // Slam the continuous controls while it renders. The on/off
                // switch is left alone: it is the one stepped control, and the
                // point here is that the *smoothed* path never clicks.
                e.set_param(id::FX_CRUSH_BITS, 4.0 + (block % 13) as f32);
                e.set_param(id::FX_CRUSH_DOWN, 1.0 + (block % 64) as f32);
                e.set_param(id::FX_CRUSH_AA, (block % 11) as f32 / 10.0);
                e.set_param(mix, if (block / 20) % 2 == 1 { 1.0 } else { 0.0 });
                let gain = ((block % 37) as f32 - 18.0).clamp(-18.0, 18.0);
                e.set_param(id::FX_EQ_LOW_GAIN, gain);
                e.set_param(id::FX_EQ_MID_GAIN, -gain);
                e.set_param(id::FX_EQ_HIGH_GAIN, gain);
                e.set_param(id::FX_EQ_MID_FREQ, 200.0 + (block % 40) as f32 * 195.0);
                // The transient shaper's three continuous controls, slammed the
                // same way. `mix` above is the same-named parameter of whichever
                // effect this iteration is running.
                e.set_param(id::FX_TRANSIENT_ATTACK, (block % 41) as f32 / 20.0 - 1.0);
                e.set_param(id::FX_TRANSIENT_SUSTAIN, 1.0 - (block % 41) as f32 / 20.0);
                e.set_param(id::FX_TRANSIENT_MIX, if (block / 20) % 2 == 1 { 1.0 } else { 0.0 });
                e.process(128);
                for &sample in e.left() {
                    assert!(sample.is_finite(), "{kind:?}: non-finite sample at block {block}");
                    peak = peak.max(sample.abs());
                    step = step.max((sample - previous).abs());
                    previous = sample;
                }
            }
            assert!(peak <= 1.0, "{kind:?}: peak {peak:.3} exceeded full scale");
            assert!(step < 0.5, "{kind:?}: largest sample step was {step:.3}");
        }
    }
}
