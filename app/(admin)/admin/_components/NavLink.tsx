'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive =
    pathname === href ||
    (href !== '/admin' && pathname?.startsWith(href + '/')) ||
    (href !== '/admin' && pathname === href);

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cx(
        'rounded-md px-3 py-1.5 transition',
        isActive
          ? 'bg-slate-900 text-white'
          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
      )}
    >
      {children}
    </Link>
  );
}
