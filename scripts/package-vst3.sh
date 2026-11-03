#!/bin/sh
# Assemble the Linux x86_64 VST3 bundle for the GS1 synth plugin.
#
# Usage (from the repository root):
#   CLANG=<clang shim or clang> AR=ar scripts/package-vst3.sh [out-dir]
#
# CLANG is the C/C++ compiler the synth-core build uses for its vendored
# C/C++ sources; it must handle both .c and .cpp inputs (a plain `cc`
# driver dispatches by extension; on machines without a working clang the
# repo's local clang wrapper is the fallback). AR is the archiver.
# Defaults: CLANG=clang, AR=ar.
#
# Output: <out-dir>/GS1.vst3 (default: dist/GS1.vst3) with the layout
#   GS1.vst3/Contents/x86_64-linux/GS1.so
#   GS1.vst3/Contents/Resources/{LICENSE-MIT,LICENSE-ISC-nih-plug,
#     LICENSE-GPLv3,ATTRIBUTION.md}
# moduleinfo.json is a phase-2 item and is intentionally not generated.
set -eu
cd "$(dirname "$0")/.."

CLANG="${CLANG:-clang}"
AR="${AR:-ar}"
OUT_DIR="${1:-dist}"
BUNDLE="$OUT_DIR/GS1.vst3"
SO_SRC="crates/synth-vst3/target/release/libsynth_vst3.so"

export CLANG AR
cargo build --release --locked --manifest-path crates/synth-vst3/Cargo.toml

if [ ! -f "$SO_SRC" ]; then
  echo "package-vst3: expected cdylib not found: $SO_SRC" >&2
  exit 1
fi

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/x86_64-linux" "$BUNDLE/Contents/Resources"
cp "$SO_SRC" "$BUNDLE/Contents/x86_64-linux/GS1.so"
cp crates/synth-vst3/licenses/LICENSE-MIT \
  crates/synth-vst3/licenses/LICENSE-ISC-nih-plug \
  crates/synth-vst3/licenses/LICENSE-GPLv3 \
  crates/synth-vst3/licenses/ATTRIBUTION.md \
  "$BUNDLE/Contents/Resources/"

# The VST3 entry point must be dynamically exported, or no host will see
# the plugin at all.
if ! nm -D "$BUNDLE/Contents/x86_64-linux/GS1.so" | grep -q ' T GetPluginFactory$'; then
  echo "package-vst3: GetPluginFactory is not exported from GS1.so" >&2
  exit 1
fi

echo "package-vst3: bundle ready: $BUNDLE"
find "$BUNDLE" -type f | sort | while read -r f; do
  echo "  $(stat -c%s "$f") bytes  $f"
done
echo "  sha256(GS1.so): $(sha256sum "$BUNDLE/Contents/x86_64-linux/GS1.so" | cut -d' ' -f1)"
