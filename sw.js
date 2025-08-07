/* sw.js - simple precache for LeoMind */
const LEOMIND_CACHE = 'leomind-v2'; // <-- bump this on updates
const ASSETS = [
  './', 'index.html', 'styles.css', 'main.js', 'store.js', 'charts.js', 'export.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(LEOMIND_CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==LEOMIND_CACHE).map(k=>caches.delete(k)));
    self.clients.claim();
  })());
});
self.addEventListener('fetch', (event)=>{
  const req = event.request;
  event.respondWith((async()=>{
    const cache = await caches.open(LEOMIND_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (req.method==='GET' && resp.status===200 && (new URL(req.url)).origin===location.origin) {
        cache.put(req, resp.clone());
      }
      return resp;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});
