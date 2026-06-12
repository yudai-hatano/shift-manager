const CACHE_NAME = 'shim-v1';
const OFFLINE_ASSETS = [
  './shift-manager.html',
  './icons/icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase や外部リクエストはネットワーク優先（オフライン時はスキップ）
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('google') ||
    url.hostname.includes('gstatic')
  ) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // アプリ本体はキャッシュ優先（オフラインフォールバック）
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).catch(() =>
      caches.match('./shift-manager.html')
    ))
  );
});

// メインスレッドからの通知表示リクエスト
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      icon: icon || './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: tag || 'shim-notification',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    });
  }
});

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
