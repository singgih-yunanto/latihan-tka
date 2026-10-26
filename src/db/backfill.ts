import type { Database } from 'better-sqlite3';
import { generateTempPassword, hashPassword, tempPasswordExpiry, usernameFromName } from '@/lib/password';
import { parseAnswerKey, parseIdList, parseQuestionBody } from '@/domain/question';

export type IssuedCredential = { nama: string; username: string; password: string };

/**
 * Gives a login to accounts that predate the authentication system, or that an
 * admin created without issuing credentials.
 *
 * Idempotent by design: it only touches rows where `password_hash IS NULL`, so
 * re-running migrations never resets a password somebody has already chosen.
 *
 * Lives here rather than in the migration script so it can be tested against an
 * in-memory database without running a migration.
 */
export function backfillCredentials(sqlite: Database): IssuedCredential[] {
  const pending = sqlite
    .prepare('SELECT id, nama, username FROM users WHERE password_hash IS NULL ORDER BY id')
    .all() as { id: number; nama: string; username: string | null }[];

  if (pending.length === 0) return [];

  const taken = new Set(
    (
      sqlite.prepare('SELECT username FROM users WHERE username IS NOT NULL').all() as {
        username: string;
      }[]
    ).map((r) => r.username.toLowerCase()),
  );

  const update = sqlite.prepare(
    `UPDATE users
        SET username = ?, password_hash = ?, must_change_password = 1,
            temp_password_expires_at = ?,
            role = COALESCE(NULLIF(role, ''), 'student')
      WHERE id = ?`,
  );

  const created: IssuedCredential[] = [];

  const run = sqlite.transaction(() => {
    for (const user of pending) {
      // An account that already has a login name keeps it; only the password is
      // missing. Deriving a fresh one here would rename somebody for no reason.
      let username = user.username ?? usernameFromName(user.nama);
      if (!user.username) {
        let suffix = 2;
        while (taken.has(username)) {
          username = `${usernameFromName(user.nama)}${suffix}`;
          suffix += 1;
        }
      }
      taken.add(username);

      // Each account gets a one-time password of its own; see generateTempPassword.
      const password = generateTempPassword();
      update.run(username, hashPassword(password), tempPasswordExpiry(), user.id);
      created.push({ nama: user.nama, username, password });
    }
  });
  run();

  return created;
}

/**
 * Freezes the type, options and key of every item into attempts drawn before
 * attempts.item_snapshot_json existed, using the bank as it stands now. From
 * then on a bank edit can no longer change how those attempts are graded or
 * reviewed. Idempotent: only rows with no snapshot are touched.
 */
export function backfillSnapshots(sqlite: Database): number {
  const pending = sqlite
    .prepare('SELECT id, question_order_json AS orderJson FROM attempts WHERE item_snapshot_json IS NULL')
    .all() as { id: number; orderJson: string }[];
  if (pending.length === 0) return 0;

  const getQuestion = sqlite.prepare(
    'SELECT type, options_json AS optionsJson, answer_json AS answerJson FROM questions WHERE id = ?',
  );
  const save = sqlite.prepare('UPDATE attempts SET item_snapshot_json = ? WHERE id = ?');

  sqlite.transaction(() => {
    for (const attempt of pending) {
      const snapshot: Record<string, unknown> = {};
      for (const questionId of parseIdList(attempt.orderJson)) {
        const row = getQuestion.get(questionId) as
          | { type: string; optionsJson: string; answerJson: string }
          | undefined;
        if (!row) continue;
        const body = parseQuestionBody(row.optionsJson);
        const answer = parseAnswerKey(row.answerJson);
        if (body && answer) snapshot[questionId] = { type: row.type, body, answer };
      }
      save.run(JSON.stringify(snapshot), attempt.id);
    }
  })();
  return pending.length;
}
