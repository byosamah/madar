import { useTranslation } from 'react-i18next';
import { PRIVATE } from '../../../app/privateMark';

/**
 * The page of a Word file (tsk_495). The cleaned HTML (`sanitize.ts`) is drawn in a frame with two walls of its own:
 * - `sandbox=""`: no script, no form, no popup, no top navigation, no same-origin right. The frame is a page of an empty origin.
 * - a CSP in the page: `default-src 'none'` with only inline styles and `data:` pictures. Nothing can load from the network.
 * The styles are inside the frame, so the file cannot change the look of the screen, and the screen cannot change the look of the page.
 * The page is white like paper in both color modes. Each block has `dir="auto"` (set by the cleaner), so Arabic and English read right.
 */
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const STYLE = `
html{color-scheme:light}
body{margin:0;padding:20px 24px 28px;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Tahoma,Arial,sans-serif;color:#1c1c1e;background:#fff;overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.3em 0 .5em}
h1{font-size:1.6em}h2{font-size:1.35em}h3{font-size:1.15em}h4,h5,h6{font-size:1em}
body>:first-child{margin-top:0}
p{margin:0 0 .85em}
ul,ol{margin:0 0 .85em;padding-inline-start:1.6em}
li{margin:.15em 0}
table{border-collapse:collapse;margin:0 0 1em;max-width:100%}
td,th{border:1px solid #d1d1d6;padding:6px 10px;vertical-align:top;text-align:start}
td>p,th>p{margin:0}
img{max-width:100%;height:auto}
blockquote{margin:0 0 .85em;padding-inline-start:1em;border-inline-start:3px solid #d1d1d6;color:#48484a}
pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
hr{border:0;border-top:1px solid #d1d1d6;margin:1.2em 0}
`;

/** The full page of the frame for the cleaned HTML of a Word file. */
export function docFrameHtml(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>${body}</body></html>`;
}

export function OfficeDoc({ html, name }: { html: string; name: string }) {
  const { t } = useTranslation();
  return (
    // The grey edge makes the white page visible on the white sheet.
    <div className="rounded-2xl bg-fill p-1.5">
      <iframe
        sandbox=""
        title={t('officePreview.docFrame', { name })}
        srcDoc={docFrameHtml(html)}
        className={`${PRIVATE} block h-[62dvh] w-full rounded-xl bg-white sm:h-[63dvh]`}
      />
    </div>
  );
}
