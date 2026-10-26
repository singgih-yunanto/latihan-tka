import type { IssuedCredential } from '../src/db/backfill';

/** Print freshly issued one-time passwords. Shared by db:migrate and seed:users. */
export function reportCredentials(created: IssuedCredential[]): void {
  if (created.length === 0) return;

  console.log(`\nIssued one-time passwords to ${created.length} account(s):`);
  for (const c of created) {
    console.log(`  ${c.nama.padEnd(20)} username ${c.username.padEnd(14)} password ${c.password}`);
  }
  console.log(
    'Hand each one over privately. They expire in 7 days and must be changed at first\n' +
      'sign-in. They are not stored anywhere and will not be shown again.\n',
  );
}
