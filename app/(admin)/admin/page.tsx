import { WhoAmIClient } from './_components/WhoAmIClient';

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Minimaler DEV-Admin Bereich (Header-Auth via <code className="rounded bg-slate-100 px-1 py-0.5">x-user-id</code>).
        </p>
      </header>

      <WhoAmIClient />

      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Nächste Schritte</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>/admin/templates (System-Templates listen)</li>
          <li>/admin/forms (Tenant-Forms listen)</li>
          <li>/admin/forms/[id] (Detail + Fields sortiert)</li>
        </ul>
      </section>
    </div>
  );
}
