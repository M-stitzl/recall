import { describe, expect, it } from "vitest";
import { escapeHtml, plainPreview, renderMarkdown, renderText } from "@/lib/render";

describe("renderText", () => {
  it("escaped HTML im Kartentext", () => {
    const html = renderText('<img src=x onerror="alert(1)"> & <script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
  });

  it("escaped HTML auch in Cloze-Antworten und Hinweisen", () => {
    const text = "{{c1::<b>x</b>::<i>hint</i>}}";
    expect(renderText(text, { clozeOrdinal: 1 })).not.toContain("<i>");
    expect(renderText(text, { clozeOrdinal: 1, revealed: true })).not.toContain("<b>");
  });

  it("rendert Zeilenumbrüche, Fettdruck und Code", () => {
    expect(renderText("a\nb")).toBe("a<br>b");
    expect(renderText("**wichtig**")).toBe("<strong>wichtig</strong>");
    expect(renderText("`npv`")).toBe("<code>npv</code>");
  });

  it("rendert Formeln mit KaTeX", () => {
    expect(renderText("Es gilt $E = mc^2$.")).toContain('class="katex"');
    expect(renderText("$$\\frac{D}{V}$$")).toContain("katex-display");
  });

  it("lässt Geldbeträge mit Dollarzeichen in Ruhe", () => {
    const html = renderText("Preis: $5 und $10 pro Aktie");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5 und $10");
  });

  describe("Cloze", () => {
    const text = "WACC nutzt {{c1::Marktwerte}} und FK {{c2::nach Steuern::wann?}}.";

    it("verdeckt nur die abgefragte Lücke", () => {
      const html = renderText(text, { clozeOrdinal: 1 });
      expect(html).toContain('<span class="cloze cloze-hidden">[…]</span>');
      expect(html).not.toContain("Marktwerte");
      expect(html).toContain("nach Steuern");
    });

    it("zeigt den Hinweis statt der Auslassungspunkte", () => {
      const html = renderText(text, { clozeOrdinal: 2 });
      expect(html).toContain("[wann?]");
      expect(html).not.toContain("nach Steuern");
      expect(html).toContain("Marktwerte");
    });

    it("hebt die Antwort nach dem Aufdecken hervor", () => {
      const html = renderText(text, { clozeOrdinal: 1, revealed: true });
      expect(html).toContain('<span class="cloze cloze-revealed">Marktwerte</span>');
      expect(html).not.toContain("wann?");
    });

    it("verdeckt alle Vorkommen derselben Lückennummer", () => {
      const html = renderText("{{c1::A}} und {{c1::B}} aber {{c2::C}}", { clozeOrdinal: 1 });
      expect(html.match(/cloze-hidden/g)).toHaveLength(2);
      expect(html).toContain("C");
    });

    it("rendert Formeln innerhalb einer Lücke", () => {
      const html = renderText("{{c1::$r_E$}}", { clozeOrdinal: 1, revealed: true });
      expect(html).toContain("cloze-revealed");
      expect(html).toContain('class="katex"');
    });

    it("hebt mit highlightAll alle Lücken hervor", () => {
      const html = renderText(text, { highlightAll: true });
      expect(html.match(/cloze-revealed/g)).toHaveLength(2);
      expect(html).not.toContain("cloze-hidden");
    });

    it("zeigt ohne Ordinal alle Lücken als normalen Text", () => {
      expect(renderText("{{c1::A}} {{c2::B}}")).toBe("A B");
    });
  });
});

describe("plainPreview", () => {
  it("entfernt Cloze-Syntax und kürzt lange Texte", () => {
    expect(plainPreview("Der {{c1::WACC::Hinweis}}\n  ist …")).toBe("Der WACC ist …");
    expect(plainPreview("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("escapeHtml", () => {
  it("ersetzt alle kritischen Zeichen", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("renderMarkdown", () => {
  it("rendert Überschriften, Listen und Tabellen", () => {
    const html = renderMarkdown(
      "### Step 2: Uses and sources\n\nSenior debt is sized on EBITDA.\n\n- Uses\n- Sources\n\n| Assumption | Value |\n| --- | --- |\n| Leverage | 3.5x |\n",
    );
    expect(html).toContain("<h3>Step 2: Uses and sources</h3>");
    expect(html).toContain("<p>Senior debt is sized on EBITDA.</p>");
    expect(html).toContain("<ul><li>Uses</li><li>Sources</li></ul>");
    expect(html).toContain("<th>Assumption</th>");
    expect(html).toContain("<td>3.5x</td>");
    expect(html).not.toContain("---");
  });

  it("escaped HTML im Quelltext", () => {
    const html = renderMarkdown("## <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rendert Formeln mit KaTeX", () => {
    expect(renderMarkdown("EV = $E + D$")).toContain('class="katex"');
  });
});
