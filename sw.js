"use strict";
const CACHE = "walkpad-v31";
const ASSETS = ["./", "./index.html", "./script.js", "./manifest.json", "./icon.svg", "./tailwind.js"];

self.addEventListener("install", e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", e =>
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    )
);

self.addEventListener("fetch", e => {
    if (self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1") return;
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
