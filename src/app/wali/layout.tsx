import Link from 'next/link';
import { sqlite } from '@/db/client';
import { isRankingEnabled } from '@/domain/settings';
import { requireUser } from '@/lib/auth';

const MENU = [
  { href: '/wali', label: 'Ringkasan' },
  { href: '/wali/penugasan/baru', label: 'Beri tugas' },
  { href: '/wali/hasil', label: 'Hasil' },
  { href: '/wali/analitik', label: 'Analitik' },
];

const RANKING_ITEM = { href: '/wali/peringkat', label: 'Peringkat' };

/**
 * The parent area. Same shape as the admin panel, but every page under it is
 * scoped to the children linked to this account.
 */
export default async function WaliLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser('parent');
  const menu = isRankingEnabled(sqlite) ? [...MENU, RANKING_ITEM] : MENU;

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/wali" className="mr-2 font-bold">
            TKA <span className="text-brand">Orang tua</span>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {menu.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="text-sm text-muted">{me.nama}</span>
          <Link href="/akun" className="text-sm text-muted underline underline-offset-4">
            Akun
          </Link>
          <Link href="/keluar" className="text-sm text-muted underline underline-offset-4">
            Keluar
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
