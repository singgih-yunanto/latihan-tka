import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import { backfillCredentials, backfillSnapshots } from '../src/db/backfill';
import { reportCredentials } from './credentials';

/** Apply any migrations not yet run. Safe to repeat. */

function main() {
  const dbPath = resolveDbPath();
  const sqlite = openSqlite(dbPath);
  const db = drizzle(sqlite);

  migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations') });
  reportCredentials(backfillCredentials(sqlite));
  const frozen = backfillSnapshots(sqlite);
  if (frozen > 0) console.log(`Froze answer keys into ${frozen} existing attempt(s).`);
  sqlite.close();

  console.log(`Migrations complete. Database: ${dbPath}`);
}

main();
