// Service Worker — ShiM
// Firebase SDK は main スクリプト側で使用。
// SW では native Push API で受信し iOS 16.4+ にも対応。

const CACHE_NAME = 'shim-v6';

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
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート（旧キャッシュ削除） ────────────────────
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
      .then(() => self.clients.claim())
  );
});

// ── フェッチ（HTML はネットワーク優先、その他はキャッシュ優先） ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase / Google の外部リクエストはネットワーク直通
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('google')
  ) return;

  if (url.origin !== self.location.origin) return;

  // shift-manager.html → ネットワーク優先
  if (
    url.pathname.endsWith('shift-manager.html') ||
    url.pathname === '/shift-manager/' ||
    url.pathname.endsWith('/')
  ) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // その他のアセット → キャッシュ優先
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

// ── プッシュ通知受信（iOS 16.4+ / Android 両対応） ──────────
// Firebase SDK を SW に importScripts せず native push event で処理。
// Firebase SDK の onBackgroundMessage は iOS Safari で動作しないケースがある。
// getToken() は main スクリプト側で Firebase SDK を使うため変更不要。
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch (e) { return; }

  // FCM は notification / data / webpush など複数パスでデータを送信
  const n   = payload.notification || {};
  const d   = payload.data         || {};
  const wp  = (payload.webpush && payload.webpush.notification) || {};

  const title = n.title || wp.title || d.title || 'ShiM';
  const body  = n.body  || wp.body  || d.body  || '';
  const icon  = n.icon  || wp.icon  || d.icon  || './icons/icon-192.png';
  const badge = wp.badge || './icons/icon-192.png';
  const link  = (payload.fcmOptions && payload.fcmOptions.link)
             || (payload.webpush && payload.webpush.fcmOptions && payload.webpush.fcmOptions.link)
             || d.url
             || './shift-manager.html';

  console.log('[SW] push received:', title, body);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      vibrate: [200, 100, 200],
      data: { url: link, ...d }
    })
  );
});

// ── メインスレッドからのメッセージ ───────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      icon:   icon || './icons/icon-192.png',
      badge:  './icons/icon-192.png',
      tag:    tag  || 'shim-notif',
      vibrate: [200, 100, 200]
    });
  }
});

// ── 通知クリック ─────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './shift-manager.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.includes('shift-manager'));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
