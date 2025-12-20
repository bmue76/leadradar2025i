import { TemplatesListClient } from './_components/TemplatesListClient';

export default function AdminTemplatesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
        <p className="mt-1 text-sm text-slate-600">
          System-Templates (Seed) aus der Admin API.
        </p>
      </header>

      <TemplatesListClient />
    </div>
  );
}
