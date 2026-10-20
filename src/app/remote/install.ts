/**
 * The Android install of Madar, the page side (owner, 2026-10-20). The real build only. This file holds no React and no zod.
 *
 * Chrome on Android sends `beforeinstallprompt` when it may add Madar to the Home Screen. Madar keeps that event and stops the
 * small bar of Chrome, so Home shows one button in its place (src/features/home/PushAskCard.tsx). The tap opens the install box
 * of Chrome. Chrome lets a page use the event once, so any answer ends the button. The other systems keep their own way: an iPhone
 * sends no such event (Home shows the steps there), and Chrome on a computer keeps its own install icon.
 *
 * Push works in a Chrome tab on Android, so the install only gives the icon and a window of its own. This serves the Home Screen
 * app until the store app comes (owner, 2026-10-20).
 */

/** The event of Chrome. The DOM types of TypeScript do not have it. */
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let held: InstallEvent | null = null;
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

/** True for an Android phone or tablet. */
export function isAndroid(userAgent: string): boolean {
  return /Android/.test(userAgent);
}

/** Starts to listen for the install event. main.tsx calls it once, before the first screen. On a system that is not Android, it does nothing. */
export function watchInstall(win: Window = window): () => void {
  if (!isAndroid(win.navigator.userAgent)) return () => undefined;
  const keep = (event: Event) => {
    // Without this, Chrome shows its own small bar next to the card.
    event.preventDefault();
    held = event as InstallEvent;
    tell();
  };
  const installed = () => {
    held = null;
    tell();
  };
  win.addEventListener('beforeinstallprompt', keep);
  win.addEventListener('appinstalled', installed);
  return () => {
    win.removeEventListener('beforeinstallprompt', keep);
    win.removeEventListener('appinstalled', installed);
    held = null;
    tell();
  };
}

/** True when Chrome may add Madar to the Home Screen now. */
export function canInstall(): boolean {
  return held !== null;
}

/** Calls the listener each time canInstall() may give another answer. Gives the function that stops it. */
export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Opens the install box of Chrome and gives the answer of the person, or "none" when the box cannot open. Call it in the tap: the
 * box opens before any wait, because Chrome refuses it outside a tap.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'none'> {
  const event = held;
  held = null;
  tell();
  if (!event) return 'none';
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return 'none';
  }
}
