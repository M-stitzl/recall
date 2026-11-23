# Prüfungsprofil erstellen

Ziel: `kurse/<kurs>/pruefungsprofil.md` – eine knappe Beschreibung dessen, was in der Klausur
drankommt. Sie steuert Auswahl und Priorität der Karten.

## Vorgehen

1. `kurse/<kurs>/manifest.json` lesen. Quellen in dieser Reihenfolge auswerten:
   Altklausuren (`altklausur`) → Übungsblätter und Lösungen (`uebung`) →
   Learning Objectives und Zusammenfassungsfolien in den Vorlesungen (`folien`).
2. Nur festhalten, was die Quellen belegen. Fehlen Altklausuren, das im Profil ausdrücklich
   sagen und die Gewichtung aus Übungen und Learning Objectives ableiten.
3. Bestehendes Profil aktualisieren statt neu schreiben, wenn neue Wochen dazukommen.

## Aufbau der Datei

```markdown
# Prüfungsprofil: <Kurs>

Stand: <Datum> · Grundlage: <welche Quellen, z. B. 2 Altklausuren, 5 Übungen, 6 Vorlesungen>

## Format
Klausurart (offen/geschlossen), Dauer, Hilfsmittel, Aufgabentypen (Rechnen, Multiple Choice,
Freitext, Fallstudie) – soweit aus den Quellen ersichtlich. Unbekanntes als „unbekannt“ markieren.

## Themen und Gewichtung
| Thema | Gewicht (hoch/mittel/niedrig) | Beleg | Typische Aufgabe |
| --- | --- | --- | --- |

## Wiederkehrende Aufgabentypen
Je Typ: was verlangt wird, welche Formeln oder Schritte man auswendig können muss.

## Formeln und Definitionen, die sitzen müssen
Liste mit Verweis auf Datei und Folie.

## Kartenbudget
| Quelle | Stufe (A–D) | Budget | Schwerpunkt |
| --- | --- | --- | --- |
Höchstens 20 je Vorlesung/Tutorial, höchstens 150 für den Kurs. Stufen und Regeln:
pipeline/prompts/cards.md, Abschnitt „Budget zuerst“. Ein Rest bleibt für kommende Wochen frei.

## Offene Punkte
Was die Quellen nicht hergeben (z. B. keine Altklausur vorhanden).
```

Für eine **offene** Klausur (Open Book) gilt: weniger Definitionskarten, mehr Karten zu
Vorgehen, Abgrenzung und typischen Fehlern.
