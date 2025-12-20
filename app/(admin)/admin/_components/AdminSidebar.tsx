"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AdminSidebar() {
  const pathname = usePathname();

  const items: NavItem[] = [
    { label: "Übersicht", href: "/admin" },
    { label: "Templates", href: "/admin/templates" },
    { label: "Forms", href: "/admin/forms" },
    { label: "Leads", href: "/admin/leads" },
    { label: "Recipients", href: "/admin/recipients" },
    { label: "Exports", href: "/admin/exports" },
  ];

  return (
    <aside className="w-64 shrink-0 border-r bg-white">
      <div className="px-4 py-4">
        <div className="text-sm font-semibold">LeadRadar Admin</div>
        <div className="mt-1 text-xs text-neutral-500">MVP UI</div>
      </div>

      <nav className="px-2 pb-4">
        <ul className="space-y-1">
          {items.map((it) => {
            const active = isActive(pathname, it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={[
                    "block rounded-md px-3 py-2 text-sm",
                    active
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-100",
                  ].join(" ")}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
