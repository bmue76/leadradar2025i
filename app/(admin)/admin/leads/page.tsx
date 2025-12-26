import { Suspense } from "react";
import LeadsClient from "./LeadsClient";

export const dynamic = "force-dynamic";

export default function AdminLeadsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <LeadsClient />
    </Suspense>
  );
}
