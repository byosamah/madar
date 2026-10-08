import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MadarApi } from '../../../api/calls';
import type { FileView } from '../../../api/contract/views';
import type { State } from '../../../api/store';
import { RuntimeProvider, createQueryClient } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { renderApp } from '../../../test/render';
import { DrawingsStrip } from './DrawingsStrip';

const MEETING = '/dashboard/meeting?mode=projects';

const lateFirst = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};

const file = (n: number, name: string, mimeType: string) => ({
  id: `fil_90${n}`, projectId: 'prj_011', stageId: null, taskId: null, name,
  versions: [{ letter: 'A', blobKey: `blob_9${n}`, mimeType, size: 1000, uploadedBy: 'usr_001', uploadedAt: `2026-09-${10 + n}T10:00:00.000+03:00` }],
});

/** Shore Walk (prj_011) is the first project screen, with none of its sample files. */
const clearFiles = (state: State) => {
  lateFirst(state);
  for (const id of Object.keys(state.files)) if (state.files[id].projectId === 'prj_011') delete state.files[id];
};

/** Seven drawings (day 11 to day 17, so "Plan 7" is the newest) and one text file that is not a drawing. */
const withDrawings = (state: State) => {
  clearFiles(state);
  for (let n = 1; n <= 7; n += 1) {
    const f = file(n, `Plan ${n}.${n === 3 ? 'pdf' : 'png'}`, n === 3 ? 'application/pdf' : 'image/png');
    state.files[f.id] = f;
  }
  const notes = file(8, 'Notes.txt', 'text/plain');
  notes.versions[0].uploadedAt = '2026-09-29T10:00:00.000+03:00';
  state.files[notes.id] = notes;
};

const noDrawings = (state: State) => {
  clearFiles(state);
  const notes = file(8, 'Notes.txt', 'text/plain');
  state.files[notes.id] = notes;
};

describe('drawings in the meeting (owner, 2026-10-02)', () => {
  it('shows the 6 newest drawings, newest first, and skips other files', async () => {
    await renderApp(MEETING, withDrawings);
    const strip = within(await screen.findByRole('region', { name: 'Drawings' }));
    const items = strip.getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([7, 6, 5, 4, 3, 2].map((n) => expect.stringContaining(`Plan ${n}`)));
  });

  it('opens the preview with a press, goes to the next drawing, and Escape closes only the preview', async () => {
    await renderApp(MEETING, withDrawings);
    const strip = within(await screen.findByRole('region', { name: 'Drawings' }));
    await userEvent.click(strip.getByRole('button', { name: /Plan 7/ }));
    expect(await screen.findByRole('dialog', { name: 'Plan 7.png' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next drawing' }));
    expect(await screen.findByRole('dialog', { name: 'Plan 6.png' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Previous drawing' }));
    expect(await screen.findByRole('dialog', { name: 'Plan 7.png' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agenda 1 of 9/ })).toBeInTheDocument();
  });

  it('scrolls with the panels, so nothing is pinned under the panels', async () => {
    await renderApp(MEETING, withDrawings);
    const article = within(await screen.findByRole('article'));
    const scrollAreaOf = (node: HTMLElement) => node.closest('.overflow-y-auto');
    const drawings = scrollAreaOf(await article.findByRole('region', { name: 'Drawings' }));
    expect(drawings).not.toBeNull();
    for (const name of ['Needs attention', 'Decisions', 'Latest update']) expect(scrollAreaOf(article.getByRole('region', { name }))).toBe(drawings);
    // The project header, with its people, stays in place above the scroll area.
    expect(scrollAreaOf(article.getByRole('heading', { level: 2 }))).toBeNull();
    expect(scrollAreaOf(article.getByRole('region', { name: 'People' }))).toBeNull();
  });

  it('shows no Drawings region when the project has no image or PDF file', async () => {
    await renderApp(MEETING, noDrawings);
    await screen.findByRole('article');
    expect(screen.queryByRole('region', { name: 'Drawings' })).toBeNull();
  });
});

describe('drawings in the meeting in the real build (plan 5.2)', () => {
  it('show the small pictures, and let the browser load and decode them only near the view (performance audit BGR-4)', async () => {
    const drawing = {
      file: { id: 'fil_901', projectId: 'prj_011', stageId: null, taskId: null, name: 'Plan 1.png', versions: [] },
      latest: { letter: 'A', blobKey: 'k', mimeType: 'image/png', size: 10, uploadedBy: 'usr_001', uploadedAt: '2026-09-29T10:00:00.000+03:00' },
    } as unknown as FileView;
    const api = {
      call: async (name: string) => {
        if (name === 'files.list') return [drawing];
        if (name === 'files.link') return { url: 'https://store.test/link-1', expiresAt: 'x', name: 'Plan 1.png', mimeType: 'image/png', size: 1 };
        throw new Error(`unexpected ${name}`);
      },
      run: async () => { throw new Error('not used'); },
    } as unknown as MadarApi;
    initI18n('en');
    const { container } = render(
      <RuntimeProvider runtime={{ api, mode: 'remote' }} queryClient={createQueryClient({ remote: true })}>
        <ToastProvider><DrawingsStrip projectId="prj_011" /></ToastProvider>
      </RuntimeProvider>,
    );
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://store.test/link-1'));
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(container.querySelector('img')).toHaveAttribute('decoding', 'async');
  });
});
