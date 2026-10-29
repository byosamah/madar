import createDOMPurify from 'dompurify';

/**
 * The cleaner of the HTML that a converter makes from a Word file (tsk_495). The file comes from another person, so the HTML is treated
 * as hostile even though mammoth escapes text. The rules are an allowlist:
 * - Tags: text, headings, lists, tables and a picture. No script, style, iframe, form, object, embed, svg, math, link or meta.
 * - Attributes: only the picture source and its alt text, the cell spans and `dir`. No style, class, id, name, event handler or data.
 * - Links: every `<a>` goes and its text stays. A link never loads on its own, but a click in the frame would leave the page, and an
 *   address that the person cannot read first is not worth that risk.
 * - Pictures: only `data:image/(png|jpeg|gif|webp|bmp);base64,`. An outside address, a `blob:` address and a vector picture go.
 * The result is drawn in a frame that has `sandbox=""` and its own CSP (`OfficeDoc.tsx`), which is a second wall behind this one.
 */
const TAGS = [
  'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'blockquote', 'pre', 'code',
  'ul', 'ol', 'li', 'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img',
];
const ATTRIBUTES = ['src', 'alt', 'colspan', 'rowspan', 'dir'];
/** The only address that survives: an inline picture of a safe type. DOMPurify tests every URL attribute with this pattern. */
const SAFE_PICTURE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i;
/** The tags that hold text with a direction of its own. Each gets dir="auto", so an Arabic paragraph and an English one each read right. */
const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TH', 'TD', 'BLOCKQUOTE', 'PRE', 'CAPTION', 'DIV']);

let instance: ReturnType<typeof createDOMPurify> | null = null;

function purifier() {
  if (instance) return instance;
  const purify = createDOMPurify(window);
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'IMG' && !SAFE_PICTURE.test(node.getAttribute('src') ?? '')) node.remove();
    else if (BLOCKS.has(node.nodeName)) node.setAttribute('dir', 'auto');
  });
  instance = purify;
  return purify;
}

/** The safe HTML of a converter result. It holds no script, no outside address and no way to run code. */
export function sanitizeDocHtml(html: string): string {
  return purifier().sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOWED_URI_REGEXP: SAFE_PICTURE,
    // DOMPurify tests the value of any attribute outside this list with the picture pattern: the cell spans are plain numbers.
    ADD_URI_SAFE_ATTR: ['colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
}
