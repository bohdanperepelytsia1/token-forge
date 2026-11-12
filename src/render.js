// Малювання токена: форми, рамки, тла.
export const PI = Math.PI, TAU = PI * 2;
export const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- кольори ---------- */
export function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); }
export function rgba(h, a) { const [r, g, b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }
const lt = (c, t) => mix(c, '#ffffff', t), dk = (c, t) => mix(c, '#000000', t);
export function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- середовище (заповнює app.js) ---------- */
export const env = { work: null, original: null, bgImg: null, guideUntil: 0, hover: false };
let blurCache = null, blurSrc = null;
function getBlur() {
  const o = env.original; if (!o) return null;
  if (blurSrc === o) return blurCache;
  const s = 22 / Math.max(o.width, o.height), a = mk(o.width * s, o.height * s);
  a.getContext('2d').drawImage(o, 0, 0, a.width, a.height);
  const b = mk(a.width * 5, a.height * 5), bx = b.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, b.width, b.height);
  blurSrc = o; return (blurCache = b);
}

/* ---------- форми ---------- */
function poly(sh) { return sh === 'hex' ? { n: 6, a0: 0 } : sh === 'hexp' ? { n: 6, a0: -PI / 2 } : { n: 8, a0: PI / 8 }; }
function polyR(sh, R) { return sh === 'oct' ? R / Math.cos(PI / 8) : R; }
export function rr(x, X, Y, W, H, r) { r = Math.max(0, Math.min(r, W / 2, H / 2)); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
export function shapePath(x, cx, cy, R, sh, ins) {
  if (sh === 'circle') { const r = Math.max(0, R - ins); x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, TAU); x.closePath(); return; }
  if (sh === 'square' || sh === 'rounded') { const h = Math.max(0, R - ins), r = sh === 'rounded' ? Math.max(0, R * 0.28 - ins) : 0; if (r > 0) rr(x, cx - h, cy - h, 2 * h, 2 * h, r); else x.rect(cx - h, cy - h, 2 * h, 2 * h); return; }
  const P = poly(sh), Rc = Math.max(0, polyR(sh, R) - ins / Math.cos(PI / P.n));
  for (let i = 0; i < P.n; i++) { const a = P.a0 + i * TAU / P.n, px = cx + Math.cos(a) * Rc, py = cy + Math.sin(a) * Rc; i ? x.lineTo(px, py) : x.moveTo(px, py); }
  x.closePath();
}
function boundary(sh, R, ins, a) {
  if (sh === 'circle') return R - ins;
  if (sh === 'square' || sh === 'rounded') { const h = R - ins, ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a)); if (sh === 'square') return h / Math.max(ca, sa); return h / Math.pow(Math.pow(ca, 5) + Math.pow(sa, 5), 0.2); }
  const P = poly(sh), Rc = polyR(sh, R) - ins / Math.cos(PI / P.n), ap = Rc * Math.cos(PI / P.n), seg = TAU / P.n, d = ((a - P.a0) % seg + seg) % seg;
  return ap / Math.cos(d - seg / 2);
}
export const padFrac = (T) => 0.012 + (T.shadow ? 0.025 : 0) + T.glow / 100 * 0.7;

/* ---------- шум і текстури ---------- */
function fbm(L, seed, oct = 5, base = 4) {
  const r = rng(seed), out = new Float32Array(L * L); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const g = base << o, grid = new Float32Array(g * g); for (let i = 0; i < grid.length; i++) grid[i] = r();
    const G = (ix, iy) => grid[(iy % g) * g + (ix % g)];
    for (let y = 0; y < L; y++) {
      const fy = y / L * g, iy = fy | 0, ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < L; x++) {
        const fx = x / L * g, ix = fx | 0, tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const a = G(ix, iy) + (G(ix + 1, iy) - G(ix, iy)) * sx, b = G(ix, iy + 1) + (G(ix + 1, iy + 1) - G(ix, iy + 1)) * sx;
        out[y * L + x] += (a + (b - a) * sy) * amp;
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function voronoi(L, n, seed) {
  const r = rng(seed), pts = []; for (let i = 0; i < n; i++) pts.push([r() * L, r() * L, r()]);
  const d1 = new Float32Array(L * L), d2 = new Float32Array(L * L), v = new Float32Array(L * L);
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    let a = 1e9, b = 1e9, id = 0;
    for (const p of pts) for (let ox = -L; ox <= L; ox += L) for (let oy = -L; oy <= L; oy += L) {
      const q = (x - p[0] - ox) ** 2 + (y - p[1] - oy) ** 2;
      if (q < a) { b = a; a = q; id = p[2]; } else if (q < b) b = q;
    }
    const k = y * L + x; d1[k] = Math.sqrt(a); d2[k] = Math.sqrt(b); v[k] = id;
  }
  return { d1, d2, v };
}
function paint(L, fn) {
  const c = mk(L, L), x = c.getContext('2d'), img = x.createImageData(L, L), d = img.data;
  for (let y = 0; y < L; y++) for (let xx = 0; xx < L; xx++) { const k = y * L + xx, col = fn(k, xx, y); d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; d[k * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
const lerpC = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
function noise(x, N, amt, seed) { const r = rng(seed), img = x.getImageData(0, 0, N, N), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(img, 0, 0); }

const texCache = new Map();
export function getTex(tex, c1, c2) {
  const key = tex + c1 + c2; if (texCache.has(key)) return texCache.get(key);
  if (texCache.size > 40) texCache.delete(texCache.keys().next().value);
  const N = 512, c = mk(N, N), x = c.getContext('2d', { willReadFrequently: true }), r = rng(42), A = hex2rgb(c1), B = hex2rgb(c2);
  const up = (src) => { x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, N, N); };
  switch (tex) {
    case 'parchment': {
      x.fillStyle = mix(c1, '#c9b07a', 0.55); x.fillRect(0, 0, N, N);
      for (let i = 0; i < 55; i++) { const px = r() * N, py = r() * N, rad = 20 + r() * 120, g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, rgba(mix(c2, '#5a3d1a', 0.4), 0.13 * r())); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N); }
      noise(x, N, 22, 3); const g = x.createRadialGradient(N / 2, N / 2, N * 0.25, N / 2, N / 2, N * 0.72); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, rgba(mix(c2, '#3b2410', 0.5), 0.55)); x.fillStyle = g; x.fillRect(0, 0, N, N); break;
    }
    case 'stone': { const L = 128, V = voronoi(L, 42, 7); up(paint(L, (k) => lerpC(A, B, V.d2[k] - V.d1[k] < 1.6 ? 1 : 0.15 + V.v[k] * 0.45))); noise(x, N, 26, 5); break; }
    case 'hexgrid': {
      const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.7); g.addColorStop(0, c1); g.addColorStop(1, c2); x.fillStyle = g; x.fillRect(0, 0, N, N);
      x.strokeStyle = rgba(lt(c1, 0.5), 0.28); x.lineWidth = 2; const s = 34, hh = s * Math.sqrt(3);
      for (let col = -1; col < N / (s * 1.5) + 1; col++) for (let row = -1; row < N / hh + 1; row++) { const cx = col * s * 1.5, cy = row * hh + (col % 2 ? hh / 2 : 0); x.beginPath(); for (let i = 0; i < 6; i++) { const a = i * PI / 3; i ? x.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s) : x.moveTo(cx + s, cy); } x.closePath(); x.stroke(); }
      break;
    }
    case 'stars': {
      x.fillStyle = dk(c2, 0.3); x.fillRect(0, 0, N, N);
      for (let i = 0; i < 7; i++) { const px = r() * N, py = r() * N, rad = 80 + r() * 180, g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, rgba(c1, 0.35)); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, N, N); }
      for (let i = 0; i < 380; i++) { x.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.75})`; const s = r() < 0.93 ? r() * 1.4 + 0.4 : r() * 2.2 + 1.4; x.beginPath(); x.arc(r() * N, r() * N, s, 0, TAU); x.fill(); }
      break;
    }
    case 'arcane': {
      const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.7); g.addColorStop(0, mix(c2, c1, 0.25)); g.addColorStop(1, dk(c2, 0.4)); x.fillStyle = g; x.fillRect(0, 0, N, N);
      x.translate(N / 2, N / 2); x.strokeStyle = rgba(c1, 0.55); x.lineWidth = 2.5; [0.47, 0.42, 0.27].forEach((k) => { x.beginPath(); x.arc(0, 0, N * k, 0, TAU); x.stroke(); });
      x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 7; i++) { const a = -PI / 2 + i * 3 * TAU / 7; i ? x.lineTo(Math.cos(a) * N * 0.42, Math.sin(a) * N * 0.42) : x.moveTo(Math.cos(a) * N * 0.42, Math.sin(a) * N * 0.42); } x.stroke();
      x.fillStyle = rgba(c1, 0.6); x.font = `${N * 0.032}px serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; const gl = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
      for (let i = 0; i < 32; i++) { x.save(); x.rotate(i / 32 * TAU); x.fillText(gl[i % gl.length], 0, -N * 0.445); x.restore(); }
      x.setTransform(1, 0, 0, 1, 0, 0); noise(x, N, 10, 9); break;
    }
    case 'wood': {
      x.fillStyle = c1; x.fillRect(0, 0, N, N);
      for (let i = 0; i < N; i += 2) { const w = Math.sin(i * 0.05 + r() * 0.4) * 0.5 + 0.5; x.fillStyle = rgba(c2, 0.08 + w * 0.18); x.fillRect(0, i, N, 2); }
      for (let p = 0; p < 9; p++) { x.fillStyle = rgba(dk(c2, 0.5), 0.55); x.fillRect(0, (p + 0.5) * N / 9, N, 2); }
      noise(x, N, 20, 11); break;
    }
    case 'fog': { const L = 256, v = fbm(L, 21, 6); up(paint(L, (k) => lerpC(B, A, Math.pow(v[k], 1.3)))); noise(x, N, 8, 4); break; }
    case 'marble': {
      const L = 256, v = fbm(L, 31, 6);
      up(paint(L, (k, px, py) => { const t = Math.abs(Math.sin((px / L * 3 + py / L * 2 + v[k] * 4) * PI)); const vein = Math.pow(1 - t, 8); return lerpC(lerpC(A, [255, 255, 255], v[k] * 0.15), B, vein * 0.9); }));
      noise(x, N, 6, 2); break;
    }
    case 'lava': {
      const L = 128, V = voronoi(L, 30, 17), v = fbm(L, 5, 4), Y = [255, 230, 140];
      up(paint(L, (k) => { const e = V.d2[k] - V.d1[k], glow = Math.exp(-e * 0.55); const base = lerpC(dk3(B, 0.4), B, v[k]); const hot = lerpC(base, A, glow); return glow > 0.75 ? lerpC(hot, Y, (glow - 0.75) * 3) : hot; }));
      noise(x, N, 10, 6); break;
    }
    case 'water': {
      const L = 256, v = fbm(L, 41, 5);
      up(paint(L, (k, px, py) => { const rip = Math.sin(v[k] * 14 + py / L * 18) * 0.5 + 0.5; let col = lerpC(B, A, v[k] * 0.7 + rip * 0.25); if (rip > 0.94) col = lerpC(col, [255, 255, 255], (rip - 0.94) * 6); return col; }));
      break;
    }
    case 'grass': {
      const L = 128, v = fbm(L, 51, 4); up(paint(L, (k) => lerpC(B, A, 0.3 + v[k] * 0.5)));
      x.lineCap = 'round';
      for (let i = 0; i < 2600; i++) { const px = r() * N, py = r() * N, len = 6 + r() * 12, a = -PI / 2 + (r() - 0.5) * 0.9; x.strokeStyle = rgba(mix(c1, i % 3 ? '#e8ffb0' : c2, r() * 0.45), 0.55); x.lineWidth = 1 + r() * 1.5; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke(); }
      break;
    }
    case 'sand': { const L = 256, v = fbm(L, 61, 5); up(paint(L, (k, px, py) => { const d = Math.sin(py / L * 26 + v[k] * 7 + px / L * 4) * 0.5 + 0.5; return lerpC(A, B, d * 0.35 + v[k] * 0.25); })); noise(x, N, 18, 8); break; }
    case 'snow': {
      const L = 256, v = fbm(L, 71, 5); up(paint(L, (k) => lerpC([250, 252, 255], A, v[k] * 0.6)));
      const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, rgba(c2, 0.35)); x.fillStyle = g; x.fillRect(0, 0, N, N);
      for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`; x.fillRect(r() * N, r() * N, 1.5, 1.5); }
      break;
    }
    case 'leather': {
      const L = 128, V = voronoi(L, 140, 23), v = fbm(L, 9, 4);
      up(paint(L, (k) => { const e = V.d2[k] - V.d1[k]; const base = lerpC(A, B, v[k] * 0.45 + V.v[k] * 0.12); return e < 0.9 ? lerpC(base, B, 0.55) : base; }));
      noise(x, N, 16, 12); const g = x.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N * 0.7); g.addColorStop(0, 'rgba(255,255,255,.06)'); g.addColorStop(1, 'rgba(0,0,0,.35)'); x.fillStyle = g; x.fillRect(0, 0, N, N); break;
    }
    case 'tiles': {
      x.fillStyle = dk(c2, 0.2); x.fillRect(0, 0, N, N); const n = 6, s = N / n, gap = 5;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = mix(c1, c2, r() * 0.45); x.fillRect(i * s + gap / 2, j * s + gap / 2, s - gap, s - gap); x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(i * s + gap / 2, j * s + gap / 2, s - gap, 3); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(i * s + gap / 2, (j + 1) * s - gap / 2 - 3, s - gap, 3); }
      noise(x, N, 22, 14); break;
    }
  }
  texCache.set(key, c); return c;
}
function dk3(C, t) { return [C[0] * (1 - t), C[1] * (1 - t), C[2] * (1 - t)]; }
function cover(x, img, dx, dy, dw, dh) { const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(dw / iw, dh / ih); x.drawImage(img, dx + (dw - iw * s) / 2, dy + (dh - ih * s) / 2, iw * s, ih * s); }

/* ---------- тло ---------- */
export function drawBg(x, S, c, R, P) {
  switch (P.bgType) {
    case 'none': return;
    case 'solid': x.fillStyle = P.bg1; x.fillRect(0, 0, S, S); return;
    case 'radial': { const g = x.createRadialGradient(c, c * 0.85, 0, c, c, R * 1.05); g.addColorStop(0, P.bg1); g.addColorStop(1, P.bg2); x.fillStyle = g; x.fillRect(0, 0, S, S); return; }
    case 'linear': { const g = x.createLinearGradient(0, c - R, 0, c + R); g.addColorStop(0, P.bg1); g.addColorStop(1, P.bg2); x.fillStyle = g; x.fillRect(0, 0, S, S); return; }
    case 'texture': x.drawImage(getTex(P.tex, P.bg1, P.bg2), c - R, c - R, 2 * R, 2 * R); return;
    case 'blur': { const b = getBlur(); if (b) { cover(x, b, c - R, c - R, 2 * R, 2 * R); x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(0, 0, S, S); } else { x.fillStyle = '#3a3f4a'; x.fillRect(0, 0, S, S); } return; }
    case 'image': if (env.bgImg) cover(x, env.bgImg, c - R, c - R, 2 * R, 2 * R); else { x.fillStyle = P.bg2; x.fillRect(0, 0, S, S); } return;
  }
}

/* ---------- рамки ---------- */
export const RING_STYLES = [
  ['metal', 'Метал'], ['solid', 'Суцільна'], ['gradient', 'Градієнт'], ['double', 'Подвійна'], ['dashed', 'Пунктир'],
  ['runic', 'Руни'], ['studs', 'Заклепки'], ['gems', 'Самоцвіти'], ['enamel', 'Емаль'], ['segmented', 'Сегменти'],
  ['dentil', 'Зубчики'], ['plate', 'Гвинти'], ['scifi', 'Наукова фантастика'], ['neon', 'Неон'], ['chain', 'Ланцюг'],
  ['rope', 'Мотузка'], ['braid', 'Плетіння'], ['leaves', 'Лавровий вінок'], ['floral', 'Квіти'], ['thorns', 'Терен'],
  ['scales', 'Луска'], ['stone', 'Камінь'], ['wood', 'Дерево'], ['gear', 'Шестерня'], ['ice', 'Крига'],
  ['flame', 'Полум\'я'], ['compass', 'Компас'], ['ooze', 'Слиз'],
];
export const ACCENT_STYLES = new Set(['gems', 'enamel', 'scifi', 'neon', 'floral', 'flame', 'compass']);
export const COUNT_STYLES = new Set(['runic', 'studs', 'gems', 'segmented', 'dentil', 'plate', 'scifi', 'braid', 'leaves', 'floral', 'thorns', 'stone', 'wood', 'gear', 'ice', 'flame', 'ooze']);

export function drawRing(x, S, c, R, bw, P) {
  const sh = P.shape, c1 = P.c1, c2 = P.c2, c3 = P.c3 || '#c0283a', n0 = P.ticks || 24;
  const band = (o, i) => { x.beginPath(); shapePath(x, c, c, R, sh, o); shapePath(x, c, c, R, sh, i); };
  const fillRing = (style, o = 0, i = bw) => { band(o, i); x.fillStyle = style; x.fill('evenodd'); };
  const clip = () => { x.save(); band(0, bw); x.clip('evenodd'); };
  const pt = (a, ins) => { const d = boundary(sh, R, ins, a); return [c + Math.cos(a) * d, c + Math.sin(a) * d]; };
  const tang = (a, ins) => { const e = 0.003, p1 = pt(a - e, ins), p2 = pt(a + e, ins); return Math.atan2(p2[1] - p1[1], p2[0] - p1[0]); };
  // локальні осі: x — уздовж рамки, −y — назовні, +y — всередину
  const place = (n, ins, fn, off = 0) => { for (let i = 0; i < n; i++) { const a = (i + off) / n * TAU - PI / 2, [px, py] = pt(a, ins); x.save(); x.translate(px, py); x.rotate(tang(a, ins)); fn(i, a); x.restore(); } };
  const perim = (ins) => { let L = 0, p = pt(0, ins); for (let i = 1; i <= 180; i++) { const q = pt(i / 180 * TAU, ins); L += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; } return L; };
  const midPath = (ins) => { x.beginPath(); shapePath(x, c, c, R, sh, ins); };
  const curve = (fn) => { x.beginPath(); for (let i = 0; i <= 720; i++) { const a = i / 720 * TAU - PI / 2, [px, py] = pt(a, fn(a)); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); };
  const metal = (a = c1, b = c2) => { const g = x.createLinearGradient(c - R, c - R, c + R, c + R), l = lt(a, 0.45); g.addColorStop(0, l); g.addColorStop(0.2, a); g.addColorStop(0.46, b); g.addColorStop(0.6, a); g.addColorStop(0.8, l); g.addColorStop(1, b); return g; };
  const lw = (k) => Math.max(1, bw * k);
  let bevelOuter = true;

  switch (P.bStyle) {
    case 'solid': fillRing(c1); break;
    case 'metal': fillRing(metal()); break;
    case 'gradient': { const g = x.createLinearGradient(0, c - R, 0, c + R); g.addColorStop(0, c1); g.addColorStop(1, c2); fillRing(g); break; }
    case 'double': fillRing(c2); fillRing(metal(), 0, bw * 0.34); fillRing(metal(), bw * 0.66, bw); break;
    case 'dashed': fillRing(c2); x.save(); midPath(bw / 2); x.strokeStyle = c1; x.lineWidth = bw * 0.42; x.setLineDash([bw * 0.9, bw * 0.55]); x.stroke(); x.restore(); break;
    case 'runic': case 'studs': {
      fillRing(metal()); clip(); const r = rng(11);
      place(n0, bw / 2, (i) => {
        if (P.bStyle === 'studs') { const sr = bw * 0.2, g = x.createRadialGradient(-sr * 0.35, -sr * 0.35, sr * 0.1, 0, 0, sr); g.addColorStop(0, lt(c1, 0.7)); g.addColorStop(0.5, c1); g.addColorStop(1, c2); x.fillStyle = g; x.beginPath(); x.arc(0, 0, sr, 0, TAU); x.fill(); x.strokeStyle = 'rgba(0,0,0,.45)'; x.lineWidth = Math.max(0.6, bw * 0.03); x.stroke(); return; }
        const s = bw * 0.3, k = Math.floor(r() * 6);
        const path = () => { x.beginPath(); x.moveTo(0, -s); x.lineTo(0, s);
          if (k === 0) { x.moveTo(0, -s); x.lineTo(s * 0.6, -s * 0.35); } else if (k === 1) { x.moveTo(0, -s * 0.1); x.lineTo(s * 0.55, -s * 0.65); x.moveTo(0, -s * 0.1); x.lineTo(-s * 0.55, -s * 0.65); }
          else if (k === 2) { x.moveTo(0, -s); x.lineTo(s * 0.55, -s * 0.45); x.lineTo(0, s * 0.1); } else if (k === 3) { x.moveTo(-s * 0.5, -s * 0.55); x.lineTo(s * 0.5, s * 0.55); }
          else if (k === 4) { x.moveTo(0, 0); x.lineTo(s * 0.55, -s * 0.55); x.moveTo(0, 0); x.lineTo(s * 0.55, s * 0.55); } else { x.moveTo(-s * 0.5, -s * 0.35); x.lineTo(s * 0.5, -s * 0.35); } };
        x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = lw(0.1);
        x.translate(bw * 0.025, bw * 0.025); path(); x.strokeStyle = 'rgba(255,255,255,.35)'; x.stroke();
        x.translate(-bw * 0.05, -bw * 0.05); path(); x.strokeStyle = c2; x.stroke();
        if (P.glow > 0) { x.shadowColor = P.glowColor; x.shadowBlur = bw * 0.4; x.strokeStyle = P.glowColor; x.lineWidth *= 0.5; x.stroke(); }
      });
      x.restore(); break;
    }
    case 'gems': {
      fillRing(metal());
      place(Math.max(3, Math.round(n0 / 3)), bw / 2, () => {
        const r = bw * 0.33; x.beginPath(); x.arc(0, 0, r * 1.2, 0, TAU); x.fillStyle = dk(c1, 0.15); x.fill(); x.strokeStyle = lt(c1, 0.4); x.lineWidth = lw(0.04); x.stroke();
        const g = x.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r); g.addColorStop(0, lt(c3, 0.75)); g.addColorStop(0.35, c3); g.addColorStop(1, dk(c3, 0.6)); x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill();
        x.fillStyle = 'rgba(255,255,255,.8)'; x.beginPath(); x.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.12, -0.6, 0, TAU); x.fill();
      }, 0.5);
      break;
    }
    case 'enamel': {
      fillRing(metal(), 0, bw * 0.24); fillRing(metal(), bw * 0.76, bw);
      const g = x.createLinearGradient(0, c - R, 0, c + R); g.addColorStop(0, lt(c3, 0.25)); g.addColorStop(0.5, c3); g.addColorStop(1, dk(c3, 0.45)); fillRing(g, bw * 0.24, bw * 0.76);
      clip(); const gl = x.createLinearGradient(0, c - R, 0, c); gl.addColorStop(0, 'rgba(255,255,255,.4)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gl; x.fillRect(c - R, c - R, 2 * R, R); x.restore(); break;
    }
    case 'segmented': {
      fillRing(dk(c2, 0.25)); const n = Math.max(4, n0), L = perim(bw / 2), gap = Math.max(bw * 0.22, L / n * 0.12);
      x.save(); midPath(bw / 2); x.setLineDash([L / n - gap, gap]); x.lineDashOffset = gap / 2; x.lineWidth = bw * 0.72; x.strokeStyle = metal(); x.stroke(); x.restore(); break;
    }
    case 'dentil': {
      fillRing(metal()); clip(); const n = n0 * 2, s = perim(bw * 0.72) / n;
      place(n, bw * 0.72, () => { x.fillStyle = dk(c2, 0.1); x.fillRect(-s * 0.28, -bw * 0.16, s * 0.56, bw * 0.32); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(-s * 0.28, -bw * 0.16, s * 0.56, bw * 0.05); });
      midPath(bw * 0.38); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = lw(0.04); x.stroke(); x.restore(); break;
    }
    case 'plate': {
      fillRing(metal());
      place(Math.max(3, Math.round(n0 / 4)), bw / 2, (i) => {
        const r = bw * 0.2, g = x.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r); g.addColorStop(0, lt(c1, 0.6)); g.addColorStop(1, dk(c1, 0.35));
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, TAU); x.fill(); x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = Math.max(1, r * 0.16); x.stroke();
        x.rotate(i * 0.9); x.beginPath(); x.moveTo(-r * 0.6, 0); x.lineTo(r * 0.6, 0); x.stroke();
      }, 0.5);
      break;
    }
    case 'scifi': {
      fillRing(dk(c2, 0.3)); const n = Math.max(4, Math.round(n0 / 3)), L = perim(bw / 2);
      x.save(); midPath(bw / 2); x.setLineDash([L / n * 0.8, L / n * 0.2]); x.lineWidth = bw * 0.52; x.strokeStyle = metal(); x.stroke(); x.restore();
      x.save(); x.shadowColor = c3; x.shadowBlur = bw * 0.6; x.strokeStyle = c3; x.lineWidth = lw(0.07); midPath(bw * 0.1); x.stroke(); midPath(bw * 0.9); x.stroke(); x.restore(); break;
    }
    case 'neon': {
      fillRing('rgba(8,10,16,.88)'); const L = perim(bw * 0.3);
      x.save(); x.shadowColor = c1; x.shadowBlur = bw * 0.9; x.strokeStyle = lt(c1, 0.3); x.lineWidth = lw(0.12); x.setLineDash([L / 8 * 0.8, L / 8 * 0.2]); midPath(bw * 0.3); x.stroke(); x.stroke();
      const L2 = perim(bw * 0.72); x.setLineDash([L2 / 24 * 0.6, L2 / 24 * 0.4]); x.strokeStyle = c3; x.shadowColor = c3; midPath(bw * 0.72); x.stroke(); x.restore(); break;
    }
    case 'chain': {
      fillRing(dk(c2, 0.25)); const L = perim(bw / 2), linkL = bw * 1.25, n = Math.max(8, Math.round(L / (linkL * 0.72)));
      place(n, bw / 2, (i) => {
        x.lineWidth = bw * 0.13;
        if (i % 2 === 0) { x.beginPath(); x.ellipse(0, 0, linkL / 2, bw * 0.27, 0, 0, TAU); x.strokeStyle = dk(c1, 0.35); x.lineWidth = bw * 0.17; x.stroke(); x.strokeStyle = c1; x.lineWidth = bw * 0.11; x.stroke(); x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = bw * 0.04; x.beginPath(); x.ellipse(0, 0, linkL / 2, bw * 0.27, 0, PI * 1.15, PI * 1.85); x.stroke(); }
        else { x.beginPath(); rr(x, -linkL / 2, -bw * 0.075, linkL, bw * 0.15, bw * 0.075); x.fillStyle = dk(c1, 0.12); x.fill(); x.strokeStyle = dk(c1, 0.45); x.lineWidth = lw(0.03); x.stroke(); }
      });
      break;
    }
    case 'rope': {
      fillRing(c1); clip(); const n = Math.round(perim(bw / 2) / (bw * 0.3));
      place(n, bw / 2, () => { x.rotate(0.75); x.strokeStyle = rgba(c2, 0.7); x.lineWidth = lw(0.09); x.beginPath(); x.moveTo(0, -bw * 0.8); x.lineTo(0, bw * 0.8); x.stroke(); x.strokeStyle = 'rgba(255,255,255,.2)'; x.translate(bw * 0.08, 0); x.beginPath(); x.moveTo(0, -bw * 0.8); x.lineTo(0, bw * 0.8); x.stroke(); });
      const sh2 = x.createLinearGradient(c - R, c - R, c + R, c + R); sh2.addColorStop(0, 'rgba(255,255,255,.12)'); sh2.addColorStop(1, 'rgba(0,0,0,.25)'); band(0, bw); x.fillStyle = sh2; x.fill('evenodd');
      x.restore(); break;
    }
    case 'braid': {
      fillRing(dk(c2, 0.2)); const k = Math.max(6, Math.round(n0 / 2)), amp = bw * 0.25;
      x.save(); x.lineJoin = 'round';
      for (let s = 0; s < 2; s++) { curve((a) => bw / 2 + Math.sin(a * k + s * PI) * amp); x.lineWidth = bw * 0.26; x.strokeStyle = dk(c1, 0.55); x.stroke(); x.lineWidth = bw * 0.16; x.strokeStyle = s ? c1 : lt(c1, 0.18); x.stroke(); }
      x.restore(); break;
    }
    case 'leaves': case 'floral': {
      bevelOuter = false;
      fillRing(rgba(c2, 0.92), bw * 0.15, bw * 0.85); x.save(); midPath(bw / 2); x.strokeStyle = dk(c1, 0.4); x.lineWidth = lw(0.08); x.stroke(); x.restore();
      const leaf = (len, wid, col) => { x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.5, -wid, len, 0); x.quadraticCurveTo(len * 0.5, wid, 0, 0); x.fillStyle = col; x.fill(); x.strokeStyle = dk(col, 0.4); x.lineWidth = Math.max(0.6, bw * 0.025); x.stroke(); x.beginPath(); x.moveTo(len * 0.1, 0); x.lineTo(len * 0.85, 0); x.stroke(); };
      const n = Math.max(10, n0);
      place(n, bw / 2, (i) => {
        for (const side of [-1, 1]) { x.save(); x.rotate(side * 0.6); leaf(bw * 0.55, bw * 0.19, i % 3 ? c1 : lt(c1, 0.18)); x.restore(); }
        if (P.bStyle === 'floral' && i % 3 === 0) {
          const pr = bw * 0.16; x.fillStyle = c3; for (let p = 0; p < 5; p++) { x.beginPath(); x.ellipse(Math.cos(p * TAU / 5) * pr, Math.sin(p * TAU / 5) * pr, pr * 0.85, pr * 0.6, p * TAU / 5, 0, TAU); x.fill(); }
          x.fillStyle = '#ffe27a'; x.beginPath(); x.arc(0, 0, pr * 0.55, 0, TAU); x.fill();
        }
      });
      break;
    }
    case 'thorns': {
      fillRing(dk(c2, 0.1)); clip();
      curve((a) => bw / 2 + Math.sin(a * Math.max(6, n0 / 2)) * bw * 0.16); x.strokeStyle = c1; x.lineWidth = bw * 0.16; x.stroke(); x.strokeStyle = 'rgba(255,255,255,.15)'; x.lineWidth = bw * 0.05; x.stroke();
      place(n0 * 2, bw / 2, (i) => { const dir = i % 2 ? 1 : -1; x.beginPath(); x.moveTo(-bw * 0.1, 0); x.lineTo(bw * 0.05, dir * bw * 0.42); x.lineTo(bw * 0.12, 0); x.closePath(); x.fillStyle = lt(c1, 0.12); x.fill(); });
      x.restore(); break;
    }
    case 'scales': {
      fillRing(dk(c2, 0.3)); clip(); const s = bw * 0.4, n = Math.round(perim(bw / 2) / (s * 1.05));
      for (let row = 0; row < 3; row++) place(n, bw * (0.12 + row * 0.33), () => {
        const g = x.createLinearGradient(0, -s * 0.5, 0, s * 0.6); g.addColorStop(0, lt(c1, 0.35)); g.addColorStop(1, dk(c1, 0.35));
        x.beginPath(); x.arc(0, -s * 0.15, s * 0.62, 0, PI); x.closePath(); x.fillStyle = g; x.fill(); x.strokeStyle = dk(c2, 0.3); x.lineWidth = lw(0.03); x.stroke();
      }, row % 2 ? 0.5 : 0);
      x.restore(); break;
    }
    case 'stone': case 'wood': {
      const pat = x.createPattern(getTex(P.bStyle, c1, c2), 'repeat'); pat.setTransform(new DOMMatrix().scaleSelf(S / 900, S / 900)); fillRing(pat);
      clip(); place(Math.max(6, Math.round(n0 / 2)), bw / 2, () => { x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = lw(0.07); x.beginPath(); x.moveTo(0, -bw); x.lineTo(0, bw); x.stroke(); x.strokeStyle = 'rgba(255,255,255,.15)'; x.lineWidth = lw(0.03); x.beginPath(); x.moveTo(lw(0.06), -bw); x.lineTo(lw(0.06), bw); x.stroke(); }, 0.5);
      x.restore(); break;
    }
    case 'gear': {
      bevelOuter = false; const t = 0.42, n = Math.max(8, n0), L = perim(bw * t / 2);
      fillRing(metal(), bw * t, bw);
      place(n, bw * t / 2, () => { const w = L / n * 0.55, h = bw * t * 0.55; x.beginPath(); x.moveTo(-w / 2, h); x.lineTo(-w * 0.34, -h); x.lineTo(w * 0.34, -h); x.lineTo(w / 2, h); x.closePath(); x.fillStyle = lt(c1, 0.05); x.fill(); x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = lw(0.03); x.stroke(); });
      place(Math.round(n / 2), bw * 0.71, () => { x.beginPath(); x.arc(0, 0, bw * 0.08, 0, TAU); x.fillStyle = dk(c2, 0.4); x.fill(); }, 0.25);
      break;
    }
    case 'ice': {
      const g = x.createLinearGradient(c - R, c - R, c + R, c + R); g.addColorStop(0, lt(c1, 0.6)); g.addColorStop(0.35, c1); g.addColorStop(0.6, lt(c1, 0.3)); g.addColorStop(1, c2); fillRing(g);
      clip(); const r = rng(5);
      place(n0 * 2, bw / 2, () => { x.rotate((r() - 0.5) * 0.8); x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = lw(0.04); x.beginPath(); x.moveTo(-bw * 0.4, -bw * 0.4); x.lineTo(bw * (r() - 0.5) * 0.4, bw * 0.1); x.lineTo(bw * 0.35, -bw * 0.45); x.stroke(); });
      x.restore();
      place(n0, bw, (i) => { if (i % 2) return; const h = bw * (0.25 + r() * 0.35); x.beginPath(); x.moveTo(-bw * 0.12, -1); x.lineTo(0, h); x.lineTo(bw * 0.12, -1); x.closePath(); x.fillStyle = rgba(lt(c1, 0.55), 0.85); x.fill(); });
      break;
    }
    case 'flame': {
      fillRing(dk(c2, 0.2)); clip(); x.globalCompositeOperation = 'lighter'; const r = rng(9);
      place(n0 * 2, bw * 0.95, () => { const h = bw * (0.7 + r() * 0.6), w = bw * 0.34, g = x.createLinearGradient(0, 0, 0, -h); g.addColorStop(0, rgba(c3, 0.95)); g.addColorStop(0.5, rgba(c1, 0.85)); g.addColorStop(1, rgba(c1, 0)); x.fillStyle = g; x.beginPath(); x.moveTo(-w / 2, 0); x.quadraticCurveTo(-w * 0.6, -h * 0.5, (r() - 0.5) * w * 0.6, -h); x.quadraticCurveTo(w * 0.6, -h * 0.5, w / 2, 0); x.closePath(); x.fill(); });
      x.restore(); break;
    }
    case 'compass': {
      fillRing(metal()); clip();
      place(72, bw * 0.22, (i) => { x.fillStyle = dk(c2, 0.2); x.fillRect(-Math.max(0.5, bw * 0.02), -bw * 0.2, Math.max(1, bw * 0.04), i % 6 === 0 ? bw * 0.45 : bw * 0.22); });
      x.restore();
      place(4, bw * 0.62, () => { x.beginPath(); x.moveTo(0, -bw * 0.32); x.lineTo(bw * 0.18, bw * 0.16); x.lineTo(-bw * 0.18, bw * 0.16); x.closePath(); x.fillStyle = c3; x.fill(); x.strokeStyle = dk(c3, 0.5); x.lineWidth = lw(0.03); x.stroke(); });
      break;
    }
    case 'ooze': {
      const g = x.createLinearGradient(0, c - R, 0, c + R); g.addColorStop(0, lt(c1, 0.25)); g.addColorStop(0.6, c1); g.addColorStop(1, dk(c1, 0.35)); fillRing(g);
      const r = rng(13);
      place(n0, bw * 0.98, () => { if (r() < 0.45) return; const len = bw * (0.3 + r() * 0.9), w = bw * (0.16 + r() * 0.14); x.fillStyle = c1; x.beginPath(); x.moveTo(-w, -bw * 0.05); x.quadraticCurveTo(-w * 0.6, len * 0.6, 0, len); x.quadraticCurveTo(w * 0.6, len * 0.6, w, -bw * 0.05); x.closePath(); x.fill(); x.beginPath(); x.arc(0, len, w * 0.75, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,255,255,.35)'; x.beginPath(); x.arc(-w * 0.25, len - w * 0.2, w * 0.22, 0, TAU); x.fill(); });
      clip(); place(n0, bw * (0.3 + 0.2), (i) => { if (i % 3) return; x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = lw(0.03); x.beginPath(); x.arc(0, 0, bw * 0.1, 0, TAU); x.stroke(); }, 0.3); x.restore();
      break;
    }
  }
  if (P.bevel) {
    const w = Math.max(1, S * 0.005); x.save(); x.lineWidth = w; x.strokeStyle = 'rgba(0,0,0,.6)';
    if (bevelOuter) { x.beginPath(); shapePath(x, c, c, R, sh, w / 2); x.stroke(); }
    x.beginPath(); shapePath(x, c, c, R, sh, bw); x.stroke();
    if (bevelOuter) { x.strokeStyle = 'rgba(255,255,255,.3)'; x.beginPath(); shapePath(x, c, c, R, sh, w * 1.6); x.stroke(); }
    x.restore();
  }
}

/* ---------- підписи ---------- */
const FONT_W = { 'Ruslan Display': 400, 'Marck Script': 400 };
export function fontStr(T, px) { return `${FONT_W[T.nameFont] || 700} ${px}px "${T.nameFont}", serif`; }
function drawBanner(x, S, c, R, T) {
  const w = S * 0.74, h = S * 0.13, y = c + R * 0.76, tw = h * 0.75; x.save();
  x.fillStyle = dk(T.bannerColor, 0.4);
  [-1, 1].forEach((sd) => { const e = c + sd * w / 2; x.beginPath(); x.moveTo(e - sd * tw * 0.4, y - h * 0.2); x.lineTo(e + sd * tw, y - h * 0.2); x.lineTo(e + sd * tw * 0.6, y + h * 0.25); x.lineTo(e + sd * tw, y + h * 0.68); x.lineTo(e - sd * tw * 0.4, y + h * 0.68); x.closePath(); x.fill(); });
  x.beginPath(); rr(x, c - w / 2, y - h / 2, w, h, h * 0.2); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = S * 0.015; x.shadowOffsetY = S * 0.006; x.fillStyle = T.bannerColor; x.fill();
  x.shadowColor = 'transparent'; x.lineWidth = S * 0.007; x.strokeStyle = T.c1; x.stroke();
  let fs = h * 0.66; x.font = fontStr(T, fs); while (x.measureText(T.name).width > w * 0.86 && fs > 4) { fs *= 0.94; x.font = fontStr(T, fs); }
  x.fillStyle = T.nameColor; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(T.name, c, y + fs * 0.05); x.restore();
}
function drawBadge(x, S, c, R, T, num) {
  const r = S * 0.1, off = R * 0.7, p = { tr: [1, -1], tl: [-1, -1], br: [1, 1], bl: [-1, 1] }[T.numPos] || [1, -1], px = c + p[0] * off, py = c + p[1] * off;
  x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = S * 0.015; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fillStyle = T.numColor; x.fill();
  x.shadowColor = 'transparent'; x.lineWidth = S * 0.012; x.strokeStyle = T.c1; x.stroke();
  const s = String(num), fs = r * (s.length > 2 ? 0.78 : s.length > 1 ? 1 : 1.25); x.fillStyle = '#fff'; x.font = `700 ${fs}px "Philosopher", serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s, px, py + fs * 0.06); x.restore();
}

/* ---------- токен ---------- */
function drawSubject(x, S, T, shadow) {
  const w = env.work; if (!w) return; const k = S * T.zoom / Math.max(w.width, w.height);
  x.save(); x.translate(S / 2 + T.ox * S, S / 2 + T.oy * S); x.rotate(T.rot * PI / 180); x.scale(T.flip ? -k : k, k);
  if (shadow) { x.shadowColor = 'rgba(0,0,0,.65)'; x.shadowBlur = S * 0.03; x.shadowOffsetY = S * 0.012; }
  x.imageSmoothingQuality = 'high'; x.drawImage(w, -w.width / 2, -w.height / 2); x.restore();
}
export function drawToken(x, S, T, o = {}) {
  const c = S / 2, R = c - S * padFrac(T), bw = S * T.bw / 100, sh = T.shape;
  if (o.subjectOnly) { drawSubject(x, S, T, false); return; }
  x.save();
  if (T.shadow || T.glow > 0) {
    x.save(); x.beginPath(); shapePath(x, c, c, R, sh, 0); if (T.bgType === 'none') shapePath(x, c, c, R, sh, bw); x.fillStyle = T.c2;
    if (T.shadow) { x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = S * 0.03; x.shadowOffsetY = S * 0.012; x.fill('evenodd'); }
    if (T.glow > 0) { x.shadowColor = T.glowColor; x.shadowBlur = S * T.glow / 100; x.shadowOffsetY = 0; x.fill('evenodd'); x.fill('evenodd'); }
    x.restore();
  }
  x.save(); x.beginPath(); shapePath(x, c, c, R, sh, Math.max(0, bw - S * 0.002)); x.clip();
  if (T.bgType === 'none' && (T.shadow || T.glow > 0)) x.clearRect(0, 0, S, S);
  drawBg(x, S, c, R, T);
  if (T.vignette && T.bgType !== 'none') { const g = x.createRadialGradient(c, c, R * 0.45, c, c, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); x.fillStyle = g; x.fillRect(0, 0, S, S); }
  drawSubject(x, S, T, T.subjShadow); x.restore();
  if (bw > 0) drawRing(x, S, c, R, bw, T);
  if (T.innerLine && bw > 0) { x.save(); x.lineWidth = Math.max(1, S * 0.005); x.strokeStyle = T.c1; x.globalAlpha = 0.8; x.beginPath(); shapePath(x, c, c, R, sh, bw + S * 0.013); x.stroke(); x.restore(); }
  if (T.popout && env.work) { x.save(); x.beginPath(); x.rect(0, 0, S, S * T.popCut); x.clip(); drawSubject(x, S, T, T.subjShadow); x.restore(); }
  if (T.name && T.name.trim()) drawBanner(x, S, c, R, T);
  const num = o.num != null ? o.num : T.num; if (num !== '' && num != null) drawBadge(x, S, c, R, T, num);
  if (o.preview && T.popout && (env.hover || performance.now() < env.guideUntil)) {
    x.save(); x.setLineDash([S * 0.015, S * 0.012]); x.strokeStyle = 'rgba(255,230,160,.85)'; x.lineWidth = Math.max(1, S * 0.003); x.beginPath(); x.moveTo(0, S * T.popCut); x.lineTo(S, S * T.popCut); x.stroke();
    x.font = `600 ${S * 0.024}px "Alegreya Sans", sans-serif`; x.fillStyle = 'rgba(255,230,160,.95)'; x.fillText('вище цієї лінії — поверх рамки', S * 0.02, S * T.popCut - S * 0.012); x.restore();
  }
  x.restore();
}
export function fitToken(T, kind, bbox) {
  const w = env.work; if (!w || !bbox) return; const W = w.width, H = w.height, m = Math.max(W, H), Rr = 0.5 - padFrac(T), inner = (Rr - T.bw / 100) * 2; T.rot = 0;
  // Фон ще не прибрано — заповнюємо рамку зображенням без порожнин, вирівнюючи по верху.
  if (kind === 'portrait' && bbox.w >= W - 2 && bbox.h >= H - 2) {
    T.zoom = clamp(inner * 1.01 * m / Math.min(W, H), 0.15, 4); const k = T.zoom / m;
    T.ox = 0; T.oy = H * k / 2 - (Rr - T.bw / 100); return;
  }
  if (kind === 'full') { T.zoom = inner * 0.9 * m / Math.max(bbox.w, bbox.h); const k = T.zoom / m; T.ox = -(bbox.x + bbox.w / 2 - W / 2) * k * (T.flip ? -1 : 1); T.oy = -(bbox.y + bbox.h / 2 - H / 2) * k; }
  else { T.zoom = inner * 1.02 * m / Math.min(bbox.w, bbox.h * 0.8); const k = T.zoom / m; T.ox = -(bbox.x + bbox.w / 2 - W / 2) * k * (T.flip ? -1 : 1); const top = T.popout ? 0.5 - Rr - 0.01 : 0.5 - Rr + T.bw / 100 + 0.03; T.oy = top - 0.5 - (bbox.y - H / 2) * k; }
  T.zoom = clamp(T.zoom, 0.15, 4);
}

/* ---------- готові набори ---------- */
export const RING_PRESETS = [
  ['Золото', { bStyle: 'metal', c1: '#e2b856', c2: '#5e3f12' }], ['Срібло', { bStyle: 'metal', c1: '#eef1f4', c2: '#5f6670' }],
  ['Бронза', { bStyle: 'metal', c1: '#d08a4c', c2: '#4f2a10' }], ['Залізо', { bStyle: 'studs', c1: '#a3a9b0', c2: '#2a2d31', ticks: 16 }],
  ['Гравець', { bStyle: 'gradient', c1: '#5aa4ff', c2: '#0d2c63' }], ['Союзник', { bStyle: 'solid', c1: '#3cc46e', c2: '#0d3d20' }],
  ['Нейтрал', { bStyle: 'solid', c1: '#e3c447', c2: '#57460f' }], ['Ворог', { bStyle: 'solid', c1: '#d63b3b', c2: '#460c0c' }],
  ['Бос', { bStyle: 'runic', c1: '#b77aff', c2: '#2b0b57', glow: 4, glowColor: '#b77aff' }], ['Нежить', { bStyle: 'runic', c1: '#7dffb0', c2: '#0b2416', glow: 4, glowColor: '#4dff95', ticks: 20 }],
  ['Королівська', { bStyle: 'gems', c1: '#e2b856', c2: '#5e3f12', c3: '#c0283a', ticks: 24 }], ['Сапфір', { bStyle: 'gems', c1: '#e6eaef', c2: '#5f6670', c3: '#2f6fd8', ticks: 18 }],
  ['Емаль', { bStyle: 'enamel', c1: '#e2b856', c2: '#5e3f12', c3: '#1f6f8b' }], ['Сегменти', { bStyle: 'segmented', c1: '#dfe3e8', c2: '#3a4048', ticks: 12 }],
  ['Антична', { bStyle: 'dentil', c1: '#ece4d2', c2: '#6f6656', ticks: 24 }], ['Броня', { bStyle: 'plate', c1: '#9aa1a9', c2: '#2b2e33', ticks: 24 }],
  ['Космос', { bStyle: 'scifi', c1: '#9fb0c4', c2: '#18202c', c3: '#3fe0ff', ticks: 18 }], ['Кіберпанк', { bStyle: 'neon', c1: '#ff3fd2', c2: '#100818', c3: '#3fe0ff' }],
  ['Ланцюг', { bStyle: 'chain', c1: '#b8bec6', c2: '#22262c' }], ['Мотузка', { bStyle: 'rope', c1: '#b8935a', c2: '#4a3016' }],
  ['Кельтська', { bStyle: 'braid', c1: '#d9b45a', c2: '#2a1f10', ticks: 20 }], ['Лавр', { bStyle: 'leaves', c1: '#7fa04a', c2: '#2b3a18', ticks: 22 }],
  ['Золотий вінок', { bStyle: 'leaves', c1: '#e2b856', c2: '#3a2810', ticks: 22 }], ['Квіти', { bStyle: 'floral', c1: '#5e8f3e', c2: '#1d2a14', c3: '#e66a9a', ticks: 21 }],
  ['Терен', { bStyle: 'thorns', c1: '#6a4630', c2: '#140c08', ticks: 20 }], ['Дракон', { bStyle: 'scales', c1: '#b8402c', c2: '#2a0d08' }],
  ['Фортеця', { bStyle: 'stone', c1: '#8f8a80', c2: '#34312b', ticks: 16 }], ['Дерево', { bStyle: 'wood', c1: '#9a6a3a', c2: '#2b1a0c', ticks: 12 }],
  ['Механізм', { bStyle: 'gear', c1: '#c9a24a', c2: '#4a3510', ticks: 24 }], ['Крига', { bStyle: 'ice', c1: '#bfe8ff', c2: '#2a5a80', ticks: 22 }],
  ['Пекло', { bStyle: 'flame', c1: '#ff6a1a', c2: '#200803', c3: '#ffd34a', glow: 3, glowColor: '#ff6a1a', ticks: 22 }], ['Компас', { bStyle: 'compass', c1: '#d8c08a', c2: '#3a2a10', c3: '#b8322a' }],
  ['Слиз', { bStyle: 'ooze', c1: '#7cd14a', c2: '#1d3a10', ticks: 22 }], ['Святе', { bStyle: 'double', c1: '#fff1c0', c2: '#b88a2a', glow: 4, glowColor: '#fff1a0' }],
  ['Порожнеча', { bStyle: 'solid', c1: '#2a1240', c2: '#0a0410', glow: 6, glowColor: '#7a3cff' }],
];
export const BG_PRESETS = [
  ['Сутінки', { bgType: 'radial', bg1: '#3d4250', bg2: '#121318' }], ['Пергамент', { bgType: 'texture', tex: 'parchment', bg1: '#c9b07a', bg2: '#5a3d1a' }],
  ['Бруківка', { bgType: 'texture', tex: 'stone', bg1: '#6b6458', bg2: '#2e2a25' }], ['Дерево', { bgType: 'texture', tex: 'wood', bg1: '#7a5230', bg2: '#2b1a0c' }],
  ['Гекси', { bgType: 'texture', tex: 'hexgrid', bg1: '#2f5d50', bg2: '#0d1f1a' }], ['Зорі', { bgType: 'texture', tex: 'stars', bg1: '#6a4cff', bg2: '#0b0a1a' }],
  ['Магія', { bgType: 'texture', tex: 'arcane', bg1: '#b77aff', bg2: '#1a0b2e' }], ['Кров', { bgType: 'radial', bg1: '#8a1d1d', bg2: '#1a0505' }],
  ['Розмитий арт', { bgType: 'blur' }], ['Без тла', { bgType: 'none' }],
  ['Туман', { bgType: 'texture', tex: 'fog', bg1: '#8a96a3', bg2: '#1c2128' }], ['Мармур', { bgType: 'texture', tex: 'marble', bg1: '#e9e4da', bg2: '#6e6658' }],
  ['Лава', { bgType: 'texture', tex: 'lava', bg1: '#ff7a1a', bg2: '#2a0a04' }], ['Вода', { bgType: 'texture', tex: 'water', bg1: '#4fb4d8', bg2: '#0b2a40' }],
  ['Трава', { bgType: 'texture', tex: 'grass', bg1: '#7cbf4a', bg2: '#1f3a14' }], ['Пісок', { bgType: 'texture', tex: 'sand', bg1: '#e2c48a', bg2: '#8a6a3a' }],
  ['Сніг', { bgType: 'texture', tex: 'snow', bg1: '#b9d6ee', bg2: '#5f7f9a' }], ['Шкіра', { bgType: 'texture', tex: 'leather', bg1: '#8a5a3a', bg2: '#2a160a' }],
  ['Підземелля', { bgType: 'texture', tex: 'tiles', bg1: '#6a655d', bg2: '#1e1c1a' }], ['Отрута', { bgType: 'radial', bg1: '#6fe05a', bg2: '#0a2a08' }],
  ['Сонце', { bgType: 'radial', bg1: '#ffe08a', bg2: '#a0521a' }], ['Безодня', { bgType: 'radial', bg1: '#2a4a8a', bg2: '#05070f' }],
  ['Небо', { bgType: 'linear', bg1: '#6fa8ec', bg2: '#e8f4ff' }], ['Ніч', { bgType: 'linear', bg1: '#0b1028', bg2: '#3a2a5a' }],
];
