//! Freestanding libc shims for the vendored C/C++ sources (wasm32 only).
//!
//! The wasm build is compiled with `-nostdinc` against `c_bridge/shim/*`, so the
//! libraries only ever see the handful of symbols declared here. Math is routed
//! to `std` (which embeds a libm on wasm32-unknown-unknown); allocation is
//! routed to the fixed arena in [`crate::alloc_arena`].

#![cfg(target_arch = "wasm32")]

use crate::alloc_arena;

// ---------------------------------------------------------------- allocation

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    alloc_arena::alloc(size, 16)
}

#[no_mangle]
pub extern "C" fn calloc(nmemb: usize, size: usize) -> *mut u8 {
    let total = nmemb.saturating_mul(size);
    alloc_arena::alloc_zeroed(total, 16)
}

#[no_mangle]
pub extern "C" fn realloc(ptr: *mut u8, size: usize) -> *mut u8 {
    alloc_arena::realloc(ptr, size, 16)
}

#[no_mangle]
pub extern "C" fn free(ptr: *mut u8) {
    alloc_arena::dealloc(ptr);
}

// -------------------------------------------------------------------- process

#[no_mangle]
pub extern "C" fn abort() -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn exit(_status: i32) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn __gs_assert_fail(_expr: *const u8, _file: *const u8, _line: i32) -> ! {
    core::arch::wasm32::unreachable()
}

// ----------------------------------------------------------------------- rng

static mut RNG_STATE: u32 = 0x1234_5678;

#[no_mangle]
pub extern "C" fn rand() -> i32 {
    unsafe {
        let mut x = RNG_STATE;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        RNG_STATE = x;
        ((x >> 1) & 0x7fff_ffff) as i32
    }
}

#[no_mangle]
pub extern "C" fn srand(seed: u32) {
    unsafe {
        RNG_STATE = if seed == 0 { 1 } else { seed };
    }
}

// The variadic stdio surface (sprintf/fprintf/...) cannot be defined on stable
// Rust, so it lives in c_bridge/gs_stubs.c.

// ---------------------------------------------------------------------- math

macro_rules! f32_unary {
    ($name:ident, $method:ident) => {
        #[no_mangle]
        pub extern "C" fn $name(x: f32) -> f32 {
            x.$method()
        }
    };
}

macro_rules! f64_unary {
    ($name:ident, $method:ident) => {
        #[no_mangle]
        pub extern "C" fn $name(x: f64) -> f64 {
            x.$method()
        }
    };
}

f32_unary!(sinf, sin);
f32_unary!(cosf, cos);
f32_unary!(tanf, tan);
f32_unary!(asinf, asin);
f32_unary!(acosf, acos);
f32_unary!(atanf, atan);
f32_unary!(sqrtf, sqrt);
f32_unary!(fabsf, abs);
f32_unary!(expf, exp);
f32_unary!(logf, ln);
f32_unary!(log10f, log10);
f32_unary!(log2f, log2);
f32_unary!(floorf, floor);
f32_unary!(ceilf, ceil);
f32_unary!(roundf, round);
f32_unary!(truncf, trunc);
f32_unary!(tanhf, tanh);
f32_unary!(sinhf, sinh);
f32_unary!(coshf, cosh);

f64_unary!(sin, sin);
f64_unary!(cos, cos);
f64_unary!(tan, tan);
f64_unary!(sqrt, sqrt);
f64_unary!(fabs, abs);
f64_unary!(exp, exp);
f64_unary!(log, ln);
f64_unary!(log10, log10);
f64_unary!(floor, floor);
f64_unary!(ceil, ceil);
f64_unary!(round, round);

#[no_mangle]
pub extern "C" fn atan2f(y: f32, x: f32) -> f32 {
    y.atan2(x)
}

#[no_mangle]
pub extern "C" fn atan2(y: f64, x: f64) -> f64 {
    y.atan2(x)
}

#[no_mangle]
pub extern "C" fn powf(x: f32, y: f32) -> f32 {
    x.powf(y)
}

#[no_mangle]
pub extern "C" fn pow(x: f64, y: f64) -> f64 {
    x.powf(y)
}

#[no_mangle]
pub extern "C" fn fmodf(x: f32, y: f32) -> f32 {
    x % y
}

#[no_mangle]
pub extern "C" fn fmod(x: f64, y: f64) -> f64 {
    x % y
}

#[no_mangle]
pub extern "C" fn fminf(a: f32, b: f32) -> f32 {
    a.min(b)
}

#[no_mangle]
pub extern "C" fn fmaxf(a: f32, b: f32) -> f32 {
    a.max(b)
}

#[no_mangle]
pub extern "C" fn frexpf(x: f32, exp: *mut i32) -> f32 {
    // Decompose via the IEEE-754 exponent without pulling in a libm symbol.
    if x == 0.0 || !x.is_finite() {
        if !exp.is_null() {
            unsafe { *exp = 0 };
        }
        return x;
    }
    let bits = x.to_bits();
    let mut e = ((bits >> 23) & 0xff) as i32 - 126;
    let mut m = f32::from_bits((bits & 0x807f_ffff) | (126 << 23));
    if m.abs() >= 1.0 {
        m *= 0.5;
        e += 1;
    }
    if !exp.is_null() {
        unsafe { *exp = e };
    }
    m
}

#[no_mangle]
pub extern "C" fn ldexpf(x: f32, exp: i32) -> f32 {
    x * (2.0f32).powi(exp)
}
