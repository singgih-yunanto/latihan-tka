import { notFound } from 'next/navigation';
import { AttemptReview } from '@/components/AttemptReview';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DetailHasilPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ galat?: string }>;
}) {
  await requireUser('admin');

  const { attemptId: raw } = await params;
  const attemptId = Number(raw);
  if (!Number.isInteger(attemptId)) notFound();

  const { galat } = await searchParams;
  return <AttemptReview attemptId={attemptId} basePath="/admin/hasil" error={galat} />;
}
