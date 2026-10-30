import mammoth from 'mammoth/mammoth.browser.min.js';
import { checkZip } from './zipGuard';

/**
 * A Word file as HTML that is NOT clean yet (tsk_495). Madar draws the file itself in the browser: mammoth reads the .docx here, in the
 * worker of the preview (`officeWorker.ts`, which has no DOM and a time budget), the main thread cleans the HTML with DOMPurify
 * (`docxClean.ts`), and the page draws it in a frame without scripts (`OfficeDoc.tsx`). Nothing leaves the browser.
 * - The ZIP is unpacked in small steps first (`zipGuard.ts`), so a small file cannot unpack to a huge one.
 * - mammoth reads no outside file (`externalFileAccess` is off), so a picture of an outside address never loads.
 * - A picture comes as a data address of a safe type, at most `MAX_IMAGE_BYTES` each and `MAX_IMAGES` in all. Others are left out.
 * - The layout is close, not exact: mammoth keeps the structure (headings, lists, tables, bold, pictures) and drops fonts, columns and page breaks.
 */
export type DocxRaw = { kind: 'html'; html: string } | { kind: 'bad' } | { kind: 'big' };

/** The longest HTML text that the main thread cleans. A text above it is "big": the cleaner runs on the page and has no time budget. */
export const MAX_HTML_CHARS = 20_000_000;

const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);
/** The size of one picture as base64 text. A larger picture is left out. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 60;

export async function docxToRawHtml(bytes: ArrayBuffer): Promise<DocxRaw> {
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
    return result.value.length > MAX_HTML_CHARS ? { kind: 'big' } : { kind: 'html', html: result.value };
  } catch {
    return { kind: 'bad' };
  }
}
