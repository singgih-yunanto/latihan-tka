import type { Database } from 'better-sqlite3';

/**
 * Server-wide switches stored in `app_settings`.
 *
 * Raw SQL against better-sqlite3, like the rest of src/domain, so the rules can
 * be tested against an in-memory database. A missing row means the default.
 */

export const RANKING_ENABLED = 'ranking_enabled';

export function getSetting(sqlite: Database, key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setSetting(sqlite: Database, key: string, value: string): void {
  sqlite
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value);
}

/** The ranking board is on unless an admin has switched it off. */
export function isRankingEnabled(sqlite: Database): boolean {
  return getSetting(sqlite, RANKING_ENABLED) !== '0';
}
