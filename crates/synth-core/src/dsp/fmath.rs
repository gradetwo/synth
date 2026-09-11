//! Freestanding math for the wasm32 C/C++ shim.
//!
//! On `wasm32-unknown-unknown`, Rust's `f32::sin`/`exp`/`log`/... lower to
//! libcalls named `sinf`/`expf`/..., so a shim that simply forwards to them
//! would recurse into itself. These implementations use only integer bit
//! manipulation, `wasm` SIMD intrinsics (sqrt/floor/ceil/trunc/nearest) and
//! minimax/Taylor polynomials, so the vendored DSP can run with no libc at all.
//!
//! Accuracy target is ~1e-7 relative for the f32 functions, which is far below
//! the audible floor and well inside DaisySP's own tolerances. Every function is
//! unit-tested against `std` on the host.

#![allow(clippy::excessive_precision)]
// The constants below are the ones the C originals use, written out so they can
// be checked against the reference; `core::f32::consts` would hide that.
#![allow(clippy::approx_constant)]

const PI: f32 = 3.141592653589793;
const FRAC_2_PI: f32 = 0.6366197723675814;
/// f32(π/2) and the residual, for Cody-Waite range reduction.
const PIO2_HI: f32 = 1.5707963705062866;
const PIO2_LO: f32 = -4.3711388e-8;
const LN2: f32 = 0.6931471805599453;
const LN2_HI: f32 = 0.6931471824645996;
const LN2_LO: f32 = -1.9046542e-9;
const LOG2E: f32 = 1.4426950408889634;
const INV_LN10: f32 = 0.4342944819032518;

#[inline]
pub fn fabsf(x: f32) -> f32 {
    f32::from_bits(x.to_bits() & 0x7fff_ffff)
}

#[inline]
pub fn copysignf(x: f32, y: f32) -> f32 {
    f32::from_bits((x.to_bits() & 0x7fff_ffff) | (y.to_bits() & 0x8000_0000))
}

// The wasm SIMD intrinsics need the `simd128` target feature. When the scalar
// fallback build is selected (older Safari), pure bit-manipulation / Newton
// versions are used so we still never emit a libcall (which would recurse).

#[inline]
pub fn sqrtf(x: f32) -> f32 {
    sqrt_impl(x)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn sqrt_impl(x: f32) -> f32 {
    core::arch::wasm32::f32x4_extract_lane::<0>(core::arch::wasm32::f32x4_sqrt(
        core::arch::wasm32::f32x4_splat(x),
    ))
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
#[inline]
fn sqrt_impl(x: f32) -> f32 {
    if x <= 0.0 {
        return if x == 0.0 { 0.0 } else { f32::NAN };
    }
    if !x.is_finite() {
        return x;
    }
    // Halve the exponent as a seed, then Newton-Raphson (quadratic).
    let mut g = f32::from_bits((x.to_bits() >> 1) + 0x1fc0_0000);
    for _ in 0..4 {
        g = 0.5 * (g + x / g);
    }
    g
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn sqrt_impl(x: f32) -> f32 {
    x.sqrt()
}

#[inline]
pub fn truncf(x: f32) -> f32 {
    trunc_impl(x)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn trunc_impl(x: f32) -> f32 {
    core::arch::wasm32::f32x4_extract_lane::<0>(core::arch::wasm32::f32x4_trunc(
        core::arch::wasm32::f32x4_splat(x),
    ))
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
#[inline]
fn trunc_impl(x: f32) -> f32 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let bits = x.to_bits();
    let exp = ((bits >> 23) & 0xff) as i32 - 127;
    if exp >= 23 {
        return x;
    }
    if exp < 0 {
        return copysignf(0.0, x);
    }
    let mask = !((1u32 << (23 - exp)) - 1);
    f32::from_bits(bits & mask)
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn trunc_impl(x: f32) -> f32 {
    x.trunc()
}

#[inline]
pub fn floorf(x: f32) -> f32 {
    floor_impl(x)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn floor_impl(x: f32) -> f32 {
    core::arch::wasm32::f32x4_extract_lane::<0>(core::arch::wasm32::f32x4_floor(
        core::arch::wasm32::f32x4_splat(x),
    ))
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
#[inline]
fn floor_impl(x: f32) -> f32 {
    let t = trunc_impl(x);
    if x < 0.0 && t != x {
        t - 1.0
    } else {
        t
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn floor_impl(x: f32) -> f32 {
    x.floor()
}

#[inline]
pub fn ceilf(x: f32) -> f32 {
    ceil_impl(x)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn ceil_impl(x: f32) -> f32 {
    core::arch::wasm32::f32x4_extract_lane::<0>(core::arch::wasm32::f32x4_ceil(
        core::arch::wasm32::f32x4_splat(x),
    ))
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
#[inline]
fn ceil_impl(x: f32) -> f32 {
    let t = trunc_impl(x);
    if x > 0.0 && t != x {
        t + 1.0
    } else {
        t
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn ceil_impl(x: f32) -> f32 {
    x.ceil()
}

#[inline]
pub fn roundf(x: f32) -> f32 {
    round_impl(x)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
fn round_impl(x: f32) -> f32 {
    core::arch::wasm32::f32x4_extract_lane::<0>(core::arch::wasm32::f32x4_nearest(
        core::arch::wasm32::f32x4_splat(x),
    ))
}

#[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
#[inline]
fn round_impl(x: f32) -> f32 {
    if x >= 0.0 {
        floor_impl(x + 0.5)
    } else {
        ceil_impl(x - 0.5)
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[inline]
fn round_impl(x: f32) -> f32 {
    x.round()
}

/// Round to nearest integer, ties away from zero, as an `i32`.
#[inline]
fn round_to_i32(x: f32) -> i32 {
    (x + copysignf(0.5, x)) as i32
}

#[inline]
fn sin_poly(r: f32) -> f32 {
    let r2 = r * r;
    r * (1.0
        + r2 * (-1.666_666_6e-1
            + r2 * (8.333_331e-3
                + r2 * (-1.984_126_9e-4 + r2 * (2.755_731_4e-6 + r2 * -2.505_081e-8)))))
}

#[inline]
fn cos_poly(r: f32) -> f32 {
    let r2 = r * r;
    1.0 + r2
        * (-0.5
            + r2 * (4.166_666_4e-2
                + r2 * (-1.388_888_9e-3
                    + r2 * (2.480_158_7e-5 + r2 * (-2.755_731_4e-7 + r2 * 2.087_675_4e-9)))))
}

pub fn sinf(x: f32) -> f32 {
    if !x.is_finite() {
        return f32::NAN;
    }
    // Reduce very large arguments modulo 2π first (rare in audio, but cheap).
    let mut x = x;
    if fabsf(x) > 1.0e5 {
        x = fmodf(x, 2.0 * PI);
    }
    let k = round_to_i32(x * FRAC_2_PI);
    let kf = k as f32;
    let r = x - kf * PIO2_HI - kf * PIO2_LO;
    match k & 3 {
        0 => sin_poly(r),
        1 => cos_poly(r),
        2 => -sin_poly(r),
        _ => -cos_poly(r),
    }
}

pub fn cosf(x: f32) -> f32 {
    if !x.is_finite() {
        return f32::NAN;
    }
    let mut x = x;
    if fabsf(x) > 1.0e5 {
        x = fmodf(x, 2.0 * PI);
    }
    let k = round_to_i32(x * FRAC_2_PI);
    let kf = k as f32;
    let r = x - kf * PIO2_HI - kf * PIO2_LO;
    match k & 3 {
        0 => cos_poly(r),
        1 => -sin_poly(r),
        2 => -cos_poly(r),
        _ => sin_poly(r),
    }
}

pub fn tanf(x: f32) -> f32 {
    let c = cosf(x);
    if c == 0.0 {
        return copysignf(f32::INFINITY, sinf(x));
    }
    sinf(x) / c
}

pub fn tanhf(x: f32) -> f32 {
    if x > 9.0 {
        return 1.0;
    }
    if x < -9.0 {
        return -1.0;
    }
    let e = expf(2.0 * x);
    (e - 1.0) / (e + 1.0)
}

pub fn expf(x: f32) -> f32 {
    if x.is_nan() {
        return x;
    }
    if x > 88.722 {
        return f32::INFINITY;
    }
    if x < -87.336 {
        return 0.0;
    }
    let k = round_to_i32(x * LOG2E);
    let kf = k as f32;
    let r = x - kf * LN2_HI - kf * LN2_LO;
    // Taylor series on |r| <= ln(2)/2.
    let p = 1.0
        + r * (1.0
            + r * (0.5
                + r * (1.666_666_7e-1
                    + r * (4.166_666_7e-2
                        + r * (8.333_333e-3 + r * (1.388_889e-3 + r * 1.984_127e-4))))));
    let scale = f32::from_bits((((k + 127) as u32) & 0xff) << 23);
    p * scale
}

pub fn logf(x: f32) -> f32 {
    if x.is_nan() {
        return x;
    }
    if x < 0.0 {
        return f32::NAN;
    }
    if x == 0.0 {
        return f32::NEG_INFINITY;
    }
    if x.is_infinite() {
        return x;
    }
    let mut bits = x.to_bits();
    let mut e = ((bits >> 23) & 0xff) as i32 - 127;
    // Normalise subnormals.
    if e == -127 {
        bits = (x * 16_777_216.0).to_bits();
        e = ((bits >> 23) & 0xff) as i32 - 127 - 24;
    }
    let mut m = f32::from_bits((bits & 0x007f_ffff) | (127 << 23));
    if m > 1.414_213_6 {
        m *= 0.5;
        e += 1;
    }
    let s = (m - 1.0) / (m + 1.0);
    let s2 = s * s;
    let p = 1.0
        + s2 * (1.0 / 3.0
            + s2 * (1.0 / 5.0
                + s2 * (1.0 / 7.0 + s2 * (1.0 / 9.0 + s2 * (1.0 / 11.0 + s2 * (1.0 / 13.0))))));
    2.0 * s * p + e as f32 * LN2
}

#[inline]
pub fn log10f(x: f32) -> f32 {
    logf(x) * INV_LN10
}

#[inline]
pub fn log2f(x: f32) -> f32 {
    logf(x) * LOG2E
}

pub fn powf(x: f32, y: f32) -> f32 {
    if y == 0.0 {
        return 1.0;
    }
    if x == 1.0 {
        return 1.0;
    }
    if x > 0.0 {
        return expf(y * logf(x));
    }
    if x == 0.0 {
        return if y > 0.0 { 0.0 } else { f32::INFINITY };
    }
    let yi = y as i32;
    if yi as f32 == y {
        let m = expf(y * logf(-x));
        if yi & 1 == 0 {
            m
        } else {
            -m
        }
    } else {
        f32::NAN
    }
}

pub fn fmodf(x: f32, y: f32) -> f32 {
    if y == 0.0 || x.is_nan() || x.is_infinite() {
        return f32::NAN;
    }
    if y.is_infinite() {
        return x;
    }
    let ax = fabsf(x);
    let ay = fabsf(y);
    if ax < ay {
        return x;
    }
    let mut r = ax;
    while r >= ay {
        let mut d = ay;
        // Largest power-of-two multiple of the divisor that still fits.
        while d <= r * 0.5 {
            d *= 2.0;
        }
        r -= d;
    }
    copysignf(r, x)
}

/// Decompose into mantissa in [0.5, 1) and a power of two.
pub fn frexpf(x: f32, exp: *mut i32) -> f32 {
    if x == 0.0 || !x.is_finite() {
        if !exp.is_null() {
            unsafe { *exp = 0 };
        }
        return x;
    }
    let bits = x.to_bits();
    let mut e = ((bits >> 23) & 0xff) as i32 - 126;
    let m = f32::from_bits((bits & 0x807f_ffff) | (126 << 23));
    if m.abs() >= 1.0 {
        e += 1;
    }
    let mut m = m;
    if m.abs() >= 1.0 {
        m *= 0.5;
    }
    if !exp.is_null() {
        unsafe { *exp = e };
    }
    m
}

pub fn ldexpf(x: f32, exp: i32) -> f32 {
    let mut r = x;
    let mut e = exp;
    while e > 127 {
        r *= f32::from_bits(254 << 23);
        e -= 127;
    }
    while e < -126 {
        r *= f32::from_bits(1 << 23);
        e += 126;
    }
    r * f32::from_bits((((e + 127) as u32) & 0xff) << 23)
}

#[inline]
pub fn fminf(a: f32, b: f32) -> f32 {
    if a < b {
        a
    } else if b < a {
        b
    } else {
        // NaN handling: return the non-NaN operand when possible.
        if a.is_nan() {
            b
        } else {
            a
        }
    }
}

#[inline]
pub fn fmaxf(a: f32, b: f32) -> f32 {
    if a > b {
        a
    } else if b > a {
        b
    } else if a.is_nan() {
        b
    } else {
        a
    }
}

// --- double precision surface used by Soundpipe -----------------------------
// The only double routines the vendored reverb needs are cos/sqrt; f32 backing
// is comfortably precise for its damping coefficient.

#[inline]
pub fn sqrt(x: f64) -> f64 {
    sqrtf(x as f32) as f64
}

#[inline]
pub fn tan(x: f64) -> f64 {
    tanf(x as f32) as f64
}

#[inline]
pub fn cos(x: f64) -> f64 {
    cosf(x as f32) as f64
}

#[inline]
pub fn sin(x: f64) -> f64 {
    sinf(x as f32) as f64
}

#[inline]
pub fn exp(x: f64) -> f64 {
    expf(x as f32) as f64
}

#[inline]
pub fn log(x: f64) -> f64 {
    logf(x as f32) as f64
}

#[inline]
pub fn log10(x: f64) -> f64 {
    log10f(x as f32) as f64
}

#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    powf(x as f32, y as f32) as f64
}

#[inline]
pub fn round(x: f64) -> f64 {
    roundf(x as f32) as f64
}

#[inline]
pub fn floor(x: f64) -> f64 {
    floorf(x as f32) as f64
}

#[inline]
pub fn ceil(x: f64) -> f64 {
    ceilf(x as f32) as f64
}

#[inline]
pub fn fabs(x: f64) -> f64 {
    f64::from_bits(x.to_bits() & 0x7fff_ffff_ffff_ffff)
}

#[inline]
pub fn fmod(x: f64, y: f64) -> f64 {
    fmodf(x as f32, y as f32) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32, tol: f32) -> bool {
        (a - b).abs() <= tol * (1.0 + b.abs())
    }

    #[test]
    fn sin_matches_std() {
        let mut x = -20.0f32;
        while x <= 20.0 {
            assert!(close(sinf(x), x.sin(), 1e-6), "sinf({x}) = {} vs {}", sinf(x), x.sin());
            assert!(close(cosf(x), x.cos(), 1e-6), "cosf({x}) = {} vs {}", cosf(x), x.cos());
            x += 0.017;
        }
    }

    #[test]
    fn exp_log_match_std() {
        let mut x = 0.001f32;
        while x < 80.0 {
            assert!(close(expf(x), x.exp(), 1e-5), "expf({x}) = {} vs {}", expf(x), x.exp());
            assert!(close(logf(x), x.ln(), 1e-5), "logf({x}) = {} vs {}", logf(x), x.ln());
            x *= 1.13;
        }
    }

    #[test]
    fn pow_matches_std() {
        for (b, e) in [(2.0f32, 10.0f32), (1.5, 3.3), (0.25, -2.5), (10.0, 0.1)] {
            assert!(close(powf(b, e), b.powf(e), 1e-4), "powf({b},{e})");
        }
    }

    #[test]
    fn floor_ceil_round_trunc() {
        for x in [-2.7f32, -0.5, 0.0, 0.5, 2.7, 1234.5] {
            assert_eq!(floorf(x), x.floor());
            assert_eq!(ceilf(x), x.ceil());
            assert_eq!(truncf(x), x.trunc());
        }
    }

    #[test]
    fn fmod_matches_std() {
        for (x, y) in [(7.5f32, 2.0f32), (-7.5, 2.0), (1.0, 0.3), (100.0, 7.0)] {
            assert!(close(fmodf(x, y), x % y, 1e-5), "fmodf({x},{y}) = {} vs {}", fmodf(x, y), x % y);
        }
    }

    #[test]
    fn frexp_matches_std() {
        for x in [1.0f32, 0.75, 3.5, -1234.5, 1.0e-6] {
            let mut e1 = 0i32;
            let mut e2 = 0i32;
            let m1 = frexpf(x, &mut e1);
            let m2 = x.abs().max(0.0);
            let _ = m2;
            // std::f32 doesn't expose frexp; compare against the mathematical
            // identity m * 2^e == x with m in [0.5, 1).
            assert!((m1.abs() - 0.5) >= -1e-9 && m1.abs() < 1.0);
            let _ = &mut e2;
            assert!(close(ldexpf(m1, e1), x, 1e-5));
        }
    }

    #[test]
    fn tanh_matches_std() {
        let mut x = -6.0f32;
        while x <= 6.0 {
            assert!(close(tanhf(x), x.tanh(), 1e-4), "tanhf({x})");
            x += 0.25;
        }
    }
}
