#!/bin/sh
# Assemble the VST3 bundle for the OS this script runs on (Linux, macOS or
# Windows under Git Bash), with moduleinfo.json.
#
# Usage (from the repository root):
#   scripts/package-vst3-all.sh [out-dir]
#
# Why a new script instead of extending package-vst3.sh: the Linux path in
# package-vst3.sh is proven and fingerprinted (its GS1.so must stay
# byte-identical), and the three platforms differ in almost every step after
# the build — binary name and location, universal-binary lipo on macOS, the
# export-listing tool, the sha256/stat spellings, and the Windows class-ID
# byte order in moduleinfo.json. Extending the Linux script with a
# three-way branch would put that proven path at risk for no benefit; this
# script dispatches by host OS and reuses package-vst3.sh untouched for
# Linux, so the Linux bundle is the same script producing the same bytes.
#
# Layouts (all three carry the same Resources/ licences and moduleinfo.json):
#   Linux:   GS1.vst3/Contents/x86_64-linux/GS1.so
#   macOS:   GS1.vst3/Contents/MacOS/GS1            (universal arm64 + x86_64,
#                                                    Mach-O dylib, no extension)
#   Windows: GS1.vst3/Contents/x86_64-win/GS1.vst3.dll
#   all:     GS1.vst3/moduleinfo.json
#            GS1.vst3/Contents/Resources/moduleinfo.json   (same bytes)
#            GS1.vst3/Contents/Resources/{LICENSE-MIT,LICENSE-ISC-nih-plug,
#              LICENSE-GPLv3,ATTRIBUTION.md}
#
# moduleinfo.json sits in two places on purpose (see gen-moduleinfo.mjs):
# hosts disagree about which location they read, and the copies are
# byte-identical. The Windows bundle uses moduleinfo.windows.json (same
# content, Windows byte-order CID) renamed to moduleinfo.json.
#
# Toolchain, per OS (all native builds; the C++ bridge is never
# cross-compiled from Linux):
#   Linux:   clang + llvm-ar (CI installs them); locally CLANG may point at
#            .work/clang-wrap.sh as for package-vst3.sh.
#   macOS:   Apple clang (in PATH on macos-latest); the x86_64 slice needs
#            the `x86_64-apple-darwin` rust target (`rustup target add`).
#   Windows: LLVM clang + llvm-ar (`C:\Program Files\LLVM\bin` on PATH;
#            windows-latest ships LLVM, CI puts its bin dir on PATH
#            explicitly). The bridge's build.rs links no libm on Windows
#            and archives to `gsdsp.lib`, which is what rustc looks for on
#            the MSVC target. clang must be the LLVM GNU-driver `clang`,
#            not `clang-cl`: build.rs passes GCC-style flags.
#
# macOS signing/notarisation is out of scope: the bundle is unsigned, and
# hosts will ask the user to allow it (or it must be signed before
# distribution). See crates/synth-vst3/README.md.
#
# Environment: CLANG (default clang), AR (default ar on Linux/macOS,
# llvm-ar on Windows via build.rs; this script does not override it).
set -eu
cd "$(dirname "$0")/.."

CLANG="${CLANG:-clang}"
OUT_DIR="${1:-dist}"
BUNDLE="$OUT_DIR/GS1.vst3"
MANIFEST="crates/synth-vst3/Cargo.toml"

# Portable helpers: GNU stat/sha256sum on Linux and in Git Bash, BSD stat
# and shasum on macOS.
file_bytes() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1"
}
file_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
copy_licenses() {
  cp crates/synth-vst3/licenses/LICENSE-MIT \
    crates/synth-vst3/licenses/LICENSE-ISC-nih-plug \
    crates/synth-vst3/licenses/LICENSE-GPLv3 \
    crates/synth-vst3/licenses/ATTRIBUTION.md \
    "$BUNDLE/Contents/Resources/"
}
# $1 = moduleinfo source file (unix or windows variant).
copy_moduleinfo() {
  cp "$1" "$BUNDLE/moduleinfo.json"
  cp "$1" "$BUNDLE/Contents/Resources/moduleinfo.json"
}
list_bundle() {
  echo "package-vst3-all: bundle ready: $BUNDLE"
  find "$BUNDLE" -type f | sort | while read -r f; do
    echo "  $(file_bytes "$f") bytes  $f"
  done
}

OS="$(uname -s)"
case "$OS" in
  Linux*)
    # Proven path, untouched: same script, same GS1.so bytes.
    CLANG="$CLANG" AR="${AR:-ar}" scripts/package-vst3.sh "$OUT_DIR"
    # package-vst3.sh already created the bundle and the Resources dir.
    copy_moduleinfo crates/synth-vst3/moduleinfo.json
    BINARY="$BUNDLE/Contents/x86_64-linux/GS1.so"
    echo "  moduleinfo.json (unix CID): $(file_sha256 "$BUNDLE/moduleinfo.json")"
    echo "  sha256(GS1.so): $(file_sha256 "$BINARY")"
    ;;

  Darwin*)
    export CLANG
    for target in aarch64-apple-darwin x86_64-apple-darwin; do
      cargo build --release --locked --target "$target" --manifest-path "$MANIFEST"
    done
    ARM="crates/synth-vst3/target/aarch64-apple-darwin/release/libsynth_vst3.dylib"
    X86="crates/synth-vst3/target/x86_64-apple-darwin/release/libsynth_vst3.dylib"
    for f in "$ARM" "$X86"; do
      if [ ! -f "$f" ]; then
        echo "package-vst3-all: expected cdylib not found: $f" >&2
        exit 1
      fi
    done
    rm -rf "$BUNDLE"
    mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
    lipo -create -output "$BUNDLE/Contents/MacOS/GS1" "$ARM" "$X86"
    copy_licenses
    copy_moduleinfo crates/synth-vst3/moduleinfo.json
    BINARY="$BUNDLE/Contents/MacOS/GS1"
    echo "  architectures: $(lipo -info "$BINARY")"
    echo "  exports:"
    nm -gU "$BINARY"
    if ! nm -gU "$BINARY" | grep -q ' T _GetPluginFactory$'; then
      echo "package-vst3-all: GetPluginFactory is not exported from GS1" >&2
      exit 1
    fi
    list_bundle
    echo "  moduleinfo.json (unix CID): $(file_sha256 "$BUNDLE/moduleinfo.json")"
    echo "  sha256(GS1): $(file_sha256 "$BINARY")"
    ;;

  MINGW*|MSYS*|CYGWIN*)
    # Windows under Git Bash. The MSVC target is the host target, so no
    # --target flag; build.rs compiles the C/C++ bridge with $CLANG (LLVM
    # clang, GNU driver) and archives to gsdsp.lib.
    export CLANG
    export AR="${AR:-llvm-ar}"
    cargo build --release --locked --manifest-path "$MANIFEST"
    DLL="crates/synth-vst3/target/release/synth_vst3.dll"
    if [ ! -f "$DLL" ]; then
      echo "package-vst3-all: expected cdylib not found: $DLL" >&2
      exit 1
    fi
    rm -rf "$BUNDLE"
    mkdir -p "$BUNDLE/Contents/x86_64-win" "$BUNDLE/Contents/Resources"
    cp "$DLL" "$BUNDLE/Contents/x86_64-win/GS1.vst3.dll"
    copy_licenses
    # Windows byte-order CID (see scripts/gen-moduleinfo.mjs).
    copy_moduleinfo crates/synth-vst3/moduleinfo.windows.json
    BINARY="$BUNDLE/Contents/x86_64-win/GS1.vst3.dll"
    echo "  exports:"
    if command -v llvm-readobj >/dev/null 2>&1; then
      # llvm-readobj reads the PE export directory, which is the source of
      # truth for a DLL. llvm-nm does NOT work here: it reads the COFF
      # symbol table, which a release MSVC-linked DLL does not carry, so it
      # reports "no symbols" even when the export is present (CI run
      # 42338663909 failed exactly this way). GetPluginFactory must be in
      # the export directory.
      llvm-readobj --coff-exports "$BINARY" || true
      if ! llvm-readobj --coff-exports "$BINARY" | grep -q 'GetPluginFactory'; then
        echo "package-vst3-all: GetPluginFactory is not exported from GS1.vst3.dll (llvm-readobj)" >&2
        exit 1
      fi
    elif command -v dumpbin >/dev/null 2>&1; then
      dumpbin /EXPORTS "$BINARY"
      if ! dumpbin /EXPORTS "$BINARY" | grep -q 'GetPluginFactory'; then
        echo "package-vst3-all: GetPluginFactory is not exported from GS1.vst3.dll (dumpbin)" >&2
        exit 1
      fi
    else
      echo "package-vst3-all: no llvm-readobj or dumpbin to verify the DLL exports" >&2
      exit 1
    fi
    list_bundle
    echo "  moduleinfo.json (windows CID): $(file_sha256 "$BUNDLE/moduleinfo.json")"
    echo "  sha256(GS1.vst3.dll): $(file_sha256 "$BINARY")"
    ;;

  *)
    echo "package-vst3-all: unsupported host OS: $OS" >&2
    exit 1
    ;;
esac
