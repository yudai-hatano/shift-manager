'use strict';

// ⚠️  ICS エンドポイントは Firebase Blaze プラン（従量課金）が必要です。
// まだアップグレードしていない場合は https://console.firebase.google.com/project/shift-manager-de355/usage/details
// から「Blaze プランにアップグレード」してください。
console.info('[ShiM] Cloud Functions 起動。ICS エンドポイントを使用するには Blaze プランが必要です。');

const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const crypto    = require('crypto');

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

// ── ICS カレンダー購読エンドポイント ─────────────────────────────────────────
// GET /ics?uid={uid}&token={token}[&wpId={wpId}]

/** レートリミット: インスタンスごとのメモリ内カウンタ（1分10回まで） */
const _rateMap = new Map();
function _checkRate(key) {
  const now  = Date.now();
  const cur  = _rateMap.get(key) || { n: 0, t: now };
  if (now - cur.t > 60000) { cur.n = 1; cur.t = now; }
  else                      { cur.n++; }
  _rateMap.set(key, cur);
  return cur.n <= 10;
}

/** タイミングセーフ文字列比較 */
function _safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function _p2(n) { return String(n).padStart(2, '0'); }

/** "YYYY-MM-DD" + "HH:MM" → "YYYYMMDDTHHmmss" */
function _icsdt(date, time) {
  const [y, mo, d] = date.split('-');
  const [h, mi]    = time.split(':');
  return `${y}${_p2(mo)}${_p2(d)}T${_p2(h)}${_p2(mi)}00`;
}

/** ICS テキスト用エスケープ */
function _icsEsc(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** シフト配列と勤務先配列から VCALENDAR 文字列を生成 */
function _buildICS(shiftsArr, workplacesArr, wpId, calName) {
  const now   = new Date();
  const stamp = `${now.getUTCFullYear()}${_p2(now.getUTCMonth()+1)}${_p2(now.getUTCDate())}T${_p2(now.getUTCHours())}${_p2(now.getUTCMinutes())}${_p2(now.getUTCSeconds())}Z`;

  const wpMap = {};
  for (const wp of workplacesArr) if (wp && wp.id) wpMap[wp.id] = wp;

  const pastCut   = new Date(now); pastCut.setMonth(pastCut.getMonth() - 3);
  const futureCut = new Date(now); futureCut.setMonth(futureCut.getMonth() + 6);
  const pastStr   = pastCut.toISOString().slice(0, 10);
  const futureStr = futureCut.toISOString().slice(0, 10);

  const events = shiftsArr.filter(s =>
    s && s.date && s.startTime && s.endTime &&
    s.date >= pastStr && s.date <= futureStr &&
    (!wpId || s.workplaceId === wpId)
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiM//Shift Manager//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${_icsEsc(calName)}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  for (const s of events) {
    const wp     = wpMap[s.workplaceId];
    const wpName = wp ? (wp.name || '') : '';
    const plMark = s.isPaidLeave ? '🌴有給 ' : '';

    const [sh, sm] = s.startTime.split(':').map(Number);
    const [eh, em] = s.endTime.split(':').map(Number);
    const dtstart  = _icsdt(s.date, s.startTime);

    let dtend;
    if (eh * 60 + em <= sh * 60 + sm) {
      const nd = new Date(s.date + 'T00:00:00+09:00');
      nd.setDate(nd.getDate() + 1);
      dtend = _icsdt(nd.toISOString().slice(0, 10), s.endTime);
    } else {
      dtend = _icsdt(s.date, s.endTime);
    }

    const summary = wpName
      ? `${plMark}${s.startTime}〜${s.endTime} ${wpName}`
      : `${plMark}${s.startTime}〜${s.endTime}`;
    const desc = [s.location, s.memo].filter(Boolean).join(' / ');

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${s.id || stamp}@shim`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;TZID=Asia/Tokyo:${dtstart}`);
    lines.push(`DTEND;TZID=Asia/Tokyo:${dtend}`);
    lines.push(`SUMMARY:${_icsEsc(summary)}`);
    if (desc) lines.push(`DESCRIPTION:${_icsEsc(desc)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

exports.ics = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
    return;
  }

  const { uid, token, wpId } = req.query;
  if (!uid || !token) { res.status(400).send('Bad Request'); return; }

  if (!_checkRate(uid)) { res.status(429).send('Too Many Requests'); return; }

  try {
    const storedSnap = await db.ref(`users/${uid}/icsToken`).get();
    const stored     = storedSnap.val();
    if (!stored || !_safeEq(token, stored)) { res.status(401).send('Unauthorized'); return; }

    const [shiftsSnap, wpSnap] = await Promise.all([
      db.ref(`shift-manager/${uid}/shifts`).get(),
      db.ref(`shift-manager/${uid}/workplaces`).get(),
    ]);

    const raw = shiftsSnap.val();
    const shiftsArr = raw ? (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean) : [];

    const wpRaw = wpSnap.val();
    const wpsArr = wpRaw ? (Array.isArray(wpRaw) ? wpRaw : Object.values(wpRaw)).filter(Boolean) : [];

    let calName = 'ShiM シフト';
    if (wpId) {
      const wp = wpsArr.find(w => w && w.id === wpId);
      if (wp && wp.name) calName = `ShiM ${wp.name}`;
    }

    const body = _buildICS(shiftsArr, wpsArr, wpId || null, calName);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="shim-shifts.ics"');
    res.set('Cache-Control', 'private, max-age=0, no-cache');
    res.status(200).send(body);
    functions.logger.info(`[ICS] Served uid=${uid} wpId=${wpId || 'all'} events=${shiftsArr.length}`);
  } catch (e) {
    functions.logger.error('[ICS] Error:', e);
    res.status(500).send('Internal Server Error');
  }
});
