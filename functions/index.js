'use strict';

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

admin.initializeApp();
const db  = admin.database();
const fcm = admin.messaging();

const ICON_URL  = 'https://yudai-hatano.github.io/shift-manager/icons/icon-192.png';
const CLICK_URL = 'https://yudai-hatano.github.io/shift-manager/shift-manager.html';

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/**
 * 指定ユーザーの通知設定を確認して FCM を送信する
 * @param {string} userId
 * @param {string} settingKey  'friendRequest' | 'notices' | 'shiftReminder'
 * @param {{ title: string, body: string }} notification
 */
async function sendPushToUser(userId, settingKey, notification) {
  try {
    const snap = await db.ref(`users/${userId}`).get();
    const user = snap.val();
    if (!user || !user.fcmToken) {
      functions.logger.info(`[FCM] No token for user ${userId}`);
      return;
    }
    if (user.notificationSettings && user.notificationSettings[settingKey] === false) {
      functions.logger.info(`[FCM] ${settingKey} disabled for user ${userId}`);
      return;
    }
    await fcm.send({
      token: user.fcmToken,
      notification: { ...notification, icon: ICON_URL },
      webpush: {
        notification: { icon: ICON_URL, badge: ICON_URL },
        fcmOptions: { link: CLICK_URL }
      }
    });
    functions.logger.info(`[FCM] ✅ Sent ${settingKey} to ${userId}`);
  } catch (e) {
    functions.logger.error(`[FCM] ❌ Failed ${settingKey} to ${userId}:`, e.message);
  }
}

// ── フレンド申請通知 ──────────────────────────────────────────────────────────
// friends/{recipientId}/incoming/{senderId} が作成されたときに発火
exports.onFriendRequest = functions.database
  .ref('friends/{recipientId}/incoming/{senderId}')
  .onCreate(async (snap, context) => {
    const { recipientId } = context.params;
    const data = snap.val();
    if (!data || data.status !== 'pending') return null;

    const senderName = data.name || 'ユーザー';
    await sendPushToUser(recipientId, 'friendRequest', {
      title: 'フレンド申請',
      body: `${senderName} さんからフレンド申請が届きました`
    });
    return null;
  });

// ── お知らせ通知（全ユーザーへ）─────────────────────────────────────────────
// shift-manager/notices/{noticeId} が作成されたときに発火
exports.onNewNotice = functions.database
  .ref('shift-manager/notices/{noticeId}')
  .onCreate(async (snap) => {
    const notice = snap.val();
    if (!notice) return null;

    const usersSnap = await db.ref('users').get();
    const users = usersSnap.val() || {};

    // 通知有効ユーザーのメッセージを組み立て
    const messages = Object.entries(users)
      .filter(([, u]) => u && u.fcmToken && u.notificationSettings?.notices !== false)
      .map(([, u]) => ({
        token: u.fcmToken,
        notification: {
          title: 'お知らせ',
          body: notice.title || '新しいお知らせがあります',
          icon: ICON_URL
        },
        webpush: {
          notification: { icon: ICON_URL, badge: ICON_URL },
          fcmOptions: { link: CLICK_URL }
        }
      }));

    if (!messages.length) return null;

    // FCM は一度に最大 500 件まで
    for (let i = 0; i < messages.length; i += 500) {
      const result = await fcm.sendEach(messages.slice(i, i + 500));
      functions.logger.info(
        `[FCM] Notice batch: success=${result.successCount} fail=${result.failureCount}`
      );
    }
    return null;
  });

// ── 翌日シフトリマインダー（毎日 19:55 JST）──────────────────────────────────
// Cloud Scheduler が毎日 10:55 UTC（= 19:55 JST）に起動する
// ※ Cloud Scheduler を使うには Firebase Blaze プランが必要です
exports.dailyShiftReminder = functions.pubsub
  .schedule('55 10 * * *')
  .timeZone('Asia/Tokyo')
  .onRun(async () => {
    // JST の「明日」日付文字列を計算
    const nowUtcMs = Date.now();
    const jstMidnight = new Date(nowUtcMs + 9 * 3600000);
    jstMidnight.setDate(jstMidnight.getDate() + 1);
    const tomorrowStr =
      `${jstMidnight.getFullYear()}-` +
      `${String(jstMidnight.getMonth() + 1).padStart(2, '0')}-` +
      `${String(jstMidnight.getDate()).padStart(2, '0')}`;

    functions.logger.info('[Reminder] Checking shifts for tomorrow:', tomorrowStr);

    const usersSnap = await db.ref('users').get();
    const users = usersSnap.val() || {};

    await Promise.all(
      Object.entries(users)
        .filter(([, u]) => u?.fcmToken && u?.notificationSettings?.shiftReminder !== false)
        .map(async ([uid, user]) => {
          const sSnap = await db.ref(`shift-manager/${uid}/shifts`).get();
          const raw = sSnap.val();
          if (!raw) return;

          const shifts = (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean);
          const hits   = shifts.filter(s => s && s.date === tomorrowStr);
          if (!hits.length) return;

          const wpNames = hits
            .map(s => s.wpName || s.workplace || '')
            .filter(Boolean)
            .join(', ');

          await fcm.send({
            token: user.fcmToken,
            notification: {
              title: '明日のシフトリマインダー',
              body:  `明日（${tomorrowStr}）にシフトがあります${wpNames ? '：' + wpNames : ''}`,
              icon:  ICON_URL
            },
            webpush: {
              notification: { icon: ICON_URL, badge: ICON_URL },
              fcmOptions: { link: CLICK_URL }
            }
          }).catch(e =>
            functions.logger.error(`[Reminder] ❌ Failed for ${uid}:`, e.message)
          );

          functions.logger.info(`[Reminder] ✅ Sent to ${uid} for ${tomorrowStr}`);
        })
    );
    return null;
  });

