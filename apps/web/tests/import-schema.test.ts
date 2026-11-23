import { describe, expect, it } from "vitest";
import {
  clozeCount,
  clozeOrdinals,
  parseImport,
  parseImportText,
  pendingImageUploads,
  pendingSourceUploads,
  sentenceCount,
  wordCount,
} from "@recall/schema";

const cloze = {
  course: "Corporate Finance",
  source: "VL03.pdf",
  source_ref: "Folie 14",
  type: "cloze",
  format: "cloze",
  warum_relevant: "Formel kommt in Zahlenfeld-Fragen vor.",
  front: "Der WACC gewichtet die Kapitalkosten mit {{c1::Marktwerten}}.",
  back: "",
  extra: "Buchwerte verzerren die Kapitalstruktur.",
  tags: ["wacc", "kapitalkosten"],
  priority: "hoch",
};

const warum = {
  course: "Example Course",
  source: "Intro.pdf",
  source_ref: "Folie 3",
  type: "basic",
  format: "warum",
  warum_relevant: "Kernmechanik laut Prüfungsprofil.",
  front: "Warum erhöht Fremdkapital die Eigenkapitalrendite?",
  back: "Weil der Hebel die Rendite auf das eingesetzte Eigenkapital verstärkt.",
};

const anwendung = {
  ...warum,
  format: "anwendung",
  front: "Entry-Equity 150, Exit-Equity 450 nach 4 Jahren. MoM und IRR?",
  back: "MoM = 450 / 150 = 3,0x; IRR = 3,0^(1/4) − 1 ≈ 31,6 %.",
};

describe("Hilfsfunktionen", () => {
  it("findet eindeutige Lückennummern sortiert", () => {
    expect(clozeOrdinals("{{c2::b}} {{c1::a}} {{c2::c::hint}}")).toEqual([1, 2]);
    expect(clozeOrdinals("kein Cloze")).toEqual([]);
  });

  it("zählt Lücken-Vorkommen, Wörter und Sätze", () => {
    expect(clozeCount("{{c1::a}} und {{c1::b}}")).toBe(2);
    expect(wordCount("MoM = Exit-Equity / Entry-Equity")).toBe(3);
    expect(wordCount("Es gilt $E = mc^2$ immer")).toBe(4);
    expect(sentenceCount("Erster Satz. Zweiter Satz, z.B. mit 3.5x Leverage. Dritter!")).toBe(3);
  });
});

describe("parseImport", () => {
  it("akzeptiert Warum-, Cloze- und Anwendungskarten", () => {
    expect(parseImport([cloze, warum, anwendung]).ok).toBe(true);
  });

  it("ergänzt Standardwerte", () => {
    expect(parseImport([warum])).toMatchObject({
      ok: true,
      notes: [{ priority: "mittel", tags: [], extra: "" }],
    });
  });

  it("akzeptiert auch { notes: [...] }", () => {
    expect(parseImport({ notes: [warum] }).ok).toBe(true);
  });

  it("verlangt Kartentyp und warum_relevant", () => {
    const without = (key: string) => Object.fromEntries(Object.entries(warum).filter(([k]) => k !== key));
    const ohneFormat = without("format");
    const ohneRelevanz = without("warum_relevant");
    expect(parseImport([ohneFormat])).toMatchObject({ ok: false, issues: [{ path: "format" }] });
    expect(parseImport([ohneRelevanz])).toMatchObject({ ok: false, issues: [{ path: "warum_relevant" }] });
  });

  it("lehnt Cloze-Karten mit mehr als einer Lücke ab", () => {
    const result = parseImport([{ ...cloze, front: "{{c1::Marktwerte}} und {{c2::nach Steuern}}" }]);
    expect(result).toMatchObject({ ok: false, issues: [{ path: "front" }] });
    const sameNumber = parseImport([{ ...cloze, front: "{{c1::A}} und {{c1::B}} gemeinsam" }]);
    expect(sameNumber.ok).toBe(false);
  });

  it("lehnt Cloze-Karten mit mehr als 20 Wörtern ab", () => {
    const long = `${"Wort ".repeat(20)}{{c1::Lücke}}`;
    const result = parseImport([{ ...cloze, front: long }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toMatch(/zu lang: 21 Wörter/);
  });

  it("verlangt für Warum- und Anwendungskarten eine Frage mit Antwort", () => {
    const result = parseImport([{ ...warum, type: "cloze", front: "Der {{c1::Hebel}} wirkt." }]);
    expect(result).toMatchObject({ ok: false, issues: [{ path: "type" }] });
  });

  describe("Bildkarten", () => {
    const bild = {
      ...warum,
      format: "bild",
      front: "Which party is hidden in the limited partnership structure?",
      back: "The general partner (GP).",
      image: "_bilder/intro-p18.png",
      occlusion: { x: 0.6, y: 0.2, w: 0.2, h: 0.08 },
    };

    it("akzeptiert Bildkarten mit lokalem oder hochgeladenem Bild", () => {
      expect(parseImport([bild]).ok).toBe(true);
      expect(parseImport([{ ...bild, image: undefined, image_path: "uid/abc.png" }]).ok).toBe(true);
    });

    it("verlangt Abdeckung und Bild", () => {
      expect(parseImport([{ ...bild, occlusion: undefined }])).toMatchObject({ ok: false, issues: [{ path: "occlusion" }] });
      expect(parseImport([{ ...bild, image: undefined }])).toMatchObject({ ok: false, issues: [{ path: "image" }] });
    });

    it("lehnt Abdeckungen außerhalb des Bildes ab", () => {
      expect(parseImport([{ ...bild, occlusion: { x: 0.9, y: 0.2, w: 0.2, h: 0.1 } }]).ok).toBe(false);
      expect(parseImport([{ ...bild, occlusion: { x: 0.1, y: 0.2, w: 0, h: 0.1 } }]).ok).toBe(false);
    });

    it("erlaubt Bild und Abdeckung nur bei Bildkarten", () => {
      expect(parseImport([{ ...warum, image: "x.png" }])).toMatchObject({ ok: false, issues: [{ path: "format" }] });
    });

    it("zählt Bildkarten, deren Bild noch hochgeladen werden muss", () => {
      expect(pendingImageUploads([bild, { ...bild, image_path: "uid/abc.png" }, warum])).toBe(1);
    });
  });

  it("übernimmt das Ergebnis der Selbstprüfung", () => {
    const result = parseImport([{ ...warum, check: { ok: false, issues: ["Quelle nennt 2 Gründe"] } }]);
    expect(result).toMatchObject({ ok: true, notes: [{ check: { ok: false, issues: ["Quelle nennt 2 Gründe"] } }] });
  });

  it("verlangt eine Quelle pro Karte", () => {
    expect(parseImport([{ ...warum, source_ref: "  " }])).toMatchObject({
      ok: false,
      issues: [{ index: 0, path: "source_ref" }],
    });
  });

  it("lehnt Basic-Notes ohne Rückseite ab", () => {
    expect(parseImport([{ ...warum, back: "" }])).toMatchObject({ ok: false, issues: [{ path: "back" }] });
  });

  it("nennt bei mehreren Fehlern die Position", () => {
    const result = parseImport([warum, { ...warum, priority: "dringend" }]);
    expect(result).toMatchObject({ ok: false, issues: [{ index: 1, path: "priority" }] });
  });

  it("lehnt eine leere Datei ab", () => {
    expect(parseImport([]).ok).toBe(false);
  });
});

describe("parseImportText", () => {
  it("meldet kaputtes JSON verständlich", () => {
    const result = parseImportText("[{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toMatch(/^Kein gültiges JSON/);
  });

  it("parst gültigen Text", () => {
    expect(parseImportText(JSON.stringify([cloze, warum])).ok).toBe(true);
  });
});

describe("Quellenansicht", () => {
  const base = {
    course: "Example Course",
    source: "Intro.pdf",
    source_ref: "Folie 7",
    type: "basic",
    format: "warum",
    warum_relevant: "Test.",
    front: "Why?",
    back: "Because.",
  };

  it("akzeptiert Folien und Textabschnitte, lokal oder hochgeladen", () => {
    const result = parseImport([
      { ...base, source_view: { items: [{ kind: "image", label: "Folie 7", file: "../_quellen/a.png" }] } },
      { ...base, front: "How?", source_view: { items: [{ kind: "text", label: "Lernpfad: Step 2", path: "uid/b.md" }] } },
    ]);
    expect(result.ok).toBe(true);
  });

  it("verlangt eine Datei je Eintrag", () => {
    expect(parseImport([{ ...base, source_view: { items: [{ kind: "image", label: "Folie 7" }] } }]).ok).toBe(false);
  });

  it("zählt Quellen, die noch hochgeladen werden müssen", () => {
    const local = { ...base, source_view: { items: [{ kind: "image" as const, label: "Folie 7", file: "a.png" }] } };
    const uploaded = { ...base, source_view: { items: [{ kind: "image" as const, label: "Folie 7", path: "uid/a.png" }] } };
    expect(pendingSourceUploads([local, uploaded, base])).toBe(1);
  });
});
