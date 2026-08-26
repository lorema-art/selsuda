/* 서비스워커 - 껍데기(HTML/CSS/JS)만 캐시. 데이터는 항상 실시간으로 받아온다. */
const CACHE = 'selsuda-m-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './config.js', './icon.png', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                          // 앱스크립트 POST는 건드리지 않음
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                // 외부 요청은 그대로
  // 네트워크 우선 - 새 버전이 있으면 바로 반영(재설치 불필요), 오프라인이면 캐시
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
