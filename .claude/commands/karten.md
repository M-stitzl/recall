---
description: Erzeugt aus einer Vorlesung geprüfte Lernkarten im Kartenbudget (Profil → Generierung → Selbstprüfung → Validierung)
argument-hint: <Kursordner oder Datei, z. B. "kurse/<Kurs>" oder "kurse/<Kurs>/<Woche>/<Datei>.pdf">
---

Erzeuge Lernkarten für: $ARGUMENTS

Arbeite die Schritte der Reihe nach ab. Kursmaterial bleibt lokal: nichts aus `kurse/`
hochladen, committen oder an externe Dienste senden. Moodle-Lektionen, Quizze und Tests werden
nie geöffnet oder bearbeitet.

1. **Extraktion.** `pipeline/.venv/Scripts/python pipeline/recall_pipeline.py extract "<kursordner>"`
   (unter macOS/Linux `pipeline/.venv/bin/python`).
2. **Prüfungsprofil.** Fehlt `kurse/<kurs>/pruefungsprofil.md`, erstelle es nach
   `pipeline/prompts/pruefungsprofil.md` – inklusive Tabelle „Kartenbudget“ – und **zeig es mir,
   bevor du Karten erzeugst.** Ohne meine Freigabe des Profils keine Karten.
3. **Budget prüfen.** Lies das Kartenbudget aus dem Profil und zähle bereits vorhandene
   `kurse/<kurs>/_karten/*.notes.json`. Ist das Budget einer Quelle oder des Kurses erschöpft,
   erzeuge keine weiteren Karten und sag es mir.
4. **Auswahl.** Wurde eine Datei genannt, nur diese. Sonst nur Quellen der **aktuellen
   Vorlesungswoche** (just-in-time), nicht alle auf einmal. Stufe B (Bücher) nur über
   `buch-index.md`, Stufe C (Excel-Modelle) nie als Karten.
5. **Generierung.** Exakt nach `pipeline/prompts/cards.md`, eine
   `kurse/<kurs>/_karten/<name>.notes.json` pro Quelle, höchstens 20 Notes.
6. **Selbstprüfung.** Nach `pipeline/prompts/selfcheck.md` in einem eigenen Durchlauf mit frisch
   gelesener Quelle, möglichst durch einen Subagenten.
7. **Validierung.** `pnpm cards:validate "<datei>"` muss fehlerfrei durchlaufen.
8. **Bericht.** Pro Datei: Anzahl Notes, Basic/Cloze, markierte Notes, und was wegen des Budgets
   weggelassen wurde. Stand des Kursbudgets (verbraucht / gesamt). Importiere **nicht** selbst –
   der Import ist meine Entscheidung.
