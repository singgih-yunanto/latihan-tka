#!/usr/bin/env bash
#
# Update an installation already sitting in /opt/tka.
# Safe to run repeatedly.
#
# Usage:  sudo -u tka --preserve-env=PATH ./deploy/deploy.sh   (reads /etc/tka/tka.env)
#         sudo systemctl restart tka
#
# The running service is never touched while this runs: each build is copied
# into its own directory under releases/, and only the final step points the
# `current` symlink at it. The old release keeps serving -- with all its own
# chunks -- until the restart, and rolling back is re-pointing the symlink.
#
# Migrations run against the live database before the restart, so for a few
# moments the old code runs on the new schema. Keep migrations additive (new
# tables, new nullable or defaulted columns) and this is harmless.
#
# Deploy outside exam hours where you can: a child mid-attempt during the
# restart gets "gagal menyimpan" for a few seconds until the runner retries.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tka}"
RELEASES="$APP_DIR/releases"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
cd "$APP_DIR"

# The build and the scripts need the service's settings: APP_ORIGIN and the
# Server Actions key are baked in at build time, and the migration and sync
# steps need TKA_DB_PATH. Sourcing (rather than `env $(cat ... | xargs)`) copes
# with the comments in the file.
if [ -r /etc/tka/tka.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/tka/tka.env
  set +a
else
  echo "WARNING: /etc/tka/tka.env is not readable by $(id -un); using the current environment." >&2
fi
if [ -z "${APP_ORIGIN:-}" ]; then
  echo "WARNING: APP_ORIGIN is not set; answers may fail to save behind the proxy." >&2
fi
if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then
  echo "WARNING: NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set; pages open during the" >&2
  echo "         restart will fail to save until they are reloaded. See docs/DEPLOY.md." >&2
fi

echo "==> Fetching the latest changes"
git pull --ff-only

# Dev dependencies are still required, because the build needs TypeScript and
# Tailwind.
echo "==> Installing dependencies"
npm ci

echo "==> Checking the code and the question bank"
npx tsc --noEmit
npm test
npm run bank:validate

echo "==> Building the app"
npm run build

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$RELEASES/$STAMP"
echo "==> Assembling release $STAMP"
mkdir -p "$RELEASES"
cp -r .next/standalone "$TARGET"

# The Next.js standalone bundle ships neither .next/static nor public/, so both
# are copied in by hand to keep CSS, fonts and question figures served.
mkdir -p "$TARGET/.next"
cp -r .next/static "$TARGET/.next/static"

# Next's file tracing also copies ./data into the bundle. The real database
# lives in /var/lib/tka, so this copy is just leftover test data.
rm -rf "$TARGET/data"

# Everything that writes to the live database comes last, after the build
# has succeeded, and starts with a backup.
echo "==> Backing up the database"
npm run db:backup

echo "==> Running database migrations"
npm run db:migrate

# Run before copying public/, because bank:sync writes raster question figures
# into public/bank-assets.
echo "==> Syncing the question bank"
npm run bank:sync
if [ -d public ]; then
  cp -r public "$TARGET/public"
fi

echo "==> Switching to the new release"
ln -sfn "$TARGET" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"

# Old releases beyond the newest few are removed.
ls -1d "$RELEASES"/*/ 2>/dev/null | sort | head -n -"$KEEP_RELEASES" | xargs -r rm -rf

echo
echo "Done. Reload the service with:"
echo "  sudo systemctl restart tka"
echo "  sudo journalctl -u tka -f"
echo "Roll back by pointing $APP_DIR/current at an older directory in $RELEASES."
