"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/hooks";
import { flushOutbox } from "@/lib/outbox";
import { getSupabase } from "@/lib/supabase";
import { Icon, Loading, type IconName } from "./ui";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Heute", icon: "today" },
  { href: "/courses", label: "Kurse", icon: "courses" },
  { href: "/review", label: "Freigabe", icon: "review" },
  { href: "/stats", label: "Statistik", icon: "stats" },
  { href: "/settings", label: "Mehr", icon: "more" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/courses") return pathname.startsWith("/course");
  if (href === "/settings") return pathname.startsWith("/settings") || pathname.startsWith("/import");
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  // Offene Bewertungen nachsenden, sobald wir angemeldet und online sind.
  useEffect(() => {
    if (!session) return;
    const flush = () => void flushOutbox(getSupabase());
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [session]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  const focusMode = pathname.startsWith("/study");
  const mainClass = `mx-auto w-full max-w-3xl flex-1 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-6 md:pt-8 ${
    focusMode ? "pb-4" : "pb-28 md:pb-12"
  }`;

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      {!focusMode && (
        <header className="sticky top-0 z-10 hidden bg-shell text-shell-ink md:block">
          <nav className="mx-auto flex max-w-3xl items-stretch gap-1 px-6" aria-label="Hauptnavigation">
            <Link href="/" className="mr-6 flex items-center text-base font-semibold tracking-[-0.01em]">
              Recall
            </Link>
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center px-3 py-3.5 text-sm font-medium transition-colors duration-150 ${
                    active ? "text-shell-ink" : "text-shell-muted hover:text-shell-ink"
                  }`}
                >
                  {item.label}
                  {active && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-marker" />}
                </Link>
              );
            })}
          </nav>
        </header>
      )}

      <main className={mainClass}>{session ? children : <Loading label="Anmeldung wird geprüft" />}</main>

      {!focusMode && (
        <nav
          aria-label="Hauptnavigation"
          className="fixed inset-x-0 bottom-0 z-10 bg-shell pb-[env(safe-area-inset-bottom)] text-shell-ink md:hidden"
        >
          <ul className="mx-auto flex max-w-lg">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium ${
                      active ? "text-shell-ink" : "text-shell-muted"
                    }`}
                  >
                    {active && <span className="absolute top-0 h-[3px] w-8 rounded-b bg-marker" />}
                    <Icon name={item.icon} size={22} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
