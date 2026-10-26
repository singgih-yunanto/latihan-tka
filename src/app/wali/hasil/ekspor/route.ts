import { actionUser, studentsVisibleTo } from '@/lib/auth';
import { closeExpiredFor } from '@/lib/grading';
import { assignmentFilter, buildResultsCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/** A parent's export: the same CSV, limited to their own children. */
export async function GET(request: Request) {
  const me = await actionUser();
  if (!me || me.role !== 'parent') {
    return new Response('Unauthorized', { status: 401 });
  }

  const scope = studentsVisibleTo(me);
  closeExpiredFor(scope);
  return buildResultsCsv(scope, assignmentFilter(request));
}
