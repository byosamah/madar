/**
 * The redirect addresses of the AI apps that Madar knows (plan 5.6; task G4). The consent screen shows a plain warning when the
 * redirect address of a request is not loopback and not on this list: the code of an approval goes to that address, so an
 * unknown address may be an app that the person did not start. The match is exact on the scheme and the host, so
 * "claude.ai.evil.example" is unknown, and so is "foo://claude.ai/cb": an AI app registers its own addresses (DCR), and an app
 * scheme goes to whatever app owns that scheme on the device (review of G4).
 *
 * - Loopback: a desktop or command line app that waits on this computer (Claude Code, VS Code, Cursor and others), http or https.
 * - The web apps, https only: Claude, ChatGPT, VS Code for the web.
 * - The app address of Cursor, cursor: only (cursor://anysphere.cursor-retrieval/...).
 */
export const KNOWN_AI_APPS: readonly { scheme: string; host: string }[] = [
  { scheme: 'https:', host: 'claude.ai' },
  { scheme: 'https:', host: 'claude.com' },
  { scheme: 'https:', host: 'chatgpt.com' },
  { scheme: 'https:', host: 'chat.openai.com' },
  { scheme: 'https:', host: 'vscode.dev' },
  { scheme: 'https:', host: 'insiders.vscode.dev' },
  { scheme: 'cursor:', host: 'anysphere.cursor-retrieval' },
];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The host of a redirect address, without the port, or null when the address does not parse. */
export function hostOf(uri: string): string | null {
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase());
}

/** Schemes that run script or read local data in the Madar page. An AI app registers its own redirect addresses (DCR). */
const REFUSED_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'blob:', 'file:', 'filesystem:', 'about:']);

/**
 * True when Madar may send the browser to this return address of an AI app (security review of G4): https, http on a loopback
 * host only, or an app scheme (for example cursor:). Never a script or local scheme, whatever its host reads as
 * ("javascript://claude.ai/%0a..." has the host claude.ai), and never an address that does not parse.
 */
export function safeRedirect(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (REFUSED_SCHEMES.has(scheme)) return false;
  if (scheme === 'https:') return parsed.hostname !== '';
  if (scheme === 'http:') return isLoopback(parsed.hostname);
  return true;
}

/**
 * True when the consent screen must warn: an address that Madar would not leave for, or an address that is not loopback (http or
 * https) and not a known AI app with its own scheme.
 */
export function needsWarning(redirectUri: string): boolean {
  if (!safeRedirect(redirectUri)) return true;
  const parsed = new URL(redirectUri);
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  if (!host) return true;
  if ((scheme === 'http:' || scheme === 'https:') && isLoopback(host)) return false;
  return !KNOWN_AI_APPS.some((app) => app.scheme === scheme && app.host === host);
}
