import { ResultsView } from '@/components/ResultsView';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function HasilPage({
  searchParams,
}: {
  searchParams: Promise<{ penugasan?: string; murid?: string }>;
}) {
  await requireUser('admin');
  const { penugasan, murid } = await searchParams;

  // scope null: an admin sees every student.
  return <ResultsView scope={null} basePath="/admin/hasil" penugasan={penugasan} murid={murid} />;
}
