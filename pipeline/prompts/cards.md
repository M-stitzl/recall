# Kartengenerierung

Versionierter Prompt-Baustein. Änderungen an der Kartenqualität laufen über diese Datei,
nicht über den Chat – so bleibt nachvollziehbar, was sich wann geändert hat.

## Aufgabe

Erzeuge aus **einer** extrahierten Quelle (`kurse/<kurs>/_extrakt/.../<datei>.md`) Lernkarten
für ein Spaced-Repetition-System. Ziel ist die Klausur des Kurses, nicht Vollständigkeit.

Lies vorher:

1. die Quelle selbst, vollständig – bei Folien mit Bildverweis (`![Folie N](…)`) auch das Bild,
2. `kurse/<kurs>/pruefungsprofil.md`, falls vorhanden (Themen, Gewichtung, Aufgabentypen),
3. `pipeline/prompts/feedback.md`, falls vorhanden (verworfene Karten und ihre Gründe).

## Budget zuerst: das Zeitbudget bestimmt die Kartenzahl, nicht das Material

Jede Karte erzeugt dauerhaft Wiederholungen. Faustregel bei 90 % Zielretention: Die tägliche
Review-Last liegt grob beim 8- bis 10-Fachen der neuen Karten pro Tag. Bei 25 Minuten täglich und
etwa 8 Sekunden pro Karte sind das rund 180 Reviews, also **15 bis 20 neue Karten pro Tag über alle
Kurse**. Jedes Deck muss in dieses Budget passen.

**Harte Obergrenzen:**

- höchstens **20 Notes pro Vorlesung bzw. Tutorial**,
- höchstens das Kursbudget aus `kurse/<kurs>/pruefungsprofil.md` (Tabelle „Kartenbudget“;
  ohne Angabe: 150 pro Kurs, abzüglich bereits importierter Notes).

Reicht das Budget nicht, wird **nach Prüfungsprofil priorisiert, nicht aufgefüllt**: Was am Ende
der Prioritätenliste steht, entfällt. Nenne im Bericht, was du weggelassen hast und warum.

**Material nach Stufen:**

| Stufe | Material | Behandlung |
| --- | --- | --- |
| A Prüfungskern | Vorlesungsfolien, Tutorien, Quiz-Themen | Karten, priorisiert nach Prüfungsprofil |
| B Lücken füllen | Bücher, Lernpfad-Bücher, Reading List | **keine Karten auf Vorrat.** Erst ein Index (Kapitel → Vorlesungsthema). Karten nur für Profil-Themen, die die Folien nicht erklären, jede mit Begründung |
| C Können | Excel- und Rechenmodelle | **keine Karten**, sondern Übungsaufgaben (Modell aus leerem Rahmen nachbauen) |
| D Fallmaterial | Geschäftsberichte, Fallstudien | nur als Beispiel in Übungsaufgaben, höchstens 5 Karten |

**Just-in-time:** Karten pro Vorlesungswoche erzeugen, synchron zum Kurs, nicht alles vorab. Ein
großer Vorrat ungeprüfter Entwürfe wird nie freigegeben.

## Kartenmix: verstehen statt raten

Zielmix pro Vorlesung bzw. Tutorial. Die Anteile sind aus Lernprinzipien abgeleitet, keine
empirisch optimierte Quote. Je nach Klausurformat nachjustieren: Gibt es Rechenaufgaben in der
Klausur, bekommen Anwendungsaufgaben mehr Gewicht.

| `format` | Anteil | Was | Form |
| --- | --- | --- | --- |
| `warum` | ca. 40 % | Warum/Wie-Fragen zu Mechanik, Bedingungen und Abgrenzungen | `type: basic`, Antwort frei in **höchstens 2 Sätzen** |
| `cloze` | ca. 25 % | nur Formeln, Definitionen, Kennzahlen | `type: cloze`, **genau 1 Lücke = 1 Kernbegriff**, höchstens 20 Wörter |
| `anwendung` | ca. 20 % | Mini-Rechenaufgabe mit **eigenen Zahlen** | `type: basic`, Zahlen auf der Vorderseite, **Rechenweg auf der Rückseite** |
| `bild` | ca. 15 % | verdecktes Element in einer Grafik | über `pipeline/bildkarten.py` (siehe unten) |

Beispiele (Corporate Finance, frei formuliert):

- **warum:** „Why does the WACC not keep falling as the debt ratio rises?“
- **cloze:** „WACC weights the cost of capital by {{c1::market values}}.“
- **anwendung:** „E = 600, D = 400, r_E = 10 %, r_D = 5 %, t = 30 %. WACC?“ – Rückseite:
  Rechenweg und Ergebnis.

## Qualitätscheck für Cloze-Karten

Eine Cloze-Karte ist schlecht, wenn **eines** davon zutrifft. Dann umschreiben in eine
Warum/Wie-Frage oder streichen:

1. Die Lücke ist aus Grammatik oder Satzlänge erratbar.
2. Die Lücke ist ein triviales Wort statt des Kernkonzepts.
3. Der Satz hat mehr als etwa 20 Wörter oder enthält mehrere Lücken, die zusammen abgefragt werden.
4. Man kann die Antwort sagen, aber nicht erklären, warum sie stimmt.

Das Schema prüft Regel 3 automatisch (genau eine Lücke, höchstens 20 Wörter); 1, 2 und 4 prüfst du.

## Anwendungsaufgaben

- Eigene, runde Zahlen, keine Zahlen von der Folie abschreiben. Die **Methode** muss aus der Quelle
  stammen (z. B. die WACC-Formel von Folie 15); `source_ref` nennt die Stelle der Methode.
- Rechne jedes Ergebnis nach, bevor die Karte geschrieben wird (Skript oder Taschenrechner).
- Rückseite: Rechenweg in Schritten, Ergebnis am Ende, mit Einheit.

## Bildkarten und Folienbilder

- Bei normalen Karten kein Folienbild auf der Vorderseite; die Folie ist über „Quelle anzeigen“
  erreichbar (`pipeline/quellen.py`).
- Bildkarten (`format: bild`): Folie mit einem verdeckten Element, erzeugt über eine
  `bildkarten.spec.json` und `pipeline/bildkarten.py`. Nur Grafiken, bei denen kein anderer Text
  auf der Folie die verdeckte Antwort verrät.

## Umfang

- Innerhalb des Budgets: lieber 12 gute als 20 mittelmäßige Notes.
- Keine Karten zu Organisatorischem, Agenda-Folien, Literaturlisten oder Wiederholungsfolien.
- Jede Note steht für sich: Sie muss ohne die Folie und ohne Nachbarkarten verständlich sein.
- Keine reinen Aufzählungsfragen („Nenne die fünf …“). Aufzählungen werden zu Warum/Wie-Fragen
  über einzelne Punkte oder zu einer Cloze-Karte für den einen Kernbegriff.

## Regeln für jede Karte

1. **Eine Idee pro Karte.**
2. **`warum_relevant` ist Pflicht:** ein Satz auf Deutsch mit Bezug zum Prüfungsprofil
   (Thema, Gewicht, Aufgabentyp), z. B. „Hoch gewichtet: WACC kommt als Zahlenfeld-Aufgabe.“
3. **Kurze, eindeutige Antworten.** Wenn mehrere verschiedene Antworten richtig wären, ist die
   Frage zu offen.
4. **Eigene Formulierungen.** Formuliere um, statt Folientext zu kopieren.
5. **Nichts erfinden.** Jede Aussage muss in der Quelle stehen. Was die Quelle nicht hergibt,
   wird nicht ergänzt – auch nicht, wenn es fachlich stimmt.
6. **Quelle ist Pflicht.** `source_ref` nennt die Folie(n), z. B. `Folie 14` oder `Folie 14–15`.
7. **Sprache der Karte = Sprache der Quelle.** Englische Vorlesung → englische Karten.
   `warum_relevant` ist immer Deutsch.
8. **Priorität laut Prüfungsprofil:** `hoch` für Kernthemen und alles, was in Altklausuren oder
   Übungen vorkommt; `mittel` als Standard; `niedrig` für Randthemen und Beispiele.

## Formeln

- LaTeX in `$…$` (im Satz) oder `$$…$$` (abgesetzt). In JSON müssen Backslashes doppelt stehen:
  `"$r_{WACC} = \\frac{E}{V} r_E$"`.
- Bei Formel-Lücken die **ganze Formel oder einen ganzen Term** in die Lücke legen, also
  `{{c1::$\\frac{E}{V}$}}`. Eine Lücke *innerhalb* von `$…$` wird nicht gerendert.
- Zu jeder Formel gehört mindestens eine Warum- oder Anwendungskarte, die zeigt, wozu sie dient.

## Ausgabeformat

Ein JSON-Array, sonst nichts. Datei: `kurse/<kurs>/_karten/<dateiname>.notes.json`.

```json
[
  {
    "course": "Corporate Finance",
    "source": "03 Woche/VL03.pdf",
    "source_ref": "Folie 17",
    "type": "basic",
    "format": "warum",
    "warum_relevant": "Hoch gewichtet: Kapitalstruktur ist typische Verständnisfrage.",
    "front": "Why does the WACC not keep falling as the debt ratio rises?",
    "back": "Expected costs of financial distress rise with leverage and eventually outweigh the tax advantage of debt.",
    "tags": ["wacc", "capital-structure"],
    "priority": "hoch",
    "week": "03 Woche",
    "source_kind": "folien",
    "source_hash": "<Hash aus dem Kopf der Extrakt-Datei>"
  },
  {
    "course": "Corporate Finance",
    "source": "03 Woche/VL03.pdf",
    "source_ref": "Folie 14",
    "type": "cloze",
    "format": "cloze",
    "warum_relevant": "Grundprinzip der Kapitalkosten, MC-tauglich.",
    "front": "WACC weights the cost of capital by {{c1::market values}}.",
    "tags": ["wacc"],
    "priority": "hoch"
  },
  {
    "course": "Corporate Finance",
    "source": "03 Woche/VL03.pdf",
    "source_ref": "Folie 15 (Methode), eigene Zahlen",
    "type": "basic",
    "format": "anwendung",
    "warum_relevant": "WACC-Rechnung ist eine wiederkehrende Zahlenfeld-Aufgabe.",
    "front": "E = 600, D = 400, r_E = 10 %, r_D = 5 %, t = 30 %. WACC?",
    "back": "WACC = 0.6 × 10 % + 0.4 × 5 % × (1 − 0.3) = 6.0 % + 1.4 % = 7.4 %.",
    "tags": ["wacc"],
    "priority": "hoch"
  }
]
```

Feldregeln:

| Feld | Regel |
| --- | --- |
| `course` | Exakt der Kursname aus dem Kopf der Extrakt-Datei (= Ordnername). |
| `source` | Der Wert hinter „Quelle:“ im Kopf der Extrakt-Datei. |
| `source_ref` | Pflicht. Folie(n), auf denen die Aussage bzw. Methode steht. |
| `format` | `warum`, `cloze` oder `anwendung` (siehe Kartenmix). Bestimmt `type`: cloze → `cloze`, sonst `basic`. |
| `warum_relevant` | Pflicht. Ein Satz auf Deutsch: Bezug zum Prüfungsprofil. |
| `type` | `basic` (braucht `back`) oder `cloze` (genau eine Lücke `{{c1::…}}` in `front`). |
| `extra` | Optional: Merkhilfe, Abgrenzung oder Beispiel. Wird erst mit der Antwort gezeigt. |
| `tags` | 1 bis 3 kleingeschriebene Themen-Tags ohne Leerzeichen. |
| `priority` | `hoch`, `mittel` oder `niedrig`. |
| `source_kind` | `folien`, `uebung`, `altklausur` oder `sonstiges` (aus dem Kopf: „Art:“). |
