import { describe, expect, it } from 'vitest';
import { sanitizeDocHtml } from './sanitize';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const clean = (html: string) => sanitizeDocHtml(html);

describe('sanitizeDocHtml (tsk_495): the file comes from another person', () => {
  it('keeps the text, the headings, the lists, the tables and the marks of a page', () => {
    const out = clean('<h1>Title</h1><p>A <strong>bold</strong> and <em>slanted</em> line<br>next</p><ul><li>One</li></ul><table><tr><td colspan="2">Cell</td></tr></table><sup>1</sup>');
    for (const part of ['<h1', 'Title', '<strong>bold</strong>', '<em>slanted</em>', '<ul>', '<li', '<table>', 'colspan="2"', '<sup>']) expect(out).toContain(part);
  });

  it('removes a script, a style, an iframe, a form, an object, an embed and an SVG with their content', () => {
    const out = clean('<p>Safe</p><script>alert(1)</script><style>p{background:url(https://evil.test/x)}</style><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input name="a"><button>Go</button></form><object data="x"></object><embed src="x"><svg><script>alert(2)</script></svg><math><mi>x</mi></math><link rel="stylesheet" href="https://evil.test/a.css"><meta http-equiv="refresh" content="0;url=https://evil.test">');
    expect(out).toContain('Safe');
    for (const part of ['script', 'alert', 'style', 'url(', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'svg', 'math', 'link', 'meta', 'evil.test']) expect(out.toLowerCase()).not.toContain(part);
  });

  it('removes every attribute that is not on the list: event handlers, style, class, id, name, data', () => {
    const out = clean('<p onclick="alert(1)" style="background:url(https://evil.test)" class="x" id="y" data-a="b" onmouseover="alert(2)" title="t">Text</p><table><tr><td background="https://evil.test/b.png" rowspan="2">Cell</td></tr></table>');
    for (const part of ['onclick', 'onmouseover', 'style', 'class', 'id=', 'data-a', 'title', 'background', 'evil.test']) expect(out).not.toContain(part);
    expect(out).toContain('rowspan="2"');
  });

  it('drops every link but keeps its text, so no click leaves the page and no address loads', () => {
    const out = clean('<p><a href="javascript:alert(1)">Run</a> <a href="https://example.com/x" target="_blank">Site</a> <a href="data:text/html,<script>alert(1)</script>">Data</a> <a href="#note">Note</a></p>');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href');
    expect(out).not.toContain('javascript');
    for (const word of ['Run', 'Site', 'Data', 'Note']) expect(out).toContain(word);
  });

  it('keeps a picture only when it is a data picture of a safe type', () => {
    const out = clean(`<img src="${PNG}" alt="Plan"><img src="https://evil.test/track.png"><img src="//evil.test/a.png"><img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="><img src="data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4="><img src="blob:https://x/y"><img srcset="https://evil.test/a.png 1x" src="${PNG}" onerror="alert(1)"><img>`);
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).toContain(PNG);
    for (const part of ['evil.test', 'svg', 'text/html', 'blob:', 'srcset', 'onerror']) expect(out).not.toContain(part);
  });

  it('gives every text block its own direction, so Arabic and English paragraphs each read right', () => {
    const out = clean('<h2>عنوان</h2><p>نص</p><ul><li>بند</li></ul><table><tr><th>A</th><td>B</td></tr></table>');
    for (const tag of ['h2', 'p', 'li', 'th', 'td']) expect(out).toContain(`<${tag} dir="auto"`);
  });

  it('survives a broken, nested and mixed-case page without a surviving handler', () => {
    const out = clean('<P ONCLICK="alert(1)"><scr<script>ipt>alert(1)</script>Hi</P><IMG SRC=javascript:alert(1)><b/onmouseover=alert(1)>Bold');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('onmouseover');
    expect(out.toLowerCase()).not.toContain('javascript');
    expect(out.toLowerCase()).not.toContain('<script');
  });
});
