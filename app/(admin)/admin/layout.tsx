import type { Metadata } from 'next';
import Link from 'next/link';
import { NavLink } from './_components/NavLink';
import { DevUserIdBar } from './_components/DevUserIdBar';

export const metadata: Metadata = {
  title: 'LeadRadar Admin (DEV)',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            LeadRadar Admin <span className="text-xs font-normal text-slate-500">(DEV)</span>
          </Link>

          <nav className="flex items-center gap-2 text-sm">
            <NavLink href="/admin">Dashboard</NavLink>
            <NavLink href="/admin/templates">Templates</NavLink>
            <NavLink href="/admin/forms">Forms</NavLink>
          </nav>

          <div className="ml-auto">
            <DevUserIdBar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>

      <footer className="border-t bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
          DEV-Hinweis: Dieses Admin-UI setzt einen <code className="rounded bg-slate-100 px-1 py-0.5">x-user-id</code>{' '}
          Header aus dem Browser-LocalStorage. Nicht produktiv verwenden.
        </div>
      </footer>
    </div>
  );
}
