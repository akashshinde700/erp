/**
 * ForgeERP service worker — deliberately conservative.
 *
 * Policy (matches the ERP's data-safety requirements):
 *  - NEVER cache anything under /api/ — live inventory, invoices, payments and
 *    auth responses must never be served stale or replayed.
 *  - Document navigations: network-first (fresh HTML), offline fallback page.
 *  - Same-origin static assets: stale-while-revalidate, and only when the
 *    server itself allows caching (skips volatile no-store dev assets).
 *  - New versions wait for an explicit SKIP_WAITING message from the page
 *    (user-approved reload) — no silent takeovers.
 *  - Old caches are purged on activate.
 */

const VERSION = 'forgeerp-v2'
const SHELL_CACHE = `${VERSION}-shell`
const STATIC_CACHE = `${VERSION}-static`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function networkFirstNavigation(event) {
  try {
    const res = await fetch(event.request)
    // Only remember the shell when the server explicitly marks it cacheable
    // (public/max-age/immutable). Dev servers serve volatile HTML and must
    // never be pinned — offline falls back to the static offline page.
    const cc = res.headers.get('cache-control') || ''
    if (res.ok && /public|max-age|s-maxage|immutable/i.test(cc)) {
      const cache = await caches.open(SHELL_CACHE)
      await cache.put(event.request, res.clone())
    }
    return res
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    const cached = (await cache.match(event.request)) || (await cache.match(OFFLINE_URL))
    return cached || Response.error()
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(event.request)
  const fetchAndUpdate = fetch(event.request)
    .then(async (res) => {
      if (res.ok) {
        const cc = res.headers.get('cache-control') || ''
        if (!/no-store/.test(cc)) await cache.put(event.request, res.clone())
      }
      return res
    })
    .catch(() => undefined)
  return cached || (await fetchAndUpdate) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return // mutations always hit the network

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // cross-origin: leave to the browser

  // Sensitive ERP data: never cache, never serve stale. On failure the fetch
  // simply rejects and the app surfaces the network error honestly.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event))
    return
  }

  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/logo.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname.startsWith('/downloads/')
  ) {
    event.respondWith(staleWhileRevalidate(event))
  }
})
