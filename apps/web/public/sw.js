/*
 * Service Worker von Recall.
 * Ziel: Die App-Hülle startet sofort und auch ohne Netz. Kartendaten und
 * Bewertungen laufen nicht über den Service Worker, sondern direkt zu Supabase
 * (Bewertungen werden bei Funklöchern im Ausgangskorb der App zwischengespeichert).
 */
const VERSION = "recall-v1";
const SHELL = ["/", "/study", "/review", "/courses", "/stats", "/settings", "/login"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached =
      (await caches.match(request)) ||
      (await caches.match(request, { ignoreSearch: true })) ||
      (fallbackUrl ? await caches.match(fallbackUrl) : undefined);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dateien mit Hash im Namen ändern sich nie.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/"));
    return;
  }
  event.respondWith(networkFirst(request));
});
