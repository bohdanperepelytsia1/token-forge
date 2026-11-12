// Збірка: dist/ — повністю статичний сайт без сторонніх скриптів.
// Код, шрифти, рушій ONNX Runtime і AI-моделі лежать на вашому сервері.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './headers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const nm = path.join(root, 'node_modules');
const CHUNK = 4 * 1024 * 1024; // < 25 МБ ліміту Cloudflare Pages на файл
const hash = (buf) => createHash('sha256').update(buf).digest('hex');

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, 'assets'), { recursive: true });


/* Бібліотека ndarray генерує код через new Function — це вимагало б 'unsafe-eval' у CSP.
   Замінюємо її на маленьку реалізацію без eval (бібліотека @imgly використовує лише get/set/data/shape). */
const NDARRAY_SHIM = `
function __tfNdarray(data, shape, stride, offset) {
  shape = shape || [data.length]; offset = offset | 0;
  const d = shape.length;
  if (!stride) { stride = new Array(d); let s = 1; for (let i = d - 1; i >= 0; i--) { stride[i] = s; s *= shape[i]; } }
  const idx = (a) => { let k = offset; for (let j = 0; j < d; j++) k += stride[j] * a[j]; return k; };
  return { data, shape, stride, offset, dimension: d, size: shape.reduce((a, b) => a * b, 1),
    index: (...a) => idx(a), get: (...a) => data[idx(a)], set: (...a) => (data[idx(a)] = a[d]) };
}`;
const noEval = {
  name: 'no-eval-ndarray',
  setup(b) {
    b.onLoad({ filter: /@imgly[\\/]background-removal[\\/]dist[\\/]index\.mjs$/ }, async (args) => {
      let s = await fs.readFile(args.path, 'utf8');
      if (!/__toESM\(require_ndarray\(\)\)/.test(s)) throw new Error('ndarray patch: шаблон не знайдено — перевірте версію @imgly/background-removal');
      s = s.replace(/__toESM\(require_ndarray\(\)\)/g, '{ default: __tfNdarray }') + NDARRAY_SHIM;
      return { contents: s, loader: 'js', resolveDir: path.dirname(args.path) };
    });
  },
};

/* 1. JavaScript */
const res = await build({
  entryPoints: [path.join(root, 'src/app.js')],
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  target: ['chrome113', 'edge113', 'firefox115', 'safari16.4'],
  outdir: path.join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunks/[name]-[hash]',
  metafile: true,
  legalComments: 'linked',
  logLevel: 'warning',
  plugins: [noEval],
});
const appJs = Object.entries(res.metafile.outputs).find(([, o]) => o.entryPoint)[0];
const appJsRel = path.relative(dist, path.join(root, appJs)).split(path.sep).join('/');

/* 2. CSS + шрифти */
const css = await fs.readFile(path.join(root, 'src/styles.css'));
const fonts = [
  ['alegreya-sans', 'Alegreya Sans', [400, 500, 700]],
  ['cormorant-sc', 'Cormorant SC', [600, 700]],
  ['ruslan-display', 'Ruslan Display', [400]],
  ['philosopher', 'Philosopher', [700]],
  ['marck-script', 'Marck Script', [400]],
];
const RANGES = {
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
};
await fs.mkdir(path.join(dist, 'assets/fonts'), { recursive: true });
let fontCss = '';
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) for (const sub of ['cyrillic', 'latin']) {
    const file = `${pkg}-${sub}-${w}-normal.woff2`;
    const src = path.join(nm, '@fontsource', pkg, 'files', file);
    try { await fs.copyFile(src, path.join(dist, 'assets/fonts', file)); } catch { continue; }
    fontCss += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format("woff2");unicode-range:${RANGES[sub]}}\n`;
  }
}
const cssAll = Buffer.from(fontCss + css.toString());
const cssName = `styles-${hash(cssAll).slice(0, 10)}.css`;
await fs.writeFile(path.join(dist, 'assets', cssName), cssAll);

/* 3. HTML і конфіг */
let html = await fs.readFile(path.join(root, 'src/index.html'), 'utf8');
html = html.replace('%CSS%', `assets/${cssName}`).replace('%APP%', appJsRel);
await fs.writeFile(path.join(dist, 'index.html'), html);
await fs.copyFile(path.join(root, 'src/config.js'), path.join(dist, 'config.js'));
for (const f of await fs.readdir(path.join(root, 'public')).catch(() => [])) {
  await fs.cp(path.join(root, 'public', f), path.join(dist, f), { recursive: true });
}

/* 4. AI: моделі + ONNX Runtime у форматі resources.json бібліотеки @imgly */
const modelsDir = path.join(dist, 'models');
await fs.mkdir(modelsDir, { recursive: true });
const resources = {};
async function addFile(key, buf, mime, prefix) {
  const chunks = [];
  for (let o = 0; o < buf.length; o += CHUNK) {
    const part = buf.subarray(o, Math.min(o + CHUNK, buf.length));
    const name = `${prefix}${hash(part).slice(0, 32)}`;
    await fs.writeFile(path.join(modelsDir, name), part);
    chunks.push({ name, offsets: [o, o + part.length] });
  }
  resources[key] = { chunks, size: buf.length, mime };
}
const ortDist = path.join(nm, 'onnxruntime-web/dist');
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) {
  const mime = f.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
  await addFile(`/onnxruntime-web/${f}`, await fs.readFile(path.join(ortDist, f)), mime, 'r');
}
const dataDir = path.join(nm, '@imgly/background-removal-data/dist');
const dataRes = JSON.parse(await fs.readFile(path.join(dataDir, 'resources.json'), 'utf8'));
const readModel = async (key) => Buffer.concat(await Promise.all(dataRes[key].chunks.map((c) => fs.readFile(path.join(dataDir, c.hash)))));
await addFile('/models/isnet_quint8', await readModel('/models/small'), 'application/octet-stream', 'm');
await addFile('/models/isnet_fp16', await readModel('/models/medium'), 'application/octet-stream', 'm');
await fs.writeFile(path.join(modelsDir, 'resources.json'), JSON.stringify(resources));

/* 5. Заголовки для Cloudflare Pages / Netlify */
const h = securityHeaders();
const block = Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join('\n');
await fs.writeFile(path.join(dist, '_headers'),
  `/*\n${block}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/models/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/models/resources.json\n  Cache-Control: no-cache\n\n/config.js\n  Cache-Control: no-cache\n`);

const size = async (d) => { let s = 0; for (const f of await fs.readdir(d, { withFileTypes: true })) s += f.isDirectory() ? await size(path.join(d, f.name)) : (await fs.stat(path.join(d, f.name))).size; return s; };
console.log(`✔ dist/ готовий: ${(await size(dist) / 1048576).toFixed(1)} МБ`);
