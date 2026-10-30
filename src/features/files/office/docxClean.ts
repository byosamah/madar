import { sanitizeDocHtml } from './sanitize';

/**
 * The last step of a Word file (tsk_495): the HTML that mammoth made in the worker is cleaned on the page, because DOMPurify needs a DOM
 * and a worker has none. The cleaner is an allowlist (`sanitize.ts`). The result is "empty" when no text and no picture is left.
 */
export type DocxResult = { kind: 'html'; html: string } | { kind: 'empty' };

export function cleanDocxHtml(raw: string): DocxResult {
  // A paragraph that held only a picture that was left out is empty now.
  const html = sanitizeDocHtml(raw).replace(/<p dir="auto"><\/p>/g, '');
  return html.replace(/<[^>]*>/g, '').trim() === '' && !html.includes('<img') ? { kind: 'empty' } : { kind: 'html', html };
}
