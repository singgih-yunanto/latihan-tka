import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/** An in-memory database on the current schema, for testing question draws. */
export function makeTestDb(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  const dir = path.resolve(process.cwd(), 'src/db/migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  return sqlite;
}

export function addUser(
  sqlite: Database.Database,
  nama: string,
  role: 'admin' | 'parent' | 'student' = 'student',
): number {
  const info = sqlite
    .prepare('INSERT INTO users (nama, role, username) VALUES (?, ?, ?)')
    .run(nama, role, nama.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return Number(info.lastInsertRowid);
}

/** Links a parent account to one of its children. */
export function linkParent(
  sqlite: Database.Database,
  parentId: number,
  studentId: number,
): void {
  sqlite
    .prepare('INSERT INTO parent_children (parent_id, student_id, created_at) VALUES (?, ?, 0)')
    .run(parentId, studentId);
}

type QuestionSeed = {
  id: string;
  subject: string;
  domain?: string;
  competency?: string;
  difficulty?: string;
  type?: string;
};

const DEFAULT_DOMAIN: Record<string, string> = {
  matematika: 'bilangan',
  bahasa_indonesia: 'teks_informasi',
  ipas: 'energi_gaya',
};

const DEFAULT_COMPETENCY: Record<string, string> = {
  matematika: 'penalaran',
  bahasa_indonesia: 'inferensial',
  ipas: 'penerapan',
};

export function addQuestion(sqlite: Database.Database, seed: QuestionSeed): string {
  sqlite
    .prepare(
      `INSERT INTO questions
         (id, subject, content_domain, competency, difficulty, type, stem_md,
          options_json, answer_json, explanation_md, fingerprint, batch, aktif)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      seed.id,
      seed.subject,
      seed.domain ?? DEFAULT_DOMAIN[seed.subject] ?? 'bilangan',
      seed.competency ?? DEFAULT_COMPETENCY[seed.subject] ?? 'penalaran',
      seed.difficulty ?? 'sedang',
      seed.type ?? 'pg',
      `Soal ${seed.id}`,
      JSON.stringify({ kind: 'choices', choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }),
      JSON.stringify({ kind: 'single', correct: 'a' }),
      'Pembahasan',
      seed.id,
      'uji',
    );
  return seed.id;
}

/** Fill the bank with a number of questions for one subject. */
export function seedQuestions(
  sqlite: Database.Database,
  subject: string,
  count: number,
  prefix = subject,
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(addQuestion(sqlite, { id: `${prefix}-${String(i).padStart(3, '0')}`, subject }));
  }
  return ids;
}
