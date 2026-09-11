#!/usr/bin/env bash
# Run the WebKit E2E suite on a headless Weston compositor (CachyOS/Arch).
#
#   ./scripts/e2e-webkit-wayland.sh                     # the core subset
#   ./scripts/e2e-webkit-wayland.sh --all               # everything
#   ./scripts/e2e-webkit-wayland.sh e2e/fxgraph.spec.ts # what to run
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
XDG_RUNTIME_DIR="$runtime" weston \
  --backend=headless-backend.so --socket=wayland-gs1 \
  --width=1280 --height=900 --idle-time=0 >"$log" 2>&1 &
weston_pid=$!
trap 'kill "$weston_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  [ -S "$runtime/wayland-gs1" ] && break
  sleep 0.25
done
if [ ! -S "$runtime/wayland-gs1" ]; then
  echo "weston did not come up; see $log" >&2
  exit 1
fi

echo "[wayland] weston headless up (socket $runtime/wayland-gs1)"
echo "[wayland] renderer: $(ls /dev/dri 2>/dev/null | head -1 || echo 'software (no /dev/dri)')"

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$root/.pw-browsers}" \
WAYLAND_DISPLAY=wayland-gs1 \
XDG_RUNTIME_DIR="$runtime" \
  npx playwright test "${suite[@]}" --project=webkit --workers=1 --headed "${args[@]}"
