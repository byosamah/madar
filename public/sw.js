/*
 * The service worker of Madar browser push (owner, 2026-10-08). Plain JavaScript, no build step.
 *
 * It does two things only:
 *   1. A push arrives (an empty message from the server). It shows ONE fixed line, in Arabic when the browser language starts
 *      with "ar", else in English. The push carries no task, project, client or person, so the line carries none either.
 *   2. A person presses the notification. It closes the notification, then focuses an open Madar window or opens the home page.
 *
 * It never handles fetch, so it cannot slow down or break a page. The two lines below are the same as push.notificationTitle and
 * push.notificationBody in src/i18n/real/push.en.json and push.ar.json (src/app/remote/serviceWorker.test.ts keeps them equal).
 * The prototype build never registers this file.
 */

var TEXT = {
  en: { title: 'Madar', body: 'You have something new in Madar.' },
  ar: { title: 'مدار', body: 'لديك جديد في مدار.' },
};

/** The title and the body for a browser language such as "ar-SA" or "en-US". */
function pushText(language) {
  return String(language || '').toLowerCase().indexOf('ar') === 0 ? TEXT.ar : TEXT.en;
}

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var language = self.navigator && self.navigator.language;
  var arabic = String(language || '').toLowerCase().indexOf('ar') === 0;
  var text = pushText(language);
  event.waitUntil(
    self.registration.showNotification(text.title, {
      body: text.body,
      // One tag: a second push replaces the first line and alerts again, so the phone never shows a pile of the same line.
      tag: 'madar-new',
      renotify: true,
      icon: '/icons/madar-192.png',
      lang: arabic ? 'ar' : 'en',
      dir: arabic ? 'rtl' : 'ltr',
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        if ('focus' in windows[i]) return windows[i].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
