// Єдине джерело заголовків безпеки. Використовується в serve.mjs і для генерації dist/_headers.
// Якщо ви підключили свій проксі (deploy/proxy-worker), додайте його адресу в EXTRA_CONNECT.
export const EXTRA_CONNECT = (process.env.TF_PROXY_ORIGIN || '').split(/\s+/).filter(Boolean);

export const PUBLIC_PROXIES = [
  'https://wsrv.nl',
  'https://api.allorigins.win',
  'https://corsproxy.io',
];

export function csp() {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' — лише компіляція WebAssembly (рушій нейромережі). blob: — модулі ONNX Runtime, які бібліотека збирає з частин.
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src 'self' blob: data: ${[...PUBLIC_PROXIES, ...EXTRA_CONNECT].join(' ')}`,
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
  ].join('; ');
}

export function securityHeaders() {
  return {
    'Content-Security-Policy': csp(),
    // Ізоляція сторінки: вмикає багатопотоковість WebAssembly → AI на процесорі в рази швидший.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), browsing-topics=()',
  };
}
