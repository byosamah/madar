import type { Lang } from './dates';

/** The client's name in the screen's language, or the other one when that is missing (colleague comment 11, 2026-10-01). */
export function clientName(client: { name: string; nameAr?: string }, lang: Lang): string {
  const arabic = client.nameAr?.trim() ?? '';
  return lang === 'ar' ? arabic || client.name : client.name || arabic;
}
