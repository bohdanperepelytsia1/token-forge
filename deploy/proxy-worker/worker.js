// Власний проксі для завантаження картинок за посиланням (Cloudflare Worker).
// Замінює публічні wsrv.nl / allorigins / corsproxy: ваші користувачі не залежать від чужих сервісів.
//   GET /?url=<адреса картинки>              → саме зображення
//   GET /?mode=page&url=<адреса сторінки>    → HTML сторінки (до 3 МБ), щоб знайти на ній og:image
// Налаштування — у wrangler.toml (ALLOWED_ORIGINS) і, за бажанням, обмеження частоти запитів.

const MAX_IMAGE = 30 * 1024 * 1024;
const MAX_HTML = 3 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|avif|bmp)\b/i;

function isBlockedHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return true; // IP-адреси не приймаємо взагалі
  return false;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET',
    'Vary': 'Origin',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

async function readCapped(res, max) {
  const reader = res.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    if (env.RATE_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return new Response('Too many requests', { status: 429, headers: cors });
    }

    const params = new URL(request.url).searchParams;
    let target;
    try { target = new URL(params.get('url') || ''); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(target.protocol) || target.username || target.password || (target.port && !['80', '443'].includes(target.port)) || isBlockedHost(target.hostname) || target.href.length > 2048) {
      return new Response('Url not allowed', { status: 400, headers: cors });
    }
    const page = params.get('mode') === 'page';

    let upstream;
    try {
      upstream = await fetch(target.href, {
        redirect: 'follow',
        headers: { 'User-Agent': 'TokenForgeProxy/1.0', 'Accept': page ? 'text/html' : 'image/*' },
        cf: { cacheTtl: 86400, cacheEverything: true },
        signal: AbortSignal.timeout(15000),
      });
    } catch { return new Response('Upstream error', { status: 502, headers: cors }); }
    if (!upstream.ok || !upstream.body) return new Response('Upstream status ' + upstream.status, { status: 502, headers: cors });

    // Після редиректів ще раз перевіряємо кінцеву адресу
    try { if (isBlockedHost(new URL(upstream.url).hostname)) return new Response('Url not allowed', { status: 400, headers: cors }); } catch { /* ok */ }

    const type = upstream.headers.get('content-type') || '';
    if (page) {
      if (!/text\/html|application\/xhtml/i.test(type)) return new Response('Not a page', { status: 415, headers: cors });
      const body = await readCapped(upstream, MAX_HTML);
      if (!body) return new Response('Too large', { status: 413, headers: cors });
      return new Response(body, { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (!IMAGE_TYPES.test(type)) return new Response('Not an image', { status: 415, headers: cors });
    const len = +(upstream.headers.get('content-length') || 0);
    if (len > MAX_IMAGE) return new Response('Too large', { status: 413, headers: cors });
    const body = await readCapped(upstream, MAX_IMAGE);
    if (!body) return new Response('Too large', { status: 413, headers: cors });
    return new Response(body, { headers: { ...cors, 'Content-Type': type.split(';')[0], 'Cache-Control': 'public, max-age=86400', 'Content-Disposition': 'inline' } });
  },
};
