const CACHE = 'homepi-1790474458' + __BUILD_TIME__
const STATIC = ['/']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Network first — données temps réel, pas de cache sur les API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  // API calls : toujours réseau
  if (url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/prom-api/') ||
      url.pathname.startsWith('/loki-api/') ||
      url.pathname.startsWith('/influx/')) {
    return
  }
  // App shell : network first, fallback cache
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  )
})