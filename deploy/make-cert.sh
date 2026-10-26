#!/usr/bin/env bash
#
# Create a self-signed TLS certificate for a server with no domain name.
#
# Important: the certificate MUST carry a subjectAltName of type IP. Modern
# browsers ignore the Common Name and reject a certificate that only fills in
# CN, so the page will not open at all rather than merely showing a warning.
#
# Usage:  sudo ./make-cert.sh 203.0.113.10

set -euo pipefail

IP="${1:-}"
if [[ -z "$IP" ]]; then
  echo "Usage: $0 <server-ip-address>" >&2
  exit 1
fi

if ! [[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "Not a valid IP address: $IP" >&2
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
echo "Installing the Nginx config for IP $IP ..."
SRC="$(dirname "$0")/nginx-tka.conf"
DST=/etc/nginx/sites-available/tka
sed "s/SERVER_IP/$IP/g" "$SRC" > "$DST"
ln -sf "$DST" /etc/nginx/sites-enabled/tka
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo
echo "Done. Open https://$IP on the children's devices."
echo "The browser will warn about the certificate once; accept that warning."
echo "To remove the warning entirely, install $CRT as a trusted CA on those"
echo "devices (see docs/DEPLOY.md)."
