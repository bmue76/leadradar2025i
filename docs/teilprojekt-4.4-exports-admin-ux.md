# Teilprojekt 4.4 – Exports: Admin bedienbar (Listing + Polling + Download)

## Ziel / Scope
Exports im Admin so ausbauen, dass der CSV-Export **praktisch nutzbar** ist:
- API ergänzen um **Listing** und **Detail/Status**
- Admin UI: **Job-Liste**, **Polling bis DONE/FAILED** (Timeout), **Download Button** nur bei DONE
- Bestehende Endpoints bleiben kompatibel:
  - POST `/api/admin/v1/exports/csv`
  - GET  `/api/admin/v1/exports/[id]/download`

## Deliverables
### API
- `GET /api/admin/v1/exports`
  - Paging: `page`, `take`
  - Filter: `status`, `formId`, `groupId` (optional)
  - tenant-scoped via `requireTenantContext(req)` (ExportJob hat kein ownerId → tenant-only Listing)
- `GET /api/admin/v1/exports/[id]`
  - Detail/Status (tenantId geprüft)
  - `downloadUrl` nur wenn `status=DONE` und `resultStorageKey` vorhanden (leak-safe)

### Admin UI
- `/admin/exports`
  - “Neuen Export starten” (formId required, groupId optional)
  - “Letzte Exports” Liste (Paging/Filter)
  - Polling alle 2s bis DONE/FAILED, Timeout 2min
  - Download via Blob

## Technische Umsetzung (Kurz)
- Validation: `validateQuery` (Listing)
- Errors: `httpError` + `isHttpError` + `jsonError(req, status, message, code, details?)`
- Security: alle DB Lookups mit `tenantId`
- Status: Prisma enthält u.a. `QUEUED`, `RUNNING`, `DONE`, `FAILED`

## Manuelle Tests
1. `/admin/exports` öffnen, ggf. Dev-Header in localStorage setzen (LR_TENANT_ID / LR_USER_ID)
2. Export starten (formId eingeben) → Job erscheint in Liste
3. Status wird automatisch gepollt bis DONE/FAILED (max. 2min)
4. DONE → Download Button aktiv → CSV wird heruntergeladen
5. Filter testen (status/formId/groupId)

## Nächste Schritte (Vorschlag)
- Export-Start UI mit Form-Dropdown (via Forms API) statt formId Input
- Optional: “Auto-open download” nach DONE
- Optional: “Retry” bei FAILED + Anzeige errorMessage wenn vorhanden

---

## Masterchat-Block (Copy/Paste)
**Teilprojekt 4.4 – Exports Admin bedienbar**
- API erweitert: `GET /api/admin/v1/exports` (Listing + Paging/Filter), `GET /api/admin/v1/exports/[id]` (Detail/Status)
- Security: tenant-scoped (requireTenantContext), Job lookups leak-safe (tenantId)
- Status kompatibel mit Prisma (u.a. QUEUED/RUNNING/DONE/FAILED)
- downloadUrl nur bei DONE + resultStorageKey
- Admin UI: Job-Liste, Polling (2s, Timeout 2min), Download Button nur bei DONE, klare Loading/Error/Empty States
- Bestehende Endpoints unverändert kompatibel: POST `/exports/csv` + GET `/exports/[id]/download`
