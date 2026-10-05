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

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string; userId: string }
  | { kind: 'project'; code: string };

const TOKEN = /@\[([^\]]{1,80})\]\((usr_\d{3,})\)|#([A-Z]{1,4}-\d{2}-\d{3,})\b/g;

/** Splits a post into plain text, mentions and project links (spec 7.2), for display. */
export function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: body.slice(last, index) });
    out.push(match[3] ? { kind: 'project', code: match[3] } : { kind: 'mention', name: match[1], userId: match[2] });
    last = index + match[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** The text of a post with each mention as "@Name". */
export function plainText(body: string): string {
  return body.replace(MENTION, (_match, name: string) => `@${name}`);
}

/**
 * Turns "@Name" into mention markup for each picked person, with the English or the Arabic name (owner item 12). Longer names
 * go first, so "@Sara Al-Qahtani" wins over "@Sara".
 */
export function withMentionMarkup(text: string, people: { id: string; name: string; nameAr?: string | null }[]): string {
  const names = people.flatMap((person) => [person.name, person.nameAr?.trim() ?? ''].filter(Boolean).map((name) => ({ id: person.id, name })));
  let out = text;
  for (const person of names.sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${person.name}`).join(mentionMarkup(person.name, person.id));
  }
  return out;
}

/**
 * The body of an edited post or comment. The editor shows each mention as "@Name"; on save it becomes a link again for the
 * current people and for every person the old body already mentioned, so a mention of someone who left the team or changed
 * their name survives an edit (audit PER-19).
 */
export function editedBody(draft: string, people: { id: string; name: string }[], before: string): string {
  const known = [...before.matchAll(MENTION)].map((match) => ({ id: match[2], name: match[1] }));
  const all = [...people, ...known.filter((old) => !people.some((person) => person.id === old.id && person.name === old.name))];
  return withMentionMarkup(draft, all);
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
