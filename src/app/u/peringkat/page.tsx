import Link from 'next/link';
import { RankingView, type RankingSearch } from '@/components/RankingView';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** The student's view of the shared ranking board. */
export default async function MuridPeringkatPage({
  searchParams,
}: {
  searchParams: Promise<RankingSearch>;
}) {
  const me = await requireUser('student');
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/u" className="mb-4 inline-block text-sm text-muted underline underline-offset-4">
        ← Kembali ke daftar tugas
      </Link>
      <RankingView actor={me} basePath="/u/peringkat" search={await searchParams} />
    </main>
  );
}
