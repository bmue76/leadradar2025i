# LeadRadar2025i – Teilprojekt 4.2 – Backend Polish: Exports (CSV Job + Download + Storage Stub Hardening)

Datum: 26.12.2025  
Branch: `main`  
Commit: `5efaa78`  

## Ziel / Scope (MVP)
Härten des CSV-Export-Flows (Admin) für stabile, reproduzierbare Exports inkl. Download, Excel-Kompatibilität (BOM + `;`) und Tenant-Scope-Sicherheit.

## Umsetzung (Was wurde gebaut)
### 1) POST `/api/admin/v1/exports/csv`
- Validierung über `validateBody()` (`lib/http.ts`) statt manueller Parsing-Logik.
- Tenant-/Admin-Scope über `requireTenantContext(req)` (Owner-only, tenant leak-safe).
- ExportJob wird tenant-scoped erstellt und Status sauber geführt:
  - `QUEUED → RUNNING → DONE` bzw. `FAILED` inkl. `queuedAt/startedAt/finishedAt`.
- CSV-Generierung nach Spec:
  - Separator: `;`
  - UTF-8 BOM (`\ufeff`) für Excel
  - MultiSelect: Werte via `/`
  - Boolean: `ja/nein`
  - Datum: `DD.MMMM.YYYY` plus zusätzliche `(ISO)`-Spalte bei DATE/DATETIME Feldern
  - Visitenkarte: nur `Visitenkarte vorhanden` (`ja/nein`), keine URL
- Storage Stub (lokal):
  - Datei wird geschrieben nach `.tmp_exports/<tenantId>/export_<jobId>.csv`
  - `resultStorageKey` wird **relativ** gespeichert (deploy-tauglich, kein Windows-Path in DB)
- Ergebnis: Response liefert `downloadUrl` auf `/api/admin/v1/exports/<jobId>/download`.

### 2) GET `/api/admin/v1/exports/{id}/download`
- Tenant leak-safe: ExportJob lookup strikt mit `tenantId` + `type: CSV`.
- Liefert sinnvolle Fehler:
  - `404 NOT_FOUND` wenn Job nicht existiert oder Datei fehlt
  - `409 NOT_READY` wenn Job nicht `DONE` ist
- Storage-Key Hardening:
  - absolute Pfade werden abgelehnt
  - nur Keys unter `.tmp_exports/` erlaubt
  - Path Traversal Guard via `path.resolve()` + root-prefix check
- Download ist TS-/Node-safe:
  - Streaming via `fs.createReadStream()` + `Readable.toWeb()` (kein Buffer/Edge-Stress)
  - Headers:
    - `content-type: text/csv; charset=utf-8`
    - `content-disposition: attachment; filename="leadradar_export_<jobId>.csv"`
    - `x-trace-id`

### 3) Build-Hardening (Nebenfix, damit Deploy funktioniert)
- Next.js Build-Blocker bei `/admin/leads` behoben:
  - `useSearchParams()` wird jetzt in einem Client-Component unter `Suspense` gerendert:
    - `app/(admin)/admin/leads/page.tsx` (Server Wrapper)
    - `app/(admin)/admin/leads/LeadsClient.tsx` (Client Page)
- `adminFetch` Default Export ergänzt (verhindert Import-Fehler in Build):
  - `app/(admin)/admin/_lib/adminFetch.ts`

## Wichtige Files
- `app/api/admin/v1/exports/csv/route.ts`
- `app/api/admin/v1/exports/[id]/download/route.ts`
- `app/(admin)/admin/leads/page.tsx`
- `app/(admin)/admin/leads/LeadsClient.tsx`
- `app/(admin)/admin/_lib/adminFetch.ts`
- `.gitignore` enthält `.tmp_exports/`

## Tests / Checks
- `npm run build` läuft durch (nach Windows-Prisma-EPERM-Fix via Cleanup/Regenerate).
- Export kann erstellt werden und Download liefert CSV inkl. BOM + `;`.

## Nächste Schritte (Vorschlag)
1) Export-Jobs asynchronisieren (Queue/Worker), damit große Exports nicht im Request-Thread laufen.
2) Admin-UI: Button „Export CSV“ auf Leads-Page aktivieren (filters → POST export → Polling/Status → Download).
3) Optional: ExportJob Listing Endpoint + Retention/Cleanup für `.tmp_exports` (z.B. Cron/RetentionMarker).
