# Teilprojekt 3.7 – Fix Mobile Lead Sync 500 + Online Detection (Backend + Mobile) — Schlussrapport

## Ausgangslage
- Blocker (P0): `POST /api/mobile/v1/leads` lieferte HTTP 500 → Leads blieben in Outbox, Sync blockiert.
- Outbox zeigte “Online: NO”, obwohl Backend grundsätzlich erreichbar war.
- Fokus Android/Backend (iOS Dev-Client Modul fehlt).

## Ziel
- 500 Root Cause finden und eliminieren, ohne Contracts zu brechen.
- Standard Responses (jsonOk/jsonError) + `x-trace-id` in allen Fällen.
- 200 bei Erfolg (idempotent), sonst saubere 4xx/409/413 statt 500.
- Online Detection entkoppeln: Online = Backend erreichbar (Health/Ping), nicht abhängig von Lead-POST Fehlern.

## Umsetzung (Backend)
### Health Endpoint
- Neu: `GET /api/mobile/v1/health`
- Proof:
  - `curl -i "http://localhost:3000/api/mobile/v1/health" -H "x-trace-id: curl-3.7-health-001"` → 200

### Hardened `POST /api/mobile/v1/leads`
- Keine 500 mehr für erwartbare Fälle:
  - Invalid JSON → 400
  - Body zu gross → 413
  - Zod/Validation → 422
  - Tenant/Form Scope → 4xx/409
- Idempotent: `clientLeadId` verhindert Duplikate.
- `x-trace-id` wird durchgereicht und für Debugging genutzt.

### Root Causes & Fixes
1) Prisma Validation Error: `select: { eventId: true }` auf `Form` obwohl Feld im Schema nicht existiert  
   → Fix: schema-safe select (kein eventId select wenn Feld fehlt)
2) Status-Mismatch: Backend Form Status `ACTIVE`, Mobile erwartete `ONLINE`  
   → Fix: `ACTIVE` als “online” akzeptieren (zusätzlich zu `ONLINE`)

### Proof (curl)
- Not found:
  - `curl-3.7-test-004` → 404 `FORM_NOT_FOUND`
- Real form:
  - `curl-3.7-test-006` → 200 `{ ok:true, data:{ created:true, id:"..." } }`

## Umsetzung (Mobile)
### Online Detection (Outbox)
- Outbox “Online” basiert neu auf **Backend Health Probe** (BaseUrl erreichbar) statt nur NetInfo.
- 5xx/4xx bei Lead-POST wird als Sync-Error behandelt, Online bleibt davon unabhängig.
- Implementiert in `mobile/src/screens/OutboxScreen.tsx`.

## Commits
- `5466f11` fix(api): make mobile lead POST non-500 (dev details + schema mismatch mapping)
- `2064650` fix(mobile): add health ping + online probe helpers (stabilize online detection)
- `cd26c6c` fix(api): schema-safe form select (avoid eventId on Form)
- `bf6c80d` fix(api): treat ACTIVE forms as online for mobile lead POST
- `593d1e4` fix(mobile): outbox online detection via backend health probe

## Akzeptanzkriterien
- ✅ curl POST /api/mobile/v1/leads liefert 200 oder saubere 4xx/409/413 — keine 500 für erwartbare Fälle
- ✅ `x-trace-id` in Responses vorhanden
- ✅ Outbox zeigt Online: YES sobald Health erreichbar ist
- ✅ Build bleibt grün (`npm run build`)

