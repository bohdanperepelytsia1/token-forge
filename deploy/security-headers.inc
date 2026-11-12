# Заголовки безпеки. Збігаються з scripts/headers.mjs — змінюйте обидва місця разом.
# Якщо підключаєте свій проксі (deploy/proxy-worker), додайте його адресу в connect-src.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: data: https://wsrv.nl https://api.allorigins.win https://corsproxy.io; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; manifest-src 'self'" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "same-origin" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), browsing-topics=()" always;
# Увімкніть, коли сайт відкривається лише через HTTPS:
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
