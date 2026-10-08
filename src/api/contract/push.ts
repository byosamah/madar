/**
 * Browser push (owner, 2026-10-08): the plain limits and the endpoint rule, with no zod, so a screen of the first load can import
 * them without the zod schemas (the sign-out step does). entities.ts uses them for the PushDevice record.
 * One device is one browser on one computer or phone that has a push subscription. The endpoint is the https address of the push
 * service of that browser. The server posts an empty message to it.
 */
export const PUSH_ENDPOINT_MAX = 2048;
export const PUSH_LABEL_MAX = 80;
/** The most devices of one person. A new device past this number pushes the oldest one out. */
export const PUSH_DEVICES_PER_PERSON = 10;

/**
 * The hosts of the push services of the browsers. The server posts to the endpoint that a person sends, so the endpoint must
 * name one of these hosts. Without this rule, a person could make the server post to any address (server side request forgery).
 * A name that starts with a dot matches every host below it.
 *   Chrome, Edge and Opera on a phone or computer, Samsung: Firebase Cloud Messaging.
 *   Firefox: Mozilla autopush.   Safari and iPhone: Apple.   Edge on Windows: the Windows Notification Service.
 */
export const PUSH_HOSTS: readonly string[] = [
  'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', '.push.apple.com', '.notify.windows.com',
];

/** True when the text is the https address of a known push service: no login, no other port, no bare address. */
export function isPushEndpoint(text: string): boolean {
  if (text.length === 0 || text.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => (allowed.startsWith('.') ? host.endsWith(allowed) : host === allowed));
}
