import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

describe('the Files tab', () => {
  it('groups the files by stage and shows the latest version', async () => {
    await renderApp(FILES);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Ground floor plan.pdf')).toBeInTheDocument();
    expect(within(group).getByText('Version B')).toBeInTheDocument();
  });

  it('uploads a file, and a second upload with the same name becomes version B', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const input = await screen.findByLabelText('Upload files');
    await userEvent.upload(input, new File(['notes'], 'Site notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Files uploaded: 1.')).toBeInTheDocument();
    await userEvent.upload(input, new File(['notes 2'], 'Site notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Site notes.txt')?.versions.map((v) => v.letter)).toEqual(['A', 'B']));
  });

  it('refuses a file over 25 MB before any upload', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const big = new File(['x'], 'Huge model.rvt', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await userEvent.upload(await screen.findByLabelText('Upload files'), big);
    expect(await screen.findByText('Huge model.rvt is larger than 25 MB.')).toBeInTheDocument();
    expect(Object.values(store.state.files).some((f) => f.name === 'Huge model.rvt')).toBe(false);
  });

  it('deletes a file, then brings it back with Undo', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeDefined());
  });

  it('sets an image as the project cover', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Massing view.svg' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set as cover' }));
    await waitFor(() => expect(store.state.projects.prj_001.coverFileId).toBe('fil_002'));
  });
});
