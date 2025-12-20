import { FormsListClient } from './_components/FormsListClient';

export default function AdminFormsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tenant-Forms aus der Admin API (Status sichtbar; Toggle folgt in 2.1).
        </p>
      </header>

      <FormsListClient />
    </div>
  );
}
