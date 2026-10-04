import { describe, expect, it } from 'vitest';
import { FILE_STORE_LIMITS } from '../core/ports';
import { depsFrom, serverEnvFrom } from '../core/deps';
import { linkType } from '../../src/api/handlers/serverFakes';
import { DOWNLOAD_LINK_SECONDS, UPLOAD_LINK_SECONDS, baseMimeType, contentDisposition, downloadOnly, effectiveDisposition, intentLifeSeconds, isPictureType, safeFileName, storedMimeType } from './links';
import { r2FilesPort } from './r2';
import { supabaseStorageFilesPort } from './supabaseStorage';

describe('the type rule (proof.md, Z0a item 6)', () => {
  it('compares a type in lower case without its parameters', () => {
    expect(baseMimeType('TEXT/HTML; charset=utf-8')).toBe('text/html');
    expect(baseMimeType(' Application/PDF ')).toBe('application/pdf');
    expect(baseMimeType('image/svg+xml;foo="a;b"')).toBe('image/svg+xml');
    expect(baseMimeType('')).toBe('');
  });

  it('keeps a value with a comma whole, because a browser takes the last of two joined types (Fetch standard)', () => {
    expect(baseMimeType('image/png;x=1, text/html')).toBe('image/png;x=1, text/html');
    expect(baseMimeType('Text/Plain, TEXT/HTML')).toBe('text/plain, text/html');
  });

  it('signs HTML, SVG, XHTML, XSL and every XML type as download only, in any case and with any parameters', () => {
    for (const type of ['text/html', 'TEXT/HTML', 'text/html; charset=utf-8', 'image/svg+xml', 'Image/SVG+XML; q=1', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/atom+xml', 'application/rss+xml', 'application/vnd.foo+xml', 'text/xsl', 'TEXT/XSL; charset=utf-8']) {
      expect(downloadOnly(type), type).toBe(true);
      expect(effectiveDisposition('inline', type), type).toBe('attachment');
    }
    expect(effectiveDisposition('attachment', 'application/pdf')).toBe('attachment');
  });

  it('lets only a short safe list be inline: every other type, and every value that is not one clean type, is a download', () => {
    for (const type of ['application/pdf', 'Application/PDF', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'text/plain', 'text/plain; charset=utf-8', 'video/mp4', 'video/webm', 'audio/mpeg']) {
      expect(downloadOnly(type), type).toBe(false);
      expect(effectiveDisposition('inline', type), type).toBe('inline');
    }
    for (const type of ['x', 'text', '', 'application/octet-stream', 'image/png;x=1, text/html', 'text/plain, text/html', 'image/x-unknown', 'application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png/x']) {
      expect(downloadOnly(type), type).toBe(true);
      expect(effectiveDisposition('inline', type), type).toBe('attachment');
    }
  });

  it('stores every download-only type as application/octet-stream, and a safe type in its clean form', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'text/xsl', 'x', '', 'image/png;x=1, text/html', 'application/zip']) {
      expect(storedMimeType(type), type).toBe('application/octet-stream');
    }
    expect(storedMimeType('application/pdf')).toBe('application/pdf');
    expect(storedMimeType('Image/PNG; q=1')).toBe('image/png');
  });
});

describe('the pictures and the fake links (task F2)', () => {
  it('takes only an inline-safe picture type as a small picture (thumb), so its link may always show inline', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'IMAGE/WEBP; q=1', 'image/avif']) expect(isPictureType(type), type).toBe(true);
    for (const type of ['image/svg+xml', 'image/x-unknown', 'application/pdf', 'text/plain', 'application/octet-stream', 'image/png, text/html', '']) expect(isPictureType(type), type).toBe(false);
  });

  it('gives the fake files.link the same rule as the real stores: an inline link only for the safe list, every other link is plain data', () => {
    const types = [
      'application/pdf', 'image/png', 'Image/PNG; q=1', 'text/plain', 'video/mp4', 'audio/mpeg', 'text/html', 'TEXT/HTML; charset=utf-8', 'image/svg+xml',
      'application/xhtml+xml', 'text/xml', 'text/xsl', 'application/atom+xml', 'x', '', 'image/x-unknown', 'application/zip', 'image/png;x=1, text/html',
    ];
    for (const type of types) {
      for (const disposition of ['inline', 'attachment'] as const) {
        const real = effectiveDisposition(disposition, type) === 'inline' ? storedMimeType(type) : 'application/octet-stream';
        expect(linkType(type, disposition), `${type} ${disposition}`).toBe(real);
      }
    }
  });
});

describe('the file name of a download (RFC 6266 and RFC 5987)', () => {
  it('gives an ASCII fallback and the UTF-8 name for an Arabic name', () => {
    expect(contentDisposition('attachment', 'مخطط الطابق الأرضي.pdf')).toBe(
      `attachment; filename="____ ______ ______.pdf"; filename*=UTF-8''%D9%85%D8%AE%D8%B7%D8%B7%20%D8%A7%D9%84%D8%B7%D8%A7%D8%A8%D9%82%20%D8%A7%D9%84%D8%A3%D8%B1%D8%B6%D9%8A.pdf`,
    );
    expect(contentDisposition('inline', 'plan.pdf')).toBe(`inline; filename="plan.pdf"; filename*=UTF-8''plan.pdf`);
  });

  it('keeps quotes, back slashes and the characters outside attr-char out of both forms', () => {
    const header = contentDisposition('attachment', `a "b" c'(d)*.txt`);
    expect(header).toBe(`attachment; filename="a _b_ c'(d)*.txt"; filename*=UTF-8''a%20%22b%22%20c%27%28d%29%2A.txt`);
    // The name passes through safeFileName first, so a folder part never reaches the header.
    expect(contentDisposition('inline', 'x/../a\\b.png')).toBe(`inline; filename="b.png"; filename*=UTF-8''b.png`);
  });

  it('makes a safe name: no folders, no control characters, never empty, at most 200 characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a\\b\\c.txt')).toBe('c.txt');
    expect(safeFileName('a\u0000b\nc\u007f.txt')).toBe('abc.txt');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName(`${'x'.repeat(300)}.pdf`)).toHaveLength(200);
    expect(safeFileName(`${'x'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true);
  });
});

describe('the link life of each store (proof.md, Z0a item 6)', () => {
  it('reports 2 hours for a Supabase Storage upload link and 10 minutes for an R2 upload link', () => {
    expect(UPLOAD_LINK_SECONDS).toEqual({ supabase: 7200, r2: 600 });
    expect(DOWNLOAD_LINK_SECONDS).toBe(600);
  });

  it('lets an upload intent live for the link life on Storage, and the link life plus 60 minutes on R2', () => {
    expect(intentLifeSeconds('supabase')).toBe(7200);
    expect(intentLifeSeconds('r2')).toBe(600 + 3600);
  });
});

describe('the size limit of the active store (plan 2b, point 1)', () => {
  it('is 50 MB on Supabase Storage and 250 MB on R2, on each port', () => {
    expect(supabaseStorageFilesPort({ supabaseUrl: 'http://127.0.0.1:54321', secretKey: 'x', bucket: 'madar-files' }).maxFileBytes).toBe(50 * 1024 * 1024);
    expect(r2FilesPort({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'madar-files' }).maxFileBytes).toBe(250 * 1024 * 1024);
  });

  it('is the same number in the port and in config.limits, which session.get returns as limits.maxFileBytes', () => {
    const base: Record<string, string> = {
      DATABASE_URL: 'postgresql://u:p@127.0.0.1:54322/postgres', SUPABASE_URL: 'http://127.0.0.1:54321', MADAR_SECRET_KEY: 'x',
      APP_URL: 'http://127.0.0.1:5173', MAIL_FROM: 'Madar <a@madar.test>', MAIL_DRIVER: 'outbox',
    };
    const stores: Record<string, string>[] = [{}, { MADAR_FILE_STORE: 'supabase' }, { MADAR_FILE_STORE: 'r2', R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' }];
    for (const store of stores) {
      const values = { ...base, ...store };
      const deps = depsFrom(serverEnvFrom((name) => values[name]), { db: {} as never });
      expect(deps.config.limits.maxFileBytes).toBe(deps.files.maxFileBytes);
      expect(deps.files.maxFileBytes).toBe(FILE_STORE_LIMITS[deps.files.kind].maxFileBytes);
    }
  });
});
