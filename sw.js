// Service Worker: App-Shell offline, Decks „network first“ (neue Karten kommen sofort an), Schriften „stale while revalidate“
const VERSION = "funcard-0.1.0";
const SHELL = [
  "./", "index.html", "css/app.css", "js/app.js", "js/db.js", "js/srs.js", "js/util.js",
  "manifest.webmanifest", "icons/icon.svg",
  "decks/index.json", "decks/wk.json", "decks/tm1.json", "decks/qum.json", "decks/tlp.json", "decks/rob.json", "decks/aise.json",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { credentials: "include" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "funcard-fonts").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  if (url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com")) {
    e.respondWith(caches.open("funcard-fonts").then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Antworten von Authelia (Umleitung zur Anmeldung) nicht cachen
  const cacheable = r => r && r.ok && !r.redirected && r.type === "basic";

  if (url.pathname.includes("/decks/")) {
    e.respondWith(fetch(e.request).then(r => {
      if (cacheable(r)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (cacheable(r)) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match("index.html"))));
});
