"use client";

import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/render";
import type { SourceItem, SourceView } from "@/lib/types";
import { SlideImage, signedUrl } from "./slide-image";
import { Icon } from "./ui";

/** Zitierter Textabschnitt (Lernpfad-Kapitel, Excel-Blatt) aus dem privaten Speicher. */
function SourceText({ item }: { item: SourceItem }) {
  const [state, setState] = useState<{ path: string; text: string | null; error: string | null }>({
    path: item.path,
    text: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    signedUrl(item.path)
      .then((url) => fetch(url))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => active && setState({ path: item.path, text, error: null }))
      .catch((error: unknown) =>
        active && setState({ path: item.path, text: null, error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      active = false;
    };
  }, [item.path]);

  const current = state.path === item.path ? state : { text: null, error: null };
  const html = useMemo(() => (current.text ? renderMarkdown(current.text) : ""), [current.text]);

  if (current.error) {
    return (
      <p role="alert" className="text-sm text-again">
        Der Textabschnitt konnte nicht geladen werden ({current.error}).
      </p>
    );
  }
  if (!current.text) {
    return (
      <div aria-busy="true" aria-label="Textabschnitt wird geladen" className="space-y-2">
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
      </div>
    );
  }
  return <div className="source-text" data-testid="source-text" dangerouslySetInnerHTML={{ __html: html }} />;
}

type Props = {
  view: SourceView | null | undefined;
  /** Quellenangabe als Text (z. B. „VL01.pdf · Folie 14“), wird immer angezeigt. */
  reference: string;
};

/**
 * Quellenangabe mit Button „Quelle anzeigen“: klappt die zitierte(n) Folie(n) bzw. den
 * Textabschnitt direkt unter der Karte auf. Folien werden immer vollständig gezeigt.
 */
export function SourceViewer({ view, reference }: Props) {
  const [open, setOpen] = useState(false);
  const items = view?.items ?? [];

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {reference && <p className="text-xs text-muted">{reference}</p>}
        {items.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            data-testid="source-toggle"
          >
            <Icon name={open ? "back" : "forward"} size={16} />
            {open ? "Quelle ausblenden" : items[0].kind === "text" ? "Text anzeigen" : items.length > 1 ? `${items.length} Folien anzeigen` : "Folie anzeigen"}
          </button>
        )}
      </div>
      {open && (
        <div className="reveal mt-4 space-y-5 border-t border-border pt-4" data-testid="source-panel">
          {items.map((item) => (
            <figure key={item.path}>
              <figcaption className="mb-2 text-xs font-semibold text-muted">{item.label}</figcaption>
              {item.kind === "image" ? (
                <SlideImage path={item.path} alt={item.label} />
              ) : (
                <SourceText item={item} />
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
