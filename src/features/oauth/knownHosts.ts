/**
 * The redirect hosts of the AI apps that Madar knows (plan 5.6; task G4). The consent screen shows a plain warning when the
 * redirect address of a request is not loopback and not on this list: the code of an approval goes to that address, so an
 * unknown host may be an app that the person did not start. The match is exact, so "claude.ai.evil.example" is unknown.
 *
 * - Loopback: a desktop or command line app that waits on this computer (Claude Code, VS Code, Cursor and others).
 * - The web apps: Claude, ChatGPT, VS Code for the web.
 * - The app address of Cursor (cursor://anysphere.cursor-retrieval/...).
 */
export const KNOWN_AI_HOSTS: readonly string[] = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'vscode.dev',
  'insiders.vscode.dev',
  'anysphere.cursor-retrieval',
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
 * True when the consent screen must warn: an address that Madar would not leave for, or a host that is not loopback and not a
 * known AI app.
 */
export function needsWarning(redirectUri: string): boolean {
  if (!safeRedirect(redirectUri)) return true;
  const host = hostOf(redirectUri)?.toLowerCase();
  if (!host) return true;
  return !isLoopback(host) && !KNOWN_AI_HOSTS.includes(host);
}
