# Backlog

Feature-Requests und geplante Erweiterungen. Einträge hier werden **nicht** implementiert bis sie explizit priorisiert und in einen Release-Branch überführt werden.

---

## Priorität: Hoch (SPEC-Lücken)

### BL-01 — Kalender: Wiederkehrende Events werden nicht expandiert

**Status:** Erledigt (v0.3.0)
**Aufwand:** M (3–5 Tage)

Das Datenmodell speichert `recurrence_rule` (iCal RRULE) für Kalender-Events. Der `recurrence.js`-Service mit `nextOccurrence()` existiert und wird in Tasks genutzt. Im Kalender-Route (`server/routes/calendar.js`) fehlt jedoch die Expansion: Beim Abruf der Events werden Wiederholungsinstanzen nicht generiert. Wiederkehrende Termine erscheinen daher nur einmal (beim Originaldatum).

**Akzeptanzkriterien:**
- GET `/api/v1/calendar` expandiert RRULE-Events im angefragten Zeitfenster
- Instanzen erben Farbe, Titel, Beschreibung des Original-Events
- In der UI sind Wiederholungs-Instanzen mit einem kleinen Repeat-Icon gekennzeichnet
- Einzelne Instanz kann bearbeitet werden (Ausnahme), Serie bleibt unberührt

---

### BL-02 — Budget: Monatsvergleich (aktuell vs. Vormonat)

**Status:** Erledigt (v0.3.0)
**Aufwand:** S (1–2 Tage)

SPEC: „Monatsvergleich (aktuell vs. Vormonat)". Derzeit zeigt die Budget-Seite nur den aktuellen Monat. Es fehlen API-Endpunkt und UI-Komponente für den Vergleich.

**Akzeptanzkriterien:**
- Monatsübersicht zeigt Einnahmen/Ausgaben des Vormonats als Vergleichswerte (Trend-Pfeile oder %-Differenz)
- Keine zusätzliche Seite — inline im bestehenden Budget-Header
- Server: GET `/api/v1/budget?month=YYYY-MM` gibt bereits Monatsdaten zurück; Vormonat kann mit einem zweiten Call oder als optionaler `compare`-Parameter geholt werden

---

### BL-03 — Essensplan: Drag & Drop zwischen Slots und Tagen

**Status:** Erledigt (v0.3.0)
**Aufwand:** M (2–4 Tage)

SPEC: „Drag & Drop zwischen Tagen/Slots". Die Wochenansicht zeigt Mahlzeit-Karten aber unterstützt kein Drag & Drop. Mahlzeiten können nur gelöscht und neu angelegt, nicht verschoben werden.

**Akzeptanzkriterien:**
- Mahlzeit-Karte ist draggable
- Drop auf leeren Slot verschiebt die Mahlzeit (PUT `/api/v1/meals/:id` mit neuem `date` + `meal_type`)
- Drop auf belegten Slot: Swap oder Ablehnung mit visuellem Feedback
- Touch-Support (pointer events, kein reines HTML5 Drag API)
- Reduced-motion: bei `prefers-reduced-motion` kein Animations-Feedback, Aktion trotzdem möglich

---

## Priorität: Mittel

### BL-04 — Kalender-Sync: Settings-UI vollständig verdrahten

**Status:** Offen
**Aufwand:** M (2–3 Tage)

Die Sync-Services `server/services/google-calendar.js` und `server/services/apple-calendar.js` sind implementiert (~300 Zeilen je). Das Settings-UI in `public/pages/settings.js` zeigt die Verbindungs-Buttons. Unklar ob der komplette OAuth-Flow (Redirect → Callback → Token-Speicherung → Auto-Sync-Intervall) end-to-end getestet und fehlerfrei ist.

**Akzeptanzkriterien:**
- Google-OAuth-Flow: Verbinden → Callback → Token gespeichert → Status in Settings zeigt „Verbunden"
- Apple CalDAV: Credentials-Formular → Verbindungstest → Fehleranzeige wenn Credentials falsch
- Auto-Sync alle 15 min (konfigurierbar) läuft als Hintergrund-Job
- Konfliktstrategie: externes Event gewinnt (wie in SPEC)

---

### BL-05 — Budget: Wiederkehrende Buchungen automatisch generieren

**Status:** Erledigt (v0.3.0)
**Aufwand:** S (1–2 Tage)

Das Budget-Formular hat eine „Wiederkehrend"-Checkbox und speichert `is_recurring = 1`. Es fehlt jedoch die automatische Generierung der Folgebuchungen. Derzeit muss der Nutzer jede Buchung manuell eintragen.

**Akzeptanzkriterien:**
- Beim Laden des Monats prüft der Server, ob fällige Wiederholungsbuchungen fehlen und legt sie automatisch an (analog zu Tasks)
- Oder: expliziter „Generieren"-Button im UI mit Vorschau
- Nutzer kann einzelne generierte Instanz löschen ohne die Serie zu löschen

---

### BL-06 — Shopping: Schnell-Add Autocomplete von lokalem Verlauf

**Status:** Erledigt (bereits vollständig implementiert)
**Aufwand:** XS

`shopping.js` ruft `/api/v1/shopping/suggestions?q=...` auf. Prüfen ob der API-Endpunkt auf Server-Seite existiert und korrekt auf die `shopping_items`-Historie zugreift. Falls ja, Status auf „Fertig" setzen.

---

## Priorität: Niedrig / Ideen

### BL-07 — Notizen: Volltextsuche / Filter

Derzeit keine Suchfunktion in der Pinnwand. Die Notizen liegen im State, eine Client-seitige Filterleiste wäre ohne API-Änderung machbar.

---

### BL-08 — Dashboard: Wetter-Widget Refresh

Wetter-Widget lädt beim Seitenaufruf und hat keinen manuellen Refresh-Button. Bei langem Tab-Offenbleiben können die Daten veralten. Ein 30-Minuten-Interval oder ein Refresh-Icon wäre sinnvoll (SPEC erwähnt „Refresh 30min" implizit).

---

### BL-09 — Kontakte: vCard-Import / -Export

Nicht im SPEC, aber naheliegend: `.vcf`-Export eines Kontakts, Import aus vCard für Erstbefüllung.

---

### BL-10 — PWA: Offline-Fallback für kritische Seiten

Der Service Worker cached aktuell den App-Shell. Bei Offline-Nutzung fehlt eine sinnvolle Fallback-Seite mit dem Hinweis auf fehlende Verbindung und einem „Wiederholen"-Button.

---

## Erledigte Features (Referenz)

| Feature | Version |
|---------|---------|
| UX Polish (Animationen, Bottom Sheet, FAB, Validierung, Stagger, Vibration) | v0.2.0 |
| Event-Listener-Leaks, CSS-Lücken, Modal-Tests | v0.2.1 |
