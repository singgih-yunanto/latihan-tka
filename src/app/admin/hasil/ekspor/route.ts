import { actionUser } from '@/lib/auth';
import { closeExpiredFor } from '@/lib/grading';
import { assignmentFilter, buildResultsCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

/** Export every student's results as CSV. */
export async function GET(request: Request) {
  // A route handler is a public endpoint like any other; the admin layout does
  // not protect it.
  const me = await actionUser();
  if (!me || me.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 });
  }

  closeExpiredFor(null);
  return buildResultsCsv(null, assignmentFilter(request));
}
