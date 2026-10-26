#!/usr/bin/env bash
#
# Create a self-signed TLS certificate for a server with no domain name.
#
# Important: the certificate MUST carry a subjectAltName of type IP. Modern
# browsers ignore the Common Name and reject a certificate that only fills in
# CN, so the page will not open at all rather than merely showing a warning.
#
# Usage:  sudo ./make-cert.sh 203.0.113.10                 # HTTPS on 443
#         sudo ./make-cert.sh 203.0.113.10 --port 8443     # 443 is taken by something else
#
# On a port other than 443 the port-80 redirect is left out, and the app's
# address becomes https://IP:PORT -- set APP_ORIGIN to exactly that.

set -euo pipefail

IP=""
PORT=443
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) IP="$1"; shift ;;
  esac
done

if [[ -z "$IP" ]]; then
  echo "Usage: $0 <server-ip-address> [--port <https-port>]" >&2
  exit 1
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "Not a valid port: $PORT" >&2
  exit 1
fi

if ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Not a valid IP address: $IP" >&2
  exit 1
fi

SRC="$(dirname "$0")/nginx-tka.conf"
DST=/etc/nginx/sites-available/tka

# Refuse a port another program already listens on; Nginx would pass its config
# test and then fail to bind on reload. A port our own config already uses is
# fine: that is a re-run.
if ss -Hltn "sport = :$PORT" | grep -q .   && ! grep -qE "listen ${PORT}( |;)" "$DST" 2>/dev/null; then
  echo "Port $PORT is already in use:" >&2
  ss -Hltnp "sport = :$PORT" >&2 || true
  for candidate in 8443 9443 10443 18443 28443; do
    if ! ss -Hltn "sport = :$candidate" | grep -q .; then
      echo "Pick another one with --port; $candidate is free: --port $candidate" >&2
      break
    fi
  done
  exit 1
fi
# Port 80 carries no certificate, so Nginx can share it with other sites; only
# a different program holding it is a problem.
if (( PORT == 443 )) && ss -Hltnp "sport = :80" | grep -q .   && ! ss -Hltnp "sport = :80" | grep -q '"nginx"'; then
  echo "Port 80 is held by another program, so the HTTP redirect cannot be installed:" >&2
  ss -Hltnp "sport = :80" >&2 || true
  echo "Use --port with another HTTPS port, which leaves the redirect out." >&2
  exit 1
fi

DIR=/etc/ssl/tka
CRT="$DIR/tka.crt"
KEY="$DIR/tka.key"

mkdir -p "$DIR"

openssl req -x509 -nodes \
  -newkey rsa:2048 \
  -days 3650 \
  -keyout "$KEY" \
  -out "$CRT" \
  -subj "/C=ID/O=Latihan TKA/CN=$IP" \
  -addext "subjectAltName=IP:$IP" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 640 "$KEY"
chmod 644 "$CRT"
chown root:root "$CRT" "$KEY"
if getent group www-data >/dev/null; then
  chgrp www-data "$KEY"
fi

echo
echo "Certificate created:"
echo "  $CRT"
echo "  $KEY"
echo
openssl x509 -in "$CRT" -noout -subject -ext subjectAltName -dates

echo
echo "Installing the Nginx config for $IP, HTTPS port $PORT ..."
if (( PORT == 443 )); then
  sed -e "s/SERVER_IP/$IP/g" -e "s/HTTPS_PORT/$PORT/g" "$SRC" > "$DST"
  # The stock default site also claims port 80.
  rm -f /etc/nginx/sites-enabled/default
  URL="https://$IP"
else
  # Another site owns 443 (and usually 80), so leave both alone.
  sed -e '/^# BEGIN http-redirect/,/^# END http-redirect/d'       -e "s/SERVER_IP/$IP/g" -e "s/HTTPS_PORT/$PORT/g" "$SRC" > "$DST"
  URL="https://$IP:$PORT"
fi
ln -sf "$DST" /etc/nginx/sites-enabled/tka

nginx -t
systemctl reload nginx

echo
echo "Done. Open $URL on the children's devices."
echo
echo "Set APP_ORIGIN=$URL in /etc/tka/tka.env (exactly, no trailing slash),"
echo "open the port in the firewall (sudo ufw allow $PORT/tcp), then rebuild:"
echo "  sudo -u tka --preserve-env=PATH /opt/tka/deploy/deploy.sh && sudo systemctl restart tka"
echo
echo "The browser will warn about the certificate once; accept that warning."
echo "To remove the warning entirely, install $CRT as a trusted CA on those"
echo "devices (see docs/DEPLOY.md)."
