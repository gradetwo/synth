#!/usr/bin/env bash
# Run the WebKit E2E suite on a headless Weston compositor (CachyOS/Arch).
#
#   ./scripts/e2e-webkit-wayland.sh                     # the core subset
#   ./scripts/e2e-webkit-wayland.sh --all               # everything
#   ./scripts/e2e-webkit-wayland.sh e2e/fxgraph.spec.ts # what to run
#
# The default here is the *core* subset, the quick local look. The nightly's
# default is wider (core + visual + audio) and lives in scripts/nightly-e2e.mjs;
# run `npm run nightly` for that. `--all` includes e2e/visual.spec.ts, which is
# smoke-only on this engine — it renders every surface and compares no baseline,
# because the baselines exist for Chromium on Linux only (see the spec's header
# and docs/notes/compat.md §4). GS1_VISUAL_SMOKE says so explicitly; comparing
# would write a batch of software-rendered `-webkit-linux` baselines instead.
#
# Why Weston rather than Xvfb: WebKitGTK composites through the display server,
# and on this machine Xvfb renders it at roughly 0.7 fps against Weston's 1.8 —
# both far too slow for Playwright, which waits for two stable frames per click.
# If `/dev/dri` exists (any normal desktop session) Weston picks up the GPU and
# the numbers are ordinary; without it, both are software and neither is usable.
# The fastest option of all is your own session: run `npm run test:e2e:webkit:desktop`
# from a terminal inside the desktop, where GL is already up.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="$root/.tmp/xdg-weston"
log="$root/.tmp/weston.log"
suite=("e2e/responsive.spec.ts" "e2e/touch.spec.ts" "e2e/text-fit.spec.ts" "e2e/boot.spec.ts"
       "e2e/fxgraph.spec.ts" "e2e/share.spec.ts" "e2e/drawer.spec.ts" "e2e/theme.spec.ts")

args=()
files=()
for arg in "$@"; do
  case "$arg" in
    --all) suite=() ;;
    --*) args+=("$arg") ;;
    *) files+=("$arg") ;;
  esac
done
# An explicit file list replaces the default subset, so a single spec can be
# checked in a minute or two.
if [ "${#files[@]}" -gt 0 ]; then
  suite=("${files[@]}")
fi

command -v weston >/dev/null || { echo "weston is not installed (pacman -S weston)" >&2; exit 1; }

mkdir -p "$runtime"
chmod 700 "$runtime"

# Ask for the GL renderer when there is a DRM node. Without this flag the
# headless backend silently picks the no-op/pixman renderer **even on a machine
# with a GPU**: measured 2026-09-14 on this box, `/dev/dri/renderD128` present
# and weston still logged "no-op renderer", which is why the lane looked like it
# needed a desktop session. With the flag it logs
# `Using rendering device: /dev/dri/renderD128` (EGL 1.5, Mesa). If GL cannot
# come up we fall back to the default renderer rather than failing the lane.
weston_renderer_args=()
if ls /dev/dri/renderD* >/dev/null 2>&1; then
  weston_renderer_args=(--renderer=gl)
fi

weston_pid=""
start_weston() {
  XDG_RUNTIME_DIR="$runtime" weston \
    --backend=headless-backend.so --socket=wayland-gs1 \
    "${weston_renderer_args[@]}" \
    --width=1280 --height=900 --idle-time=0 >"$log" 2>&1 &
  weston_pid=$!
}

wait_for_socket() {
  for _ in $(seq 1 40); do
    [ -S "$runtime/wayland-gs1" ] && return 0
    sleep 0.25
  done
  return 1
}

start_weston
trap 'kill "$weston_pid" 2>/dev/null || true' EXIT

if ! wait_for_socket; then
  echo "weston did not come up; see $log" >&2
  exit 1
fi

# Had a DRM node but GL did not load? Restart without the flag and say so.
if [ "${#weston_renderer_args[@]}" -gt 0 ] && ! grep -aq "Using rendering device" "$log"; then
  echo "[wayland] GL renderer unavailable, falling back to the default renderer; see $log" >&2
  kill "$weston_pid" 2>/dev/null || true
  rm -f "$runtime/wayland-gs1"
  weston_renderer_args=()
  start_weston
  wait_for_socket || { echo "weston did not come back up; see $log" >&2; exit 1; }
fi

# Report what weston *actually* chose, not what /dev happens to contain: the
# old line printed `ls /dev/dri | head -1`, i.e. the literal string "by-path".
renderer_device="$(grep -a 'Using rendering device' "$log" | head -1 | sed 's/.*: //')"
echo "[wayland] weston headless up (socket $runtime/wayland-gs1)"
if [ -n "$renderer_device" ]; then
  echo "[wayland] renderer: GL via $renderer_device"
else
  echo "[wayland] renderer: software (no GL renderer; see $log)"
fi

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$root/.pw-browsers}" \
WAYLAND_DISPLAY=wayland-gs1 \
XDG_RUNTIME_DIR="$runtime" \
GS1_VISUAL=1 \
GS1_VISUAL_SMOKE=1 \
  npx playwright test "${suite[@]}" --project=webkit --workers=1 --headed "${args[@]}"
