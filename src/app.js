import { env, mk, clamp, drawToken, drawRing, drawBg, fitToken, fontStr, RING_STYLES, RING_PRESETS, BG_PRESETS, ACCENT_STYLES, COUNT_STYLES, TAU } from './render.js';
import { decodeImage, blobFromUrl, LoadError } from './loader.js';
import { refineCutout } from './refine.js';

const CFG = window.TF_CONFIG || {};
const MAX_SIDE = CFG.maxWorkSide || 2048;
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const rctx = (c) => c.getContext('2d', { willReadFrequently: true });

/* ---------- стан ---------- */
const T = {
  shape: 'circle', bStyle: 'metal', c1: '#e2b856', c2: '#5e3f12', c3: '#c0283a', bw: 6, ticks: 24, bevel: true, innerLine: true, shadow: true, glow: 0, glowColor: '#ffcc66',
  bgType: 'radial', tex: 'parchment', bg1: '#3d4250', bg2: '#121318', vignette: true,
  zoom: 1, rot: 0, flip: false, ox: 0, oy: 0, subjShadow: true, popout: false, popCut: 0.3,
  name: '', nameFont: 'Cormorant SC', nameColor: '#f3e6c4', bannerColor: '#2b1d10',
  num: '', numPos: 'tr', numColor: '#8e1c1c', size: '512', fmt: 'png',
};
const R = { tool: 'wand', global: false, tol: 18, brush: 36, hard: 70, view: 'checker', ghost: false, quality: 'fast', clean: true, outBg: 'none', outColor: '#ffffff', crop: true };
const STATE = { T, R };

let mode = 'token', original = null, octx = null, work = null, wctx = null, odata = null, bbox = null, cutDone = false, baseFile = 'token';
const hist = [], redoS = [];
let maxHist = 12;

/* ---------- UI ---------- */
const FMT = { 'T.zoom': (v) => (+v).toFixed(2) + '×', 'T.rot': (v) => v + '°', 'T.popCut': (v) => Math.round(v * 100) + '%', 'T.bw': (v) => (+v).toFixed(1), 'T.glow': (v) => (+v).toFixed(1), 'R.brush': (v) => v + ' px' };
function setEl(el, v) {
  if (el.type === 'checkbox') el.checked = !!v; else if (document.activeElement !== el || el.type === 'range') el.value = v;
  const o = el.parentElement && el.parentElement.querySelector('output');
  if (o && el.type === 'range') { const f = FMT[el.dataset.k]; o.textContent = f ? f(v) : v; }
}
function syncUI() {
  $$('[data-k]').forEach((el) => { const [o, k] = el.dataset.k.split('.'); setEl(el, STATE[o][k]); });
  $$('[data-set]').forEach((g) => { const [o, k] = g.dataset.set.split('.'); g.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === String(STATE[o][k]))); });
  $('#ticksRow').hidden = !COUNT_STYLES.has(T.bStyle);
  $('#accentRow').hidden = !ACCENT_STYLES.has(T.bStyle);
  $('#glowColRow').hidden = !(T.glow > 0);
  $('#popRow').hidden = !T.popout;
  $('#bgColors').hidden = ['none', 'blur', 'image'].includes(T.bgType);
  $$('.thumb[data-ring]').forEach((b) => { const p = RING_PRESETS[+b.dataset.ring][1]; b.classList.toggle('on', p.bStyle === T.bStyle && p.c1 === T.c1 && p.c2 === T.c2); });
  $$('.thumb[data-bg]').forEach((b) => b.classList.toggle('on', bgMatches(BG_PRESETS[+b.dataset.bg][1])));
  $$('#views button').forEach((b) => b.classList.toggle('on', b.dataset.v === R.view));
  const brush = R.tool !== 'wand';
  $('#tolRow').hidden = brush; $('#globalRow').hidden = brush; $('#brushRow').hidden = !brush; $('#hardRow').hidden = !brush;
  $('#outColorRow').hidden = R.outBg !== 'color';
}
function bindInputs() {
  $$('[data-k]').forEach((el) => {
    const [o, k] = el.dataset.k.split('.');
    el.addEventListener('input', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.type === 'number' ? (el.value === '' ? '' : clamp(+el.value, 0, 999)) : el.value;
      STATE[o][k] = v; setEl(el, v);
      if (k === 'popCut') { env.guideUntil = performance.now() + 1500; setTimeout(scheduleRender, 1600); }
      if (k === 'popout' && v && !cutDone) toast('Для цього ефекту спершу приберіть фон персонажа');
      if (k === 'popout') { fitToken(T, 'portrait', bbox); }
      if (k === 'nameFont') document.fonts.load(fontStr(T, 40)).then(scheduleRender);
      syncUI(); scheduleRender();
    });
  });
  $$('[data-set]').forEach((g) => {
    const [o, k] = g.dataset.set.split('.');
    g.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; STATE[o][k] = b.dataset.v; syncUI(); scheduleRender(); });
  });
}
let rafId = 0;
function scheduleRender() { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; refresh(); }); }
function refresh() { if (!work) return; if (mode === 'cut') drawRm(); else renderTk(); }

let toastT = 0;
function toast(msg, ms = 3200, err = false) { const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', err); t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
function busy(text, pct) {
  const b = $('#busy');
  if (text === false) { b.hidden = true; return; }
  b.hidden = false; b.querySelector('span').textContent = text;
  b.classList.toggle('indet', pct == null); b.querySelector('i').style.width = pct == null ? '' : Math.round(pct * 100) + '%';
}
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
function aiHint(text, cls = '') { for (const id of ['#aiHint', '#aiHint2']) { $(id).textContent = text; $(id).className = 'hint ' + cls; } }

/* ---------- завантаження ---------- */
function showStart(on) { $('#start').hidden = !on; $('#startClose').hidden = !work; if (on) setTimeout(() => $('#urlInput').focus(), 50); }
async function openBlob(blob, name) {
  busy('Відкриваю зображення…');
  try {
    const bmp = await decodeImage(blob, MAX_SIDE);
    setSource(bmp, name);
    bmp.close && bmp.close();
  } catch (e) {
    toast(e instanceof LoadError ? e.message : 'Не вдалося відкрити зображення.', 6000, true);
  } finally { busy(false); }
}
function cleanName(s) { return String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^\p{L}\p{N}_ -]+/gu, ' ').trim().replace(/\s+/g, '_').slice(0, 40) || 'token'; }
function setSource(img, name) {
  let w = img.width, h = img.height; const s = Math.min(1, MAX_SIDE / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
  original = mk(w, h); octx = rctx(original); octx.imageSmoothingQuality = 'high'; octx.drawImage(img, 0, 0, w, h);
  work = mk(w, h); wctx = rctx(work); wctx.drawImage(original, 0, 0);
  env.work = work; env.original = original;
  odata = null; hist.length = 0; redoS.length = 0; cutDone = false; baseFile = cleanName(name);
  maxHist = clamp(Math.floor(300e6 / (w * h * 4)), 3, 14);
  updateBBox(); fitToken(T, 'portrait', bbox);
  $('#app').classList.remove('empty'); $('#topActions').hidden = false; $('#tabs').hidden = false; showStart(false);
  setMode(mode); buildBgThumbs(false);
  aiHint('Фон можна прибрати одним кліком, а потім підправити краї.');
  syncUI(); warmup();
}

/* ---------- службові ---------- */
function getOD() { if (!odata) odata = octx.getImageData(0, 0, original.width, original.height).data; return odata; }
function updateBBox() {
  const w = work.width, h = work.height, d = wctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) { const row = y * w * 4; for (let x = 0; x < w; x++) { if (d[row + x * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } } }
  bbox = x1 < 0 ? { x: 0, y: 0, w, h } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function snap() { return { data: wctx.getImageData(0, 0, work.width, work.height), cut: cutDone }; }
function pushHist() { hist.push(snap()); while (hist.length > maxHist) hist.shift(); redoS.length = 0; }
function applySnap(s) { wctx.putImageData(s.data, 0, 0); cutDone = s.cut; }
function undo() { const s = hist.pop(); if (!s) return toast('Скасовувати більше нічого'); redoS.push(snap()); applySnap(s); afterEdit(); }
function redo() { const s = redoS.pop(); if (!s) return; hist.push(snap()); applySnap(s); afterEdit(); }
function afterEdit() { updateBBox(); refresh(); }

/* ---------- режими ---------- */
const TOOL_HINT = { wand: 'Клацніть по фону, щоб прибрати область схожого кольору', erase: 'Проведіть по зайвому, щоб стерти · колесо міняє розмір пензля', restore: 'Проведіть, щоб повернути стерте · колесо міняє розмір пензля' };
function setMode(m) {
  mode = m;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#tokenPanel').hidden = m !== 'token'; $('#cutPanel').hidden = m !== 'cut';
  $('#tkC').hidden = m !== 'token'; $('#viewBar').hidden = m !== 'token';
  $('#rmC').hidden = m !== 'cut'; $('#editHead').hidden = m !== 'cut';
  $('#saveTop').textContent = m === 'cut' ? 'Зберегти PNG' : 'Зберегти токен';
  $('#editHint').textContent = TOOL_HINT[R.tool];
  syncUI(); refresh();
}

/* ---------- екран прибирання фону ---------- */
let rmV = { s: 1, ox: 0, oy: 0 }, cursor = null, painting = false, lastP = null, checker = null;
function drawRm() {
  const c = $('#rmC'), st = $('#stage'), W = st.clientWidth, H = st.clientHeight, dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
  const x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!work) return;
  const pt = 60, pad = 24, s = Math.min((W - pad * 2) / work.width, (H - pt - pad) / work.height), dw = work.width * s, dh = work.height * s, ox = (W - dw) / 2, oy = pt + (H - pt - pad - dh) / 2;
  rmV = { s, ox, oy };
  if (R.view === 'checker') {
    if (!checker) { const p = mk(16, 16), px = p.getContext('2d'); px.fillStyle = '#3d424c'; px.fillRect(0, 0, 16, 16); px.fillStyle = '#2b2f37'; px.fillRect(0, 0, 8, 8); px.fillRect(8, 8, 8, 8); checker = p; }
    x.fillStyle = x.createPattern(checker, 'repeat');
  } else x.fillStyle = R.view;
  x.fillRect(ox, oy, dw, dh); x.imageSmoothingQuality = 'high';
  if (R.ghost) { x.globalAlpha = 0.25; x.drawImage(original, ox, oy, dw, dh); x.globalAlpha = 1; }
  x.drawImage(work, ox, oy, dw, dh);
  if (cursor && R.tool !== 'wand') { x.beginPath(); x.arc(cursor.x, cursor.y, R.brush / 2, 0, TAU); x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.7)'; x.stroke(); x.lineWidth = 1.4; x.strokeStyle = R.tool === 'erase' ? '#ff9a85' : '#9be3a6'; x.stroke(); }
  c.style.cursor = R.tool === 'wand' ? 'crosshair' : 'none';
}
function toImg(e) { const r = $('#rmC').getBoundingClientRect(), lx = e.clientX - r.left, ly = e.clientY - r.top; return { lx, ly, x: (lx - rmV.ox) / rmV.s, y: (ly - rmV.oy) / rmV.s }; }
function dab(p) {
  const r = Math.max(0.5, R.brush / 2 / rmV.s), inner = r * clamp(R.hard / 100, 0, 0.98);
  if (R.tool === 'erase') {
    wctx.save(); wctx.globalCompositeOperation = 'destination-out';
    const g = wctx.createRadialGradient(p.x, p.y, inner, p.x, p.y, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    wctx.fillStyle = g; wctx.beginPath(); wctx.arc(p.x, p.y, r, 0, TAU); wctx.fill(); wctx.restore();
  } else {
    const d = Math.ceil(r * 2) + 2, t = mk(d, d), tx = t.getContext('2d'), sx = p.x - d / 2, sy = p.y - d / 2;
    tx.drawImage(original, -sx, -sy); tx.globalCompositeOperation = 'destination-in';
    const g = tx.createRadialGradient(d / 2, d / 2, inner, d / 2, d / 2, r); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    tx.fillStyle = g; tx.beginPath(); tx.arc(d / 2, d / 2, r, 0, TAU); tx.fill(); wctx.drawImage(t, sx, sy);
  }
}
function flood(seeds, col, tolSq) {
  const w = work.width, h = work.height, od = getOD(), img = wctx.getImageData(0, 0, w, h), wd = img.data, seen = new Uint8Array(w * h), st = new Int32Array(w * h); let sp = 0;
  for (const k of seeds) if (!seen[k]) { seen[k] = 1; st[sp++] = k; }
  const [cr, cg, cb] = col;
  while (sp) {
    const k = st[--sp], i = k * 4;
    if (wd[i + 3] >= 10) { const dr = od[i] - cr, dg = od[i + 1] - cg, db = od[i + 2] - cb; if (dr * dr + dg * dg + db * db > tolSq) continue; }
    wd[i + 3] = 0; const x = k % w;
    if (x > 0 && !seen[k - 1]) { seen[k - 1] = 1; st[sp++] = k - 1; }
    if (x < w - 1 && !seen[k + 1]) { seen[k + 1] = 1; st[sp++] = k + 1; }
    if (k >= w && !seen[k - w]) { seen[k - w] = 1; st[sp++] = k - w; }
    if (k < w * (h - 1) && !seen[k + w]) { seen[k + w] = 1; st[sp++] = k + w; }
  }
  softEdge(wd, od, col, tolSq, w, h); wctx.putImageData(img, 0, 0);
}
function softEdge(wd, od, col, tolSq, w, h) {
  const lim = tolSq * 2.6, out = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4; if (wd[i + 3] < 10) continue;
    if (wd[i - 1] >= 10 && wd[i + 7] >= 10 && wd[i - w * 4 + 3] >= 10 && wd[i + w * 4 + 3] >= 10) continue;
    const dr = od[i] - col[0], dg = od[i + 1] - col[1], db = od[i + 2] - col[2], d = dr * dr + dg * dg + db * db;
    if (d < lim) out.push(i, Math.round(wd[i + 3] * clamp((d - tolSq) / (lim - tolSq), 0.25, 1)));
  }
  for (let j = 0; j < out.length; j += 2) wd[out[j] + 3] = out[j + 1];
}
const tolSq = () => { const t = R.tol / 100 * 441; return t * t; };
function wand(px, py) {
  const w = work.width, od = getOD(), i = (py * w + px) * 4, col = [od[i], od[i + 1], od[i + 2]];
  if (R.global) { const img = wctx.getImageData(0, 0, w, work.height), wd = img.data, ts = tolSq(); for (let j = 0; j < wd.length; j += 4) { const dr = od[j] - col[0], dg = od[j + 1] - col[1], db = od[j + 2] - col[2]; if (dr * dr + dg * dg + db * db <= ts) wd[j + 3] = 0; } softEdge(wd, od, col, ts, w, work.height); wctx.putImageData(img, 0, 0); }
  else flood([py * w + px], col, tolSq());
}
function autoRemove() {
  const w = work.width, h = work.height, od = getOD(), idx = [];
  for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) idx.push(y * w, y * w + w - 1);
  const ch = [[], [], []]; idx.forEach((k) => { for (let c = 0; c < 3; c++) ch[c].push(od[k * 4 + c]); });
  const med = ch.map((a) => a.sort((p, q) => p - q)[a.length >> 1]), t = Math.max(R.tol, 14) / 100 * 441, ts = t * t;
  const seeds = idx.filter((k) => { const i = k * 4, dr = od[i] - med[0], dg = od[i + 1] - med[1], db = od[i + 2] - med[2]; return dr * dr + dg * dg + db * db <= ts; });
  if (seeds.length < idx.length * 0.25) toast('Фон не однотонний: тут краще впорається «Прибрати фон»', 4500);
  pushHist(); flood(seeds, med, ts); cutDone = true; afterEdit();
}
function alphaOp(fn) {
  pushHist(); const w = work.width, h = work.height, img = wctx.getImageData(0, 0, w, h), d = img.data, a = new Uint8ClampedArray(w * h);
  for (let k = 0; k < w * h; k++) a[k] = d[k * 4 + 3]; const r = fn(a, w, h); for (let k = 0; k < w * h; k++) d[k * 4 + 3] = r[k];
  wctx.putImageData(img, 0, 0); afterEdit();
}
function minPass(a, w, h) {
  const t = new Uint8ClampedArray(a.length), o = new Uint8ClampedArray(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; t[k] = Math.min(a[k], x > 0 ? a[k - 1] : 0, x < w - 1 ? a[k + 1] : 0); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; o[k] = Math.min(t[k], y > 0 ? t[k - w] : 0, y < h - 1 ? t[k + w] : 0); }
  return o;
}
function blurPass(a, w, h, r) {
  const t = new Float32Array(a.length), o = new Uint8ClampedArray(a.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * w + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { t[y * w + x] = s / n; s += a[y * w + clamp(x + r + 1, 0, w - 1)] - a[y * w + clamp(x - r, 0, w - 1)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = Math.min(a[y * w + x], s / n); s += t[clamp(y + r + 1, 0, h - 1) * w + x] - t[clamp(y - r, 0, h - 1) * w + x]; } }
  return o;
}

/* ---------- AI ---------- */
let libP = null, gpu = null, forceCPU = false, warm = null, aiRunning = false, warmPct = 0;
const lib = () => libP || (libP = import('@imgly/background-removal'));
async function hasGPU() {
  // Вбудовані моделі (з npm) не сумісні з WebGPU, тому відеокарта вмикається лише з моделями з CDN (див. config.js).
  if (forceCPU || CFG.aiDevice !== 'gpu') return false; if (gpu !== null) return gpu;
  try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { gpu = false; }
  return gpu;
}
async function aiCfg(progress) {
  const g = await hasGPU();
  return {
    publicPath: CFG.modelPath || new URL('models/', location.href).href,
    device: g ? 'gpu' : 'cpu', proxyToWorker: g,
    model: g || R.quality === 'best' ? 'isnet_fp16' : 'isnet_quint8',
    output: { format: 'image/x-rgba8' }, progress,
  };
}
function onWarm(key, cur, total) {
  if (!total || !/fetch/.test(key)) return; warmPct = cur / total;
  if (aiRunning) busy('Завантажую AI-модель (лише перший раз)…', warmPct); else aiHint('Готую AI-модель: ' + Math.round(warmPct * 100) + '%');
}
function warmup() {
  if (warm) return warm;
  warm = (async () => { const L = await lib(); await L.preload(await aiCfg(onWarm)); })();
  warm.then(() => { if (!aiRunning && !cutDone) aiHint('AI готовий: фон прибирається за кілька секунд.', 'ok'); }).catch((e) => { console.warn(e); warm = null; });
  return warm;
}
async function runAI() {
  if (!work || aiRunning) return;
  aiRunning = true; $('#aiBtn').disabled = $('#aiBtn2').disabled = true;
  const t0 = performance.now();
  try {
    busy('Готую AI…'); await frame();
    try { await warmup(); } catch { /* спробуємо ще раз нижче */ }
    const L = await lib();
    const w = original.width, h = original.height, s = Math.min(1, 1024 / Math.max(w, h)), sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
    const small = mk(sw, sh), sx = rctx(small); sx.imageSmoothingQuality = 'high'; sx.drawImage(original, 0, 0, sw, sh);
    const input = new Blob([sx.getImageData(0, 0, sw, sh).data], { type: `image/x-rgba8;width=${sw};height=${sh}` });
    busy((await hasGPU()) ? 'Прибираю фон на відеокарті…' : 'Прибираю фон…'); await frame();
    const tInf = performance.now();
    const out = await L.segmentForeground(input, await aiCfg(onWarm));
    busy('Доводжу краї…'); await frame();
    const buf = new Uint8ClampedArray(await out.arrayBuffer());
    const m = mk(sw, sh); m.getContext('2d').putImageData(new ImageData(buf, sw, sh), 0, 0);
    const up = mk(w, h), ux = rctx(up); ux.imageSmoothingQuality = 'high'; ux.drawImage(m, 0, 0, w, h);
    const rgba = refineCutout(getOD(), w, h, up, { clean: R.clean });
    pushHist(); wctx.putImageData(new ImageData(rgba, w, h), 0, 0); cutDone = true;
    updateBBox(); if (mode === 'token') fitToken(T, 'portrait', bbox); syncUI(); refresh();
    console.info('AI: inference', Math.round(performance.now() - tInf), 'ms, total', Math.round(performance.now() - t0), 'ms');
    aiHint(`Фон прибрано за ${((performance.now() - t0) / 1000).toFixed(1)} с. Якщо десь лишились шматки — підправте вручну.`, 'ok');
  } catch (err) {
    console.error(err);
    aiHint('AI не спрацював. Перевірте, що сайт відкрито з сервера (не як файл), і спробуйте ще раз. Можна скористатися ручними інструментами.', 'err');
  } finally { busy(false); aiRunning = false; $('#aiBtn').disabled = $('#aiBtn2').disabled = false; }
}

/* ---------- прев'ю токена ---------- */
let tkSize = 400;
function renderTk() {
  const c = $('#tkC'), st = $('#stage'), size = Math.round(Math.max(220, Math.min(700, Math.min(st.clientWidth - 40, st.clientHeight - 110)))), dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(size * dpr)) { c.width = c.height = Math.round(size * dpr); c.style.width = c.style.height = size + 'px'; }
  tkSize = size; const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); drawToken(x, c.width, T, { preview: true });
}

/* ---------- мініатюри ---------- */
function bgMatches(s) { if (s.bgType !== T.bgType) return false; if (s.bgType === 'blur' || s.bgType === 'none') return true; return s.bg1 === T.bg1 && s.bg2 === T.bg2 && (s.tex || T.tex) === T.tex; }
function thumbCanvas(draw) { const S = 112, c = mk(S, S), x = c.getContext('2d'); x.save(); x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, TAU); x.clip(); draw(x, S); x.restore(); return c; }
function thumbBtn(name, attr, i, canvas, onClick) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.title = name; b.dataset[attr] = i;
  const label = document.createElement('span'); label.textContent = name;
  b.append(canvas, label); b.addEventListener('click', onClick); return b;
}
const VISIBLE = 10;
function buildRingThumbs(all) {
  const boxes = [$('#ringPresets'), $('#ringPresetsMore')];
  boxes.forEach((b, j) => { if (j === 0 || all) b.textContent = ''; });
  RING_PRESETS.forEach(([name, p], i) => {
    if (i >= VISIBLE && !all) return;
    const P = { ...T, glow: 0, ticks: 24, ...p, shape: 'circle', bw: 16, bevel: true };
    const c = thumbCanvas((x, S) => { x.fillStyle = '#14161b'; x.fillRect(0, 0, S, S); drawRing(x, S, S / 2, S / 2, S * 0.17, P); });
    boxes[i < VISIBLE ? 0 : 1].append(thumbBtn(name, 'ring', i, c, () => { Object.assign(T, { glow: 0, ticks: 24 }, p); syncUI(); scheduleRender(); }));
  });
  syncUI();
}
function buildBgThumbs(all) {
  const boxes = [$('#bgPresets'), $('#bgPresetsMore')];
  boxes.forEach((b, j) => { if (j === 0 || all) b.textContent = ''; });
  BG_PRESETS.forEach(([name, p], i) => {
    if (i >= VISIBLE && !all) return;
    const P = { ...T, ...p };
    const c = thumbCanvas((x, S) => {
      if (p.bgType === 'none') { x.fillStyle = '#2a2f38'; x.fillRect(0, 0, S, S); x.fillStyle = '#3a404b'; for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) if ((a + b) % 2) x.fillRect(a * S / 8, b * S / 8, S / 8, S / 8); }
      else drawBg(x, S, S / 2, S / 2, P);
    });
    boxes[i < VISIBLE ? 0 : 1].append(thumbBtn(name, 'bg', i, c, () => { Object.assign(T, p); syncUI(); scheduleRender(); }));
  });
  syncUI();
}
function lazyMore(detailsSel, total, label, build) {
  const d = $(detailsSel); d.querySelector('summary').textContent = `Ще ${total - VISIBLE} ${label}`;
  let done = false; d.addEventListener('toggle', () => { if (d.open && !done) { done = true; build(true); } });
}

/* ---------- збереження ---------- */
function toBlob(c, fmt) { return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/' + fmt, 0.95)); }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); toast('Збережено: ' + name);
}
const fileBase = () => (T.name ? cleanName(T.name) : baseFile);
function tokenCanvas(o) { const S = +T.size, c = mk(S, S); drawToken(c.getContext('2d'), S, T, o || {}); return c; }
async function saveToken() { if (work) download(await toBlob(tokenCanvas(), T.fmt), `${fileBase()}.${T.fmt}`); }
async function saveCut() {
  if (!work) return; updateBBox();
  const p = 4, b = R.crop ? { x: Math.max(0, bbox.x - p), y: Math.max(0, bbox.y - p), x2: Math.min(work.width, bbox.x + bbox.w + p), y2: Math.min(work.height, bbox.y + bbox.h + p) } : { x: 0, y: 0, x2: work.width, y2: work.height };
  const c = mk(b.x2 - b.x, b.y2 - b.y), x = c.getContext('2d');
  if (R.outBg !== 'none') { x.fillStyle = R.outBg === 'white' ? '#ffffff' : R.outColor; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(work, -b.x, -b.y);
  download(await toBlob(c, 'png'), `${baseFile}_bez-fonu.png`);
}
async function saveBatch() {
  if (!work) return; const n = clamp(+$('#batchN').value || 1, 1, 60), st = clamp(+$('#batchStart').value || 0, 0, 999);
  try {
    busy('Збираю пакет…', 0); const { default: JSZip } = await import('jszip'); const zip = new JSZip(), b = fileBase();
    for (let i = 0; i < n; i++) { zip.file(`${b}_${st + i}.${T.fmt}`, await toBlob(tokenCanvas({ num: st + i }), T.fmt)); busy('Збираю пакет…', (i + 1) / n); }
    download(await zip.generateAsync({ type: 'blob' }), `${b}_x${n}.zip`);
  } catch (e) { console.error(e); toast('Не вдалося зібрати архів.', 5000, true); } finally { busy(false); }
}

/* ---------- демо ---------- */
function demo() {
  const w = 800, h = 1000, c = mk(w, h), x = c.getContext('2d');
  x.fillStyle = '#86b8d8'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#6b4a2a'; x.lineWidth = 20; x.lineCap = 'round'; x.beginPath(); x.moveTo(610, 150); x.lineTo(570, 960); x.stroke();
  const og = x.createRadialGradient(612, 128, 4, 612, 128, 60); og.addColorStop(0, '#eaffff'); og.addColorStop(0.35, '#5ee0ff'); og.addColorStop(1, 'rgba(94,224,255,0)'); x.fillStyle = og; x.beginPath(); x.arc(612, 128, 60, 0, TAU); x.fill();
  x.fillStyle = '#3b2a4d'; x.beginPath(); x.moveTo(400, 190); x.bezierCurveTo(560, 230, 590, 600, 660, 950); x.lineTo(140, 950); x.bezierCurveTo(210, 600, 240, 230, 400, 190); x.fill();
  x.fillStyle = '#4b3762'; x.beginPath(); x.moveTo(400, 330); x.lineTo(470, 950); x.lineTo(330, 950); x.closePath(); x.fill();
  x.fillStyle = '#c9a24a'; x.fillRect(268, 575, 264, 26);
  x.fillStyle = '#2a1d38'; x.beginPath(); x.ellipse(400, 265, 125, 145, 0, 0, TAU); x.fill();
  x.fillStyle = '#d9b38c'; x.beginPath(); x.ellipse(400, 295, 62, 80, 0, 0, TAU); x.fill();
  x.fillStyle = '#160f1d'; x.beginPath(); x.ellipse(400, 238, 84, 52, 0, Math.PI, 0); x.fill();
  x.fillStyle = '#5ee0ff'; [372, 428].forEach((ex) => { x.beginPath(); x.arc(ex, 292, 7, 0, TAU); x.fill(); });
  x.fillStyle = '#e8e2d6'; x.beginPath(); x.moveTo(350, 340); x.quadraticCurveTo(400, 470, 450, 340); x.quadraticCurveTo(400, 380, 350, 340); x.fill();
  x.fillStyle = '#d9b38c'; x.beginPath(); x.arc(585, 520, 26, 0, TAU); x.fill();
  setSource(c, 'demo');
}

/* ---------- події ---------- */
function bindEvents() {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('#newBtn').onclick = () => showStart(true);
  $('#startClose').onclick = () => showStart(false);
  $('#demoBtn').onclick = demo;
  $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openBlob(f, f.name); e.target.value = ''; });
  $('#bgFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { env.bgImg = await decodeImage(f, 1024); T.bgType = 'image'; syncUI(); scheduleRender(); } catch (err) { toast(err instanceof LoadError ? err.message : 'Не вдалося відкрити картинку', 5000, true); }
  });
  $('#urlForm').addEventListener('submit', (e) => { e.preventDefault(); fromUrl($('#urlInput').value); });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    const dt = e.dataTransfer, f = dt.files && dt.files[0];
    if (f) return openBlob(f, f.name);
    const html = dt.getData('text/html'), m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    const url = (m && m[1].replace(/&amp;/g, '&')) || dt.getData('text/uri-list').split('\n').find((l) => l && !l.startsWith('#')) || dt.getData('text/plain');
    if (url) fromUrl(url);
  });
  window.addEventListener('paste', (e) => {
    const cd = e.clipboardData; if (!cd) return;
    const it = [...cd.items].find((i) => i.type.startsWith('image/'));
    if (it) { e.preventDefault(); return openBlob(it.getAsFile(), 'paste'); }
    if (e.target.matches && e.target.matches('input:not(#urlInput),textarea')) return;
    const txt = cd.getData('text/plain').trim();
    if (/^https?:\/\/\S+$/i.test(txt)) { e.preventDefault(); fromUrl(txt); }
  });

  $('#aiBtn').onclick = runAI; $('#aiBtn2').onclick = runAI;
  $('#editBtn').onclick = () => setMode('cut');
  $('#toToken').onclick = () => { fitToken(T, 'portrait', bbox); setMode('token'); };
  $('#tools').addEventListener('click', (e) => { const b = e.target.closest('[data-tool]'); if (!b) return; R.tool = b.dataset.tool; $$('#tools button').forEach((c) => c.classList.toggle('on', c === b)); $('#editHint').textContent = TOOL_HINT[R.tool]; syncUI(); drawRm(); });
  $('#views').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; R.view = b.dataset.v; syncUI(); drawRm(); });
  $('#autoBtn').onclick = autoRemove;
  $('#erodeBtn').onclick = () => alphaOp(minPass);
  $('#featherBtn').onclick = () => alphaOp((a, w, h) => blurPass(a, w, h, Math.max(1, Math.round(Math.max(w, h) / 700))));
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo;
  $('#resetBtn').onclick = () => { pushHist(); wctx.clearRect(0, 0, work.width, work.height); wctx.drawImage(original, 0, 0); cutDone = false; afterEdit(); };
  $('#saveCut').onclick = saveCut;
  $('#saveToken').onclick = saveToken;
  $('#saveTop').onclick = () => (mode === 'cut' ? saveCut() : saveToken());
  $('#saveSubject').onclick = async () => { if (work) download(await toBlob(tokenCanvas({ subjectOnly: true }), 'png'), `${fileBase()}_subject.png`); };
  $('#saveBatch').onclick = saveBatch;
  $('#fitFull').onclick = () => { fitToken(T, 'full', bbox); syncUI(); scheduleRender(); };
  $('#fitPortrait').onclick = () => { fitToken(T, 'portrait', bbox); syncUI(); scheduleRender(); };
  $('#flipBtn').onclick = () => { T.flip = !T.flip; T.ox = -T.ox; scheduleRender(); };

  const rmC = $('#rmC');
  rmC.addEventListener('pointerdown', (e) => {
    if (!work || e.button > 0) return; const p = toImg(e);
    if (R.tool === 'wand') { if (p.x < 0 || p.y < 0 || p.x >= work.width || p.y >= work.height) return; pushHist(); wand(p.x | 0, p.y | 0); cutDone = true; afterEdit(); return; }
    rmC.setPointerCapture(e.pointerId); pushHist(); painting = true; lastP = p; dab(p); drawRm();
  });
  rmC.addEventListener('pointermove', (e) => {
    if (!work) return; const p = toImg(e); cursor = { x: p.lx, y: p.ly };
    if (painting) { const r = R.brush / 2 / rmV.s, d = Math.hypot(p.x - lastP.x, p.y - lastP.y), n = Math.max(1, Math.ceil(d / Math.max(1, r * 0.3))); for (let i = 1; i <= n; i++) dab({ x: lastP.x + (p.x - lastP.x) * i / n, y: lastP.y + (p.y - lastP.y) * i / n }); lastP = p; }
    drawRm();
  });
  const endPaint = () => { if (painting) { painting = false; cutDone = true; afterEdit(); } };
  rmC.addEventListener('pointerup', endPaint); rmC.addEventListener('pointercancel', endPaint);
  rmC.addEventListener('pointerleave', () => { cursor = null; if (!painting) drawRm(); });
  rmC.addEventListener('wheel', (e) => { if (R.tool === 'wand') return; e.preventDefault(); R.brush = clamp(Math.round(R.brush * (e.deltaY < 0 ? 1.12 : 1 / 1.12)), 4, 160); syncUI(); drawRm(); }, { passive: false });

  const tkC = $('#tkC'); let drag = null;
  tkC.addEventListener('pointerdown', (e) => { if (!work) return; tkC.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY }; });
  tkC.addEventListener('pointermove', (e) => { if (!drag) return; T.ox += (e.clientX - drag.x) / tkSize; T.oy += (e.clientY - drag.y) / tkSize; drag = { x: e.clientX, y: e.clientY }; scheduleRender(); });
  const endDrag = () => { drag = null; }; tkC.addEventListener('pointerup', endDrag); tkC.addEventListener('pointercancel', endDrag);
  tkC.addEventListener('pointerenter', () => { env.hover = true; scheduleRender(); });
  tkC.addEventListener('pointerleave', () => { env.hover = false; scheduleRender(); });
  tkC.addEventListener('wheel', (e) => {
    if (!work) return; e.preventDefault();
    if (e.shiftKey) T.rot = clamp(T.rot + (e.deltaY > 0 ? 3 : -3), -180, 180);
    else { const f = e.deltaY < 0 ? 1.05 : 1 / 1.05, r = tkC.getBoundingClientRect(), mx = (e.clientX - r.left) / r.width - 0.5, my = (e.clientY - r.top) / r.height - 0.5, nz = clamp(T.zoom * f, 0.15, 4), ff = nz / T.zoom; T.ox = mx + (T.ox - mx) * ff; T.oy = my + (T.oy - my) * ff; T.zoom = nz; }
    syncUI(); scheduleRender();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); }
    if (k === 'escape' && !$('#start').hidden && work) showStart(false);
  });
  window.addEventListener('resize', scheduleRender);
}
async function fromUrl(raw) {
  let name = 'image';
  try { name = decodeURIComponent(new URL(/^https?:/i.test(raw.trim()) ? raw.trim() : 'https://' + raw.trim()).pathname.split('/').pop() || 'image'); } catch { /* ім'я не критичне */ }
  try { const blob = await blobFromUrl(raw, (t) => busy(t)); $('#urlInput').value = ''; await openBlob(blob, name); }
  catch (e) { toast(e instanceof LoadError ? e.message : 'Не вдалося завантажити за посиланням.', 9000, true); }
  finally { busy(false); }
}

/* ---------- старт ---------- */
$('#styleSel').append(...RING_STYLES.map(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; return o; }));
bindInputs(); bindEvents();
buildRingThumbs(false); buildBgThumbs(false);
lazyMore('#ringMore', RING_PRESETS.length, 'рамок', buildRingThumbs);
lazyMore('#bgMore', BG_PRESETS.length, 'варіантів тла', buildBgThumbs);
syncUI(); setMode('token'); showStart(true);
document.fonts && document.fonts.ready.then(() => { buildRingThumbs(!!$('#ringMore').open); scheduleRender(); });
