# LeadRadar2025i – Concept / Specs (Source of Truth)

**Wichtig:** Die fachlichen und technischen Spezifikationen sind **führend** im Konzept-/Spec-Repo:

- https://github.com/bmue76/leadradar2025h

Dieses Repo (`leadradar2025i`) ist die **Implementierung** (Code) und richtet sich nach den Entscheidungen und Dokumenten in `leadradar2025h` (z. B. `DECISIONS.md`).

---

## Local Dev

### Install
```bash
npm install
```

### Run
```bash
npm run dev
```

---

## Health Endpoints (API Namespace)

Nach `npm run dev`:

```bash
curl -i http://localhost:3000/api/admin/v1/health
curl -i http://localhost:3000/api/mobile/v1/health
curl -i http://localhost:3000/api/platform/v1/health
```

**Response Shape (Standard):**
- Success:
  - `{ "ok": true, "data": <...>, "traceId": "<id>" }`
- Error:
  - `{ "ok": false, "error": { "code": "...", "message": "...", "details": <optional> }, "traceId": "<id>" }`

**Header:**
- `x-trace-id: <id>`
