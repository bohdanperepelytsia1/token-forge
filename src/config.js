// Налаштування, які можна змінювати вже після збірки (файл копіюється в dist/ як є).
window.TF_CONFIG = Object.freeze({
  // Адреса вашого проксі з deploy/proxy-worker (напр. 'https://img-proxy.example.workers.dev').
  // Порожньо — використовуються публічні сервіси wsrv.nl, allorigins, corsproxy.io.
  // Не забудьте додати адресу проксі в Content-Security-Policy (connect-src).
  proxy: '',
  // Максимальний розмір файлу, який можна відкрити (байти).
  maxFileBytes: 30 * 1024 * 1024,
  // Максимум пікселів у вихідному зображенні (захист від «бомб» на гігапікселі).
  maxSourcePixels: 80e6,
  // AI на відеокарті (WebGPU). Вбудовані моделі працюють лише на процесорі.
  // Щоб увімкнути відеокарту: aiDevice: 'gpu' і modelPath з CDN бібліотеки
  // ('https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/'),
  // а також додати https://staticimgly.com у connect-src заголовка CSP.
  aiDevice: 'cpu',
  modelPath: '',
  // Робоча роздільність: довша сторона в пікселях.
  maxWorkSide: 2048,
});
