import { createInterface } from 'node:readline';
import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import { requireMigrated } from './db-ready';
import { MIN_PASSWORD_LENGTH, hashPassword, usernameFromName } from '../src/lib/password';

/**
 * Creates the first admin account, the one that bootstraps everything else.
 *
 * The password is prompted for rather than read from argv, so it never lands in
 * shell history or a process listing.
 *
 *   npm run create:admin -- --username ayah --nama "Nama Lengkap"
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const interactive = process.stdin.isTTY === true;

/**
 * One interface for the whole script, created once.
 *
 * Two separate readline interfaces cannot share stdin: the first swallows
 * everything already buffered, so the second prompt never resolves and the
 * script exits without a word and without creating anything.
 */
const rl = interactive
  ? createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  : null;

/**
 * With piped input, stdin is drained up front and the answers served from a
 * queue. Readline emits a line as soon as it arrives, so a line that lands
 * while no question happens to be pending is simply lost -- which is what made
 * the second password read as empty and the two "not match".
 */
async function pipedLines(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
}

let queue: string[] | null = null;

async function ask(question: string, hidden = false): Promise<string> {
  if (!rl) {
    queue ??= await pipedLines();
    // The prompt still goes out so a human watching a log can follow along.
    process.stdout.write(question + (hidden ? '\n' : ''));
    return queue.shift() ?? '';
  }

  return new Promise((resolve) => {
    const output = rl as unknown as { output: NodeJS.WriteStream };
    const original = output.output.write.bind(output.output);

    // Suppress the echo by intercepting the output stream while typing.
    if (hidden) {
      output.output.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        const text = typeof chunk === 'string' ? chunk : '';
        if (text.includes(question)) return original(chunk as string, ...(rest as []));
        return true;
      }) as typeof output.output.write;
    }

    // A premature EOF resolves to an empty answer, which the caller rejects
    // with a clear message rather than hanging or exiting silently.
    const onClose = () => resolve('');
    rl.once('close', onClose);

    rl.question(question, (answer) => {
      rl.removeListener('close', onClose);
      if (hidden) {
        output.output.write = original;
        process.stdout.write('\n');
      }
      resolve(answer);
    });
  });
}

function fail(message: string, sqlite?: { close: () => void }): never {
  console.error(message);
  sqlite?.close();
  rl?.close();
  process.exit(1);
}

async function main() {
  const force = process.argv.includes('--force');
  const dbPath = resolveDbPath();
  const sqlite = openSqlite(dbPath);
  requireMigrated(sqlite, dbPath);

  const existing = sqlite
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    .get() as { n: number };

  if (existing.n > 0 && !force) {
    fail(
      `An admin already exists (${existing.n}). Create further accounts from the admin panel,\n` +
        'or pass --force if you really need another one from the command line.',
      sqlite,
    );
  }

  const nama = arg('nama') ?? (await ask('Full name: ')).trim();
  if (!nama) fail('A name is required.', sqlite);

  const username = (arg('username') ?? usernameFromName(nama)).trim().toLowerCase();
  const clash = sqlite.prepare('SELECT 1 AS ok FROM users WHERE lower(username) = ?').get(username);
  if (clash) fail(`Username "${username}" is already taken.`, sqlite);

  const password = await ask(`Password for "${username}": `, true);
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`, sqlite);
  }

  const again = await ask('Repeat password: ', true);
  if (password !== again) fail('The two passwords do not match.', sqlite);

  sqlite
    .prepare(
      `INSERT INTO users (nama, role, username, password_hash, must_change_password, aktif)
       VALUES (?, 'admin', ?, ?, 0, 1)`,
    )
    .run(nama, username, hashPassword(password));

  sqlite.close();
  rl?.close();
  console.log(`\nAdmin "${username}" created. Sign in at /masuk.`);
}

void main();
