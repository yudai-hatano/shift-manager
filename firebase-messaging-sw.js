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

// ── オフラインキャッシュ ──────────────────────────────
const CACHE_NAME = 'shim-v2';
const CACHE_ASSETS = [
  './shift-manager.html',
  './manifest.json',
  './icons/icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
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
  ) {
    return; // ブラウザのデフォルト処理に委ねる
  }
  // 同一オリジンのみキャッシュ対応
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() =>
        caches.match('./shift-manager.html')
      );
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

// ── メインスレッドからの通知表示（フォアグラウンド用）────
self.addEventListener('message', event => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag } = event.data;
    console.log('[SW] Showing notification from message:', title);
    self.registration.showNotification(title, {
      body,
      icon: icon || './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag || 'shim-notif',
      vibrate: [200, 100, 200]
    });
  }
});

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
