import type { Database } from 'better-sqlite3';

/**
 * Stops an account script with a clear message when the database has not been
 * migrated yet. Opening a missing database file creates an empty one, so
 * without this check the first query fails with "no such table: users".
 */
export function requireMigrated(sqlite: Database, dbPath: string): void {
  const table = sqlite
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (table) return;
  sqlite.close();
  console.error(
    `The database at ${dbPath} has no tables yet. Run the migrations first:\n` +
      '  npm run db:migrate            (on the server: deploy/tka-run.sh db:migrate,\n' +
      '                                 or run deploy/deploy.sh, which migrates too)',
  );
  process.exit(1);
}
