import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { resolveDbPath } from './path';

/**
 * A single SQLite connection for the whole process.
 *
 * WAL keeps reads from blocking on writes -- important because several children
 * may be saving answers while an admin has the dashboard open. busy_timeout
 * gives contended writes room to wait instead of throwing SQLITE_BUSY straight
 * away.
 *
 * The connection opens lazily on first use rather than at module load. Opening
 * it at module load would make `next build` create the database file while
 * collecting page data, and that file then rides along into the standalone
 * artefact.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

type Conn = { db: Db; sqlite: Database.Database };

declare global {
  var __tkaDb: Conn | undefined;
}

export function openSqlite(file?: string): Database.Database {
  const dbPath = file ?? resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

function conn(): Conn {
  // In development Next reloads modules repeatedly; the connection is kept on
  // globalThis so handles to the same file do not pile up.
  let instance = globalThis.__tkaDb;
  if (!instance) {
    const sqlite = openSqlite();
    instance = { db: drizzle(sqlite, { schema }), sqlite };
    globalThis.__tkaDb = instance;
  }
  return instance;
}

/** Thin proxy so the connection is only opened when actually used. */
function lazy<T extends object>(pick: (c: Conn) => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const target = pick(conn());
      const value = Reflect.get(target as object, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has: (_target, prop) => prop in (pick(conn()) as object),
  });
}

export const db = lazy<Db>((c) => c.db);
export const sqlite = lazy<Database.Database>((c) => c.sqlite);
export { schema };
