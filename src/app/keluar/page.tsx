import Link from 'next/link';
import { signOut } from '@/actions/auth';
import { ROLE_HOME } from '@/domain/access';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Signing out is a POST, not a link target, so another site cannot log the user
 * out by embedding a URL. The page is the confirmation step.
 */
export default async function KeluarPage() {
  const me = await currentUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-line bg-surface p-7 text-center">
        <h1 className="text-xl font-bold">Keluar</h1>
        <p className="mt-2 text-sm text-muted">
          {me ? `Keluar dari akun ${me.nama}?` : 'Kamu sudah tidak masuk.'}
        </p>

        {me ? (
          <form action={signOut} className="mt-6">
            <button
              type="submit"
              className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white"
            >
              Ya, keluar
            </button>
          </form>
        ) : null}

        <Link
          href={me ? ROLE_HOME[me.role] : '/masuk'}
          className="mt-4 inline-block text-sm text-muted underline underline-offset-4"
        >
          {me ? 'Batal' : 'Ke halaman masuk'}
        </Link>
      </div>
    </main>
  );
}
