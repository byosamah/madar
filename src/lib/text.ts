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
