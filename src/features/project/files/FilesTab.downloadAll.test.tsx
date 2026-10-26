import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { MadarApi } from '../../../api/calls';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { parseZip } from '../../../test/zipRead';
import { FilesTab } from './FilesTab';

const view = (id: string, name: string, stageId: string | null): FileView => ({
  file: { id, projectId: 'prj_001', stageId, taskId: null, name, versions: [{ letter: 'A' }, { letter: 'B' }] },
  latest: { letter: 'B', blobKey: 'k', mimeType: 'application/pdf', size: 2048, uploadedBy: 'usr_001', uploadedAt: '2026-09-29T10:00:00.000+03:00' },
  uploader: { id: 'usr_001', name: 'Osama' },
  canDelete: false,
} as unknown as FileView);

const detail = (o: { kind?: 'internal'; code?: string } = {}) => ({
  project: { id: 'prj_001', name: 'Corniche Office Tower', code: o.code ?? '260902AZT-RES-Multi-unit Dev.', ...(o.kind ? { kind: o.kind } : {}), coverFileId: null },
  stages: [{ id: 'stg_001', name: 'Concept Design' }, { id: 'stg_002', name: 'Schematic Design' }],
  currentStage: { id: 'stg_001', name: 'Concept Design' },
  viewerCan: {},
} as unknown as ProjectDetail);

let saved: { blob: Blob; name: string }[] = [];

function renderTab(files: FileView[], project: ProjectDetail = detail(), mode: 'remote' | 'prototype' = 'remote') {
  const links: Record<string, unknown>[] = [];
  const api = {
    call: async (name: string, input: Record<string, unknown>) => {
      if (name === 'files.link') {
        links.push(input);
        return { url: `https://store.test/${String(input.id)}`, expiresAt: 'x', name: 'x.pdf', mimeType: 'application/pdf', size: 1 };
      }
      if (name === 'files.get') return { blob: new Blob([`data of ${String(input.id)}`]), file: { file: { name: 'x' } } };
      if (name === 'files.list') return files;
      if (name === 'session.get') return { limits: { maxFileBytes: 50 * 1024 * 1024 } };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, blob: async () => new Blob([`body of ${url.split('/').pop()}`]) })));
  const runtime: Runtime = { api, mode };
  initI18n('en');
  const router = createMemoryRouter([{ path: '*', element: <FilesTab detail={project} /> }], { initialEntries: ['/projects/prj_001?tab=files'] });
  render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: mode === 'remote' })}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { links };
}

beforeEach(() => {
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ blob: blob as Blob, name: '' });
    return 'blob:zip';
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    saved[saved.length - 1].name = this.download;
  });
});
afterEach(() => vi.unstubAllGlobals());

const TWO_STAGES = [
  view('fil_001', 'Site plan.pdf', 'stg_001'),
  view('fil_002', 'Annex floor.pdf', 'stg_001'),
  view('fil_003', 'Elevations.pdf', 'stg_002'),
  view('fil_004', 'Notes.pdf', null),
];

describe('Download all on the Files tab (fbk_050)', () => {
  it('shows one button at the end of each stage heading with two files or more, and none for a stage with one file', async () => {
    renderTab(TWO_STAGES);
    const concept = (await screen.findByRole('heading', { name: 'Concept Design' })).closest('section') as HTMLElement;
    expect(within(concept).getByRole('button', { name: 'Download all files of Concept Design (2)' })).toHaveTextContent('Download all (2)');
    const schematic = screen.getByRole('heading', { name: 'Schematic Design' }).closest('section') as HTMLElement;
    expect(within(schematic).queryByRole('button', { name: /Download all/ })).toBeNull();
    const none = screen.getByRole('heading', { name: 'No stage' }).closest('section') as HTMLElement;
    expect(within(none).queryByRole('button', { name: /Download all/ })).toBeNull();
  });

  it('puts the heading and its button in one row', async () => {
    renderTab(TWO_STAGES);
    const heading = await screen.findByRole('heading', { name: 'Concept Design' });
    const button = screen.getByRole('button', { name: 'Download all files of Concept Design (2)' });
    // The heading row also holds "+ Folder" before the button (fbk_066), so the button sits in the row of the heading, not beside it directly.
    expect(heading.parentElement).toContainElement(button);
  });

  it('shows one button for the whole project when the files sit in more than one group', async () => {
    renderTab(TWO_STAGES);
    expect(await screen.findByRole('button', { name: 'Download all files (4)' })).toBeInTheDocument();
  });

  it('shows no second button for the whole project when one group holds every file', async () => {
    renderTab([view('fil_001', 'Site plan.pdf', 'stg_001'), view('fil_002', 'Annex floor.pdf', 'stg_001')]);
    await screen.findByRole('heading', { name: 'Concept Design' });
    expect(screen.getAllByRole('button', { name: /Download all/ })).toHaveLength(1);
  });

  it('shows no button for fewer than two files', async () => {
    renderTab([view('fil_001', 'Site plan.pdf', 'stg_001')]);
    await screen.findByRole('heading', { name: 'Concept Design' });
    expect(screen.queryByRole('button', { name: /Download all/ })).toBeNull();
  });

  it('saves the files of a stage as one ZIP file named with the project key and the stage, newest version of each', async () => {
    const user = userEvent.setup();
    const { links } = renderTab(TWO_STAGES);
    await user.click(await screen.findByRole('button', { name: 'Download all files of Concept Design (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('260902AZT Concept Design.zip');
    // No letter: the store gives the newest version, as a plain tap does.
    expect(links.filter((input) => input.disposition === 'attachment')).toEqual([
      { id: 'fil_001', variant: 'full', disposition: 'attachment' },
      { id: 'fil_002', variant: 'full', disposition: 'attachment' },
    ]);
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name)).toEqual(['Site plan.pdf', 'Annex floor.pdf']);
  });

  it('saves every file of the project as one ZIP file named with the project key and the project name', async () => {
    const user = userEvent.setup();
    renderTab(TWO_STAGES);
    await user.click(await screen.findByRole('button', { name: 'Download all files (4)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('260902AZT Corniche Office Tower.zip');
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => entry.name)).toEqual(['Site plan.pdf', 'Annex floor.pdf', 'Elevations.pdf', 'Notes.pdf']);
  });

  it('uses the word Internal for the key of an internal project', async () => {
    const user = userEvent.setup();
    renderTab(TWO_STAGES, detail({ kind: 'internal', code: 'INT-26-001' }));
    await user.click(await screen.findByRole('button', { name: 'Download all files (4)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0].name).toBe('Internal Corniche Office Tower.zip');
  });

  it('works in the prototype with the stored data', async () => {
    const user = userEvent.setup();
    renderTab(TWO_STAGES, detail(), 'prototype');
    await user.click(await screen.findByRole('button', { name: 'Download all files of Concept Design (2)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    const zip = await parseZip(saved[0].blob);
    expect(zip.entries.map((entry) => new TextDecoder().decode(entry.bytes))).toEqual(['data of fil_001', 'data of fil_002']);
  });
});
