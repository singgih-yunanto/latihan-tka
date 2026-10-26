import path from 'node:path';

/**
 * Location of the SQLite file.
 *
 * TKA_DB_PATH is mandatory in production. The file tracing done by `next build`
 * pulls the development database into the standalone artefact, so if production
 * were allowed to fall back to the default location the app could quietly serve
 * a stale bundled copy instead of the server database. Failing loudly with a
 * clear message beats serving the wrong data.
 */
export function resolveDbPath(): string {
  const fromEnv = process.env.TKA_DB_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TKA_DB_PATH is not set. Set it in /etc/tka/tka.env, e.g. TKA_DB_PATH=/var/lib/tka/tka.db',
    );
  }

  return path.resolve(process.cwd(), 'data', 'tka.db');
}

export function resolveBackupDir(): string {
  const fromEnv = process.env.TKA_BACKUP_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), 'data', 'backup');
}
