import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

const pressDeactivate = async (name: string) => {
  const people = await screen.findByRole('region', { name: 'People' });
  await userEvent.click(await within(people).findByRole('button', { name: `Actions for ${name}` }));
  await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Deactivate' }));
};

// Owner decision 2026-10-03 on API-7: Madar warns before it turns off a person with live work, and then allows it. It never refuses.
describe('the warning before Deactivate (owner, 2026-10-03, API-7)', () => {
  it('shows the projects a leader leads and their open tasks, each a link, and Cancel keeps the person active', async () => {
    const { store } = await renderApp('/admin');
    await pressDeactivate('Omar Haddad');
    const sheet = await screen.findByRole('dialog', { name: 'Deactivate Omar Haddad?' });
    expect(within(sheet).getByText('Their reviews go to the Admins, and nobody can give them new work.')).toBeInTheDocument();
    // Omar also led a completed project. It is not live work, so the sheet does not list it.
    const led = within(sheet).getByRole('region', { name: 'Projects they lead' });
    expect(within(led).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'KH-26-003Eastern Shore Primary School',
      'KH-26-007Seaside Villa Compound',
    ]);
    // The Team tab is where the leader changes.
    expect(within(led).getByRole('link', { name: /Eastern Shore Primary School/ })).toHaveAttribute('href', '#/projects/prj_003?tab=team');
    const open = within(sheet).getByRole('region', { name: '5 open tasks' });
    const tasks = within(open).getAllByRole('link');
    expect(tasks).toHaveLength(5);
    for (const task of tasks) expect(task).toHaveAttribute('href', expect.stringMatching(/^#\/projects\/prj_00[37]\?tab=tasks&task=tsk_\w+$/));
    expect(within(open).queryByText(/more task/)).toBeNull();
    // A double press must not turn the person off: Cancel takes the focus, and the confirm sits on the start side.
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(sheet).getByRole('button', { name: 'Deactivate anyway' })).toHaveClass('me-auto');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.state.users.usr_004.active).toBe(true);
    expect(screen.queryByText('Omar Haddad deactivated.')).toBeNull();
  });

  it('warns about a person who only has open tasks, shows the first 8, and turns them off anyway with the usual Undo', async () => {
    const { store } = await renderApp('/admin');
    await pressDeactivate('Sara Al-Qahtani');
    const sheet = await screen.findByRole('dialog', { name: 'Deactivate Sara Al-Qahtani?' });
    expect(within(sheet).queryByRole('region', { name: 'Projects they lead' })).toBeNull();
    const open = within(sheet).getByRole('region', { name: '10 open tasks' });
    expect(within(open).getAllByRole('link')).toHaveLength(8);
    expect(within(open).getByText('2 more tasks')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Deactivate anyway' }));
    await waitFor(() => expect(store.state.users.usr_005.active).toBe(false));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Sara Al-Qahtani deactivated.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_005.active).toBe(true));
  });

  it('warns about a leader with no open task, also for a paused project', async () => {
    await renderApp('/admin', (state) => {
      state.projects.prj_009.leaderId = 'usr_011';
    });
    await pressDeactivate('Noura Al-Shammari');
    const sheet = await screen.findByRole('dialog', { name: 'Deactivate Noura Al-Shammari?' });
    const led = within(sheet).getByRole('region', { name: 'Projects they lead' });
    expect(within(led).getByRole('link', { name: /Gulf Crest HQ Interiors/ })).toHaveAttribute('href', '#/projects/prj_009?tab=team');
    expect(within(sheet).queryByRole('region', { name: /open task/ })).toBeNull();
  });

  it('turns off a person with no live work at once: a completed project and a done task do not count', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.projects.prj_010.leaderId = 'usr_011';
      // tsk_028 is done on the active project prj_003. Noura helps on it, so the helper path counts too (audit 2026-10-03, warn repair).
      state.tasks.tsk_028.helperIds = ['usr_011'];
    });
    await pressDeactivate('Noura Al-Shammari');
    await waitFor(() => expect(store.state.users.usr_011.active).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Noura Al-Shammari deactivated.')).toBeInTheDocument();
  });

  it('turns no one off when the check of their work fails, and Retry asks again', async () => {
    const { store } = await renderApp('/admin', undefined, {
      failFirst: (name, input) => name === 'tasks.list' && (input as { ownerId?: string }).ownerId === 'usr_004',
    });
    await pressDeactivate('Omar Haddad');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(store.state.users.usr_004.active).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('dialog', { name: 'Deactivate Omar Haddad?' })).toBeInTheDocument();
    expect(store.state.users.usr_004.active).toBe(true);
  });

  it('warns Management too, who may deactivate a person who is not an Admin', async () => {
    const { store } = await renderApp('/admin', (state) => {
      state.session.currentUserId = 'usr_010';
    });
    await pressDeactivate('Omar Haddad');
    const sheet = await screen.findByRole('dialog', { name: 'Deactivate Omar Haddad?' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Deactivate anyway' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(false));
  });

  it('speaks Arabic with the feminine form for a woman, and Arabic plural forms for the counts', async () => {
    await renderApp('/admin', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      state.projects.prj_009.leaderId = 'usr_005';
    });
    const people = await screen.findByRole('region', { name: 'الأشخاص' });
    await userEvent.click(await within(people).findByRole('button', { name: 'إجراءات Sara Al-Qahtani' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'إيقاف الحساب' }));
    const sheet = await screen.findByRole('dialog', { name: 'إيقاف حساب Sara Al-Qahtani؟' });
    expect(within(sheet).getByText('تذهب المهام التي تنتظر مراجعتها إلى مديري النظام، ولا يمكن لأحد أن يسند إليها عملًا جديدًا.')).toBeInTheDocument();
    expect(within(sheet).getByRole('region', { name: 'المشاريع التي تقودها' })).toBeInTheDocument();
    // 10 takes the Arabic plural for 3 to 10, and 2 takes the dual.
    const open = within(sheet).getByRole('region', { name: '10 مهام مفتوحة' });
    expect(within(open).getByText('مهمتان أخريان')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'إيقاف الحساب رغم ذلك' })).toBeInTheDocument();
  });
});
