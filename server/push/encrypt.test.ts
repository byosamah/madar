import { describe, expect, it } from 'vitest';
import { encryptPush, PUSH_RECORD_SIZE } from './encrypt';
import { base64url, base64urlDecode } from './vapid';

/**
 * The message encryption of Web Push (RFC 8291 with the aes128gcm coding of RFC 8188), owner 2026-10-21. The vector is Appendix A
 * of RFC 8291: with its keys and its salt, the body must be the header and the ciphertext that the RFC prints, byte for byte.
 */
const join = (text: string) => text.replace(/\s+/g, '');
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: join('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: join('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV- JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'),
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: join('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8'),
  ciphertext: join('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'),
};

describe('encryptPush', () => {
  it('gives the body of RFC 8291, Appendix A, with its keys and its salt', async () => {
    const body = await encryptPush(base64urlDecode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, {
      salt: base64urlDecode(RFC.salt),
      serverKey: { privateKey: RFC.asPrivate, publicKey: RFC.asPublic },
    });
    const header = base64urlDecode(RFC.header);
    expect(header.length).toBe(86);
    expect(base64url(body.slice(0, 86))).toBe(RFC.header);
    expect(base64url(body.slice(86))).toBe(RFC.ciphertext);
  });

  it('uses a new salt and a new server key for each push, in one record of 4096', async () => {
    const keys = { p256dh: RFC.uaPublic, auth: RFC.auth };
    const text = new TextEncoder().encode('{"title":"Madar","body":"Faisal: hello"}');
    const [a, b] = await Promise.all([encryptPush(text, keys), encryptPush(text, keys)]);
    // salt 16 + record size 4 + key length 1 + key 65, then the text, the delimiter 0x02 and the tag of 16.
    expect(a.length).toBe(86 + text.length + 1 + 16);
    expect(new DataView(a.buffer, a.byteOffset + 16, 4).getUint32(0)).toBe(PUSH_RECORD_SIZE);
    expect(a[20]).toBe(65);
    expect(base64url(a.slice(0, 16))).not.toBe(base64url(b.slice(0, 16)));
    expect(base64url(a.slice(21, 86))).not.toBe(base64url(b.slice(21, 86)));
  });

  it('refuses keys of the wrong length, and a text too long for one record', async () => {
    const text = new TextEncoder().encode('x');
    await expect(encryptPush(text, { p256dh: RFC.auth, auth: RFC.auth })).rejects.toThrow(/p256dh/);
    await expect(encryptPush(text, { p256dh: RFC.uaPublic, auth: RFC.uaPublic })).rejects.toThrow(/auth/);
    await expect(encryptPush(new Uint8Array(PUSH_RECORD_SIZE), { p256dh: RFC.uaPublic, auth: RFC.auth })).rejects.toThrow(/too long/);
  });
});
