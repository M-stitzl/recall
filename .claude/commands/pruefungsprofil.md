---
description: Erstellt oder aktualisiert das Prüfungsprofil eines Kurses aus Altklausuren, Übungen und Learning Objectives
argument-hint: <Kursordner, z. B. "kurse/Asset Management">
---

Erstelle oder aktualisiere das Prüfungsprofil für: $ARGUMENTS

1. Führe `pipeline/.venv/Scripts/python pipeline/recall_pipeline.py extract "<kursordner>"` aus
   (unter macOS/Linux `pipeline/.venv/bin/python`).
2. Folge `pipeline/prompts/pruefungsprofil.md` und schreibe `kurse/<kurs>/pruefungsprofil.md`.
3. Prüfe im Manifest, ob die erkannte Art jeder Datei stimmt (`folien`, `uebung`, `altklausur`).
   Korrigiere falsche Einträge direkt in `manifest.json` – sie bleiben beim nächsten Lauf erhalten.
4. Fasse mir in fünf Zeilen zusammen: Klausurformat, die drei wichtigsten Themen, und was die
   Quellen nicht hergeben.

Kursmaterial bleibt lokal: nichts aus `kurse/` hochladen, committen oder an externe Dienste senden.
