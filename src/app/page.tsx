import { redirect } from 'next/navigation';
import { ROLE_HOME } from '@/domain/access';
import { currentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * The entry point is now a signpost, not a page.
 *
 * It used to list every student by name so they could tap their own card. That
 * was the whole authentication story, and it also published the children's
 * names to anyone who loaded the site. Both are gone: you sign in, and you land
 * wherever your role belongs.
 */
export default async function BerandaPage() {
  const me = await currentUser();
  if (!me) redirect('/masuk');
  if (me.mustChangePassword) redirect('/akun');
  redirect(ROLE_HOME[me.role]);
}
