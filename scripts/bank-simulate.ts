import Database from 'better-sqlite3';
import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import { countAvailable, drawForUser } from '../src/domain/draw';
import { humanizeDuration, proportionalSeconds } from '../src/domain/timing';
import { SUBJECTS, SUBJECT_LABEL, type Subject } from '../src/domain/blueprint';

/**
 * Answers the question that always comes up: how many more full TKA papers can
 * a student sit before running out of unseen questions?
 *
 * The simulation runs against an in-memory copy of the database, so real
 * student history is never touched.
 */

const PAKET: { subject: Subject; count: number }[] = SUBJECTS.map((subject) => ({
  subject,
  count: 30,
}));

function salinKeMemori(sumber: string): Database.Database {
  const asal = openSqlite(sumber);
  const memori = new Database(':memory:');

  // Only some tables are copied (students, questions, history), so references
  // to others such as attempts are deliberately left dangling. This is a
  // throwaway copy used for arithmetic, so foreign key checks are turned off.
  memori.pragma('foreign_keys = OFF');

  // SQLite's built-in tables such as sqlite_sequence cannot be recreated.
  const skema = asal
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { sql: string | null }[];
  memori.exec(skema.map((r) => r.sql).filter((sql): sql is string => Boolean(sql)).join(';\n'));

  for (const tabel of ['users', 'questions', 'user_question_history']) {
    const baris = asal.prepare(`SELECT * FROM ${tabel}`).all() as Record<string, unknown>[];
    if (baris.length === 0) continue;
    const kolom = Object.keys(baris[0]);
    const stmt = memori.prepare(
      `INSERT INTO ${tabel} (${kolom.join(',')}) VALUES (${kolom.map(() => '?').join(',')})`,
    );
    const masukkan = memori.transaction(() => {
      for (const row of baris) stmt.run(...kolom.map((k) => row[k]));
    });
    masukkan();
  }

  asal.close();
  return memori;
}

function main() {
  const dbPath = resolveDbPath();
  const db = salinKeMemori(dbPath);

  const users = db.prepare('SELECT id, nama FROM users WHERE aktif = 1 ORDER BY nama').all() as {
    id: number;
    nama: string;
  }[];

  const totalSoal = PAKET.reduce((sum, p) => sum + p.count, 0);
  console.log(
    `Simulating a full TKA paper: ${totalSoal} questions (${PAKET.map((p) => `${SUBJECT_LABEL[p.subject]} ${p.count}`).join(' + ')})`,
  );
  console.log(`Proportional time per paper: ${humanizeDuration(proportionalSeconds(totalSoal))}\n`);

  if (users.length === 0) {
    console.log('No active students yet.');
    db.close();
    return;
  }

  const catat = db.prepare(
    `INSERT INTO user_question_history (user_id, question_id, attempt_id, seen_at)
     VALUES (?, ?, NULL, unixepoch()) ON CONFLICT(user_id, question_id) DO NOTHING`,
  );

  for (const u of users) {
    const stokAwal = SUBJECTS.map((s) => countAvailable(db, u.id, s));
    let paket = 0;

    // Keep drawing until unseen stock no longer covers a full paper.
    for (;;) {
      let drawn: string[];
      try {
        drawn = drawForUser(db, u.id, PAKET, false);
      } catch {
        break;
      }
      for (const id of drawn) catat.run(u.id, id);
      paket += 1;
      if (paket > 50) break;
    }

    const sisa = SUBJECTS.map((s) => countAvailable(db, u.id, s));
    console.log(
      `${u.nama.padEnd(18)} can sit ${paket} more full paper(s)` +
        `\n${' '.repeat(18)}${'unseen now'.padEnd(22)}: ${SUBJECTS.map((s, i) => `${SUBJECT_LABEL[s]} ${stokAwal[i]}`).join(', ')}` +
        `\n${' '.repeat(18)}${`left after ${paket}`.padEnd(22)}: ${SUBJECTS.map((s, i) => `${SUBJECT_LABEL[s]} ${sisa[i]}`).join(', ')}\n`,
    );
  }

  console.log('Ran against an in-memory copy; real student history is unchanged.');
  db.close();
}

main();
