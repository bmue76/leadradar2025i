// app/(admin)/admin/exports/page.tsx
import ExportsClient from "./ExportsClient";

export const runtime = "nodejs";

export default function AdminExportsPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Exports</h1>
        <p className="mt-1 text-sm opacity-70">
          CSV-Export Jobs erstellen, Status verfolgen und fertige Dateien herunterladen.
        </p>
      </div>

      <ExportsClient />
    </main>
  );
}
