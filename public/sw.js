/*
 * The service worker of Madar browser push (owner, 2026-10-08). Plain JavaScript, no build step.
 *
 * It does two things only:
 *   1. A push arrives. Since 2026-10-21 (owner, "Like WhatsApp") the server sends the line of the push, encrypted for this browser
 *      (the browser opens it): a title, a body, a link in Madar, a tag and a language. The worker shows that line. An empty push (a
 *      device saved before that day) or a line it cannot trust gives ONE fixed line, in Arabic when the browser language starts
 *      with "ar", else in English.
 *      One exception (fbk_028, owner 2026-10-23): when a window of Madar is visible and has the focus, the person already sees the
 *      new thing in the page, so the worker shows no line. Only Chromium may do this (its rule is in the Chromium source). WebKit (Safari on
 *      a Mac, and every browser on an iPhone or iPad) revokes the push subscription of a site that gets a push and shows no notification,
 *      so there the worker always shows the line, and shows it first, before it asks for anything else. Firefox and an engine that is
 *      not known show it too: a line too many costs nothing, a lost subscription costs every later push.
 *   2. A person presses the notification. It closes the notification, then moves an open Madar window to the link of the line, or
 *      opens a new window at it. A link is always a path of this site.
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

/** The link of a line: a path of this site only ("/inbox/cnv_013"), never a link to another site. */
function safeUrl(url) {
  return typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\' ? url : '/';
}

/** The line in the push, or null for an empty push or a line of a wrong shape. It never throws. */
function lineOf(event) {
  var line = null;
  try {
    line = event && event.data ? event.data.json() : null;
  } catch (error) {
    return null;
  }
  if (!line || typeof line !== 'object') return null;
  if (typeof line.title !== 'string' || line.title === '' || typeof line.body !== 'string' || line.body === '') return null;
  if (typeof line.tag !== 'string' || line.tag.indexOf('madar-') !== 0) return null;
  if (typeof line.url !== 'string' || safeUrl(line.url) !== line.url) return null;
  return { title: line.title, body: line.body, tag: line.tag, url: line.url, arabic: line.lang === 'ar' };
}

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

/**
 * True when the browser engine may take a push with no notification while a window of the site is in front: Chromium (Chrome, Edge,
 * Samsung Internet). Everything else answers false, so Firefox, Safari and a new or unknown engine show the line. Every browser on an
 * iPhone or iPad is WebKit whatever its name says (CriOS, FxiOS, EdgiOS), so those names answer false too.
 */
function mayStaySilent(userAgent) {
  var agent = String(userAgent || '');
  if (/(iPhone|iPad|iPod|CriOS|FxiOS|EdgiOS|OPiOS)/.test(agent)) return false;
  return /(Chrome|Chromium)\//.test(agent);
}

/** True when one of the windows is visible and has the focus. A window that reports neither does not count. */
function somebodyLooks(windows) {
  for (var i = 0; i < windows.length; i++) {
    if (windows[i].visibilityState === 'visible' && windows[i].focused === true) return true;
  }
  return false;
}

self.addEventListener('push', function (event) {
  var language = self.navigator && self.navigator.language;
  var line = lineOf(event);
  var arabic = line ? line.arabic : String(language || '').toLowerCase().indexOf('ar') === 0;
  var text = pushText(language);
  function show() {
    return self.registration.showNotification(line ? line.title : text.title, {
      body: line ? line.body : text.body,
      // One tag for each chat or item ("madar-chat-cnv_013"): a new message replaces the line of its chat and alerts again. The fixed
      // line keeps one tag, so the phone never shows a pile of the same line.
      tag: line ? line.tag : 'madar-new',
      renotify: true,
      icon: '/icons/madar-192.png',
      lang: arabic ? 'ar' : 'en',
      dir: arabic ? 'rtl' : 'ltr',
      data: { url: line ? line.url : '/' },
    });
  }
  // WebKit and unknown engines: the line first, with nothing before it that could fail.
  if (!mayStaySilent(self.navigator && self.navigator.userAgent)) {
    event.waitUntil(show());
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      function (windows) {
        return somebodyLooks(windows) ? undefined : show();
      },
      // The list of windows cannot be read: show the line, as before.
      function () {
        return show();
      }
    )
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        if ('focus' in windows[i]) {
          return windows[i].focus().then(function (focused) {
            // The home link only brings the window to the front. Another link moves it there; a window that cannot move (one this
            // worker does not control yet) leaves it, and a new window opens at the link.
            if (url === '/' || !focused || !('navigate' in focused)) return focused;
            return focused.navigate(url).catch(function () {
              return self.clients.openWindow(url);
            });
          });
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
