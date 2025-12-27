# LeadRadar2025i – Teilprojekt 4.3 – Backend Polish: Storage Stub Hardening + Attachment Download + Cleanup

Datum: 27.12.2025  
Branch: `main`  

## Ziel / Scope (MVP)
Local Storage Stub production-sicherer machen:
- **einheitliche, relative storageKeys** (keine absoluten Windows-Pfade in DB)
- **Traversal / absolute paths blocken**
- **Admin Attachment Download** (tenant-scoped, leak-safe)
- **Cleanup Script** für `.tmp_exports` / `.tmp_uploads`

## Umsetzung

### A) Zentraler Storage Helper
Neu: `lib/storage.ts`
- Definiert Root-Folders: `.tmp_exports`, `.tmp_uploads`
- Guards:
  - nur **relative Keys** erlaubt
  - blockiert `..`, absolute Pfade (Windows + Linux), UNC, Drive-Pfade
- Helpers:
  - `isSafeRelativeKey`, `resolveUnderRoot`, `sanitizeFilename`
  - `buildUploadsKey`, `buildExportsKey`
  - `writeFileAtomic` (best-effort)
  - `coerceLegacyPathToRelativeKey` (sanftes Legacy-Coercing)

### B) Attachment Writes (Mobile)
- POST `/api/mobile/v1/leads` (Base64 Card) schreibt nach:
  - `.tmp_uploads/<tenantId>/leads/<leadId>/card/...`
  - speichert **storageKey relativ** in `LeadAttachment.storageKey`
- POST `/api/mobile/v1/leads/[id]/attachments` (Multipart) gleiches Verhalten:
  - `.tmp_uploads/<tenantId>/leads/<leadId>/attachments/...`
  - storageKey relativ

### C) Exports Download – Refactor
- GET `/api/admin/v1/exports/[id]/download` nutzt nun `resolveUnderRoot`
- Legacy: wenn DB noch absolute Pfade enthält, wird best-effort ein gültiger relativer Key extrahiert.

### D) Admin Attachment Download (neu)
- GET `/api/admin/v1/leads/{id}/attachments/{attachmentId}/download`
- Auth: `requireTenantContext(req)`
- Leak-safe:
  - Lead muss zum Tenant gehören sonst 404
  - Attachment muss zu Lead+Tenant gehören sonst 404
- Guards:
  - `storageKey` fehlt → 404 `NO_FILE`
  - `storageKey` unsafe → 400 `INVALID_STORAGE_KEY`
- Streaming Response (Node runtime), Headers:
  - `content-type`, `content-disposition`, `x-trace-id`

### E) Cleanup Script (Dev Tool)
Neu: `scripts/dev/cleanup-tmp-storage.ts`
- löscht Files in `.tmp_exports`/`.tmp_uploads` älter als X Tage (Default 14)
- `--days 7` möglich
- löscht **ausschliesslich** unter den beiden Root-Folders (hard guard)
- Ausgabe: JSON summary

## Dateien
- `lib/storage.ts` (neu)
- `app/api/mobile/v1/leads/route.ts` (update)
- `app/api/mobile/v1/leads/[id]/attachments/route.ts` (update)
- `app/api/admin/v1/exports/[id]/download/route.ts` (refactor)
- `app/api/admin/v1/leads/[id]/attachments/[attachmentId]/download/route.ts` (neu)
- `scripts/dev/cleanup-tmp-storage.ts` (neu)
- `docs/teilprojekt-4.3-backend-polish-storage.md` (neu)

## AC Check
- ✅ Attachment Writes: storageKey wird gesetzt und ist relativ unter `.tmp_uploads/...`
- ✅ Traversal Guard: `..`/absolute Pfade werden mit `400 INVALID_STORAGE_KEY` blockiert
- ✅ Attachment Download: liefert Datei mit korrekten Headers, tenant/lead/attachment mismatch → 404 leak-safe
- ✅ Cleanup Script: löscht nur unter `.tmp_uploads`/`.tmp_exports` und läuft ohne Crash
- ✅ Build/Typecheck: `npm run build` grün