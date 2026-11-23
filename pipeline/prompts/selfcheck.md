# Selbstprüfung

Zweiter, unabhängiger Durchlauf über eine fertige `*.notes.json`. Du bist jetzt Prüfer,
nicht Autor: Geh davon aus, dass Fehler drin sind, und suche sie.

Lies die Quelle (`kurse/<kurs>/_extrakt/.../<datei>.md`, bei Bildverweisen auch das Bild)
erneut und prüfe **jede** Note einzeln gegen die Quelle und gegen `pipeline/prompts/cards.md`.

## Prüfpunkte je Note

1. **Belegt:** Steht jede Aussage der Karte auf den in `source_ref` genannten Folien?
   Stimmen Zahlen, Vorzeichen, Richtungen („steigt“/„sinkt“) und Formeln exakt?
2. **Eine Idee:** Fragt die Karte genau eine Sache ab?
3. **Eindeutig:** Gibt es genau eine richtige Antwort? Ist die Frage ohne Folie verständlich?
4. **Cloze sinnvoll:** Ist die Lücke der Kern der Aussage und aus dem Rest erschließbar –
   aber nicht trivial zu erraten?
5. **Relevant:** Prüfungsrelevant laut Prüfungsprofil, kein Organisatorisches?
6. **Format:** Formeln in gültigem LaTeX, keine Lücke innerhalb von `$…$`, Quelle angegeben.
7. **Kein Duplikat:** Fragt keine andere Note derselben Datei dasselbe ab?
8. **Kartentyp passt:** Cloze-Karten bestehen den Qualitätscheck aus `cards.md` (nicht erratbar,
   kein triviales Wort, höchstens 20 Wörter, eine Lücke, erklärbar). Warum-Antworten haben höchstens
   2 Sätze. Anwendungsaufgaben: **jedes Ergebnis nachrechnen**; ein Rechenfehler ist immer `ok: false`.
9. **`warum_relevant`:** nennt einen konkreten Bezug zum Prüfungsprofil, keine Floskel.

## Ergebnis

Ergänze bei **jeder** Note das Feld `check` und schreibe die Datei zurück:

```json
"check": { "ok": true, "issues": [] }
```

```json
"check": { "ok": false, "issues": ["Folie 14 nennt Marktwerte, die Karte sagt Buchwerte"] }
```

Regeln:

- Fehlerhafte Notes werden **markiert, nicht gelöscht und nicht still korrigiert**. Die
  Entscheidung fällt in der Freigabe-Queue; dort werden die Hinweise angezeigt.
- Ein Hinweis ist ein konkreter Satz, der die Abweichung benennt – mit Folie.
  Nicht: „könnte ungenau sein“.
- Bei kleinen Unsicherheiten, die keine Ablehnung rechtfertigen: `"ok": true` und trotzdem
  ein Eintrag in `issues`.
- Ändere sonst nichts an den Notes.

Zum Schluss: `pnpm cards:validate <datei>` ausführen. Die Datei muss gültig sein.
