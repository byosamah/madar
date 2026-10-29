import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../../api/calls';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { stubPhone } from '../../inbox/phoneHarness';
import { PreviewSheet, type PreviewView } from '../../project/files/PreviewSheet';
import { DOCX, OFFICE_MAX_BYTES, XLSX } from './officeKind';
import { sampleDocx, sampleXlsx } from './officeFixtures';

/**
 * A Word file and an Excel file open in the preview (tsk_495, owner 2026-10-29: "view files without a download"). Madar draws the file
 * itself in the browser. The real build reads the bytes of the signed link with fetch (the store allows a GET from the page, as "Download
 * all" does). The prototype reads the stored data with files.get. The bytes never go to another service.
 */
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const view = (id: string, name: string, mimeType: string, size = 1000): PreviewView => ({ file: { id, name }, latest: { letter: 'B', mimeType, size } });

type Call = { name: string; input: Record<string, unknown> };
type Setup = { mode: Runtime['mode']; bytes?: ArrayBuffer; refuse?: boolean; contentLength?: number };

/** The sheet in one build. `fetch` is a spy: the real build must read the signed link with it, and nothing else. */
function renderPreview(v: PreviewView, o: Setup) {
  initI18n('en');
  const calls: Call[] = [];
  const fetched: { url: string; init?: RequestInit }[] = [];
  const cancel = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetched.push({ url, init });
    const body = o.bytes ?? new ArrayBuffer(0);
    const response = new Response(body, { status: 200, headers: o.contentLength === undefined ? {} : { 'content-length': String(o.contentLength) } });
    Object.defineProperty(response, 'body', { value: { cancel } });
    if (o.contentLength !== undefined) Object.defineProperty(response, 'arrayBuffer', { value: async () => { throw new Error('The body must not be read.'); } });
    return response;
  });
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      calls.push({ name, input });
      if (name === 'files.link') {
        if (o.refuse) throw Object.assign(new Error('You cannot open this file.'), { code: 'not_found' });
        return { url: 'https://store.test/signed', expiresAt: 'x', name: v.file.name, mimeType: v.latest.mimeType, size: 10 };
      }
      if (name === 'files.get') return { blob: new Blob([o.bytes ?? new ArrayBuffer(0)], { type: v.latest.mimeType }), file: v };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  const runtime: Runtime = { api, mode: o.mode };
  render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
      <ToastProvider><PreviewSheet views={[v]} index={0} onIndex={() => undefined} onClose={() => undefined} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { calls, fetched, cancel };
}

describe('a Word file in the preview', () => {
  it('draws the page in a frame with no script rights, and says in one quiet line that the layout is close', async () => {
    const { calls, fetched } = renderPreview(view('fil_950', 'Report.docx', DOCX), { mode: 'remote', bytes: await sampleDocx() });
    const sheet = await screen.findByRole('dialog', { name: 'Report.docx' });
    const frame = await waitFor(() => {
      const found = sheet.querySelector('iframe');
      if (!found) throw new Error('No frame yet.');
      return found;
    });
    // The frame has the empty sandbox: no script, no form, no popup, no same-origin right.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame).toHaveAttribute('title', 'Page of Report.docx');
    const doc = frame.getAttribute('srcdoc') ?? '';
    expect(doc).toContain('Site report');
    expect(doc).toContain('data:image/png;base64,');
    // A second wall: the page inside the frame has its own CSP that allows no script, no connection and only data pictures.
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('img-src data:');
    expect(doc.toLowerCase()).not.toContain('<script');
    expect(doc).not.toContain('example.com');
    expect(within(sheet).getByText('This view is close to the file, not exact. Download the file to see the exact layout.')).toBeInTheDocument();
    // The real build asks for a signed link as the person, reads it with fetch and sends no cookie.
    expect(calls).toEqual([{ name: 'files.link', input: { id: 'fil_950', letter: 'B', variant: 'full', disposition: 'attachment' } }]);
    expect(fetched).toEqual([{ url: 'https://store.test/signed', init: expect.objectContaining({ credentials: 'omit' }) }]);
  });

  it('reads the stored data in the prototype and makes no fetch', async () => {
    const { calls, fetched } = renderPreview(view('fil_951', 'Report.docx', DOCX), { mode: 'prototype', bytes: await sampleDocx() });
    const sheet = await screen.findByRole('dialog', { name: 'Report.docx' });
    await waitFor(() => expect(sheet.querySelector('iframe')?.getAttribute('srcdoc')).toContain('Site report'));
    expect(calls).toEqual([{ name: 'files.get', input: { id: 'fil_951', letter: 'B' } }]);
    expect(fetched).toEqual([]);
  });

  it('keeps the Download button in the foot, and draws the same page on a phone, inside the sheet and not as a link out', async () => {
    stubPhone();
    renderPreview(view('fil_952', 'Report.docx', DOCX), { mode: 'prototype', bytes: await sampleDocx() });
    const sheet = await screen.findByRole('dialog', { name: 'Report.docx' });
    await waitFor(() => expect(sheet.querySelector('iframe')).not.toBeNull());
    expect(within(sheet).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('link')).toBeNull();
  });
});

describe('an Excel file in the preview', () => {
  const rows = [['Item', 'Count'], ['Columns', 12]];

  it('draws each sheet as a table with one tab for each sheet, and shows the text of a cell as text', async () => {
    const bytes = await sampleXlsx([
      { name: 'Quantities', rows: [...rows, ['<img src=x onerror=alert(1)>', 1]] },
      { name: 'Costs', rows: [['Total', 900]] },
    ]);
    renderPreview(view('fil_953', 'Quantities.xlsx', XLSX), { mode: 'remote', bytes });
    const sheet = await screen.findByRole('dialog', { name: 'Quantities.xlsx' });
    const tabs = await within(sheet).findByRole('tablist', { name: 'Sheets' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Quantities', 'Costs']);
    expect(within(sheet).getByRole('cell', { name: 'Columns' })).toBeInTheDocument();
    // A cell is text: a tag in a cell shows as the tag, and no element is made from it.
    expect(within(sheet).getByRole('cell', { name: '<img src=x onerror=alert(1)>' })).toBeInTheDocument();
    expect(sheet.querySelector('img')).toBeNull();
    expect(sheet.querySelector('iframe')).toBeNull();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Costs' }));
    expect(within(sheet).getByRole('cell', { name: 'Total' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('cell', { name: 'Columns' })).toBeNull();
    expect(within(sheet).getByText('This view is close to the file, not exact. Download the file to see the exact layout.')).toBeInTheDocument();
  });

  it('shows no tabs for a file with one sheet', async () => {
    renderPreview(view('fil_954', 'One.xlsx', XLSX), { mode: 'prototype', bytes: await sampleXlsx([{ name: 'Only', rows }]) });
    const sheet = await screen.findByRole('dialog', { name: 'One.xlsx' });
    expect(await within(sheet).findByRole('cell', { name: 'Columns' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('tablist')).toBeNull();
  });

  it('cuts a long sheet at 1,000 rows and 50 columns and says the rest is in the download', async () => {
    const wide = Array.from({ length: 60 }, (_, c) => `C${c}`);
    const bytes = await sampleXlsx([{ name: 'Big', rows: [wide, ...Array.from({ length: 1100 }, (_, r) => wide.map((_, c) => r + c))] }]);
    renderPreview(view('fil_955', 'Big.xlsx', XLSX), { mode: 'prototype', bytes });
    const sheet = await screen.findByRole('dialog', { name: 'Big.xlsx' });
    expect(await within(sheet).findByText('Madar shows the first 1000 rows and 50 columns of this sheet. Download the file to see the rest.')).toBeInTheDocument();
    expect(sheet.querySelectorAll('tbody tr')).toHaveLength(1000);
    expect(sheet.querySelectorAll('tbody tr:first-child td')).toHaveLength(50);
  }, 30_000);

  it('draws the table inside the sheet on a phone', async () => {
    stubPhone();
    renderPreview(view('fil_956', 'One.xlsx', XLSX), { mode: 'prototype', bytes: await sampleXlsx([{ name: 'Only', rows }]) });
    const sheet = await screen.findByRole('dialog', { name: 'One.xlsx' });
    expect(await within(sheet).findByRole('cell', { name: 'Columns' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('link')).toBeNull();
  });
});

describe('a file that the preview does not draw', () => {
  it('shows a short line and the Download button, and reads nothing, for a file above the size limit', async () => {
    const { calls, fetched } = renderPreview(view('fil_957', 'Huge.docx', DOCX, OFFICE_MAX_BYTES + 1), { mode: 'remote' });
    const sheet = await screen.findByRole('dialog', { name: 'Huge.docx' });
    expect(within(sheet).getByText('This file is too big to show here. Download it to open it.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(sheet.querySelector('iframe')).toBeNull();
    expect(calls).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it('stops at the size that the store declares, and does not read the body', async () => {
    const { cancel } = renderPreview(view('fil_958', 'Huge.xlsx', XLSX, 10), { mode: 'remote', contentLength: OFFICE_MAX_BYTES + 1 });
    const sheet = await screen.findByRole('dialog', { name: 'Huge.xlsx' });
    expect(await within(sheet).findByText('This file is too big to show here. Download it to open it.')).toBeInTheDocument();
    expect(cancel).toHaveBeenCalled();
  });

  it('says so for a file that is no Word file, and keeps the Download button', async () => {
    renderPreview(view('fil_959', 'Fake.docx', DOCX), { mode: 'prototype', bytes: new TextEncoder().encode('just words').buffer as ArrayBuffer });
    const sheet = await screen.findByRole('dialog', { name: 'Fake.docx' });
    expect(await within(sheet).findByText('Madar cannot show this file. Download it to open it.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('keeps the rights of the download: a refused link draws nothing', async () => {
    const { fetched } = renderPreview(view('fil_960', 'Report.docx', DOCX), { mode: 'remote', refuse: true });
    const sheet = await screen.findByRole('dialog', { name: 'Report.docx' });
    expect(await within(sheet).findByText('Madar cannot show this file. Download it to open it.')).toBeInTheDocument();
    expect(sheet.querySelector('iframe')).toBeNull();
    expect(fetched).toEqual([]);
  });

  it('keeps PowerPoint, the old Word and the old Excel as the plain line', async () => {
    renderPreview(view('fil_961', 'Deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), { mode: 'prototype' });
    const sheet = await screen.findByRole('dialog', { name: 'Deck.pptx' });
    expect(within(sheet).getByText('There is no preview for this file type.')).toBeInTheDocument();
  });
});
