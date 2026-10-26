import { ResultsView } from '@/components/ResultsView';
import { requireUser, studentsVisibleTo } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WaliHasilPage({
  searchParams,
}: {
  searchParams: Promise<{ penugasan?: string; murid?: string }>;
}) {
  const me = await requireUser('parent');
  const { penugasan, murid } = await searchParams;

  return (
    <ResultsView
      scope={studentsVisibleTo(me)}
      basePath="/wali/hasil"
      penugasan={penugasan}
      murid={murid}
    />
  );
}
