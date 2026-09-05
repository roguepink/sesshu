/* 節酒サポート Service Worker
   - ページ(HTML)はネットワーク優先: 更新が確実にユーザーに届く
   - アセットはキャッシュ優先＋裏で更新(stale-while-revalidate) */
const CACHE = 'sesshu-14bc217e36';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './i18n.js',
  './util.js',
  './app.js',
  './tarot-icons.js',
  './tarot.js',
  './advisor.js',
  './manifest.json',
  './manifest-en.json',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  /* addAll()は各ファイルのHTTPキャッシュを再利用しうるため、
     cache:'reload'で1件ずつネットワークから確実に最新を取得する */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(res => c.put(url, res)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then(cached => {
      const fetched = fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
