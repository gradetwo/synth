//! Build script for the GS-1 DSP core.
//!
//! Responsibilities:
//!   1. Regenerate `soundpipe.h` from the vendored upstream headers exactly the
//!      way Soundpipe's own Makefile does (concatenation inside one include
//!      guard), so the vendored `.c` files stay byte-identical to upstream.
//!   2. Cross-compile the vendored DaisySP (C++) and Soundpipe (C) sources plus
//!      our block-ABI bridges with clang, for both `wasm32-unknown-unknown` and
//!      the host target (so `cargo test` can exercise the real C code).
//!   3. Archive the objects into `libgsdsp.a` and hand it to rustc.
//!
//! The wasm build is freestanding: `-nostdinc` plus a tiny shim layer that maps
//! the handful of libc headers the libraries touch onto Rust-provided symbols
//! (see `src/shim.rs`).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let target = env::var("TARGET").expect("TARGET");
    let is_wasm = target.starts_with("wasm32");

    let c_bridge = manifest.join("c_bridge");
    let vendor = manifest.join("vendor");
    let shim = c_bridge.join("shim");
    let shim_cxx = shim.join("cxx");
    let daisysp_src = vendor.join("daisysp").join("Source");
    let soundpipe = vendor.join("soundpipe");

    // ---------------------------------------------------------------- headers
    let sp_inc = out_dir.join("sp_include");
    fs::create_dir_all(&sp_inc).expect("create sp_include");
    let mut header = String::from("#ifndef SOUNDPIPE_H\n#define SOUNDPIPE_H\n");
    for name in ["base", "delay", "allpass", "comb", "revsc"] {
        let path = soundpipe.join("h").join(format!("{name}.h"));
        header.push_str(&fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display())));
        header.push('\n');
        println!("cargo:rerun-if-changed={}", path.display());
    }
    header.push_str("#endif\n");
    write_if_changed(&sp_inc.join("soundpipe.h"), &header);

    // ------------------------------------------------------------------ clang
    // SIMD is opt-out so a scalar build can be produced for older Safari.
    let simd = env::var("GS_SIMD").map(|v| v != "0").unwrap_or(true);

    let clang = env::var("CLANG").unwrap_or_else(|_| "clang".to_string());
    let mut common: Vec<String> = vec![
        "-O3".into(),
        "-DNDEBUG".into(),
        "-DNO_LIBSNDFILE".into(),
        "-fno-exceptions".into(),
        "-fno-rtti".into(),
        "-fno-stack-protector".into(),
        "-ffunction-sections".into(),
        "-fdata-sections".into(),
        "-Wno-unused-parameter".into(),
        "-Wno-unused-function".into(),
        "-Wno-unused-variable".into(),
        format!("-I{}", sp_inc.display()),
        format!("-I{}", c_bridge.display()),
        format!("-I{}", shim.display()),
        format!("-I{}", shim_cxx.display()),
        format!("-I{}", daisysp_src.display()),
        format!("-I{}", daisysp_src.join("Utility").display()),
    ];

    if is_wasm {
        common.push("--target=wasm32-unknown-unknown".into());
        if simd {
            common.push("-msimd128".into());
        }
        common.push("-ffreestanding".into());
        common.push("-fno-builtin".into());
        common.push("-nostdinc".into());
        let resource = clang_resource_include(&clang);
        common.push("-isystem".into());
        common.push(resource.display().to_string());
    }

    let c_sources = [
        c_bridge.join("gs_soundpipe.c"),
        c_bridge.join("gs_stubs.c"),
        soundpipe.join("modules/base.c"),
        soundpipe.join("modules/delay.c"),
        soundpipe.join("modules/allpass.c"),
        soundpipe.join("modules/comb.c"),
        soundpipe.join("modules/revsc.c"),
    ];
    let cxx_sources = [
        c_bridge.join("gs_daisy.cpp"),
        daisysp_src.join("Synthesis/oscillator.cpp"),
        daisysp_src.join("Filters/ladder.cpp"),
        daisysp_src.join("Filters/svf.cpp"),
        daisysp_src.join("Utility/dcblock.cpp"),
    ];

    let obj_dir = out_dir.join("obj");
    fs::create_dir_all(&obj_dir).expect("create obj dir");

    let mut objects: Vec<PathBuf> = Vec::new();
    for (idx, src) in c_sources.iter().chain(cxx_sources.iter()).enumerate() {
        let stem = src.file_stem().unwrap().to_string_lossy().to_string();
        let obj = obj_dir.join(format!("{idx:02}-{stem}.o"));
        compile(&clang, &common, src, &obj, is_wasm, simd);
        objects.push(obj);
        println!("cargo:rerun-if-changed={}", src.display());
    }

    // -------------------------------------------------------------- archive
    let archive = out_dir.join("libgsdsp.a");
    let _ = fs::remove_file(&archive);
    let ar = env::var("AR").unwrap_or_else(|_| "llvm-ar".to_string());
    let mut cmd = Command::new(&ar);
    cmd.arg("crs").arg(&archive);
    for obj in &objects {
        cmd.arg(obj);
    }
    run(&mut cmd, "archiving C/C++ objects");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=gsdsp");
    if !is_wasm {
        println!("cargo:rustc-link-lib=dylib=m");
    }

    // Shims are header-only; rebuild when they change.
    for entry in fs::read_dir(&shim).into_iter().flatten().flatten() {
        println!("cargo:rerun-if-changed={}", entry.path().display());
    }
    for entry in fs::read_dir(&shim_cxx).into_iter().flatten().flatten() {
        println!("cargo:rerun-if-changed={}", entry.path().display());
    }
    println!("cargo:rerun-if-env-changed=GS_SIMD");
    println!("cargo:rerun-if-env-changed=CLANG");
    println!("cargo:rerun-if-env-changed=AR");
    println!("cargo:rerun-if-changed=build.rs");
}

fn write_if_changed(path: &Path, contents: &str) {
    if fs::read_to_string(path).map(|old| old == contents).unwrap_or(false) {
        return;
    }
    fs::write(path, contents).unwrap_or_else(|e| panic!("write {}: {e}", path.display()));
}

fn clang_resource_include(clang: &str) -> PathBuf {
    let output = Command::new(clang)
        .arg("--print-resource-dir")
        .output()
        .unwrap_or_else(|e| panic!("failed to run `{clang} --print-resource-dir`: {e}"));
    if !output.status.success() {
        panic!("`{clang} --print-resource-dir` failed");
    }
    let dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    PathBuf::from(dir).join("include")
}

fn compile(clang: &str, common: &[String], src: &Path, obj: &Path, is_wasm: bool, simd: bool) {
    let mut cmd = Command::new(clang);
    cmd.args(common);
    if src.extension().and_then(|e| e.to_str()) == Some("c") {
        cmd.arg("-std=c11");
    } else {
        cmd.arg("-std=c++17");
    }
    if is_wasm && simd {
        // Keep codegen aligned with the Rust side (+simd128).
        cmd.arg("-mrelaxed-simd");
    }
    cmd.arg("-c").arg(src).arg("-o").arg(obj);
    run(&mut cmd, &format!("compiling {}", src.display()));
}

fn run(cmd: &mut Command, what: &str) {
    let output = cmd
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn `{cmd:?}` while {what}: {e}"));
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        panic!("{what} failed\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}");
    }
}
