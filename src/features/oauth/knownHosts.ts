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

/** True when the consent screen must warn: the host is not loopback and not a known AI app, or the address does not parse. */
export function needsWarning(redirectUri: string): boolean {
  const host = hostOf(redirectUri)?.toLowerCase();
  if (!host) return true;
  return !isLoopback(host) && !KNOWN_AI_HOSTS.includes(host);
}
