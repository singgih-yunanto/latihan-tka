import { openSqlite } from '../src/db/client';
import { resolveDbPath } from '../src/db/path';
import type { IssuedCredential } from '../src/db/backfill';
import { generateTempPassword, hashPassword, tempPasswordExpiry } from '../src/lib/password';
import { reportCredentials } from './credentials';

/**
 * Issues fresh one-time passwords from the command line -- the same thing as
 * "Reset sandi" in the admin panel, for when nobody can sign in to press it
 * (a forgotten admin password) or for resetting several accounts at once.
 *
 *   npm run user:reset-password -- dina bayu      # by username
 *   npm run user:reset-password -- --role student  # every active student
 *   npm run user:reset-password -- --pending       # accounts still on a first password
 *   npm run user:reset-password -- --list          # show accounts, change nothing
 *
 * Each account gets its own password, valid for 7 days and to be changed at the
 * next sign-in, and is signed out on every device. Deactivated accounts are
 * skipped unless named explicitly.
 */

const ROLES = ['admin', 'parent', 'student'] as const;

type Row = {
  id: number;
  nama: string;
  role: string;
  username: string | null;
  aktif: number;
  must_change_password: number;
  last_login_at: number | null;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function stamp(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'never';
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const roleIndex = args.indexOf('--role');
  const role = roleIndex >= 0 ? args[roleIndex + 1] : undefined;
  const usernames = args
    .filter((a, i) => !a.startsWith('--') && (roleIndex < 0 || i !== roleIndex + 1))
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);

  if (roleIndex >= 0 && !(ROLES as readonly string[]).includes(role ?? '')) {
    fail(`--role must be one of: ${ROLES.join(', ')}.`);
  }

  const sqlite = openSqlite(resolveDbPath());
  const all = sqlite
    .prepare(
      `SELECT id, nama, role, username, aktif, must_change_password, last_login_at
         FROM users ORDER BY role, nama`,
    )
    .all() as Row[];

  if (flag('list')) {
    for (const u of all) {
      const notes = [
        u.aktif ? null : 'inactive',
        u.must_change_password ? 'first password not changed' : null,
      ].filter(Boolean);
      console.log(
        `  ${u.role.padEnd(8)} ${(u.username ?? '-').padEnd(14)} ${u.nama.padEnd(24)} ` +
          `last sign-in ${stamp(u.last_login_at)}${notes.length ? `  (${notes.join(', ')})` : ''}`,
      );
    }
    sqlite.close();
    return;
  }

  if (usernames.length === 0 && !role && !flag('pending')) {
    sqlite.close();
    fail(
      'Name the accounts to reset:\n' +
        '  npm run user:reset-password -- <username> [<username> ...]\n' +
        '  npm run user:reset-password -- --role student|parent|admin\n' +
        '  npm run user:reset-password -- --pending\n' +
        '  npm run user:reset-password -- --list',
    );
  }

  const byName = new Map(all.filter((u) => u.username).map((u) => [u.username!.toLowerCase(), u]));
  const unknown = usernames.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    sqlite.close();
    fail(`No account with username: ${unknown.join(', ')}. Run with --list to see them.`);
  }

  // Named accounts are reset even when deactivated; group selections only
  // reach active ones, so a sweep never revives a closed account's login.
  const targets = new Map<number, Row>();
  for (const name of usernames) targets.set(byName.get(name)!.id, byName.get(name)!);
  for (const u of all) {
    if (!u.aktif || !u.username) continue;
    if (role && u.role === role) targets.set(u.id, u);
    if (flag('pending') && u.must_change_password) targets.set(u.id, u);
  }

  if (targets.size === 0) {
    sqlite.close();
    console.log('No accounts matched; nothing was changed.');
    return;
  }

  const update = sqlite.prepare(
    `UPDATE users
        SET password_hash = ?, must_change_password = 1, temp_password_expires_at = ?
      WHERE id = ?`,
  );
  const signOut = sqlite.prepare('DELETE FROM sessions WHERE user_id = ?');
  const issued: IssuedCredential[] = [];

  sqlite.transaction(() => {
    for (const u of targets.values()) {
      const password = generateTempPassword();
      update.run(hashPassword(password), tempPasswordExpiry(), u.id);
      signOut.run(u.id);
      issued.push({ nama: u.nama, username: u.username!, password });
    }
  })();
  sqlite.close();

  reportCredentials(issued);
  const inactive = [...targets.values()].filter((u) => !u.aktif).map((u) => u.username);
  if (inactive.length > 0) {
    console.log(`Note: ${inactive.join(', ')} is deactivated and cannot sign in until reactivated.`);
  }
}

main();
