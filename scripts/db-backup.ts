import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { openSqlite } from '../src/db/client';
import { resolveBackupDir, resolveDbPath } from '../src/db/path';

/**
 * Database backup.
 *
 * Uses VACUUM INTO rather than copying the raw .db file. While the app is
 * running in WAL mode a plain copy can catch the file mid-write; VACUUM INTO
 * always produces a consistent, compacted copy without stopping the service.
 */

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function main() {
  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`No database found at ${dbPath}.`);
    process.exit(1);
  }

  const dir = resolveBackupDir();
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, `tka-${stamp()}.db`);
  const sqlite = openSqlite(dbPath);

  // VACUUM INTO refuses to overwrite an existing file, so names are unique.
  sqlite.prepare('VACUUM INTO ?').run(target);

  sqlite.close();

  // Opened read-only and directly: openSqlite would switch the backup into WAL
  // mode, leaving -wal/-shm side files next to what should be one portable file.
  const verify = new Database(target, { readonly: true, fileMustExist: true });
  const check = verify.pragma('integrity_check', { simple: true });
  verify.close();

  if (check !== 'ok') {
    console.error(`Backup failed its integrity check: ${check}`);
    process.exit(1);
  }

  const keep = Math.max(1, Number(process.env.TKA_BACKUP_KEEP ?? '14') || 14);
  const lama = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('tka-') && name.endsWith('.db'))
    .sort()
    .reverse()
    .slice(keep);

  for (const name of lama) fs.rmSync(path.join(dir, name), { force: true });

  const ukuran = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
  console.log(`Backup created: ${target} (${ukuran} MB, integrity_check ok)`);
  if (lama.length > 0) console.log(`${lama.length} old backup(s) removed, keeping ${keep}.`);
}

main();
