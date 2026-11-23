const CACHE = 'homepi-shell-v2'  // public/ is copied verbatim by Vite: no build-time constant here
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

// Network first: real-time data, no cache for the API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  // API calls: always the network
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