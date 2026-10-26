# Installing on a Linux Server

The app runs directly on the operating system as a single Node process
supervised by systemd. No containers, no orchestration.

```
Internet ──443──▶ Nginx (self-signed TLS, SAN = server IP)
                     │  proxy_pass + X-Forwarded-Proto: https
                     ▼
                 Node · Next.js standalone · 127.0.0.1:3000   ← systemd: tka.service
                     │
                     ▼
                 /var/lib/tka/tka.db (+ -wal, -shm)           ← systemd: StateDirectory
```

Tested on Ubuntu 22.04/24.04. Minimum: 1 vCPU, 1 GB RAM, 5 GB disk.

---

## 1. Prepare the system

```bash
sudo apt update
sudo apt install -y curl git nginx openssl sqlite3

# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version      # must be v22.x
```

`better-sqlite3` normally downloads a prebuilt binary. If it tries to compile on
your server instead, install the toolchain:

```bash
sudo apt install -y build-essential python3
```

## 2. User and directories

```bash
sudo useradd --system --create-home --home-dir /var/lib/tka-home --shell /usr/sbin/nologin tka
sudo mkdir -p /opt/tka /etc/tka /var/backups/tka
sudo chown -R tka:tka /opt/tka /var/backups/tka
```

`/var/lib/tka` does not need to be created by hand — systemd creates it through
`StateDirectory=tka` the first time the service starts.

## 3. Fetch the code

```bash
sudo -u tka git clone <YOUR-REPO-URL> /opt/tka
cd /opt/tka
```

## 4. Configuration file

```bash
sudo tee /etc/tka/tka.env >/dev/null <<'EOF'
# Public origin of the app. REQUIRED — without it Server Actions are rejected
# when the app is reached through the reverse proxy and student answers fail
# to save.
APP_ORIGIN=https://203.0.113.10

# Keeps Server Actions valid across deploys. Generate once, never change:
#   openssl rand -base64 32
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=PASTE-THE-GENERATED-KEY

# Optional. Dates are shown in WIB unless set (Asia/Makassar, Asia/Jayapura).
NEXT_PUBLIC_TKA_TIMEZONE=Asia/Jakarta

TKA_DB_PATH=/var/lib/tka/tka.db
TKA_BACKUP_DIR=/var/backups/tka
TKA_BACKUP_KEEP=14
EOF

sudo chown root:tka /etc/tka/tka.env
sudo chmod 640 /etc/tka/tka.env
```

Replace `203.0.113.10` with your server's IP address and paste a key generated
with `openssl rand -base64 32`.

There is no shared default password. Every account the admin panel or a script
creates gets its own random one-time password, shown once, valid for 7 days,
and replaced by the holder at first sign-in.

> `TKA_DB_PATH` is mandatory in production. The app refuses to start serving
> without it rather than silently falling back to a path inside the build
> output.

## 5. Build the app

```bash
cd /opt/tka
sudo -u tka --preserve-env=PATH env $(sudo cat /etc/tka/tka.env | xargs) ./deploy/deploy.sh
```

The script installs dependencies, runs the type check, the tests and the bank
validator, and builds the app into a new directory under `/opt/tka/releases/`.
Only then does it back up the database, run migrations, sync the bank and point
the `/opt/tka/current` symlink at the new build. The running service keeps
serving the previous release until you restart it, and rolling back is just
pointing `current` at an older release and restarting.

Add student names. Each one gets a username derived from their first name and
a one-time password, printed once, which they must change at first sign-in:

```bash
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run seed:users -- "Dina" "Bayu" "Rani"
```

Then create the first admin. It prompts for the password rather than reading it
from the command line, so it never lands in your shell history:

```bash
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run create:admin -- --username ayah --nama "Nama Lengkap"
```

That admin signs in and creates everything else: the parent accounts, any
further students, and the links between a parent and their children. The script
refuses to run a second time unless you pass `--force`.

To reset passwords from the server, for example when the only admin has
forgotten theirs, use `user:reset-password`. It works like **Reset sandi** in
the admin panel: each account gets a new one-time password, printed once, and is
signed out everywhere.

```bash
cd /opt/tka
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run user:reset-password -- --list
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run user:reset-password -- ayah
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run user:reset-password -- --role student
sudo -u tka env $(sudo cat /etc/tka/tka.env | xargs) npm run user:reset-password -- --pending
```

> **Upgrading an installation that predates accounts?** `npm run db:migrate`
> issues a username and a one-time password to every account that has none,
> and prints the list. It only touches accounts with no password set, so
> re-running it never resets anyone.
>
> **Upgrading from a release with `/opt/tka/.next/standalone` in the unit
> file?** Copy the new `deploy/tka.service` over the installed one and run
> `sudo systemctl daemon-reload` before restarting: it now starts
> `/opt/tka/current/server.js`.

## 6. Run it as a service

```bash
sudo cp /opt/tka/deploy/tka.service /etc/systemd/system/
sudo cp /opt/tka/deploy/tka-backup.service /etc/systemd/system/
sudo cp /opt/tka/deploy/tka-backup.timer /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now tka
sudo systemctl enable --now tka-backup.timer

sudo systemctl status tka
curl -I http://127.0.0.1:3000/          # expect 200
```

Follow the logs:

```bash
sudo journalctl -u tka -f
```

## 7. HTTPS and Nginx

Because this server is reached by IP address with no domain name, Let's Encrypt
is not an option. Use a self-signed certificate:

```bash
sudo /opt/tka/deploy/make-cert.sh 203.0.113.10
```

That script creates the certificate, installs the Nginx config with the right
IP, tests the config, and reloads Nginx.

> **The certificate must carry a `subjectAltName` of type IP.** Modern browsers
> ignore the Common Name. A certificate that only fills in CN is rejected
> outright, so the page will not open at all — not merely warn. The script above
> handles this.

Firewall:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 3000 does not need opening, because Node only listens on `127.0.0.1`.

## 8. The certificate warning on children's devices

Open `https://203.0.113.10`. The browser will warn that the certificate is not
recognised. There are two options.

**Quick — accept the warning.** Chrome: *Advanced → Proceed to site*. Safari on
iOS: *Show Details → visit this website*. Once per browser.

**Tidy — install the certificate as a trusted CA**, so there is no warning at
all. Copy `/etc/ssl/tka/tka.crt` to the device, then:

- **Android** — Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate
- **iOS/iPadOS** — open the file, then Settings → General → VPN & Device
  Management to install the profile. Then go to Settings → General → About →
  Certificate Trust Settings and enable full trust for it. **This last step is
  easy to miss**, and without it the certificate is still treated as untrusted.
- **Windows** — double-click the file → Install Certificate → Local Machine →
  Trusted Root Certification Authorities

---

## Post-install checks

1. `sudo systemctl status tka` is active and `sudo journalctl -u tka -n 50` is
   free of errors
2. Open `https://<IP>` from a phone, accept the certificate warning, and confirm
   the sign-in page appears
3. Sign in as the admin you created with `npm run create:admin`. Then, signed
   out, open `/u`, `/wali` and `/admin` in turn: each must bounce back to
   `/masuk` rather than render
4. **Test Server Actions:** start an assignment, answer a few questions, confirm
   "tersimpan" appears in the header, then reload the page and check the answers
   are still there. This is the most important check that `APP_ORIGIN` and
   `X-Forwarded-Proto` are right. If it fails, the log will mention Server
   Actions or Origin.
5. `sudo systemctl restart tka` in the middle of a live attempt, then reload on
   the phone: answers and remaining time must both survive
6. Reboot the server and confirm the service comes back with data intact
7. `sudo systemctl start tka-backup`, then verify the result:
   `sqlite3 /var/backups/tka/tka-*.db "PRAGMA integrity_check;"` should print `ok`

## Adding questions to a running server

New questions need no rebuild and, as a rule, no restart. The bank files are
the source of truth, so the flow is: write them on your own machine, ship the
files, sync them into the live database.

**1. On your machine** — write the batch (see `docs/ADMIN-GUIDE.md`, "Adding
questions to the bank"), then check it:

```bash
npm run bank:validate
npm test                 # tests/bank.test.ts also validates the bank
git add content/bank content/assets
git commit -m "Bank: 40 Matematika data & peluang"
git push
```

**2. On the server:**

```bash
sudo -u tka bash /opt/tka/deploy/add-questions.sh
```

The script pulls, validates, backs up the database, runs `bank:sync`, copies
any raster figures into the live release, and prints `bank:stats`. New items
are drawable for the next assignment created; papers already drawn are not
touched.

**No git on the server, or an urgent fix?** Copy the files in and skip the pull:

```bash
scp content/bank/matematika-data_peluang-004.json server:/tmp/
ssh server 'sudo install -o tka -g tka -m 644 /tmp/matematika-data_peluang-004.json /opt/tka/content/bank/ \
  && sudo -u tka bash /opt/tka/deploy/add-questions.sh --no-pull'
```

Commit the same file to the repository afterwards. Otherwise the next
`deploy.sh` either fails its `git pull` (an untracked file would be
overwritten) or, if you edited a tracked file, refuses to pull over the local
change.

**When a restart is needed:** only when a batch adds new image files under
`content/assets/`, because the production server lists `public/` once at
startup. The script says so at the end. Inline SVG figures live in the
database and never need one.

**Fixing or withdrawing an item** works the same way: edit the file and run the
script. Removing an item from the files deactivates it, and scores already
given never change, because each attempt keeps its own copy of the key. To pull
an item out of the draw immediately, without touching files, use **Tarik dari
undian** on `/admin/bank`.

## Routine maintenance

| Task | Command |
|---|---|
| Update the app | `sudo -u tka /opt/tka/deploy/deploy.sh && sudo systemctl restart tka` |
| Add questions only | `sudo -u tka bash /opt/tka/deploy/add-questions.sh` (see above; no restart unless it says so) |
| Manual backup | `sudo systemctl start tka-backup` |
| Check the backup schedule | `systemctl list-timers tka-backup.timer` |
| Restore a backup | stop the service, copy the backup file over `/var/lib/tka/tka.db`, delete the `*-wal` and `*-shm` files, start the service |
| Roll back a deploy | `sudo ln -sfn /opt/tka/releases/<older> /opt/tka/current && sudo systemctl restart tka` |
| Off-site copy of backups | copy `/var/backups/tka` to another machine regularly, e.g. `rsync -a server:/var/backups/tka/ ./tka-backups/`; a backup on the same disk does not survive the disk |
| Test a restore | every few months, restore the newest backup into a scratch copy (`TKA_DB_PATH=/tmp/tka-test.db`) and open it; an untested backup is a hope, not a backup |
| Tail the logs | `sudo journalctl -u tka -f` |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Answers do not save, everything else works | `APP_ORIGIN` is unset or does not exactly match the address being used, or Nginx is not forwarding `Host`/`X-Forwarded-Proto` |
| Browser refuses to open the page rather than just warning | The certificate has no `subjectAltName` of type IP; regenerate it with `make-cert.sh` |
| Page renders with no styling | `.next/static` was not copied into the release; re-run `deploy.sh` |
| Saves fail right after every deploy | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is missing at build time; `deploy.sh` prints a warning |
| Too many sign-in attempts (HTTP 429) for a whole class | The Nginx `tka_login` limit is per address; raise `rate`/`burst` in `nginx-tka.conf` |
| Question figures missing | New image files need a restart; run `add-questions.sh` then `sudo systemctl restart tka`, or re-run `deploy.sh` |
| `add-questions.sh` stops at "problem(s) in the question bank" | Nothing was written. Fix the file it names, or run `npm run bank:validate` locally for the full list |
| `TKA_DB_PATH belum diisi` in the log | The environment file is missing or not readable by the `tka` user |
| `SQLITE_CANTOPEN` in the log | `TKA_DB_PATH` points outside `/var/lib/tka`, which `ProtectSystem=strict` forbids writing to |
| Service restarts in a loop | Check `sudo journalctl -u tka -n 100`; usually `/etc/tka/tka.env` cannot be read by the `tka` user |
