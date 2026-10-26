#!/usr/bin/env bash
#
# Load new or edited question-bank files into the running installation,
# without a rebuild or (usually) a restart.
#
# Usage:  sudo -u tka /opt/tka/deploy/add-questions.sh            # git pull first
#         sudo -u tka /opt/tka/deploy/add-questions.sh --no-pull  # files already copied in
#
# Steps: fetch content/bank/*.json, validate it, back up the database, run
# bank:sync, and copy any raster figures into the live release. Inline SVG
# figures live in the database, so new items are drawable the moment the sync
# finishes. New *raster* files (content/assets/) are the exception: the
# production server lists public/ once at startup, so the script tells you when
# a restart is needed for them to be served.
#
# Safe while students are mid-attempt: bank:sync only upserts, and every attempt
# keeps a frozen copy of its options and answer keys.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tka}"
PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
cd "$APP_DIR"

# The scripts need TKA_DB_PATH and the backup settings the service runs with.
if [ -r /etc/tka/tka.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/tka/tka.env
  set +a
fi
if [ -z "${TKA_DB_PATH:-}" ]; then
  echo "TKA_DB_PATH is not set and /etc/tka/tka.env is not readable." >&2
  exit 1
fi

if [ "$PULL" = 1 ]; then
  echo "==> Fetching the latest question files"
  git pull --ff-only
  if ! git diff --quiet HEAD@{1} HEAD -- package-lock.json src 2>/dev/null; then
    echo "NOTE: this pull also changed the app code or dependencies. The questions" >&2
    echo "      are synced now, but run deploy/deploy.sh to ship the code change." >&2
  fi
fi

# tsx comes from the dev dependencies installed by the last deploy.
if [ ! -x node_modules/.bin/tsx ]; then
  echo "==> Installing dependencies"
  npm ci
fi

echo "==> Validating the question bank"
npm run --silent bank:validate

echo "==> Backing up the database"
npm run --silent db:backup

echo "==> Syncing the question bank"
npm run --silent bank:sync

# bank:sync writes raster figures to $APP_DIR/public/bank-assets; the service
# serves them from the current release.
NEEDS_RESTART=0
if [ -d public/bank-assets ] && [ -e current ]; then
  LIVE="$(readlink -f current)/public/bank-assets"
  mkdir -p "$LIVE"
  while IFS= read -r -d '' file; do
    rel="${file#public/bank-assets/}"
    [ -e "$LIVE/$rel" ] || NEEDS_RESTART=1
  done < <(find public/bank-assets -type f -print0)
  cp -r public/bank-assets/. "$LIVE/"
fi

echo
npm run --silent bank:stats || true
echo
if [ "$NEEDS_RESTART" = 1 ]; then
  echo "Done. New image files were added; serve them with:"
  echo "  sudo systemctl restart tka"
  echo "(Best outside exam hours: a child mid-attempt sees \"gagal menyimpan\" for a few seconds.)"
else
  echo "Done. The new questions are drawable now; no restart needed."
fi
