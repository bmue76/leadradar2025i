# LeadRadar2025i – Teilprojekt 3.5 – Mobile Outbox UX & Resilience (Polish)

Datum: 2025-12-25  
Branch: `main`  
Feature-Commit: `0571e77` – feat(mobile): outbox ux + item retry/reset + per-item error meta

## Ziel
Die Outbox im Mobile MVP soll zuverlässig und bedienbar sein:
- Item-Level Controls (Retry/Delete/Details)
- Resilience-Felder pro Item (tries/lastError/lastAttemptAt/lastSuccessAt/status)
- Klare UX-Infos (online/offline, auto-sync Status, last sync result/time)
- Keine Flow-Brüche: Activation Gate (3.2/3.3), AutoSync (3.1), Card E2E (3.4B)

## Umsetzung

### A) Storage: Schema + Migration (AsyncStorage)
**Datei:** `mobile/src/storage/outbox.ts`

Erweitertes `OutboxItem` Schema:
- `tries: number`
- `lastError?: { code?: string; message: string; at: string }` (legacy string wird best-effort konvertiert)
- `lastAttemptAt?: string`
- `lastSuccessAt?: string`
- `status?: "QUEUED"|"SYNCING"|"FAILED"|"DONE"`

Migration:
- `loadOutbox()` normalisiert Items defensiv (fehlende Felder defaulten).
- Legacy `lastError: string` → wird zu `OutboxError` mit `at` konvertiert.
- Bei erkannten Legacy-Shapes wird die normalisierte Outbox best-effort zurückgeschrieben.

Zusätzliche Utilities:
- `resetOutboxItemTries(id)`
- `resetAllOutboxTries()`

### B) Sync Engine: per Item Status + Single-Item Retry
**Datei:** `mobile/src/sync/outboxSync.ts`

Verbesserungen:
- Pro Item persistierte Zustände:
  - `status = "SYNCING"` beim Start eines Versuchs
  - `lastAttemptAt` gesetzt
  - bei Fehler: `tries++`, `status="FAILED"`, `lastError` als Objekt + Timestamp
  - bei Erfolg: `status="DONE"`, `lastSuccessAt`, danach `removeOutboxItem()`
- Mutex bleibt intakt (kein Doppelpost; schützt Manual + AutoSync gegeneinander).
- Neuer Entry-Point: `syncOutboxOne({ itemId, ... })` für “Retry nur dieses Item”.

Kompatibilität:
- Card-Flow bleibt wie 3.4B:
  - bevorzugt `cardImageBase64` inline
  - legacy fallback liest Attachment (FileSystem) und sendet inline
  - lokales Attachment wird nach erfolgreichem Sync gelöscht (best-effort)

### C) Outbox UI: Item Controls + Details + Global Status
**Datei:** `mobile/src/screens/OutboxScreen.tsx`

Neue UX/Controls:
- Global Status:
  - online/offline via NetInfo
  - auto-sync Status (best-effort Label: ON/OFF mit Begründung)
  - last sync result + time (aus `useOutboxSyncStatus()`)
- Item-Level:
  - **Details** Toggle (zeigt Status, lastAttemptAt, lastSuccessAt, lastError meta, Card/Legacy Info)
  - **Retry** (nur dieses Item) → `syncOutboxOne()`
  - **Reset** tries (pro Item, confirm) → `resetOutboxItemTries()`
  - **Delete** (confirm) → `removeOutboxItem()`
- Während laufendem Sync:
  - Action-Buttons sind disabled
  - Details bleiben lesbar

## Akzeptanzkriterien
- [x] Offline: Items bleiben queued, UI zeigt klar “Offline”
- [x] Online: AutoSync läuft wie bisher; Fehler werden pro Item persistiert (tries/error/time/status)
- [x] Retry: einzelnes Item kann manuell erneut gesynct werden (Mutex geschützt)
- [x] Delete: einzelnes Item kann gelöscht werden (Confirm)
- [x] Keine Doppelposts: Mutex bleibt intakt
- [x] Typecheck grün: `npx tsc -p mobile/tsconfig.json --noEmit`

## Hinweise / Next Steps
- Optional: AutoSync-Indicator könnte zusätzlich “why disabled” aus dem AutoSync Hook liefern (statt best-effort Label).
- Optional: Outbox Item “DONE” Historie (statt remove) wäre möglich, aktuell wird nach Erfolg entfernt (MVP).
