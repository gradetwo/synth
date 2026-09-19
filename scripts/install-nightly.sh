#!/usr/bin/env bash
# Install the nightly browser run as a user timer.
#
#   ./scripts/install-nightly.sh          # install and start the timer
#   ./scripts/install-nightly.sh --remove # stop and remove it
#
# The units land in ~/.config/systemd/user and run the checkout they were
# installed from. `systemctl --user` needs a session bus: run this from a normal
# login session (not from a bare script/CI shell).
set -euo pipefail

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now gs1-nightly.timer 2>/dev/null || true
  rm -f "$unit_dir/gs1-nightly.timer" "$unit_dir/gs1-nightly.service"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "removed the nightly timer"
  exit 0
fi

mkdir -p "$unit_dir"
cp "$here/systemd/gs1-nightly.timer" "$here/systemd/gs1-nightly.service" "$unit_dir/"

# Point the unit at this checkout, wherever it happens to live.
project="$(cd "$here/.." && pwd)"
sed -i "s|WorkingDirectory=.*|WorkingDirectory=$project|" "$unit_dir/gs1-nightly.service"

if ! systemctl --user daemon-reload 2>/dev/null; then
  echo "systemctl --user is not reachable from this shell." >&2
  echo "Units are in $unit_dir — enable them from a login session with:" >&2
  echo "  systemctl --user daemon-reload && systemctl --user enable --now gs1-nightly.timer" >&2
  exit 1
fi

systemctl --user enable --now gs1-nightly.timer
systemctl --user list-timers gs1-nightly.timer --no-pager || true
echo "next run: nightly at 03:00 (logs in .tmp/nightly, summary in docs/notes/nightly.md)"
