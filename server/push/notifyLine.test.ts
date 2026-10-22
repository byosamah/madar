import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunCall } from '../core/runCall';
import { memoryMailDb } from '../mail/memoryMailDb';
import { fakeDeps } from '../test/fakes/deps';
import { QUIET_SQL } from '../core/quiet';
import { PUSH_DEVICES_SQL, PUSH_GONE_SQL, PUSH_SENT_SQL, PUSH_STILL_NEW_SQL, sendChatPush, sendPushNotify } from './notify';
import { base64url, makeVapidKeys, type VapidConfig } from './vapid';

/**
 * The push line in the two push effects (owner, 2026-10-21): a device with keys gets the line, encrypted for it alone; a device
 * with no keys gets the empty push, as before. The test is the browser: it decrypts the body with its own private key.
 */

const NOW = new Date('2026-10-21T10:00:00Z');
const FCM = 'https://fcm.googleapis.com/fcm/send/';
const APPLE = 'https://web.push.apple.com/';
const encoder = new TextEncoder();

type Browser = { pair: CryptoKeyPair; auth: Uint8Array<ArrayBuffer>; keys: { p256dh: string; auth: string } };

async function makeBrowser(): Promise<Browser> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer));
  return { pair, auth, keys: { p256dh, auth: base64url(auth) } };
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key as Uint8Array<ArrayBuffer>, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as Uint8Array<ArrayBuffer>));
}

/** What the browser does with the body (RFC 8291, RFC 8188): the steps of the server, from the other side. */
async function decrypt(body: Uint8Array, browser: Browser): Promise<unknown> {
  const salt = body.slice(0, 16);
  const asPublic = body.slice(21, 21 + body[20]);
  const sealed = body.slice(21 + body[20]);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, browser.pair.privateKey, 256));
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', browser.pair.publicKey) as ArrayBuffer);
  const ikm = await hmac(await hmac(browser.auth, ecdh), cat(encoder.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  expect(plain.at(-1)).toBe(2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

const card = (id: string, name: string, nameAr?: string) => ({ id, name, ...(nameAr ? { nameAr } : {}), avatarUrl: null, kind: 'human', discipline: null, gender: 'male' });

/** A run of the read calls as the person: the answers of each call name, and the names asked. */
function reads(answers: Record<string, unknown>) {
  const asked: string[] = [];
  const run: RunCall = async (_deps, req) => {
    asked.push(`${req.principal.userId} ${req.name}`);
    if (req.name in answers) return { ok: true, output: answers[req.name], changed: false };
    return { ok: false, error: { code: 'not_found', message: 'Not found.' } } as never;
  };
  return { run, asked };
}

describe('the push line in the push effects (owner, 2026-10-21)', () => {
  let vapid: VapidConfig;
  beforeEach(async () => {
    vapid = { ...(await makeVapidKeys()), subject: 'mailto:madar@vado.sa' };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(devices: { endpoint: string; keys: { p256dh: string; auth: string } | null }[], stillNew: string[] = []) {
    const mem = memoryMailDb((text) => {
      if (text === QUIET_SQL) return [{ person: null, office: null }];
      if (text === PUSH_STILL_NEW_SQL) return stillNew.map((item_id) => ({ item_id }));
      if (text === PUSH_DEVICES_SQL) return devices;
      if (text === PUSH_SENT_SQL || text === PUSH_GONE_SQL) return [];
      return undefined;
    });
    const deps = fakeDeps({ db: mem.db, config: { push: vapid } });
    deps.clock.set(NOW);
    const posts: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ url, init });
      return new Response(null, { status: 201 });
    }));
    return { deps, posts, warnings: () => (deps.log as unknown as { warnings?: unknown[] }).warnings };
  }

  const notice = {
    notification: { id: 'ntf_900', userId: 'usr_002', trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_064', actorId: 'usr_001', read: false, createdAt: '2026-10-21T13:00:00.000+03:00' },
    actor: card('usr_001', 'Hala Nasser', 'هالة ناصر'), target: 'Toilet details', projectCode: null,
    project: { id: 'prj_002', name: 'Corniche Office Tower', mark: 'a' }, link: '/projects/prj_002?tab=tasks&task=tsk_064',
    needsAction: false, canApprove: false, gone: false, dueDate: null, chatKind: null, startsAt: null, forPeople: [],
  };

  it('posts the bell sentence of the notice, encrypted for a device with keys, and the empty push to a device with none', async () => {
    const browser = await makeBrowser();
    const { deps, posts } = setup([{ endpoint: `${APPLE}one`, keys: browser.keys }, { endpoint: `${FCM}two`, keys: null }]);
    const { run } = reads({ 'session.get': { user: { preferences: { language: 'en' } } }, 'notifications.list': [notice] });
    await sendPushNotify({ userId: 'usr_002' }, deps, { run });
    const apple = posts.find((p) => p.url === `${APPLE}one`)!;
    expect(new Headers(apple.init.headers).get('content-encoding')).toBe('aes128gcm');
    expect(await decrypt(apple.init.body as Uint8Array, browser)).toEqual({
      title: 'Corniche Office Tower', body: 'Hala Nasser gave you “Toilet details”', url: notice.link, tag: 'madar-task-tsk_064', lang: 'en',
    });
    const plain = posts.find((p) => p.url === `${FCM}two`)!;
    expect(plain.init.body).toBeUndefined();
    expect(new Headers(plain.init.headers).has('content-encoding')).toBe(false);
  });

  it('writes the line in Arabic for a person who reads Madar in Arabic', async () => {
    const browser = await makeBrowser();
    const { deps, posts } = setup([{ endpoint: `${FCM}one`, keys: browser.keys }]);
    const { run } = reads({ 'session.get': { user: { preferences: { language: 'ar' } } }, 'notifications.list': [notice] });
    await sendPushNotify({ userId: 'usr_002' }, deps, { run });
    const line = (await decrypt(posts[0].init.body as Uint8Array, browser)) as { body: string; lang: string };
    expect(line.lang).toBe('ar');
    expect(line.body).toContain('هالة ناصر');
  });

  it('posts the newest message of the chat for the waited push', async () => {
    const browser = await makeBrowser();
    const { deps, posts } = setup([{ endpoint: `${FCM}one`, keys: browser.keys }], ['msg_901']);
    const row = {
      kind: 'direct', id: 'cnv_013', title: 'Hala Nasser', person: card('usr_001', 'Hala Nasser'), preview: 'Can you send the drawings before 3?',
      previewAuthor: card('usr_001', 'Hala Nasser'), previewMine: false, previewKind: null,
    };
    const { run, asked } = reads({ 'session.get': { user: { preferences: { language: 'en' } } }, 'chats.list': [row] });
    await sendChatPush({ userId: 'usr_002', items: [{ chatId: 'cnv_013', itemId: 'msg_901' }] }, deps, { run });
    expect(await decrypt(posts[0].init.body as Uint8Array, browser)).toEqual({
      title: 'Hala Nasser', body: 'Can you send the drawings before 3?', url: '/inbox/cnv_013', tag: 'madar-chat-cnv_013', lang: 'en',
    });
    // Every read runs as the person who gets the push, never as another person.
    expect(asked.every((one) => one.startsWith('usr_002 '))).toBe(true);
  });

  it('sends the empty push when the line cannot be made, so the person still gets the fixed line', async () => {
    const browser = await makeBrowser();
    const { deps, posts } = setup([{ endpoint: `${FCM}one`, keys: browser.keys }]);
    const run: RunCall = async () => {
      throw new Error('The database is away. Faisal wrote about the fee.');
    };
    await sendPushNotify({ userId: 'usr_002' }, deps, { run });
    expect(posts).toHaveLength(1);
    expect(posts[0].init.body).toBeUndefined();
  });

  it('reads nothing as the person when no device has keys', async () => {
    const { deps, posts } = setup([{ endpoint: `${FCM}one`, keys: null }]);
    const { run, asked } = reads({});
    await sendPushNotify({ userId: 'usr_002' }, deps, { run });
    expect(asked).toEqual([]);
    expect(posts).toHaveLength(1);
  });

  it('reads the keys of each device with the device query', async () => {
    expect(PUSH_DEVICES_SQL).toContain("d.doc->'keys' as keys");
  });
});
