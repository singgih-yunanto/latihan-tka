import { redirect } from 'next/navigation';
import SignInForm from '@/components/SignInForm';
import { ROLE_HOME } from '@/domain/access';
import { currentUser } from '@/lib/auth';
import { safeNextPath } from '@/lib/redirect';

export const dynamic = 'force-dynamic';

/** One sign-in page for all three roles. */
export default async function MasukPage({
  searchParams,
}: {
  searchParams: Promise<{ lanjut?: string }>;
}) {
  const { lanjut } = await searchParams;

  const me = await currentUser();
  if (me) redirect(me.mustChangePassword ? '/akun' : ROLE_HOME[me.role]);

  const next = safeNextPath(lanjut) ?? undefined;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-8 sm:py-12">
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Latihan TKA</p>
        <h1 className="mt-1 text-xl font-bold">Masuk</h1>
        <p className="mt-1 text-sm text-muted">
          Gunakan nama pengguna dan kata sandi dari admin.
        </p>

        <SignInForm lanjut={next} />
      </div>
    </main>
  );
}
