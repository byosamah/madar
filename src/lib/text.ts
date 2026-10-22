import { KEY_PATTERN, OLD_CODE_PATTERN } from './projectCode';

const MENTION = /@\[([^\]]{1,80})\]\((usr_\d{3,})\)/g;
/** "#KH-26-014" (an old code) or "#260902AZT" (the key of a new code) links to the project (spec 7.2; owner, 2026-10-05). */
const LINKED_CODE = `#(${OLD_CODE_PATTERN}|${KEY_PATTERN})\\b`;
const PROJECT_LINK = new RegExp(LINKED_CODE, 'g');

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

/**
 * The start of a message for one line, for example a report in its notice (owner, 2026-10-07). It makes each run of white space
 * one space and trims. A longer text keeps its first max - 1 code points, cut at the last space when that space is in the second
 * half, then "…". It counts code points, so it never splits an emoji. The result has max code points or fewer.
 */
export function excerptOf(message: string, max = 80): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  const points = Array.from(flat);
  if (points.length <= max) return flat;
  const head = points.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  const kept = space >= Math.floor(max / 2) ? head.slice(0, space) : head;
  return `${kept.join('').trimEnd()}\u2026`;
}

/**
 * The first line of a message or a comment for a reply strip or a search hit (chat design 2026-10-19, items 10 and 16): the first
 * line of the plain text (a mention reads "@Name"), each run of white space as one space, at most 100 code points, then "…" when
 * it is cut. 100 code points stay under the 200 characters of ReplyRef.firstLine, also with emoji.
 */
export function firstLineOf(body: string): string {
  const first = plainText(body).split(/\r\n|[\n\r\u2028\u2029]/).find((line) => line.trim() !== '') ?? '';
  return excerptOf(first, 100);
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'everyone'; word: string }
  | { kind: 'mention'; name: string; userId: string }
  | { kind: 'project'; code: string }
  | { kind: 'url'; url: string };

/** A web address starts with http:// or https:// (chat design 2026-10-19, item 7). Another scheme makes no link. */
const WEB_ADDRESS = '(https?:\\/\\/[^\\s<>"]+)';
const TOKEN = new RegExp(`${MENTION.source}|${LINKED_CODE}|${WEB_ADDRESS}`, 'g');

/**
 * The words that name every person of a chat or a to-do thread (owner, 2026-10-22, fbk_041): @everyone and @all (any case) and @الجميع. A
 * whole word: the text starts with it or a space comes before the "@", and a space, the end of the text or a mark of the sentence comes
 * after it. A dot counts as a mark only at the end of a sentence, so an address like x@all.com or @all.com is no match.
 */
const EVERYONE_WORD = '(?:[eE][vV][eE][rR][yY][oO][nN][eE]|[aA][lL][lL]|\\u0627\\u0644\\u062C\\u0645\\u064A\\u0639)';
const EVERYONE_AFTER = '(?=$|\\s|[,;:!?)\\]"\'\\u00BB\\u2026\\u060C\\u061B\\u061F]|\\.(?:$|\\s))';
const EVERYONE = `(?<=^|\\s|[("'\\u00AB])@${EVERYONE_WORD}${EVERYONE_AFTER}`;
const EVERYONE_ONLY = new RegExp(EVERYONE);
const TOKEN_WITH_EVERYONE = new RegExp(`${TOKEN.source}|(${EVERYONE})`, 'g');

/** True when the text holds @everyone, @all or @الجميع as a whole word. The mention markup of a person never counts. */
export function mentionsEveryone(body: string): boolean {
  return EVERYONE_ONLY.test(body);
}

/** The marks that end a sentence, not an address: they come off the end of an address. A closing bracket comes off only when the address did not open it. */
const ADDRESS_END = new Set(Array.from('.,;:!?\'"\u060C\u061B\u061F\u00BB]}'));

/** The address without the marks of the sentence at its end. */
function trimAddress(address: string): string {
  let end = address.length;
  for (;;) {
    const last = address[end - 1];
    if (ADDRESS_END.has(last)) end -= 1;
    else if (last === ')' && address.slice(0, end).split(')').length > address.slice(0, end).split('(').length) end -= 1;
    else break;
  }
  return address.slice(0, end);
}

/**
 * Splits a post into plain text, mentions, project links and web addresses (spec 7.2), for display. With `everyone`, the three words of
 * mentionsEveryone become a segment of their own, so the bubble draws them as a mention.
 */
export function segmentsOf(body: string, options: { everyone?: boolean } = {}): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(options.everyone ? TOKEN_WITH_EVERYONE : TOKEN)) {
    const index = match.index ?? 0;
    let segment: Segment;
    let length = match[0].length;
    if (match[5] !== undefined) {
      segment = { kind: 'everyone', word: match[5] };
    } else if (match[4] !== undefined) {
      // The cut part goes back into the text. An address with nothing after its scheme stays text.
      const url = trimAddress(match[4]);
      if (/^https?:\/\/$/.test(url)) continue;
      segment = { kind: 'url', url };
      length = url.length;
    } else segment = match[3] ? { kind: 'project', code: match[3] } : { kind: 'mention', name: match[1], userId: match[2] };
    if (index > last) out.push({ kind: 'text', text: body.slice(last, index) });
    out.push(segment);
    last = index + length;
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
