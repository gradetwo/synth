//! SIMD mixing primitives.
//!
//! prd.md §5.2 asks for SIMD without the alignment traps of raw `v128_load`.
//! The stable route on `wasm32-unknown-unknown` is `core::arch::wasm32` with a
//! scalar fallback, so the same code runs in `cargo test` on the host. Buffers
//! are always 16-byte aligned (static arrays / arena payloads), and the tail is
//! handled scalar so no out-of-bounds load can ever occur.

#[inline]
pub fn accumulate(input: &[f32], output: &mut [f32], gain: f32) {
    debug_assert_eq!(input.len(), output.len());
    let n = input.len().min(output.len());
    let mut i = 0;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    unsafe {
        use core::arch::wasm32::*;
        let g = f32x4_splat(gain);
        while i + 4 <= n {
            let a = v128_load(input.as_ptr().add(i) as *const v128);
            let b = v128_load(output.as_ptr().add(i) as *const v128);
            let r = f32x4_add(b, f32x4_mul(a, g));
            v128_store(output.as_mut_ptr().add(i) as *mut v128, r);
            i += 4;
        }
    }

    while i < n {
        output[i] += input[i] * gain;
        i += 1;
    }
}

/// `output[i] = input[i] * gain` with SIMD where available.
#[inline]
pub fn scale_into(input: &[f32], output: &mut [f32], gain: f32) {
    debug_assert_eq!(input.len(), output.len());
    let n = input.len().min(output.len());
    let mut i = 0;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    unsafe {
        use core::arch::wasm32::*;
        let g = f32x4_splat(gain);
        while i + 4 <= n {
            let a = v128_load(input.as_ptr().add(i) as *const v128);
            v128_store(output.as_mut_ptr().add(i) as *mut v128, f32x4_mul(a, g));
            i += 4;
        }
    }

    while i < n {
        output[i] = input[i] * gain;
        i += 1;
    }
}

/// `out[i] = a[i] * ga + b[i] * gb` (two-oscillator mix).
#[inline]
pub fn mix2_into(a: &[f32], b: &[f32], out: &mut [f32], ga: f32, gb: f32) {
    let n = a.len().min(b.len()).min(out.len());
    let mut i = 0;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    unsafe {
        use core::arch::wasm32::*;
        let gav = f32x4_splat(ga);
        let gbv = f32x4_splat(gb);
        while i + 4 <= n {
            let va = v128_load(a.as_ptr().add(i) as *const v128);
            let vb = v128_load(b.as_ptr().add(i) as *const v128);
            let r = f32x4_add(f32x4_mul(va, gav), f32x4_mul(vb, gbv));
            v128_store(out.as_mut_ptr().add(i) as *mut v128, r);
            i += 4;
        }
    }

    while i < n {
        out[i] = a[i] * ga + b[i] * gb;
        i += 1;
    }
}

/// Peak absolute value of a block (used for the VU meter).
#[inline]
pub fn peak(samples: &[f32]) -> f32 {
    let mut p = 0.0f32;
    for &s in samples {
        let a = s.abs();
        if a > p {
            p = a;
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accumulate_matches_scalar_reference() {
        let input: Vec<f32> = (0..257).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut out = vec![0.25f32; input.len()];
        let mut expect = out.clone();
        accumulate(&input, &mut out, 0.7);
        for i in 0..input.len() {
            expect[i] += input[i] * 0.7;
            assert!((out[i] - expect[i]).abs() < 1e-6, "mismatch at {i}");
        }
    }

    #[test]
    fn mix2_handles_non_multiple_of_four() {
        let a = vec![1.0f32; 13];
        let b = vec![2.0f32; 13];
        let mut out = vec![0.0f32; 13];
        mix2_into(&a, &b, &mut out, 0.5, 0.25);
        for v in out {
            assert!((v - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn peak_finds_maximum() {
        assert_eq!(peak(&[0.1, -0.8, 0.3]), 0.8);
        assert_eq!(peak(&[]), 0.0);
    }
}
