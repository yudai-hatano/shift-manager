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

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'ShiM';
  const body  = payload.notification?.body  || '';
  const icon  = payload.notification?.icon  || './icons/icon-192.png';
  self.registration.showNotification(title, {
    body,
    icon,
    badge: './icons/icon-192.png',
    vibrate: [200, 100, 200]
  });
});
