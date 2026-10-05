import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { projectRoleOf } from '../../../api/permissions';
import { renderApp } from '../../../test/render';

// Hala (usr_001, the Admin) opens the task. Khalid Al-Mutairi is usr_008, Lina Mansour is usr_007.
// "Stair details" (tsk_007) in Corniche Office Tower is led by Yousef Saleh; "Facade details" (tsk_021) in Dune Line Townhouses by Sara.
const TASK = (project: string, task: string) => `/projects/${project}?tab=tasks&task=${task}`;

// A new lead gets the usual Undo toast, which says when the person also joined the team. One Undo takes back both
// (audit 2026-10-03, F-22).
describe('a new lead for a task (audit 2026-10-03, F-22)', () => {
  it('says who leads the task now, and Undo gives it back', async () => {
    const { store } = await renderApp(TASK('prj_001', 'tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_008');
    expect(await screen.findByText('Khalid Al-Mutairi now leads this task.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_007.ownerId).toBe('usr_008');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.ownerId).toBe('usr_006'));
  });

  it('says in the same toast that the person joined the team, and one Undo takes back both', async () => {
    const { store } = await renderApp(TASK('prj_002', 'tsk_021'));
    expect(projectRoleOf(store.state, 'prj_002', 'usr_008')).toBe('other');
    const sheet = await screen.findByRole('dialog', { name: 'Facade details' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Lead'), 'usr_008');
    expect(await screen.findByText('Khalid Al-Mutairi now leads this task and joined the project team.')).toBeInTheDocument();
    expect(projectRoleOf(store.state, 'prj_002', 'usr_008')).not.toBe('other');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_021.ownerId).toBe('usr_005'));
    expect(projectRoleOf(store.state, 'prj_002', 'usr_008')).toBe('other');
  });

  it('uses the form for a woman in Arabic', async () => {
    await renderApp(TASK('prj_002', 'tsk_021'), (state: State) => {
      state.users.usr_001.preferences.language = 'ar';
    });
    const sheet = await screen.findByRole('dialog', { name: 'Facade details' });
    await userEvent.selectOptions(await within(sheet).findByLabelText('المسؤول الرئيسي'), 'usr_007');
    expect(await screen.findByText(/^أصبحت لينا منصور المسؤولة الرئيسية عن هذه المهمة/)).toBeInTheDocument();
  });
});
