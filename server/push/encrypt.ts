import { base64url, base64urlDecode } from './vapid';

/**
 * The message encryption of Web Push (owner, 2026-10-21): RFC 8291 with the aes128gcm content coding of RFC 8188, in one record.
 * The browser gives two keys when it subscribes (p256dh, its public key, and auth, a secret of 16 bytes). Only that browser can
 * read the text: the push service of Apple, Google or Mozilla carries bytes it cannot open. WebCrypto only, so it runs on Deno
 * Edge Functions and on Workers.
 *
 * The steps (RFC 8291, section 3.4): a new P-256 key pair of the server for each push, the ECDH secret with the browser key, the
 * key of RFC 8291 from the auth secret, then the content key (16 bytes) and the nonce (12 bytes) from a new salt (16 bytes). The
 * body is the header (salt, record size, the length 65 and the public key of the server: 86 bytes), then the text with the last
 * record mark 0x02, sealed with AES-128-GCM.
 */

/** The record size in the header. Apple, Google and Mozilla take a body of 4096 bytes at most, so one record holds every push. */
export const PUSH_RECORD_SIZE = 4096;
const HEADER_BYTES = 86;
const TAG_BYTES = 16;

export type PushKeys = { p256dh: string; auth: string };
/** Tests give the salt and the server key of RFC 8291, Appendix A. A push takes new random ones. */
export type EncryptOptions = { salt?: Uint8Array; serverKey?: { privateKey: string; publicKey: string } };

/** A key of the wrong form, or a text that does not fit. The sender then sends the empty push (the fixed line). */
export class PushTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushTextError';
  }
}

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function bytesOf(name: string, text: string, length: number): Uint8Array<ArrayBuffer> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64urlDecode(text);
  } catch {
    bytes = new Uint8Array(0);
  }
  if (bytes.length !== length) throw new PushTextError(`The push key ${name} must be ${length} bytes in base64url.`);
  return bytes;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, data));
}

async function serverPair(o: EncryptOptions): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array<ArrayBuffer> }> {
  if (o.serverKey) {
    const point = bytesOf('of the server', o.serverKey.publicKey, 65);
    const jwk = { kty: 'EC', crv: 'P-256', d: o.serverKey.privateKey, x: base64url(point.slice(1, 33)), y: base64url(point.slice(33, 65)), ext: true };
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return { privateKey, publicRaw: point };
  }
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer) };
}

/** The encrypted body of one push for one browser. */
export async function encryptPush(plaintext: Uint8Array, keys: PushKeys, o: EncryptOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = bytesOf('p256dh', keys.p256dh, 65);
  const authSecret = bytesOf('auth', keys.auth, 16);
  if (HEADER_BYTES + plaintext.length + 1 + TAG_BYTES > PUSH_RECORD_SIZE) throw new PushTextError('The push text is too long for one record.');
  const salt = concat(o.salt ?? crypto.getRandomValues(new Uint8Array(16)));
  if (salt.length !== 16) throw new PushTextError('The salt must be 16 bytes.');
  const server = await serverPair(o);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));
  // HKDF with one block of output each time: extract is HMAC(salt, input), expand is HMAC(key, info || 0x01).
  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, server.publicRaw);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // 0x02 marks the last (here the only) record.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, PUSH_RECORD_SIZE);
  header[20] = 65;
  header.set(server.publicRaw, 21);
  return concat(header, sealed);
}
