import { RankingView, type RankingSearch } from '@/components/RankingView';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WaliPeringkatPage({
  searchParams,
}: {
  searchParams: Promise<RankingSearch>;
}) {
  const me = await requireUser('parent');
  return <RankingView actor={me} basePath="/wali/peringkat" search={await searchParams} />;
}
