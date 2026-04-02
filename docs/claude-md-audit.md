# CLAUDE.md Audit — Oikos

**Datum:** 2026-04-02
**Aktuelle Länge:** 109 Zeilen (exkl. Leerzeilen)
**Zielbudget:** 80–150 Zeilen

---

## Phase 1: Ist-Analyse

### 1.1 Zweckerfüllung

**Teilweise erfüllt.** Die CLAUDE.md enthält eine Mischung aus verhaltenssteuernd und rein informativ:

- **Verhaltenssteuernd (gut):** Code Conventions, Migration-Append-Only-Regel, Changelog-Anweisung, i18n-Konvention, SPEC.md-Verweis
- **Rein informativ (kein Verhaltenseffekt):** Security Model (liest sich wie Doku, nicht wie Anweisung), Backend-Dependency-Liste (steht in package.json), Deployment-Section (Ops-Doku), Implementation Status (Zustandsbeschreibung)

**Fehlend:**
- Kein expliziter Hard-Constraints-Block. "No SPA framework" ist in einen Fließtext-Absatz eingebettet statt als nicht-verhandelbare Regel markiert.
- `public/utils/ux.js` wird von 7 Seiten importiert — kein Wort davon.
- `public/i18n.js` wird als System erwähnt, aber nicht als kanonische Datei referenziert.
- `offline.html` fehlt im Architecture-Tree.

### 1.2 Informationsarchitektur

**Keine klare Hierarchie.** Harte Constraints (kein Framework, kein innerHTML, Migration append-only) stehen verstreut in verschiedenen Sections auf gleicher Ebene wie weiche Konventionen (Semicolons: yes).

**Redundanzen mit CONTRIBUTING.md:**
- Project Structure: fast identischer Tree in beiden Dateien
- Code Conventions: ES modules, Semicolons, Header comments, try/catch — alles doppelt
- Testing: identische Beschreibung in beiden
- Changelog: gleiche Anweisung in beiden
- Migration append-only: in beiden Dateien

**Keine Widersprüche gefunden**, aber die Duplikation ist erheblich (~40% der CLAUDE.md-Inhalte finden sich auch in CONTRIBUTING.md).

### 1.3 Signalqualität

**Probleme:**
- "No SPA framework" ist deskriptiv formuliert statt imperativ — ein LLM könnte es als Kontextinfo statt als harte Regel lesen.
- Security Model ist eine Faktenbeschreibung. Kein Satz sagt "tu X" oder "tu niemals Y".
- Backend-Dependency-Liste ist reines Inventar — Claude kann `package.json` lesen.
- Deployment-Dockerfile-Snippet: rein informativ, kein Handlungsbezug.
- `node:20-slim` im CLAUDE.md-Deployment-Block, aber Dockerfile verwendet tatsächlich `node:22-slim` → **falsche Information**.

### 1.4 Vollständigkeit vs. Projektrealität

| Erwähnt in CLAUDE.md | Tatsächlicher Zustand | Problem |
|---|---|---|
| `public/assets/` (apple-touch-icon, favicons) | Verzeichnis existiert nicht — Icons in `public/icons/` | **Falscher Pfad** |
| `scripts/generate-icons.js` | Existiert ✅, aber `scripts/seed-demo.js` fehlt im Tree | Unvollständig |
| Dockerfile `node:20-slim` | Dockerfile nutzt `node:22-slim` | **Falsche Version** |
| Components: `modal.js`, `oikos-install-prompt.js` | Auch `oikos-locale-picker.js` existiert | Unvollständig |
| Keine Erwähnung von `public/utils/` | `public/utils/ux.js` wird von 7 Pages importiert | **Fehlt** |
| Keine Erwähnung von `public/offline.html` | Existiert, vom Service Worker referenziert | Fehlt im Tree |
| Keine Erwähnung von `public/locales/` | `de.json`, `en.json` existieren | Fehlt im Tree |
| Keine Erwähnung von `server/db-schema-test.js` | Existiert | Fehlt |

---

## Phase 2: Bewertung

| Kriterium | Status | Begründung |
|-----------|--------|------------|
| Nur verhaltenssteuernd, keine Spec-Duplikation | ⚠️ | Security Model, Deployment, Dependency-Liste sind rein informativ |
| Harte Constraints klar abgegrenzt | ❌ | Kein separater Block; "no framework" in Fließtext versteckt |
| Referenztabelle vollständig & aktuell | ❌ | Keine Referenztabelle vorhanden — nur ein Einzeiler zu SPEC.md |
| Pfade/Module korrekt | ❌ | `public/assets/` existiert nicht, Dockerfile-Version falsch |
| Keine Redundanz mit CONTRIBUTING.md | ❌ | ~40% Überlappung (Structure, Conventions, Testing, Changelog) |
| Keine Redundanz mit docs/ | ✅ | SPEC.md wird referenziert, nicht dupliziert |
| Keine vagen Formulierungen | ⚠️ | Deskriptive statt imperative Formulierungen bei Constraints |
| Signal-Rausch-Verhältnis | ⚠️ | ~30% der Zeilen sind informativ ohne Handlungsrelevanz |
| Fehlende verhaltensrelevante Info | ⚠️ | utils/ux.js, i18n.js als kanonische Dateien, offline.html |

---

## Phase 3: Optimierungsvorschlag

Siehe `CLAUDE.md.proposed` im Repo-Root.

---

## Phase 4: Diff & Begründung

### Entfernt

| Was | Warum |
|-----|-------|
| Security Model (vollständiger Abschnitt) | Reine Dokumentation. Kein Satz steuert Verhalten. Steht implizit im Code (helmet, bcrypt, CSRF-Middleware). |
| Backend/Optional/Dev Dependencies Liste | Claude kann `package.json` lesen. Inventarlisten steuern kein Verhalten. |
| Deployment Section (Dockerfile-Snippet, env vars, Nginx-Verweis) | Ops-Dokumentation, kein Entwicklungsverhalten. Gehört in README oder docs/. |
| Implementation Status | Reine Zustandsbeschreibung ohne Handlungsanweisung. |
| Architecture Tree (erschöpfende Version) | 25-Zeilen-Tree dupliziert CONTRIBUTING.md. Ersetzt durch kompakten 10-Zeilen-Überblick der nur verhaltensrelevante Orte zeigt. |

### Hinzugefügt

| Was | Warum verhaltensrelevant |
|-----|--------------------------|
| Expliziter Hard Constraints Block | Claude muss sofort wissen, was nicht verhandelbar ist — nicht erst aus Fließtext erschließen. |
| `public/utils/ux.js` als kanonische Utility | Wird von 7 Pages importiert. Ohne dieses Wissen würde Claude Utility-Funktionen duplizieren. |
| `public/i18n.js` + `public/locales/` in Structure | Kanonische Orte für i18n — Claude muss wissen, wo Locale-Keys definiert werden. |
| `offline.html` im Tree | Existiert, wird vom Service Worker referenziert, fehlte komplett. |
| Reference Documents Tabelle | Claude muss wissen, wo welche kanonische Wahrheit liegt, statt zu raten. |
| `oikos-locale-picker.js` in Components | Existierende Komponente fehlte — Claude könnte sie unwissentlich neu bauen. |

### Umformuliert

| Alt | Neu | Grund |
|-----|-----|-------|
| "No SPA framework. Client-side routing via History API." (deskriptiv) | "Never add frontend frameworks, bundlers, transpilers, or CSS libraries." (imperativ) | Deskriptive Aussage könnte als Kontextinfo statt als Constraint gelesen werden. |
| "Web Component prefix: `oikos-` (not `fb-`)" | "Web Component prefix: always `oikos-`." | `(not fb-)` ist historischer Kontext ohne Verhaltensrelevanz. |
| "ES modules everywhere" (Konvention unter vielen) | In Hard Constraints verschoben | Ist nicht verhandelbar, stand aber auf gleicher Ebene wie "Semicolons: yes". |

### Verschoben

| Was | Von | Nach | Grund |
|-----|-----|------|-------|
| Security Model Details | CLAUDE.md | Bereits in Code (middleware, auth.js) | Kein eigenes Dokument nötig — Code ist die Wahrheit |
| Deployment env vars, Dockerfile | CLAUDE.md | README.md (bereits dort vorhanden) | Ops-Information, nicht Entwicklungsverhalten |
| Detaillierter Project Structure Tree | CLAUDE.md | CONTRIBUTING.md (bereits dort vorhanden) | Duplikation eliminieren — CONTRIBUTING.md hat den vollständigen Tree |
