// Доведення маски після нейромережі:
// 1) керований фільтр (guided filter) «прилипає» краєм маски до справжніх країв зображення;
// 2) очищення кольору країв прибирає відтінок старого фону з напівпрозорих пікселів.

export function boxBlur(src, w, h, r, out, tmp) {
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / n;
      s += src[o + Math.min(x + r + 1, w - 1)] - src[o + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
  return out;
}

/** I — яскравість 0..1, p — маска 0..1. Повертає уточнену маску. */
export function guidedFilter(I, p, w, h, r, eps) {
  const N = w * h, F = Float32Array, tmp = new F(N);
  const mI = boxBlur(I, w, h, r, new F(N), tmp);
  const mP = boxBlur(p, w, h, r, new F(N), tmp);
  const t = new F(N);
  for (let i = 0; i < N; i++) t[i] = I[i] * I[i];
  const cII = boxBlur(t, w, h, r, new F(N), tmp);
  for (let i = 0; i < N; i++) t[i] = I[i] * p[i];
  const cIP = boxBlur(t, w, h, r, new F(N), tmp);
  for (let i = 0; i < N; i++) {
    const a = (cIP[i] - mI[i] * mP[i]) / (cII[i] - mI[i] * mI[i] + eps);
    cII[i] = a;
    cIP[i] = mP[i] - a * mI[i];
  }
  boxBlur(cII, w, h, r, mI, tmp);
  boxBlur(cIP, w, h, r, mP, tmp);
  for (let i = 0; i < N; i++) {
    let q = mI[i] * I[i] + mP[i];
    q = q < 0.03 ? 0 : q > 0.97 ? 1 : q;
    t[i] = q;
  }
  return t;
}

/** rgba змінюється на місці. alpha — 0..1. */
export function decontaminate(rgba, alpha, w, h, r) {
  const N = w * h, F = Float32Array, tmp = new F(N), inv = new F(N);
  for (let i = 0; i < N; i++) inv[i] = 1 - alpha[i];
  const den = boxBlur(inv, w, h, r, new F(N), tmp);
  const num = new F(N), B = new F(N);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < N; i++) num[i] = rgba[i * 4 + c] * inv[i];
    boxBlur(num, w, h, r, B, tmp);
    for (let i = 0; i < N; i++) {
      const a = alpha[i];
      if (a <= 0.02 || a >= 0.98 || den[i] < 1e-3) continue;
      const bg = B[i] / den[i];
      const f = (rgba[i * 4 + c] - (1 - a) * bg) / a;
      rgba[i * 4 + c] = f < 0 ? 0 : f > 255 ? 255 : f;
    }
  }
}

/** Повна обробка: маска малої роздільності → готове RGBA потрібного розміру. */
export function refineCutout(origRGBA, w, h, maskCanvas, { clean = true } = {}) {
  const N = w * h;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const md = mctx.getImageData(0, 0, w, h).data;
  const p = new Float32Array(N), I = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    p[i] = md[i * 4 + 3] / 255;
    I[i] = (origRGBA[i * 4] * 0.299 + origRGBA[i * 4 + 1] * 0.587 + origRGBA[i * 4 + 2] * 0.114) / 255;
  }
  const scale = Math.max(w, h) / 1024;
  const r = Math.max(2, Math.min(10, Math.round(2 * scale) + 1));
  const alpha = guidedFilter(I, p, w, h, r, 2e-3);
  const out = new Uint8ClampedArray(origRGBA);
  if (clean) decontaminate(out, alpha, w, h, r * 3 + 2);
  for (let i = 0; i < N; i++) out[i * 4 + 3] = Math.round(alpha[i] * 255);
  return out;
}
