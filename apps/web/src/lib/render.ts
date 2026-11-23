import katex from "katex";
import { CLOZE_PATTERN } from "@recall/schema";

/**
 * Wandelt Kartentext in sicheres HTML um.
 *  - Formeln: $…$ (inline) und $$…$$ (abgesetzt) werden mit KaTeX gerendert.
 *  - Cloze: {{c1::Antwort::Hinweis}} wird je nach Karte verdeckt oder aufgedeckt.
 *  - Leichtes Markup: **fett**, `code`, Zeilenumbrüche.
 * Aller übrige Text wird HTML-escaped; es wird nie fremdes HTML durchgereicht.
 */

export type RenderOptions = {
  /** Nummer der abgefragten Lücke (Karten-Ordinal). Ohne Angabe sind alle Lücken sichtbar. */
  clozeOrdinal?: number;
  /** true = Antwortseite: die abgefragte Lücke ist aufgedeckt und hervorgehoben. */
  revealed?: boolean;
  /** true = alle Lücken aufgedeckt und hervorgehoben (Freigabe, Vorschau im Editor). */
  highlightAll?: boolean;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, { displayMode, throwOnError: false, output: "html" });
  } catch {
    return `<code>${escapeHtml(source)}</code>`;
  }
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\r?\n/g, "<br>");
}

const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g;

/** Text ohne Cloze-Syntax: Formeln rendern, Rest escapen. */
function renderPlain(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(MATH_PATTERN)) {
    html += renderInline(text.slice(last, match.index));
    html += match[1] !== undefined ? renderMath(match[1], true) : renderMath(match[2], false);
    last = match.index + match[0].length;
  }
  return html + renderInline(text.slice(last));
}

type Protected = { text: string; restore: (html: string) => string };

/** Schützt Lücken per Platzhalter, damit Formeln innerhalb und außerhalb getrennt rendern. */
function protectClozes(text: string, options: RenderOptions): Protected {
  const slots: string[] = [];
  const replaced = text.replace(CLOZE_PATTERN, (_all, num: string, answer: string, hint?: string) => {
    const ordinal = Number(num);
    const asked = options.clozeOrdinal !== undefined && ordinal === options.clozeOrdinal;
    let html: string;
    if (options.highlightAll) {
      html = `<span class="cloze cloze-revealed">${renderPlain(answer)}</span>`;
    } else if (asked && !options.revealed) {
      const label = hint ? escapeHtml(hint) : "…";
      html = `<span class="cloze cloze-hidden">[${label}]</span>`;
    } else if (asked) {
      html = `<span class="cloze cloze-revealed">${renderPlain(answer)}</span>`;
    } else {
      html = renderPlain(answer);
    }
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  });
  return {
    text: replaced,
    restore: (html) => html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => slots[Number(i)]),
  };
}

export function renderText(text: string, options: RenderOptions = {}): string {
  const guarded = protectClozes(text, options);
  return guarded.restore(renderPlain(guarded.text));
}

/**
 * Schlankes, sicheres Markdown für zitierte Textabschnitte (Lernpfad-Kapitel, Excel-Blätter):
 * Überschriften, Absätze, Listen und Tabellen. Aller Text wird escaped; Formeln wie in Karten.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${renderPlain(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      html.push(`<${tag}>${list.items.map((item) => `<li>${renderPlain(item)}</li>`).join("")}</${tag}>`);
    }
    list = null;
  };
  const flushTable = () => {
    if (table.length) {
      const [head, ...body] = table;
      const cells = (row: string[], tag: string) => row.map((cell) => `<${tag}>${renderPlain(cell)}</${tag}>`).join("");
      html.push(
        `<div class="md-table"><table><thead><tr>${cells(head, "th")}</tr></thead><tbody>${body
          .map((row) => `<tr>${cells(row, "td")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
    }
    table = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (!line) {
      flushAll();
    } else if (heading) {
      flushAll();
      const level = Math.min(4, Math.max(2, heading[1].length));
      html.push(`<h${level}>${renderPlain(heading[2])}</h${level}>`);
    } else if (line.startsWith("|")) {
      flushParagraph();
      flushList();
      const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) table.push(cells);
    } else if (bullet || numbered) {
      flushParagraph();
      flushTable();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      flushTable();
      paragraph.push(line);
    }
  }
  flushAll();
  return html.join("\n");
}

/** Reiner Text ohne Markup – für Listen und Vorschauen. */
export function plainPreview(text: string, maxLength = 140): string {
  const flat = text
    .replace(CLOZE_PATTERN, (_all, _num: string, answer: string) => answer)
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
