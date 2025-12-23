# LeadRadar2025i – Teilprojekt 3.4A – Mobile UX/Polish + Mini Branding

Status: ✅ abgeschlossen

Commit(s):
- d2175fb — feat(mobile): mini branding + refresh/retry + reason ux polish

## Ziel

Kleine, aber wirkungsvolle UX/Polish-Verbesserungen ohne neue große Features:
- StartScreen: Refresh/Retry inkl. Loading-State
- Reason UX: verständliche Texte + optional DEV-Details
- Stabilität: weniger UI-Flashes / Buttons disabled bei Loading
- Mini Branding: kleines Logo/Icon auf Start/Activation/Settings

## Umsetzung

### A) StartScreen: Refresh/Retry
- Button **„Erneut versuchen / Aktualisieren“**
- Triggert `settings.refresh()` + `activation.refresh()` parallel (Promise.allSettled)
- UI Loading-State, Buttons während Refresh disabled
- „Wird geöffnet…“ State wenn bereits unlocked (reduziert Flash beim Gate-Switch)

### B) Texte & Reason UX
- Lock-Reasons user-friendly:
  - missing_settings → „Bitte Basis-URL & Tenant setzen“
  - missing_license → „Keine aktive Lizenz“
  - expired → „Lizenz abgelaufen“
  - backend_denied → „Aktivierung abgelehnt (Details/Code)“
  - offline → „Kein Internet – bitte verbinden“
- DEV Details als einklappbarer Block (nur `__DEV__`)

### C) Klein-Stabilität
- Buttons disabled während Refresh/Unlocking
- Aktivierung: Loading State (Busy) verhindert Doppel-Requests
- Denial-Reason wird bei erfolgreicher Aktivierung zuverlässig geleert

### D) Mini Branding
- Assets:
  - `mobile/assets/brand/icon.png`
  - `mobile/assets/brand/logo.png`
- Reusable Component:
  - `mobile/src/components/BrandMark.tsx`
- Integration:
  - StartScreen: oben Branding + „Mobile Lead Capture“
  - ActivationScreen: Branding oben
  - SettingsScreen: Branding oben + kleines Footer-Mark

## Akzeptanzkriterien – erfüllt

- StartScreen zeigt Refresh und landet nach gültigem Refresh ohne störende Flashes in Tabs.
- Reason Texte verständlich und konsistent.
- backend_denied wird nach erfolgreicher Activation geleert.
- Branding klein/clean, nicht aufdringlich.
- Gate-Flow bleibt korrekt, AutoSync weiterhin nur unlocked.

## Nächste Schritte (Vorschlag)

- Optional: StartScreen Detailbox für backend_denied auch in Non-DEV (bereits vorhanden), DEV-Block bleibt nur DEV.
- Optional: BrandMark für Dark/Light Theme feinjustieren (falls gewünscht).
