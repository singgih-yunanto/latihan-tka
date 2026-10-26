import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import { requireMigrated } from './db-ready';
import { backfillCredentials } from '../src/db/backfill';
import { reportCredentials } from './credentials';
import { AVATAR_COLORS } from '../src/lib/ui';

/**
 * Seed the initial student list. Names can be passed as arguments:
 *   npm run seed:users -- Dina Bayu Rani
 * With no arguments a few sample names are used so the app can be tried out.
 *
 * Each student is left without a password hash and then handed one by the same
 * backfill the migration uses, so seeded and migrated accounts end up in an
 * identical state: a derived username, a one-time password of its own, and the
 * forced change flag set.
 *
 * This creates students only. The first admin comes from `npm run create:admin`,
 * and parent accounts are created from the admin panel.
 */

const CONTOH = ['Dina Maharani', 'Bayu Pratama', 'Rani Safitri'];

function main() {
  const namaDariArgumen = process.argv.slice(2).filter(Boolean);
  const daftar = namaDariArgumen.length > 0 ? namaDariArgumen : CONTOH;

  const dbPath = resolveDbPath();
  const sqlite = openSqlite(dbPath);
  requireMigrated(sqlite, dbPath);
  const sudahAda = sqlite.prepare('SELECT nama FROM users').all() as { nama: string }[];
  const existing = new Set(sudahAda.map((row) => row.nama.toLowerCase()));

  const insert = sqlite.prepare(
    "INSERT INTO users (nama, role, avatar_warna) VALUES (?, 'student', ?)",
  );
  let ditambah = 0;

  const run = sqlite.transaction(() => {
    for (const nama of daftar) {
      if (existing.has(nama.toLowerCase())) continue;
      const warna = AVATAR_COLORS[(existing.size + ditambah) % AVATAR_COLORS.length];
      insert.run(nama, warna);
      ditambah += 1;
    }
  });
  run();

  const issued = backfillCredentials(sqlite);

  const total = (
    sqlite.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student'").get() as { n: number }
  ).n;
  sqlite.close();

  console.log(`${ditambah} student(s) added. Total students now: ${total}.`);
  reportCredentials(issued);
  if (ditambah === 0 && daftar.length > 0) {
    console.log('Every name already existed; nothing was duplicated.');
  }
}

main();
