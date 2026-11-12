// Безпечне завантаження зображень: з файлу, буфера або посилання.
const CFG = window.TF_CONFIG || {};
const MAX_BYTES = CFG.maxFileBytes || 30 * 1024 * 1024;
const MAX_PIXELS = CFG.maxSourcePixels || 80e6;
const MAX_HTML = 3 * 1024 * 1024;

export class LoadError extends Error {}

/* ---------- перевірка формату за сигнатурою, а не за розширенням ---------- */
export async function sniffImage(blob) {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const at = (o, ...v) => v.every((x, i) => b[o + i] === x);
  const str = (o, s) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (str(0, 'GIF87a') || str(0, 'GIF89a')) return 'image/gif';
  if (str(0, 'RIFF') && str(8, 'WEBP')) return 'image/webp';
  if (str(4, 'ftyp') && (str(8, 'avif') || str(8, 'avis'))) return 'image/avif';
  if (str(0, 'BM')) return 'image/bmp';
  return null; // SVG та інше навмисно не приймаємо
}

/* розміри з заголовка — щоб не декодувати гігантські зображення */
async function headerSize(blob, mime) {
  const b = new DataView(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer());
  try {
    if (mime === 'image/png') return [b.getUint32(16), b.getUint32(20)];
    if (mime === 'image/gif') return [b.getUint16(6, true), b.getUint16(8, true)];
    if (mime === 'image/webp') {
      const tag = String.fromCharCode(b.getUint8(12), b.getUint8(13), b.getUint8(14), b.getUint8(15));
      if (tag === 'VP8X') return [1 + (b.getUint8(24) | b.getUint8(25) << 8 | b.getUint8(26) << 16), 1 + (b.getUint8(27) | b.getUint8(28) << 8 | b.getUint8(29) << 16)];
      if (tag === 'VP8L') { const v = b.getUint32(21, true); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
      if (tag === 'VP8 ') return [b.getUint16(26, true) & 0x3fff, b.getUint16(28, true) & 0x3fff];
    }
    if (mime === 'image/jpeg') {
      let o = 2;
      while (o + 9 < b.byteLength) {
        if (b.getUint8(o) !== 0xff) { o++; continue; }
        const m = b.getUint8(o + 1);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.getUint16(o + 7), b.getUint16(o + 5)];
        o += 2 + b.getUint16(o + 2);
      }
    }
  } catch { /* невідомо */ }
  return null;
}

/** Перевіряє й декодує зображення одразу в зменшеному розмірі. */
export async function decodeImage(blob, maxSide) {
  if (!blob || blob.size === 0) throw new LoadError('Файл порожній.');
  if (blob.size > MAX_BYTES) throw new LoadError(`Файл завеликий: ${(blob.size / 1048576).toFixed(0)} МБ. Максимум — ${(MAX_BYTES / 1048576).toFixed(0)} МБ.`);
  const mime = await sniffImage(blob);
  if (!mime) throw new LoadError('Це не зображення або формат не підтримується. Підходять PNG, JPG, WebP, GIF, AVIF.');
  const dims = await headerSize(blob, mime);
  if (dims && dims[0] * dims[1] > MAX_PIXELS) throw new LoadError('Зображення має забагато пікселів. Зменшіть його й спробуйте ще раз.');
  const typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
  let bmp;
  try {
    if (dims && Math.max(...dims) > maxSide) {
      const s = maxSide / Math.max(...dims);
      bmp = await createImageBitmap(typed, { resizeWidth: Math.max(1, Math.round(dims[0] * s)), resizeHeight: Math.max(1, Math.round(dims[1] * s)), resizeQuality: 'high' });
    } else bmp = await createImageBitmap(typed);
  } catch { throw new LoadError('Не вдалося прочитати зображення. Можливо, файл пошкоджений.'); }
  if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close(); throw new LoadError('Зображення має забагато пікселів.'); }
  return bmp;
}

/* ---------- посилання ---------- */
function isPrivateHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || !h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [+v4[1], +v4[2]];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** Повертає безпечну https/http адресу або null. */
export function safeUrl(raw) {
  let s = String(raw || '').trim();
  if (!s || s.length > 2048) return null;
  if (!/^https?:\/\//i.test(s)) { if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = 'https://' + s; else return null; }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || isPrivateHost(u.hostname)) return null;
  // Посилання-обгортки пошуковиків → пряма картинка
  const inner = (/(^|\.)google\./.test(u.hostname) && u.searchParams.get('imgurl')) || (/(^|\.)bing\.com$/.test(u.hostname) && u.searchParams.get('mediaurl'));
  if (inner) return safeUrl(inner);
  u.hash = '';
  return u.href;
}

async function fetchCapped(url, max, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors', cache: 'default' });
    if (!r.ok || !r.body) return null;
    if (+(r.headers.get('content-length') || 0) > max) return null;
    const reader = r.body.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { ctl.abort(); return null; }
      parts.push(value);
    }
    return { blob: new Blob(parts, { type: r.headers.get('content-type') || '' }), type: r.headers.get('content-type') || '' };
  } catch { return null; } finally { clearTimeout(t); }
}

function proxies() {
  const own = (CFG.proxy || '').replace(/\/+$/, '');
  if (own) return { img: [(u) => `${own}/?url=${encodeURIComponent(u)}`], page: [(u) => `${own}/?mode=page&url=${encodeURIComponent(u)}`] };
  return {
    img: [(u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}`],
    page: [(u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`],
  };
}

async function imageAt(url, viaProxy) {
  const tries = viaProxy ? proxies().img.map((p) => p(url)) : [url];
  for (const t of tries) {
    const r = await fetchCapped(t, MAX_BYTES, viaProxy ? 20000 : 8000);
    if (r && r.blob.size > 64 && await sniffImage(r.blob)) return r.blob;
  }
  return null;
}

async function imagesOnPage(url) {
  for (const p of proxies().page) {
    const r = await fetchCapped(p(url), MAX_HTML, 15000);
    if (!r) continue;
    const text = await r.blob.text();
    // DOMParser з text/html не виконує скриптів і не вантажить ресурсів
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const get = (sel) => { const m = doc.querySelector(sel); return m && (m.getAttribute('content') || m.getAttribute('href')); };
    let list = [get('meta[property="og:image:secure_url"]'), get('meta[property="og:image"]'), get('meta[name="twitter:image"]'), get('meta[name="twitter:image:src"]'), get('link[rel="image_src"]')].filter(Boolean);
    if (!list.length) {
      list = [...doc.querySelectorAll('img')].map((i) => ({ s: i.getAttribute('src') || i.getAttribute('data-src'), w: +(i.getAttribute('width') || 0) }))
        .filter((i) => i.s && !i.s.startsWith('data:')).sort((a, b) => b.w - a.w).slice(0, 3).map((i) => i.s);
    }
    const out = [];
    for (const x of list) {
      let abs; try { abs = new URL(x, url).href; } catch { continue; }
      const safe = safeUrl(abs); if (!safe) continue;
      if (/i\.pinimg\.com\/\d+x\//.test(safe)) out.push(safe.replace(/\/\d+x\//, '/originals/'));
      out.push(safe);
    }
    if (out.length) return [...new Set(out)];
  }
  return [];
}

/** Знаходить і завантажує картинку за посиланням (пряме або сторінка). */
export async function blobFromUrl(raw, onStep) {
  const url = safeUrl(raw);
  if (!url) throw new LoadError('Це не схоже на публічне посилання. Воно має починатися з https://');
  onStep && onStep('Шукаю картинку за посиланням…');
  let blob = await imageAt(url, false) || await imageAt(url, true);
  if (!blob) {
    onStep && onStep('Відкриваю сторінку й шукаю на ній зображення…');
    for (const img of await imagesOnPage(url)) { blob = await imageAt(img, true) || await imageAt(img, false); if (blob) break; }
  }
  if (!blob) throw new LoadError('За цим посиланням картинку не знайдено. Відкрийте зображення, клацніть правою кнопкою → «Копіювати адресу зображення» і вставте сюди.');
  return blob;
}
