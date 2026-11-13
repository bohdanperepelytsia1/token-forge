// Service worker: зберігає AI-модель і файли сайту в браузері,
// щоб при повторних відвідуваннях нічого не завантажувалось заново.
// Назви файлів моделей і збірки містять хеш вмісту, тому кешувати їх назавжди безпечно.
const MODELS = 'tf-models-v1';
const ASSETS = 'tf-assets-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== MODELS && key !== ASSETS) await caches.delete(key);
    await pruneModels();
    await self.clients.claim();
  })());
});

// Прибираємо частини моделей, яких уже немає в поточній збірці
async function pruneModels() {
  try {
    const res = await fetch(new URL('models/resources.json', self.registration.scope), { cache: 'no-cache' });
    if (!res.ok) return;
    const names = new Set();
    for (const entry of Object.values(await res.json())) for (const c of entry.chunks || []) names.add(c.name);
    const cache = await caches.open(MODELS);
    for (const req of await cache.keys()) {
      if (!names.has(new URL(req.url).pathname.split('/').pop())) await cache.delete(req);
    }
  } catch { /* не критично */ }
}

async function cacheFirst(request, name, limit) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200 && res.type === 'basic') {
    await cache.put(request, res.clone());
    if (limit) {
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
    }
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  const path = url.pathname;
  if (path.startsWith(base + 'models/') && !path.endsWith('.json')) event.respondWith(cacheFirst(req, MODELS));
  else if (path.startsWith(base + 'assets/')) event.respondWith(cacheFirst(req, ASSETS, MAX_ASSETS));
});
