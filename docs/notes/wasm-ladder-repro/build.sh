#!/usr/bin/env bash
# Build the minimal LadderFilter wasm reproducer.
#
#   ./build.sh            -> repro.wasm         (bug present: command_export wrappers)
#   ./build.sh guarded    -> repro_guarded.wasm (bug absent: __wasm_call_ctors exported)
#   ./build.sh native     -> repro_native       (native control, expected clean)
#   OPT=-O0 ./build.sh    -> repro-O0.wasm      (same bug: it is not an -O issue)
#
# The guarded variant exports __wasm_call_ctors, which tells wasm-ld not to emit
# the per-export `<name>.command_export` wrappers, so the global constructor is
# never re-run.  (A caller would then run it once itself, or ensure that no
# dynamic initializer is needed at all.)
set -euo pipefail
cd "$(dirname "$0")"

# Locate the repository root (the directory holding crates/synth-core).
REPO="$(pwd)"
while [ ! -f "$REPO/crates/synth-core/Cargo.toml" ]; do
  REPO="$(dirname "$REPO")"
  [ "$REPO" = "/" ] && { echo "cannot find repo root" >&2; exit 1; }
done
SC="$REPO/crates/synth-core"
RES="$(clang --print-resource-dir)/include"

OPT="${OPT:--O3}"
SUFFIX=""
[ "$OPT" != "-O3" ] && SUFFIX="$OPT"

CFLAGS=(--target=wasm32-unknown-unknown "$OPT" -DNDEBUG -fno-exceptions -fno-rtti
        -fno-stack-protector -std=c++17
        -I"$SC/c_bridge/shim" -I"$SC/c_bridge/shim/cxx"
        -I"$SC/vendor/daisysp/Source" -I"$SC/vendor/daisysp/Source/Utility"
        -msimd128 -ffreestanding -fno-builtin -nostdinc -isystem "$RES")

EXPORTS=(--no-entry --allow-undefined --export-memory
         --export=r_init --export=r_set --export=r_block)

if [ "${1:-}" = "native" ]; then
  clang++ -O3 -DNDEBUG -fno-exceptions -fno-rtti -std=c++17 \
    -I"$SC/c_bridge/shim" -I"$SC/c_bridge/shim/cxx" \
    -I"$SC/vendor/daisysp/Source" -I"$SC/vendor/daisysp/Source/Utility" \
    "$SC/vendor/daisysp/Source/Filters/ladder.cpp" repro.cpp -o repro_native -lm
  echo "built repro_native"
  exit 0
fi

clang++ "${CFLAGS[@]}" -c "$SC/vendor/daisysp/Source/Filters/ladder.cpp" -o ladder.o
clang++ "${CFLAGS[@]}" -c repro.cpp -o repro.o

if [ "${1:-}" = "guarded" ]; then
  wasm-ld "${EXPORTS[@]}" --export=__wasm_call_ctors ladder.o repro.o -o repro_guarded.wasm
  echo "built repro_guarded.wasm (guard: no per-export ctor wrappers)"
else
  wasm-ld "${EXPORTS[@]}" ladder.o repro.o -o "repro${SUFFIX}.wasm"
  echo "built repro${SUFFIX}.wasm (bug: command_export wrappers re-run the global ctor)"
fi
