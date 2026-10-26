import { AnalyticsView } from '@/components/AnalyticsView';
import { requireUser, studentsVisibleTo } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WaliAnalitikPage() {
  const me = await requireUser('parent');

  // Item analysis aggregates every child's answers, so it stays admin-only.
  return (
    <AnalyticsView scope={studentsVisibleTo(me)} basePath="/wali/hasil" showItemAnalysis={false} />
  );
}
