#!/bin/sh
# Assemble the Linux x86_64 CLAP plugin for the GS1 synth plugin.
#
# Usage (from the repository root):
#   CLANG=<clang shim or clang> AR=ar scripts/package-clap.sh [out-dir]
#
# CLANG is the C/C++ compiler the synth-core build uses for its vendored
# C/C++ sources; it must handle both .c and .cpp inputs (a plain `cc`
# driver dispatches by extension; on machines without a working clang the
# repo's local clang wrapper is the fallback). AR is the archiver.
# Defaults: CLANG=clang, AR=ar.
#
# Output: <out-dir>/GS1.clap (default: dist/GS1.clap) — a single-file
# Linux CLAP plugin (the shared library itself, named *.clap), plus
# <out-dir>/GS1.clap-licenses/ with the license texts.
#
# License split (deliberate, see crates/synth-vst3/README.md): this build
# uses --no-default-features --features clap, so it links no `vst3-sys`
# and the distributed GS1.clap is NOT GPLv3-bound. Only MIT (this repo)
# and ISC (nih-plug) texts ship with it. The VST3 product (GS1.vst3,
# scripts/package-vst3.sh) DOES link `vst3-sys` and stays GPLv3-bound;
# its bundle carries the GPLv3 text as well.
set -eu
cd "$(dirname "$0")/.."

CLANG="${CLANG:-clang}"
AR="${AR:-ar}"
OUT_DIR="${1:-dist}"
CLAP_FILE="$OUT_DIR/GS1.clap"
LIC_DIR="$OUT_DIR/GS1.clap-licenses"
SO_SRC="crates/synth-vst3/target/release/libsynth_vst3.so"

export CLANG AR
cargo build --release --locked --no-default-features --features clap \
  --manifest-path crates/synth-vst3/Cargo.toml

if [ ! -f "$SO_SRC" ]; then
  echo "package-clap: expected cdylib not found: $SO_SRC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$LIC_DIR"
cp "$SO_SRC" "$CLAP_FILE"
cp crates/synth-vst3/licenses/LICENSE-MIT \
  crates/synth-vst3/licenses/LICENSE-ISC-nih-plug \
  crates/synth-vst3/licenses/ATTRIBUTION.md \
  "$LIC_DIR/"

# The CLAP entry point must be dynamically exported, or no host will see
# the plugin at all. Note the type letter: `clap_entry` is a data object
# (`D`), not a function (`T`), so the match must allow both.
if ! nm -D "$CLAP_FILE" | grep -q '[DT] clap_entry$'; then
  echo "package-clap: clap_entry is not exported from GS1.clap" >&2
  exit 1
fi

# The CLAP-only build must not carry the VST3 entry point: its presence
# would mean `vst3-sys` got linked after all, and the GPLv3 split above
# would be false.
if nm -D "$CLAP_FILE" | grep -q 'GetPluginFactory$'; then
  echo "package-clap: GetPluginFactory is exported from GS1.clap; the CLAP-only build must not link vst3-sys" >&2
  exit 1
fi

echo "package-clap: plugin ready: $CLAP_FILE"
find "$CLAP_FILE" "$LIC_DIR" -type f | sort | while read -r f; do
  echo "  $(stat -c%s "$f") bytes  $f"
done
echo "  sha256(GS1.clap): $(sha256sum "$CLAP_FILE" | cut -d' ' -f1)"
