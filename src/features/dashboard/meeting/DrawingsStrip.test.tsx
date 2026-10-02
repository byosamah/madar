import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

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
