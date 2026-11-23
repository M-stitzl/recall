# Recall

Eigenes Spaced-Repetition-System für einen einzelnen Nutzer: KI-generierte, von Hand
freigegebene Lernkarten aus Uni-Kursen, gelernt als PWA auf iPhone und Laptop.

## Stack

- **Web:** Next.js 16 (App Router, Turbopack, React Compiler), TypeScript strict, Tailwind 4
- **Backend:** Supabase (Postgres, Auth, RPC). Kein eigener Server – Schutz über Row Level Security
- **Scheduling:** ts-fsrs 6 mit dem **FSRS-6**-Modell (nicht dem Default FSRS-7)
- **Validierung:** Zod (`packages/schema`), Formeln mit KaTeX
- **Pipeline:** Python (PyMuPDF, python-pptx) für die Extraktion, TypeScript-CLI für Validierung und Import
- **Tests:** Vitest (Unit), Playwright (E2E gegen lokale Supabase-Instanz)

## Ordner

```
apps/web/            Next.js-App
  src/app/(app)/     geschützte Seiten: Heute, study, review, courses, course, import, stats, settings
  src/app/login, auth/confirm   Anmeldung (E-Mail + Passwort, Bestätigungs-/Reset-Links)
  src/lib/           fsrs.ts, queue.ts, render.ts, outbox.ts, data.ts, supabase.ts
  tests/             Vitest          e2e/   Playwright
packages/schema/     Zod-Schema für das Karten-JSON (von Web und Pipeline genutzt)
pipeline/            recall_pipeline.py (ingest/extract), moodle_fetch.py, src/*.ts (CLI), prompts/
supabase/            config.toml, migrations/ (einzige Quelle für das Schema), seed.sql
scripts/backup.ps1   Datenbank-Backup
kurse/               Kursmaterial – lokal, NIE im Repo
```

## Befehle (im Repo-Root)

| Zweck | Befehl |
| --- | --- |
| Lokale Datenbank starten / stoppen | `pnpm db:start` / `pnpm db:stop` |
| Schema neu aufbauen (löscht lokale Daten!) | `pnpm db:reset` |
| App entwickeln | `pnpm dev` |
| Unit-Tests | `pnpm test` |
| E2E-Tests (braucht `pnpm db:start`) | `pnpm test:e2e` |
| Lint / Typen | `pnpm lint` / `pnpm typecheck` |
| Karten-JSON prüfen / importieren | `pnpm cards:validate <datei>` / `pnpm cards:import <datei>` |
| Ablehnungsgründe in den Prompt zurückführen | `pnpm cards:feedback` |
| Kursmaterial extrahieren | `pipeline/.venv/Scripts/python pipeline/recall_pipeline.py extract "kurse/<kurs>"` |

Vor jedem Commit: `pnpm lint && pnpm typecheck && pnpm test`. Nach Änderungen an Lernsession,
Freigabe, Import oder Schema zusätzlich `pnpm test:e2e`.

## Regeln

- **Kursmaterial wird nie committet** und nie an externe Dienste gesendet. `kurse/` und
  `backups/` stehen in `.gitignore`. In der Datenbank liegen nur eigene Formulierungen und
  Quellenverweise. **Ausnahme (Entscheidungen vom 15.11.2026): ausgewählte Folienbilder und
  zitierte Textabschnitte, nur im privaten Speicher.** Erlaubt sind einzelne Folien, die in einer
  Bildkarte vorkommen oder von einer Karte zitiert werden (Button „Quelle anzeigen“, immer die
  ganze Folie), sowie zitierte Abschnitte aus Lernpfad-Büchern bzw. Excel-Blättern als Markdown.
  Nie ganze PDFs. Ablage im Bucket `slides` unter `<user_id>/…` mit Zugriffsregel „nur
  Eigentümer“ und kurzlebigen signierten Links. Kein öffentlicher Bucket, keine öffentlichen URLs.
- **Keine Secrets im Code oder im Repo.** `.env*` ist ignoriert. Die Web-App kennt nur den
  öffentlichen Supabase-Schlüssel; der Service-Role-Schlüssel gehört ausschließlich in
  `pipeline/.env` bzw. kommt lokal aus `supabase status`.
- **Schemaänderungen nur als neue Migration** in `supabase/migrations/` (nie im Dashboard,
  nie bestehende Migrationen ändern, sobald sie in der Cloud liegen). Jede neue Tabelle
  bekommt `user_id`, RLS und Policies.
- **FSRS nicht selbst implementieren.** Alles Scheduling läuft über `src/lib/fsrs.ts`.
  `tests/fsrs.test.ts` enthält Referenzintervalle – schlagen sie nach einem Update fehl,
  hat sich das Scheduling geändert; nicht einfach die Erwartungswerte anpassen.
- **`review_logs` wird nie geändert oder gelöscht** (Grundlage für Statistik und spätere
  Parameter-Optimierung). Bewertungen laufen nur über die RPC `review_card`.
- **Nur freigegebene Notes erzeugen Karten** (Trigger `notes_create_cards`). Diese Schranke
  nicht umgehen.
- **Zeit:** UTC in der Datenbank; „heute“ wird im Browser aus der lokalen Zeit berechnet
  (`src/lib/queue.ts`).
- **Validierung mit Zod** an jeder Grenze, an der fremdes JSON hereinkommt.
- Kartentext wird ausschließlich über `renderText` (`src/lib/render.ts`) zu HTML – die Funktion
  escaped alles. Nie rohen Kartentext per `dangerouslySetInnerHTML` ausgeben.
- UI-Texte auf Deutsch.

## Architektur in Kürze

- Alle Seiten sind statisch; Daten werden im Browser mit der Session des Nutzers geladen
  (`src/lib/data.ts`). Es gibt keine Server Actions und keine Server-seitigen Datenzugriffe.
  Dadurch startet die PWA sofort und der Login funktioniert in der installierten iOS-App.
- Anmeldung mit E-Mail und Passwort (kein Magic Link: Links öffnen sich auf dem iPhone in Safari,
  nicht in der Homescreen-App). Die Session liegt im `localStorage` (`recall-auth`). Wer ein
  Konto anlegen darf, entscheidet die Tabelle `allowed_emails` über einen Trigger auf `auth.users`.
- Produktion: Vercel und ein Supabase-Cloud-Projekt. Projekt-ID und App-Adresse stehen nur lokal
  in `supabase/.env` (ignoriert), Details in der README unter „Deployment“.
- Die Lernsession rechnet den nächsten Kartenzustand im Browser aus (ts-fsrs) und schreibt
  ihn über den Ausgangskorb (`src/lib/outbox.ts`) in die Datenbank. `review_card` ist über
  die Log-ID idempotent – Retries nach Funklöchern buchen nie doppelt.
- Ein Kurs ist zugleich das Deck. Note = Inhalt, Card = Lernzustand (eine Cloze-Note mit
  drei Lücken ergibt drei Karten).

## Design

Arbeitsoberfläche („Operate“): vertraute Bedienelemente, die Gestaltung steckt in Details.
Alle Farben sind Tokens in `apps/web/src/app/globals.css` (hell und dunkel).

- **Welt:** Karteikarte und Textmarker. Warmes Papier als Grund, Tinte als Schrift, Markergelb
  (`marker`) nur für die Hauptaktion, die aufgedeckte Lücke, Auswahl und die aktive Navigation.
  Die Navigation ist in Tinte (`shell`) gesetzt.
- **Zustandsfarben** `again`/`hard`/`good`/`easy` nur für Lernzustände und Bewertungen, nie als
  Dekoration.
- **Signatur:** der Kartenstapel von der Seite (`components/stack-strip.tsx`), ein Strich pro
  Karte nach Zustand – auf „Heute“, pro Kurs und in der Lernsession.
- **Schrift:** Geist für die Oberfläche, Source Serif 4 für Karteninhalte (passt zu KaTeX).
- **Flächen:** `.sheet` (erhaben) nur für die Karteikarte und Formulare; Listen sind Zeilen mit
  Haarlinien (`.rows`), keine Kachelraster.
- **Bewegung:** ein gestalteter Moment (`.reveal`, die Antwort kommt auf die Karte), sonst nur
  kurze Zustandsübergänge; `prefers-reduced-motion` wird respektiert.
- Komponentenklassen stehen in `@layer components`, damit Tailwind-Utilities sie überschreiben.

## Arbeitsweise

Kleine, testbare Inkremente. Für Scheduling, Queue und Import zuerst den Test schreiben.
Next.js 16 weicht von älteren Versionen ab: vor Framework-Arbeit die passende Seite unter
`apps/web/node_modules/next/dist/docs/` lesen (siehe `apps/web/AGENTS.md`).
Prompt-Änderungen für die Kartengenerierung gehören in `pipeline/prompts/`, nicht in den Chat.
