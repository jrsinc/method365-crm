#!/usr/bin/env bash
# Safe update for the live CRM.
#
#   bash scripts/update.sh            # pull, build, switch, restart, check
#   bash scripts/update.sh --force    # rebuild even if already on the latest version
#
# The live site keeps running from .next while the new version builds in .next-build.
# Only if the build succeeds are the folders swapped and the app restarted. If the new
# version doesn't answer after the restart, the previous version is put back automatically.
# A failed update therefore never leaves the site down (no more 502 after updating).
#
# Settings (optional): PM2_NAME (default method365-crm), PORT (default 3001).
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR" || exit 1
NAME="${PM2_NAME:-method365-crm}"
PORT="${PORT:-3001}"
BUILD_DIR=".next-build"
STAMP=".next/DEPLOYED_COMMIT"
URL="http://127.0.0.1:${PORT}/login"

say()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!!  %s\n' "$*" >&2; exit 1; }

# Only one update at a time.
LOCK="$APP_DIR/.update.lock"
mkdir "$LOCK" 2>/dev/null || fail "Another update is already running (remove $LOCK if it isn't)."
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

command -v pm2 >/dev/null || fail "pm2 isn't installed. See DEPLOY.md, step 4."
pm2 describe "$NAME" >/dev/null 2>&1 || fail "pm2 has no app called '$NAME'. Start it once as in DEPLOY.md, step 4."

say "Getting the latest version"
git pull --ff-only || fail "git pull failed (files changed on the server?). Nothing was changed; the site is still running."
NEW="$(git rev-parse HEAD)"
DEPLOYED="$(cat "$STAMP" 2>/dev/null || true)"
if [ "$NEW" = "$DEPLOYED" ] && [ "${1:-}" != "--force" ]; then
  say "Already running the latest version ($(git log -1 --format='%h %s')). Nothing to do."
  exit 0
fi

# Install packages only when they changed (this is the one step that touches the running app).
if [ ! -d node_modules ] || [ -z "$DEPLOYED" ] || ! git diff --quiet "$DEPLOYED" "$NEW" -- package-lock.json 2>/dev/null; then
  say "Packages changed: installing (the site may pause for a moment)"
  npm ci --no-audit --no-fund || fail "npm ci failed. The site is still running the previous build; run this script again."
fi

say "Building the new version (the site stays up meanwhile)"
rm -rf "$BUILD_DIR"
if ! NEXT_DIST_DIR="$BUILD_DIR" npm run build; then
  rm -rf "$BUILD_DIR"
  git checkout -q -- tsconfig.json 2>/dev/null
  fail "The build failed (see the error above). Nothing was switched: the site is still running the previous version."
fi
# next build may add the temporary folder to tsconfig.json; keep the checkout clean for the next git pull.
git checkout -q -- tsconfig.json 2>/dev/null

say "Switching to the new version"
rm -rf .next-previous
[ -d .next ] && mv .next .next-previous
mv "$BUILD_DIR" .next
echo "$NEW" > "$STAMP"
pm2 restart "$NAME"

say "Checking that the site answers"
code=000
for _ in $(seq 1 30); do
  sleep 2
  code="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
  if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 500 ]; then
    say "Done. The CRM is running $(git log -1 --format='%h %s') (HTTP $code)."
    exit 0
  fi
done

printf '\n!!  The new version did not answer (last HTTP %s). Putting the previous version back.\n' "$code" >&2
pm2 logs "$NAME" --err --lines 30 --nostream
if [ -d .next-previous ]; then
  rm -rf .next-failed
  mv .next .next-failed
  mv .next-previous .next
  pm2 restart "$NAME"
  fail "Rolled back to the previous version. The failed build is kept in .next-failed; send the error lines above to your developer."
fi
fail "There was no previous version to go back to. Check: pm2 logs $NAME"
