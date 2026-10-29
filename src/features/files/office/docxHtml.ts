import mammoth from 'mammoth/mammoth.browser.min.js';
import { checkZip } from './zipGuard';
import { sanitizeDocHtml } from './sanitize';

/**
 * A Word file as safe HTML (tsk_495). Madar draws the file itself in the browser: mammoth reads the .docx, DOMPurify cleans the HTML
 * (`sanitize.ts`), and the page draws it in a frame without scripts (`OfficeDoc.tsx`). Nothing leaves the browser.
 * - The ZIP directory is checked first (`zipGuard.ts`), so a small file cannot unpack to a huge one.
 * - mammoth reads no outside file (`externalFileAccess` is off), so a picture of an outside address never loads.
 * - A picture comes as a data address of a safe type, at most `MAX_IMAGE_BYTES` each and `MAX_IMAGES` in all. Others are left out.
 * - The layout is close, not exact: mammoth keeps the structure (headings, lists, tables, bold, pictures) and drops fonts, columns and page breaks.
 */
export type DocxResult = { kind: 'html'; html: string } | { kind: 'empty' } | { kind: 'bad' } | { kind: 'big' };

const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
/** The size of one picture as base64 text. A larger picture is left out. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 60;

export async function docxToHtml(bytes: ArrayBuffer): Promise<DocxResult> {
  const zip = checkZip(bytes);
  if (zip !== 'ok') return { kind: zip };
  let images = 0;
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: bytes },
      {
        externalFileAccess: false,
        // A title and a subtitle are the first lines of most reports. The default style map leaves them as plain paragraphs.
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
        convertImage: mammoth.images.imgElement(async (image) => {
          const type = image.contentType.toLowerCase();
          if (!PICTURE_TYPES.has(type) || images >= MAX_IMAGES) return { src: '' };
          const base64 = await image.readAsBase64String();
          if (base64.length > MAX_IMAGE_BYTES) return { src: '' };
          images += 1;
          return { src: `data:${type};base64,${base64}` };
        }),
      },
    );
    // A paragraph that held only a picture that was left out is empty now.
    const html = sanitizeDocHtml(result.value).replace(/<p dir="auto"><\/p>/g, '');
    return html.replace(/<[^>]*>/g, '').trim() === '' && !html.includes('<img') ? { kind: 'empty' } : { kind: 'html', html };
  } catch {
    return { kind: 'bad' };
  }
}
