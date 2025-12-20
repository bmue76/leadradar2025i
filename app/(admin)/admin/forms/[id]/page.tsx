import Link from 'next/link';
import { FormDetailClient } from './_components/FormDetailClient';

export default function AdminFormDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Form Detail</h1>
          <p className="mt-1 text-sm text-slate-600">
            Form-ID: <code className="rounded bg-slate-100 px-1 py-0.5">{params.id}</code>
          </p>
        </div>

        <Link
          href="/admin/forms"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          ← Zurück
        </Link>
      </header>

      <FormDetailClient formId={params.id} />
    </div>
  );
}
