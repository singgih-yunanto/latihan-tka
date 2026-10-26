import Link from 'next/link';
import PasswordForm from '@/components/PasswordForm';
import { ROLE_HOME, ROLE_LABEL } from '@/domain/access';
import { requireUserAllowingPasswordChange } from '@/lib/auth';
import { MIN_PASSWORD_LENGTH } from '@/lib/password';

export const dynamic = 'force-dynamic';

/**
 * Change your own password.
 *
 * Reachable while `must_change_password` is set -- it is the one page a user in
 * that state may open, and `requireUser` sends them here from everywhere else.
 */
export default async function AkunPage() {
  const me = await requireUserAllowingPasswordChange();
  const forced = me.mustChangePassword;

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-6 sm:py-12">
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <h1 className="text-xl font-bold">Ganti kata sandi</h1>
        <p className="mt-1 text-sm text-muted">
          <span className="break-words">{me.nama}</span> &middot; {ROLE_LABEL[me.role]}
          {me.username ? ` (${me.username})` : ''}
        </p>

        {forced ? (
          <p className="mt-4 rounded-lg bg-brandsoft px-3 py-2 text-sm text-brand">
            Kata sandi kamu masih bawaan. Ganti dulu sebelum melanjutkan.
          </p>
        ) : null}

        <PasswordForm minLength={MIN_PASSWORD_LENGTH} />

        <div className="mt-5 flex items-center justify-between text-sm">
          {forced ? (
            <span className="text-muted">Wajib diganti</span>
          ) : (
            <Link href={ROLE_HOME[me.role]} className="py-2 text-muted underline underline-offset-4">
              Kembali
            </Link>
          )}
          <Link href="/keluar" className="py-2 text-muted underline underline-offset-4">
            Keluar
          </Link>
        </div>
      </div>
    </main>
  );
}
