// Service worker: l'app si apre anche senza rete (le chiamate al server non vengono mai messe in cache).
var CACHE = 'rds-sopralluoghi-v7';
var FILES = ['./', 'index.html', 'style.css', 'config.js', 'editor.js', 'pdf.js', 'zip.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // prima la rete (così gli aggiornamenti arrivano subito), la copia salvata solo se non c'è connessione
  e.respondWith(
    fetch(req).then(function (resp) {
      if (resp && resp.ok) { var copia = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, copia); }); }
      return resp;
    }).catch(function () { return caches.match(req, { ignoreSearch: true }); })
  );
});
