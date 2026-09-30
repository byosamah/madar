const MENTION = /@\[([^\]]{1,80})\]\((usr_\d{3,})\)/g;
const PROJECT_LINK = /#([A-Z]{1,4}-\d{2}-\d{3,})\b/g;

export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

export function mentionMarkup(name: string, userId: string): string {
  return `@[${name}](${userId})`;
}

export function linkedProjectCodes(body: string): string[] {
  return [...new Set([...body.matchAll(PROJECT_LINK)].map((match) => match[1]))];
}

/** Lower case, one space, no Arabic diacritics or tatweel, one alef form, taa marbuta as haa, alef maqsura as yaa. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Segment = { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: string };

/** Splits a post into plain text and mentions, for display. */
export function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: body.slice(last, index) });
    out.push({ kind: 'mention', name: match[1], userId: match[2] });
    last = index + match[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** The text of a post with each mention as "@Name". */
export function plainText(body: string): string {
  return body.replace(MENTION, (_match, name: string) => `@${name}`);
}

/** Turns "@Name" into mention markup for each picked person. Longer names go first, so "@Sara Al-Qahtani" wins over "@Sara". */
export function withMentionMarkup(text: string, people: { id: string; name: string }[]): string {
  let out = text;
  for (const person of [...people].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${person.name}`).join(mentionMarkup(person.name, person.id));
  }
  return out;
}

/** The mention that the caret is in: an "@" at the start of a word, then up to 30 characters on the same line. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || query.includes('\n') || query.startsWith(' ')) return null;
  return { start: at, query };
}
