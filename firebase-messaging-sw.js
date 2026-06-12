importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCQyitTb9F4POLMR3_1elKu5lEcl7lBiHM",
  authDomain: "shift-manager-de355.firebaseapp.com",
  databaseURL: "https://shift-manager-de355-default-rtdb.firebaseio.com",
  projectId: "shift-manager-de355",
  storageBucket: "shift-manager-de355.firebasestorage.app",
  messagingSenderId: "805065642268",
  appId: "1:805065642268:web:2c1e864629d81e3d34aad9"
});

const messaging = firebase.messaging();

// ── キャッシュ ────────────────────────────────────────────
// バージョンを上げると旧キャッシュが activate 時に自動削除される
const CACHE_NAME = 'shim-v5';

// shift-manager.html はキャッシュしない（常にネットワークから取得）
const CACHE_ASSETS = [
  './manifest.json',
  './icons/icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting()) // 待機せず即座に有効化
  );
});

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
      // clients.claim() 後に controllerchange がクライアントで発火し自動リロードされる
  );
});

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

  // shift-manager.html → ネットワーク優先（最新版を常に返す・失敗時はキャッシュ）
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

// ── FCM バックグラウンドメッセージ ──────────────────────
messaging.onBackgroundMessage(payload => {
  console.log('[SW] Background message received:', payload);
  const title = payload.notification?.title || 'ShiM';
  const body  = payload.notification?.body  || '';
  const icon  = payload.notification?.icon  || './icons/icon-192.png';
  self.registration.showNotification(title, {
    body,
    icon,
    badge: './icons/icon-192.png',
    vibrate: [200, 100, 200],
    data: payload.data || {}
  });
});

// ── メインスレッドからのメッセージ ───────────────────────
self.addEventListener('message', event => {
  // ページ側からの強制バージョンアップ指示
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      icon: icon || './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag || 'shim-notif',
      vibrate: [200, 100, 200]
    });
  }
});
// ─────────────────────────────────────────────────────────

// ── 通知クリック ─────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const existing = cs.find(c => c.url.includes('shift-manager'));
      if (existing) return existing.focus();
      return clients.openWindow('./shift-manager.html');
    })
  );
});
