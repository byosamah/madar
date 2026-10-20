import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { initI18n } from '../../../i18n';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

async function openShare() {
  await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Share in chat' }));
  return screen.findByRole('dialog', { name: 'Share Site plan.pdf' });
}

// The toast said only "File shared.", so a person could not tell which of three places got the file (audit 2026-10-03, F-20).
describe('the toast after a file is shared', () => {
  it('names the project chat and opens it', async () => {
    const { store, router } = await renderApp(FILES, as('usr_002'));
    const sheet = await openShare();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Shared in the Corniche Office Tower chat.')).toBeInTheDocument();
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inbox/${room?.id}`));
  });

  it('names the person and opens the chat with them', async () => {
    const { store, router } = await renderApp(FILES, as('usr_002'));
    const sheet = await openShare();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Person' }));
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Person' }), 'usr_005');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Shared with Sara Al-Qahtani.')).toBeInTheDocument();
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'direct' && c.memberIds?.includes('usr_005') && c.memberIds.includes('usr_002'));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/inbox/${room?.id}`));
  });

  it('names the task and opens its conversation', async () => {
    const { router } = await renderApp(FILES, as('usr_002'));
    const sheet = await openShare();
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Task' }));
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Task' }), 'tsk_007');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Shared in the task “Stair details”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(router.state.location.search).toContain('task=tsk_007'));
    expect(router.state.location.search).toContain('thread=1');
    expect(await screen.findByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });

  it('names the place in Arabic too', () => {
    const ar = initI18n('en').getFixedT('ar');
    expect(ar('files.sharedChat', { project: 'Corniche Office Tower' })).toBe('أُرسل الملف إلى محادثة Corniche Office Tower.');
    expect(ar('files.sharedPerson', { name: 'Sara Al-Qahtani' })).toBe('أُرسل الملف إلى Sara Al-Qahtani.');
    expect(ar('files.sharedTask', { title: 'Stair details' })).toBe('أُرسل الملف في محادثة المهمة «Stair details».');
    expect(ar('files.sharedOpen')).toBe('افتح');
  });
});
