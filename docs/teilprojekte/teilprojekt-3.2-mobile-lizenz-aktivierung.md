# LeadRadar2025i – Teilprojekt 3.2 – Mobile Lizenz Aktivierung (UI + Gate)

Status: ✅ abgeschlossen  
Commit(s): dd02a2f

## Ziel
- In der Mobile App eine Lizenz-Aktivierung ermöglichen und den Zugriff auf die App-Funktionen (Capture/Sync) sperren, wenn keine gültige Lizenz vorhanden ist.

## Umsetzung

### 1) Persistenter Activation-State (AsyncStorage)
- Key: `lr:activation`
- Persistiert:
  - `active`
  - `expiresAt` (ISO)
  - `keyLast4`
  - `licenseKeyId` (optional)
  - `updatedAt`

### 2) Activation Context
- `ActivationProvider` lädt Activation-State beim App-Start.
- `isActiveNow` berechnet Laufzeit-Gültigkeit (inkl. `expiresAt > now`).
- Tick alle 30s, damit die App bei Ablauf automatisch wieder sperrt.

### 3) App Gate / Navigation
- Neutraler Boot-Screen, solange Settings/Activation laden.
- Unlocked:
  - wenn `baseUrl + tenantSlug` gesetzt UND `activation.isActiveNow === true`
  - dann direkt in Tabs/App (kein Startscreen)
- Locked:
  - nur `Activation` und `Settings` erreichbar

### 4) Activation Screen
- Input: `licenseKey`
- Call: `POST /api/mobile/v1/activate`
  - Header: `x-tenant-slug`
  - Body: `{ licenseKey, deviceUid, platform, appVersion, osVersion }`
- Error UX: verständliche Meldungen für:
  - `PAYMENT_PENDING`
  - `KEY_ALREADY_BOUND`
  - `LICENSE_EXPIRED`
  - `TENANT_REQUIRED`
  - `TENANT_NOT_FOUND`

### 5) Demo Mode (Testphase)
- Button: **Demo 60 min**
- Setzt lokal `active=true` und `expiresAt=now+60min` → App wird sofort entsperrt.

### 6) DEV Tools
- Settings: Button **Lizenz killen**
  - löscht `lr:activation` → App wird wieder gesperrt.

### 7) Auto-Sync Guard (Outbox)
- `OutboxAutoSyncGate` wird nur gemountet, wenn:
  - Settings loaded + vorhanden
  - Activation loaded + aktiv (nicht abgelaufen)

## Akzeptanzkriterien (erfüllt)
- Activation success → App unlocked ✅
- PAYMENT_PENDING / KEY_ALREADY_BOUND → verständliche Meldung ✅
- LICENSE_EXPIRED → App blockiert wieder ✅ (via expiresAt check)
- Restart App → State persists korrekt ✅

## Hinweise / Next Steps
- Optional: `appVersion` aus `expo-application` lesen (statt "dev").
- Optional: Deeper parsing von Backend Response, falls Shape variiert (ok/data/error).
