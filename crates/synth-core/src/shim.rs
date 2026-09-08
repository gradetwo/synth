//! Freestanding libc shims for the vendored C/C++ sources (wasm32 only).
//!
//! The wasm build is compiled with `-nostdinc` against `c_bridge/shim/*`, so the
//! libraries only ever see the symbols declared here. Math comes from
//! [`crate::dsp::fmath`] (never from a libcall, which would recurse) and
//! allocation from the fixed arena in [`crate::alloc_arena`].

#![cfg(target_arch = "wasm32")]

use crate::alloc_arena;
use crate::dsp::fmath;

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

macro_rules! export_f32 {
    ($($name:ident),* $(,)?) => {
        $(
            #[no_mangle]
            pub extern "C" fn $name(x: f32) -> f32 {
                fmath::$name(x)
            }
        )*
    };
}

macro_rules! export_f64 {
    ($($name:ident),* $(,)?) => {
        $(
            #[no_mangle]
            pub extern "C" fn $name(x: f64) -> f64 {
                fmath::$name(x)
            }
        )*
    };
}

export_f32!(
    sinf, cosf, tanf, sqrtf, fabsf, expf, logf, log10f, log2f, floorf, ceilf, roundf, truncf,
    tanhf,
);
export_f64!(sin, cos, tan, sqrt, fabs, exp, log, log10, floor, ceil, round);

#[no_mangle]
pub extern "C" fn powf(x: f32, y: f32) -> f32 {
    fmath::powf(x, y)
}

#[no_mangle]
pub extern "C" fn pow(x: f64, y: f64) -> f64 {
    fmath::pow(x, y)
}

#[no_mangle]
pub extern "C" fn fmodf(x: f32, y: f32) -> f32 {
    fmath::fmodf(x, y)
}

#[no_mangle]
pub extern "C" fn fmod(x: f64, y: f64) -> f64 {
    fmath::fmod(x, y)
}

#[no_mangle]
pub extern "C" fn fminf(a: f32, b: f32) -> f32 {
    fmath::fminf(a, b)
}

#[no_mangle]
pub extern "C" fn fmaxf(a: f32, b: f32) -> f32 {
    fmath::fmaxf(a, b)
}

#[no_mangle]
pub extern "C" fn frexpf(x: f32, exp: *mut i32) -> f32 {
    fmath::frexpf(x, exp)
}

#[no_mangle]
pub extern "C" fn ldexpf(x: f32, exp: i32) -> f32 {
    fmath::ldexpf(x, exp)
}
