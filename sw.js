// Service Worker — ShiM
// shift-manager.html は常にネットワークから取得（キャッシュしない）
// アイコン・manifest のみキャッシュ
const CACHE_NAME = 'shim-v8';

const CACHE_ASSETS = [
  './manifest.json',
  './icons/icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── インストール ──────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())   // 即座に有効化
  );
});

// ── アクティベート（旧キャッシュを全削除） ────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())  // 既存タブをすぐ制御下に
  );
});

// ── フェッチ ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google 系は SW を通さず直通
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('google')
  ) return;

  // 外部ドメインも直通
  if (url.origin !== self.location.origin) return;

  // ── shift-manager.html ──
  // cache: 'no-store' = ブラウザ HTTP キャッシュもバイパス、レスポンスも保存しない
  // → CDN の max-age を無視して常に最新バイトを取得
  if (
    url.pathname.endsWith('shift-manager.html') ||
    url.pathname === '/shift-manager/' ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith(
      fetch(new Request(event.request, { cache: 'no-store' }))
        .catch(() => new Response(
          '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>オフライン</title></head>' +
          '<body style="font-family:sans-serif;display:flex;flex-direction:column;' +
          'align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb">' +
          '<p style="font-size:48px;margin:0">📡</p>' +
          '<h2 style="color:#374151;margin:16px 0 8px">オフラインです</h2>' +
          '<p style="color:#6b7280;margin:0">ネットワークに接続してからもう一度お試しください</p>' +
          '</body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ))
    );
    return;
  }

  // ── その他のアセット（アイコン・manifest など）──
  // キャッシュ優先、なければネットワーク取得してキャッシュ
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      });
    })
  );
});

// ── メインスレッドからのメッセージ ───────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
