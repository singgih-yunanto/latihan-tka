import Link from 'next/link';
import { NavLink } from '@/components/NavLink';
import { requireUser } from '@/lib/auth';

const MENU = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/penugasan', label: 'Penugasan' },
  { href: '/admin/hasil', label: 'Hasil' },
  { href: '/admin/analitik', label: 'Analitik' },
  { href: '/admin/peringkat', label: 'Peringkat' },
  { href: '/admin/bank', label: 'Bank soal' },
  { href: '/admin/users', label: 'Kelola akun' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser('admin');

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:py-3">
          <Link href="/admin" className="mr-auto font-bold sm:mr-2">
            TKA <span className="text-brand">Admin</span>
          </Link>
          {/* Phones: a full-width strip of its own that scrolls sideways, under the
              brand and account links. From sm up it sits inline as before. */}
          <nav
            aria-label="Menu"
            className="order-last -mx-4 flex basis-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:order-none sm:mx-0 sm:basis-auto sm:flex-1 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          >
            {MENU.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} exact={item.href === '/admin'} />
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
