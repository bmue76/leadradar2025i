import type { ReactNode } from "react";
import AdminSidebar from "./_components/AdminSidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <AdminSidebar />
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
