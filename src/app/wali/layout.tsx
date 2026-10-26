import Link from 'next/link';
import { NavLink } from '@/components/NavLink';
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
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:py-3">
          <Link href="/wali" className="mr-auto font-bold sm:mr-2">
            TKA <span className="text-brand">Orang tua</span>
          </Link>
          {/* Phones: a full-width strip of its own that scrolls sideways, under the
              brand and account links. From sm up it sits inline as before. */}
          <nav
            aria-label="Menu"
            className="order-last -mx-4 flex basis-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:mx-0 sm:basis-auto sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            {menu.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} exact={item.href === '/wali'} />
            ))}
          </nav>
          <span className="hidden max-w-[12rem] truncate text-sm text-muted sm:inline">{me.nama}</span>
          <Link href="/akun" className="py-2 text-sm text-muted underline underline-offset-4">
            Akun
          </Link>
          <Link href="/keluar" className="py-2 text-sm text-muted underline underline-offset-4">
            Keluar
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
