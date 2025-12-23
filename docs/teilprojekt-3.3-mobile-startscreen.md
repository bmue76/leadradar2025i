# LeadRadar2025i – Teilprojekt 3.3 – Mobile Startscreen (2017-like) + Reason UX

Status: ✅ abgeschlossen

Commit(s):
- 3fdb207 — feat(mobile): start screen gate + locked reason ux
- 8798956 — feat(mobile): persist activation denial reason for start screen

## Ziel

UX wie “2017”:

- Wenn Activation gültig: **direkt** in Tabs (kein Startscreen / keine Activation UI sichtbar)
- Wenn Activation ungültig/abgelaufen: kurzer **Startscreen** (Brand + Status/Reason) mit Buttons:
  - “Lizenz aktivieren” → Activation Screen
  - “Einstellungen” → Settings Screen

Zusätzlich:
- Reason Anzeige (user-friendly + optional DEV debug):
  - missing_settings (baseUrl/tenantSlug fehlt)
  - missing_license
  - expired
  - backend_denied (falls vorhanden)
  - offline (wenn relevant)

## Umsetzung

### 1) Boot/Loading ohne Flackern
- Solange Settings + Activation noch nicht geladen sind, wird ein neutraler Boot-Screen angezeigt.
- Erst nach `settings.isLoaded && activation.isLoaded` entscheidet der RootNavigator.

### 2) Gate-Flow (RootNavigator)
- **Unlocked** (`baseUrl+tenantSlug` vorhanden UND `activation.isActiveNow`) ⇒ direkt `AppNavigator` ⇒ Tabs
- **Locked** ⇒ eigener `LockedNavigator` mit Einstieg **StartScreen**
  - Von dort Navigation zu Activation/Settings

### 3) StartScreen (2017-like)
- Brand-Startscreen mit Status/Reason Text
- Buttons:
  - “Lizenz aktivieren” → Activation
  - “Einstellungen” → Settings
- Offline-Hinweis, wenn Settings vorhanden aber Device offline.

### 4) backend_denied Reason (persistiert)
- Bei Aktivierungsfehlern (HTTP !ok) speichert `ActivationScreen` die Denial-Info (code/message/at) in AsyncStorage (`lr:activation`).
- StartScreen zeigt dann Reason **backend_denied** inkl. Code (falls vorhanden).
- Bei erfolgreicher Aktivierung werden Denial-Felder wieder geleert.

## Betroffene Files

- `mobile/App.tsx` (unverändert, OutboxAutoSyncGate läuft nur wenn unlocked)
- `mobile/src/navigation/RootNavigator.tsx` (Gate-Flow → StartScreen bei locked)
- `mobile/src/navigation/types.ts` (LockedStack: Start/Activation/Settings)
- `mobile/src/screens/StartScreen.tsx` (neu)
- `mobile/src/screens/ActivationScreen.tsx` (Denial persistieren)
- `mobile/src/storage/activation.ts` (Denial Felder im Record + helper)
- `mobile/src/storage/ActivationContext.tsx` (Denial-Felder + setDenied/clearDenied)

## Akzeptanzkriterien – Check

- ✅ Gültige Lizenz ⇒ App startet direkt in Tabs, ohne Startscreen/Activation Flash
- ✅ Keine Lizenz ⇒ Startscreen sichtbar, “Lizenz aktivieren” führt zu Activation
- ✅ Ablauf (expiresAt) ⇒ nach Tick/Reload locked + Startscreen erscheint
- ✅ Outbox AutoSync startet nur wenn unlocked

## Test-Quicklist

1) Unlocked: Settings gesetzt + Demo 60min oder echte Aktivierung → App killen → Start → direkt Tabs.
2) Locked: In Settings “Lizenz killen” → zurück → StartScreen sichtbar → Buttons funktionieren.
3) Denied: absichtlich falscher Key / falscher tenantSlug → Activation fail → StartScreen zeigt backend_denied.
4) Offline: Flugmodus + Settings vorhanden → StartScreen zeigt Offline Hinweis.

## Nächster sinnvoller Schritt (Vorschlag)

Teilprojekt 3.4 (UX/Polish):
- StartScreen: optional “Erneut versuchen / Refresh” (Settings+Activation refresh)
- Optional: install ripgrep (`rg`) im Dev-Setup für schnellere Code-Suche
- 2017-like UI-Feinschliff (Icons, Tab labels, Farben) + bessere Texte
