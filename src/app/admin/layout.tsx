import Link from 'next/link';
import { requireUser } from '@/lib/auth';

const MENU = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/penugasan', label: 'Penugasan' },
  { href: '/admin/hasil', label: 'Hasil' },
  { href: '/admin/analitik', label: 'Analitik' },
  { href: '/admin/peringkat', label: 'Peringkat' },
  { href: '/admin/bank', label: 'Bank soal' },
  { href: '/admin/users', label: 'Akun' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser('admin');

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/admin" className="mr-2 font-bold">
            TKA <span className="text-brand">Admin</span>
          </Link>
          <nav className="flex flex-1 flex-wrap gap-1">
            {MENU.map((item) => (
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
