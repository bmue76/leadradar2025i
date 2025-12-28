# Teilprojekt 3.6 – Mobile OCR (Visitenkarte) + Meta Persistenz (Outbox) — Schlussrapport

## Ausgangslage
Ziel war, in der Mobile-App (Capture) eine **Visitenkarten-OCR** zu integrieren, Vorschläge anzuzeigen und (best-effort) in Formularfelder zu übernehmen.
Zusätzlich sollte OCR-Meta beim Offline-Fall in der Outbox persistiert und beim Sync wieder mitgesendet werden.

Parallel traten Build-/Device-Themen (iOS Dev-Client) sowie ein persistentes Backend-Problem auf: **POST /api/mobile/v1/leads → 500** (Leads landen in Outbox; Sync ist blockiert bzw. “Online: NO” trotz Forms “ONLINE”).

## Umgesetzt (Done)
### 1) On-device OCR Pipeline (MVP)
- OCR Wrapper integriert (on-device).
- Business-Card Parsing (heuristisch) auf E-Mail / Phone / URL / Name / Company.
- Review UI in `CaptureScreen`:
  - “OCR scannen”
  - Vorschläge anzeigen
  - Checkboxen pro Feld (anwenden ja/nein)
  - Option “Bestehende Werte überschreiben”
  - DEV: Rohtext anzeigen

### 2) OCR-Meta in Outbox / Sync
- OCR Meta wird beim Offline-Save mit gespeichert (`meta.ocr`).
- Sync sendet Meta “best-effort” mit (Fallback / tolerant).

### 3) Typing / Compatibility
- `mobile/src/ocr/types.ts` als zentrale Typbasis, kompatibel für Capture UI.
- TS Build grün: `npx tsc -p mobile/tsconfig.json --noEmit`

## Deliverables (Code/Files)
- `mobile/src/ocr/recognizeText.ts`
- `mobile/src/ocr/parseBusinessCard.ts`
- `mobile/src/ocr/types.ts`
- `mobile/src/screens/CaptureScreen.tsx` (OCR UI + Apply Logic)
- `mobile/src/storage/outbox.ts` (Persist Meta)
- `mobile/src/sync/outboxSync.ts` (Send Meta)
- `mobile/eas.json`
- `mobile/app.json` (Updates im Zuge Dev-Client/Build)

## Git Commits
- `a688caa` feat(mobile): ocr meta persist in outbox + sync sends meta (fallback)
- `09a9148` feat(mobile): add on-device ocr wrapper + business card parser

## Known Issues / Blocker (OPEN)
### A) Backend: POST /api/mobile/v1/leads → 500 (persistiert)
- Effekt:
  - Leads werden beim Speichern in Outbox queued
  - Backend loggt 500
  - “Sync now” im Outbox Screen nicht nutzbar / Online-Status nicht konsistent

**Repro**
1. Mobile Settings: `tenantSlug=demo`, `baseUrl=http://10.0.2.2:3000`
2. Form öffnen → Capture → Visitenkarte aufnehmen → Save Lead
3. Ergebnis: 500 im Backend, Lead landet Outbox queued

**Hypothesen (zu prüfen im Folge-Teilprojekt)**
- Auth/Context mismatch: Backend nutzt ggf. `requireTenantContext` (x-user-id + Owner) statt Mobile Tenant Scope (x-tenant-slug)
- Payload mismatch:
  - Mobile sendet `cardImageBase64`, `cardImageFilename`, `cardImageMimeType` (+ `meta`, `clientLeadId`, `capturedByDeviceUid`)
  - Backend Route akzeptiert evtl. nur `cardBase64`/`card.*` oder hat Pflichtfelder im Prisma-Model
- DB/Schema: Pflichtfelder / Migrationen / erwartete Modelle nicht aligned

### B) Mobile: Outbox Online Status inkonsistent
- Forms zeigt “ONLINE”, Outbox zeigt “Online: NO”
- Ursache vermutlich NetInfo `isInternetReachable` (Emulator/Localhost liefert gelegentlich null/undef).
- Muss im Folge-Teilprojekt robust gemacht werden (Online = isConnected && isInternetReachable !== false).

### C) iOS Dev Setup
- iOS Runtime: `Cannot find native module 'ExpoTextExtractor'`
- Bedeutet: läuft nicht in korrektem Dev-Client mit nativen Modulen (Expo Go reicht nicht).
- Workaround: Fokus auf Android (Emulator + Galaxy S21).

### D) Android Toolchain
- Gradle/AGP verlangt Java >=17.
- Lokale Umgebung nutzte zeitweise Java 11 (Eclipse JDK) → Build fail.
- Fix: JDK via Android Studio JBR + `org.gradle.java.home` (gradle.properties).

### E) Prisma Build EPERM (Windows)
- `EPERM rename ... query_engine-windows.dll.node.tmp -> ...`
- Typisch Windows File-Lock. Behebung: Node/Next Prozesse beenden, ggf. reboot; danach `prisma generate`/`npm run build` erneut.

## Fazit
OCR ist im Mobile Capture **MVP-fertig** und funktioniert (Scan + Review + Apply + Persistenz).
Der Lead-Save Pfad ist jedoch **blockiert durch Backend 500** und muss gezielt analysiert und gefixt werden.

## Nächstes Teilprojekt (Vorschlag)
### Teilprojekt 3.7 – Mobile Lead Save 500: Ursache finden & Fix
Ziele:
1. 500 reproduzierbar diagnostizieren (Server Logs/Trace)
2. Auth/tenant context sauber für Mobile definieren (x-tenant-slug / device / license)
3. Body Schema alignen (cardImage* + meta + clientLeadId + capturedByDeviceUid)
4. Outbox Online Detection robust machen + “Sync now” zuverlässig aktivieren
5. Optional: `/api/mobile/v1/ping` + In-App Diagnostics Screen

Akzeptanzkriterien:
- Save Lead online erzeugt Lead + Attachment ohne 500
- Outbox Sync funktioniert zuverlässig (Online=YES wenn Netz da)
- Offline weiterhin: Queue → später Sync erfolgreich
