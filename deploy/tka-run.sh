#!/usr/bin/env bash
#
# Run an npm script on the server with the service's settings loaded, so there
# is no need to pass /etc/tka/tka.env on the command line.
#
# Usage:  sudo -u tka /opt/tka/deploy/tka-run.sh <script> [-- args...]
#
#   sudo -u tka /opt/tka/deploy/tka-run.sh create:admin -- --username ayah --nama "Nama Lengkap"
#   sudo -u tka /opt/tka/deploy/tka-run.sh user:reset-password -- --list
#   sudo -u tka /opt/tka/deploy/tka-run.sh seed:users -- "Dina" "Bayu"
#   sudo -u tka /opt/tka/deploy/tka-run.sh bank:stats
#
# Run without arguments to list the available scripts.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tka}"
ENV_FILE="${TKA_ENV_FILE:-/etc/tka/tka.env}"

if [ ! -r "$ENV_FILE" ]; then
  echo "$ENV_FILE is not readable by $(id -un). Run this as the tka user: sudo -u tka $0 ..." >&2
  exit 1
fi

# Sourced rather than passed through `env $(cat ... | xargs)`, which breaks on
# the comment lines in the file.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

cd "$APP_DIR"

if [ "$#" -eq 0 ]; then
  sed -n '2,13p' "$0"
  echo
  npm run
  exit 0
fi

exec npm run "$@"
