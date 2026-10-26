import { AnalyticsView } from '@/components/AnalyticsView';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AnalitikPage() {
  await requireUser('admin');
  return <AnalyticsView scope={null} basePath="/admin/hasil" />;
}
