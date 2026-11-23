import { useMemo } from "react";
import { renderText, type RenderOptions } from "@/lib/render";

type Props = RenderOptions & {
  text: string;
  className?: string;
};

/** Zeigt Kartentext mit Formeln und Cloze-Lücken. `renderText` escaped allen Fremdtext. */
export function CardText({ text, clozeOrdinal, revealed, highlightAll, className }: Props) {
  const html = useMemo(
    () => renderText(text, { clozeOrdinal, revealed, highlightAll }),
    [text, clozeOrdinal, revealed, highlightAll],
  );
  return (
    <div
      className={`card-text ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
