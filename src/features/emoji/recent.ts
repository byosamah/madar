/**
 * What the emoji panel keeps on the device (chat presence design D5 and D6, track emoji E2): the last 16 emoji that the person used, and
 * the one skin tone. Both live in the storage of the browser, never on the server. A blocked or full storage gives the defaults and loses
 * the write; the panel works the same.
 */
export const RECENT_KEY = 'madar.emoji.recent';
export const TONE_KEY = 'madar.emoji.tone';
/** The most emoji in Recent. */
export const RECENT_MAX = 16;
/** Recent on a new device. */
export const DEFAULT_RECENT = ['👍', '🙏', '✅', '🎉', '😂', '🔥', '👀', '❤️'];

export type Tone = 0 | 1 | 2 | 3 | 4 | 5;

/** The last emoji, newest first: at most 16, and the defaults when nothing is kept or the kept value is not a list of text. */
export function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');
    if (Array.isArray(value)) {
      const kept = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))].slice(0, RECENT_MAX);
      if (kept.length > 0) return kept;
    }
  } catch {
    // The storage is blocked or the value is broken: the defaults show.
  }
  return [...DEFAULT_RECENT];
}

/** Puts an emoji first in Recent. On a new device the defaults follow it, so the row stays useful. */
export function pushRecent(emoji: string): string[] {
  const next = [emoji, ...readRecent().filter((entry) => entry !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // The write is lost. The panel still shows the new row for this visit.
  }
  return next;
}

/** The skin tone of the device: 0 is the default (yellow), 1 to 5 are light to dark. */
export function readTone(): Tone {
  try {
    const value = Number(localStorage.getItem(TONE_KEY));
    if (Number.isInteger(value) && value >= 1 && value <= 5) return value as Tone;
  } catch {
    // The storage is blocked: the default tone.
  }
  return 0;
}

export function writeTone(tone: Tone): void {
  try {
    localStorage.setItem(TONE_KEY, String(tone));
  } catch {
    // The write is lost.
  }
}
