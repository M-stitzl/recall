"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { Occlusion } from "@/lib/types";

/** Folienbilder liegen im privaten Speicher; Links sind kurzlebig und werden je Sitzung gemerkt. */
const LINK_LIFETIME_S = 15 * 60;
const cache = new Map<string, { url: string; expires: number }>();

export async function signedUrl(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const { data, error } = await getSupabase().storage.from("slides").createSignedUrl(path, LINK_LIFETIME_S);
  if (error || !data) throw new Error(error?.message ?? "Kein Link erhalten");
  cache.set(path, { url: data.signedUrl, expires: Date.now() + LINK_LIFETIME_S * 1000 });
  return data.signedUrl;
}

/** Lädt den Link schon vorab (z. B. für die nächste Karte der Session). */
export function prefetchSlide(path: string | null | undefined): void {
  if (path) void signedUrl(path).catch(() => {});
}

type Props = {
  path: string;
  /** Verdeckter Bereich einer Bildkarte; ohne Angabe wird die ganze Folie gezeigt. */
  occlusion?: Occlusion | null;
  /** true = Bereich verdeckt (Vorderseite), false = aufgedeckt und markiert (Rückseite). */
  hidden?: boolean;
  alt: string;
};

export function SlideImage({ path, occlusion, hidden = false, alt }: Props) {
  const [state, setState] = useState<{ path: string; url: string | null; error: string | null }>({
    path,
    url: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    signedUrl(path)
      .then((url) => active && setState({ path, url, error: null }))
      .catch((error: unknown) =>
        active && setState({ path, url: null, error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      active = false;
    };
  }, [path]);

  const current = state.path === path ? state : { url: null, error: null };

  if (current.error) {
    return (
      <p role="alert" className="rounded-lg bg-surface-2 p-4 text-sm text-again">
        Das Folienbild konnte nicht geladen werden ({current.error}).
      </p>
    );
  }

  const box = occlusion
    ? {
        left: `${occlusion.x * 100}%`,
        top: `${occlusion.y * 100}%`,
        width: `${occlusion.w * 100}%`,
        height: `${occlusion.h * 100}%`,
      }
    : null;

  return (
    <figure className="relative overflow-hidden rounded-lg border border-border bg-white" data-testid="slide-image">
      {current.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signierte, kurzlebige URL aus dem privaten Speicher
        <img src={current.url} alt={alt} className="block h-auto w-full" draggable={false} />
      ) : (
        <div className="skeleton aspect-[4/3] w-full rounded-none" aria-label="Folienbild wird geladen" />
      )}
      {current.url && box && (
        <div
          aria-hidden="true"
          data-testid={hidden ? "occlusion-hidden" : "occlusion-revealed"}
          className={
            hidden
              ? "absolute flex items-center justify-center rounded-[3px] bg-marker text-sm font-bold text-marker-ink shadow-[0_0_0_2px_var(--marker-ink)]"
              : "absolute rounded-[3px] bg-marker/25 shadow-[0_0_0_3px_var(--marker)]"
          }
          style={box}
        >
          {hidden && "?"}
        </div>
      )}
    </figure>
  );
}
