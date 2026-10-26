import { notFound } from 'next/navigation';
import { AttemptReview } from '@/components/AttemptReview';
import { canAccessAttempt } from '@/domain/access';
import { sqlite } from '@/db/client';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WaliDetailHasilPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ galat?: string }>;
}) {
  const me = await requireUser('parent');

  const { attemptId: raw } = await params;
  const attemptId = Number(raw);
  if (!Number.isInteger(attemptId)) notFound();

  // Guessing another child's attempt id is refused, not merely unlisted. It is
  // a 404 rather than a 403 so the page does not confirm that the id exists.
  if (!canAccessAttempt(sqlite, me, attemptId)) notFound();

  const { galat } = await searchParams;
  return <AttemptReview attemptId={attemptId} basePath="/wali/hasil" error={galat} />;
}
