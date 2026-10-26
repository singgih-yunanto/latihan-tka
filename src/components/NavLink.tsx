'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * A header menu item that marks the current page.
 *
 * On a phone the menu is a sideways-scrolling strip, so the current item is
 * highlighted and scrolled into view -- otherwise "Kelola akun" at the end of
 * the strip would be off-screen while you are on it. `exact` is for the area's
 * home link, which would otherwise match every page under it.
 */

type Props = { href: string; label: string; exact?: boolean };

export function NavLink({ href, label, exact = false }: Props) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <Link
      ref={ref}
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
        active ? 'bg-brandsoft text-ink' : 'text-muted hover:bg-surface2 hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );
}
