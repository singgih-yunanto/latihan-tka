import { RankingView, type RankingSearch } from '@/components/RankingView';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminPeringkatPage({
  searchParams,
}: {
  searchParams: Promise<RankingSearch>;
}) {
  const me = await requireUser('admin');
  return <RankingView actor={me} basePath="/admin/peringkat" search={await searchParams} />;
}
