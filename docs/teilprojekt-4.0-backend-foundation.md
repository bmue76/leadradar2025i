# LeadRadar2025i – Teilprojekt 4.0 – Backend Foundation (Validation + Error Codes + Query Parsing)

Status: ✅ abgeschlossen (Foundation + 2 Referenzrouten migriert, ohne Contract-Brüche)

## Ziel
- Einheitliche Basis für:
  - safe JSON parsing (robust, size-limited)
  - Query parsing / typed query validation
  - standardisierte Fehler (400/404/409) mit konsistentem Response-Envelope
- Reduktion von Copy/Paste in Routes, ohne große Refactors.
- Bestehende API-Response-Shapes bleiben kompatibel (`jsonOk/jsonError` + `traceId`).

## Deliverables
### 1) `lib/http.ts` (Foundation Helpers)
Neue Datei mit:
- `parseJson(req, { maxBytes? })`
  - Empty body ⇒ `undefined`
  - Invalid JSON ⇒ `HttpError(400, "BAD_JSON", ...)`
  - Body too large ⇒ `HttpError(413, "BODY_TOO_LARGE", ...)`
- `parseQuery(req|url)` ⇒ `{ url, query: Record<string, string | string[]> }`
- `validateBody(req, zodSchema, { maxBytes? })` ⇒ typed output
  - Validation errors ⇒ `HttpError(400, "INVALID_BODY", details)`
- `validateQuery(req|url, zodSchema)` ⇒ typed output
  - Validation errors ⇒ `HttpError(400, "INVALID_QUERY", details)`
- `HttpError`, `httpError`, `isHttpError` als kleine Standard-Primitive für Routes

Commit:
- `f7d51a7` feat(backend): add http helpers for json/query parsing + zod validation

### 2) Referenzroute #1 (Admin) migriert
`GET /api/admin/v1/leads` → `app/api/admin/v1/leads/route.ts`

Was wurde vereinheitlicht:
- Query parsing via `validateQuery(req, schema)`
- Konsistente Fehlerbehandlung via `try/catch + isHttpError`
- Leak-safe Tenant-Checks (formId/groupId) bleiben wie vorher

Kompatibilität:
- Success-Response bleibt identisch:
  - `{ ok:true, data:{ items, paging:{page,limit,total} }, traceId }`
- 400-Responses bleiben kompatibel (weiterhin `code: "BAD_REQUEST"` für Query/Date-Probleme),
  obwohl intern `validateQuery` mit `INVALID_QUERY` arbeitet.
  (Mapping in Route bewusst für Contract-Stabilität.)

Commit:
- `2fa947c` refactor(api): admin leads list uses http query validation

### 3) Referenzroute #2 (Mobile) migriert
`POST /api/mobile/v1/leads` → `app/api/mobile/v1/leads/route.ts`

Was wurde vereinheitlicht:
- Body parsing via `validateBody(req, z.any(), { maxBytes: 4MB })`
  - Hintergrund: Base64 Business Card kann >512KB sein
- Invalid JSON wird konsistent als `BAD_JSON` geliefert (über `parseJson`).
- Zentrale Fehlerbehandlung via `try/catch + isHttpError`

Kompatibilität:
- Success-Response bleibt identisch:
  - created=false:
    - `{ id, created:false, capturedAt, attachment:{required:true,present} }`
  - created=true:
    - `{ id, created:true, capturedAt, attachment:{required:true,present}, attachmentSaved }`
- Domain-spezifische Fehlercodes bleiben wie bisher (z.B. `FORM_ID_REQUIRED`, `VALUES_REQUIRED`, …).

Commit:
- `59bc21b` refactor(api): mobile leads create uses http body validation

## Fehler-/Response-Standard
Alle Endpoints bleiben auf dem bestehenden Standard:
- `jsonOk(req, data)` ⇒ `{ ok:true, data, traceId }` + Response-Header `x-trace-id`
- `jsonError(req, status, code, message, details?)` ⇒ `{ ok:false, error:{code,message,details?}, traceId }`

Neu: `HttpError` als Route-internes Primitive, um:
- Parsing/Validation-Fehler standardisiert zu “throwen”
- zentral in der Route in `jsonError` zu übersetzen

## Akzeptanzkriterien
- [x] Typecheck/Build bleibt grün (keine breaking Imports / keine API-Shape-Änderungen)
- [x] Keine Contract-Brüche (Success-Responses unverändert, 400/404 stabil)
- [x] 400/404/409 konsistenter und verständlicher (inkl. `details` bei Zod-Issues)
- [x] 2 Referenzrouten nutzen neue Helpers (`admin leads list`, `mobile leads create`)

## Hinweise / Design-Entscheide
- Admin-Leads-Route mappt interne Query-Validation-Fehler zurück auf `code: "BAD_REQUEST"`
  (kompatibel zu bisherigen Semantiken).
- Mobile-Route nutzt `validateBody` primär für safe parsing + size-limit.
  (Feinere typed body schemas können später Schritt für Schritt pro Route ergänzt werden.)

## Next Steps (Vorschlag)
1) Weitere Admin-Routen schrittweise migrieren:
   - `admin/v1/forms` (GET list: paging + filters)
   - `admin/v1/recipients` (GET list + entries)
2) Standard-Zod-Schemas einführen:
   - `pagingSchema` (page/limit)
   - `dateRangeSchema` (from/to)
3) Optional: Mini-Helper `handleRoute(req, fn)` (nur wenn gewünscht),
   um `try/catch + isHttpError` Boilerplate pro Route weiter zu reduzieren
   (ohne Refactor-Zwang).

