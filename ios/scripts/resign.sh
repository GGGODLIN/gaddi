#!/bin/bash
# Re-signs and reinstalls Collie Island before its free Personal Team profile expires (7 days).
# Run daily by launchd; it renews when fewer than RENEW_BELOW_DAYS remain (currently every
# run). --force renews regardless. The iPhone must be reachable (cable, or the same Wi-Fi) when it runs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$HOME/Library/Application Support/collie-island"
LOG="$STATE/resign.log"
# Values come from Config.local.xcconfig, the same file the app build reads; the env can override.
setting() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/Config.local.xcconfig" 2>/dev/null | tail -1; }
DEVICE="${COLLIE_ISLAND_DEVICE:-$(setting ISLAND_DEVICE_ID)}"
TEAM="${COLLIE_ISLAND_TEAM:-$(setting DEVELOPMENT_TEAM)}"
PREFIX="${COLLIE_ISLAND_BUNDLE_PREFIX:-$(setting BUNDLE_ID_PREFIX)}"
# Renew once fewer than this many days of the 7-day profile remain. Every renewal reinstalls, which
# closes the app and takes the island down until it is restarted, so the default waits until the
# profile is nearly spent. 7 renews on every run: a nightly reinstall that surfaces a failure the
# next morning rather than days later.
RENEW_BELOW_DAYS="${COLLIE_ISLAND_RENEW_BELOW_DAYS:-$(setting ISLAND_RENEW_BELOW_DAYS)}"
RENEW_BELOW_DAYS="${RENEW_BELOW_DAYS:-2}"
# Whether a failed install may restart this user's CoreDevice daemons and retry. They serve every
# device this Mac talks to, not only this app, so it is off unless asked for.
RESTART_COREDEVICE="${COLLIE_ISLAND_RESTART_COREDEVICE:-$(setting ISLAND_RESTART_COREDEVICE)}"
APP="$ROOT/build/Build/Products/Debug-iphoneos/CollieIsland.app"

mkdir -p "$STATE"
if [ -z "$DEVICE" ] || [ -z "$TEAM" ] || [ -z "$PREFIX" ]; then
  echo "resign: set DEVELOPMENT_TEAM, BUNDLE_ID_PREFIX and ISLAND_DEVICE_ID in $ROOT/Config.local.xcconfig" >&2
  exit 2
fi
log() { echo "$(date '+%F %T') $*" >>"$LOG"; }
notify() { osascript -e "display notification \"$1\" with title \"Collie Island\"" >/dev/null 2>&1; }

now=$(date +%s)
expiry=$(cat "$STATE/expiry" 2>/dev/null || echo 0)
left=$((expiry - now))

if [ "${1:-}" != "--force" ] && [ "$left" -gt $((RENEW_BELOW_DAYS * 86400)) ]; then
  log "skip: $((left / 3600))h left"
  exit 0
fi

# A failure is only worth interrupting the user for once the app is about to stop opening;
# before that, tomorrow's run gets another chance.
fail() {
  log "FAIL: $1 ($((left / 3600))h left)"
  [ "$left" -lt 86400 ] && notify "續簽失敗：$1。App 快到期了，把 iPhone 接上或連同一個 Wi-Fi。"
  exit 1
}

# Xcode reuses a cached profile while it is still valid, so a rebuild alone keeps the old
# expiry. Moving this app's profiles aside makes -allowProvisioningUpdates issue fresh 7-day
# ones (verified 2026-09-26: expiry moved from 13:11 to 13:48, i.e. now + 7 days).
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$STATE/old-profiles"
for f in "$PROFILES"/*.mobileprovision; do
  [ -f "$f" ] || continue
  id=$(security cms -D -i "$f" 2>/dev/null | plutil -extract Entitlements.application-identifier raw - 2>/dev/null)
  case "$id" in
    "$TEAM.$PREFIX.collieisland" | "$TEAM.$PREFIX.collieisland.widget") mv "$f" "$STATE/old-profiles/" ;;
  esac
done

# Building for a generic device keeps the build independent of whether the phone is reachable.
xcodebuild -project "$ROOT/CollieIsland.xcodeproj" -scheme CollieIsland -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$ROOT/build" \
  DEVELOPMENT_TEAM="$TEAM" BUNDLE_ID_PREFIX="$PREFIX" -allowProvisioningUpdates build >"$STATE/last-build.log" 2>&1 \
  || fail "build (see last-build.log)"

# The Mac's CoreDevice session can go stale while still listing the phone as connected
# ("Could not allocate a resource", 2026-09-27, phone unlocked). Restarting the per-user
# daemons (launchd relaunches them on demand) fixed it on the spot, so retry once that way.
install() { xcrun devicectl device install app --device "$DEVICE" "$APP" >"$STATE/last-install.log" 2>&1; }
# The next successful install overwrites last-install.log, so a nightly failure's reason was lost
# by the time anyone looked (6 of 12 nights, 2026-09-30 to 10-11). Each failed attempt is kept here.
keep_failure() { { echo "== $(date '+%F %T')"; cat "$STATE/last-install.log"; } >>"$STATE/install-failures.log"; }
if ! install; then
  keep_failure
  [ "$RESTART_COREDEVICE" = "YES" ] || fail "install: iPhone unreachable? (see install-failures.log)"
  log "install failed; restarting CoreDevice daemons and retrying"
  pkill -U "$(id -u)" -x CoreDeviceService; pkill -U "$(id -u)" -x remotepairingd
  install || { keep_failure; fail "install: iPhone unreachable? (see install-failures.log)"; }
fi

raw=$(security cms -D -i "$APP/embedded.mobileprovision" 2>/dev/null | plutil -extract ExpirationDate raw - 2>/dev/null)
new=$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$raw" +%s 2>/dev/null) || fail "read profile expiry"
echo "$new" >"$STATE/expiry"
log "installed; profile expires $raw"
