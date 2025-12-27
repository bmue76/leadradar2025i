# LeadRadar2025i – Teilprojekt 4.5 – Backend Polish: Export Lifecycle (Cleanup + Retention + UX Hooks)

Datum: 2025-12-27  
Scope: MVP “production-robust” Export Job Lifecycle (Retention/Cleanup + NO_FILE Handling)

---

## Ziel

Exports sollen im MVP robust “aufgeräumt” werden können, ohne DB-History zu verlieren:

- Export-Files werden nach definierter Retention gelöscht (Default 14 Tage).
- ExportJobs bleiben in der DB (Audit/History).
- Download-Endpoint reagiert sauber, wenn File nicht mehr existiert.
- Cleanup ist tenant-safe, root-guarded und ohne path traversal.

---

## Deliverables

### A) Retention Rules (verbindlich)

- Default Retention: **14 Tage**
- Cleanup berücksichtigt nur Jobs mit Status: **DONE | FAILED**
- Cleanup darf nur unter **`.tmp_exports/`** löschen (Root Guard).
- Wenn File fehlt (z. B. cleaned):  
  - ExportJob bleibt bestehen  
  - Download liefert **404** mit Code **NO_FILE** und Message „File not found (cleaned up)“

---

### B) Cleanup – 2 Wege

#### 1) Dev Script (immer)
**File:** `scripts/dev/cleanup-exports.ts`

- Args:
  - `--days <n>` (default 14, 1..365)
  - `--tenant <id>` (optional)
  - `--dry-run` (optional)
- Output: **JSON Summary** mit `deleted / skipped / errors / dirsRemoved / stats`

Beispiele:
```bash
npx tsx scripts/dev/cleanup-exports.ts --days 14 --dry-run
npx tsx scripts/dev/cleanup-exports.ts --days 30 --tenant <TENANT_ID>

