// Guarda la app en el teléfono para que abra sin conexión. Subir VERSION al cambiar archivos.
const VERSION = "liquidaciones-1";
const ARCHIVOS = ["./", "index.html", "app.js", "nucleo.js", "estilo.css", "icono.svg", "manifest.webmanifest"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) => Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (evento) => {
  if (evento.request.method !== "GET") return;
  evento.respondWith(caches.match(evento.request, { ignoreSearch: true }).then((guardado) => guardado || fetch(evento.request)));
});
