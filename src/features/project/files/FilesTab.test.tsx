import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { ApiError } from '../../../api/errors';

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

  it('retries only the files that did not upload', async () => {
    const { store, api } = await renderApp(FILES, as('usr_005'));
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'files.upload' && (input as { name: string }).name === 'Two.txt' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.upload(await screen.findByLabelText('Upload files'), [new File(['1'], 'One.txt', { type: 'text/plain' }), new File(['2'], 'Two.txt', { type: 'text/plain' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Two.txt')).toBeDefined());
    expect(Object.values(store.state.files).find((f) => f.name === 'One.txt')?.versions).toHaveLength(1);
  });

  it('shares a file into the project chat from the file menu', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share in chat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share Site plan.pdf' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Message (optional)' }), 'Please check this.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('File shared.')).toBeInTheDocument();
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001');
    const message = Object.values(store.state.messages).find((m) => m.conversationId === room?.id && m.body === 'Please check this.');
    expect(message?.fileIds).toEqual(['fil_004']);
  });

  it('shows the refusal when the person picked is not on the project', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    const outsider = Object.values(store.state.users).find((u) => u.kind === 'human' && u.active && u.id !== 'usr_002'
      && !store.state.members[`prj_001:${u.id}`] && store.state.projects.prj_001.leaderId !== u.id && u.systemRole !== 'admin');
    expect(outsider).toBeDefined();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share in chat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share Site plan.pdf' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Person' }));
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Person' }), outsider?.id as string);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('This person is not on the project of this file. They cannot open it.')).toBeInTheDocument();
    expect(Object.values(store.state.messages).some((m) => m.fileIds?.includes('fil_004'))).toBe(false);
  });

  it('shows a focus ring on Upload files', async () => {
    await renderApp(FILES, as('usr_005'));
    expect((await screen.findByText('Upload files')).closest('label')).toHaveClass('has-[:focus-visible]:outline-2');
  });
});
