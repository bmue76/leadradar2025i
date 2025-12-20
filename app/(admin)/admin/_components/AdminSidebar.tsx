"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DevUserIdBarModule from "./DevUserIdBar";

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/admin/templates", label: "Vorlagen" },
  { href: "/admin/forms", label: "Formulare" },
  { href: "/admin/leads", label: "Leads" },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function NavLink({ href, label }: NavItem) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={cx(
        "rounded-md px-3 py-2 text-sm transition",
        active ? "bg-slate-900 text-white" : "hover:bg-slate-100 text-slate-700"
      )}
    >
      {label}
    </Link>
  );
}

export default function AdminSidebar() {
  const DevUserIdBarComponent =
    (DevUserIdBarModule as any).DevUserIdBar ?? (DevUserIdBarModule as any).default;

  return (
    <aside className="w-64 border-r border-slate-200 px-4 py-4 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/admin" className="text-base font-semibold tracking-tight">
          LeadRadar Admin
        </Link>
        <div className="text-xs text-slate-500">MVP Admin UI</div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} />
        ))}
      </nav>

      <div className="mt-auto pt-4 border-t border-slate-200">
        {DevUserIdBarComponent ? <DevUserIdBarComponent /> : null}
      </div>
    </aside>
  );
}
