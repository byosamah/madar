import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Notification } from '../../api/contract/entities';
import type { State } from '../../api/store';
import { personName } from '../../lib/personName';
import { renderApp } from '../../test/render';

/**
 * The bell line of a copy for an Admin who picked "Everything" (owner, 2026-10-23). Hala (usr_001) is the Admin. Faisal (usr_002) is a man,
 * Reem (usr_003) is a woman. A copy names the actor and the people that the original went to.
 */
const STAMP = '2026-09-30T08:00:00.000+03:00';
let seq = 900;

function copy(over: Partial<Notification>): Notification {
  seq += 1;
  return {
    id: `ntf_${seq}`, userId: 'usr_001', trigger: 'task_assigned', actorId: 'usr_002', targetType: 'task', targetId: 'tsk_x', read: false, createdAt: STAMP,
    dedupeKey: null, forUserIds: ['usr_004'], ...over,
  };
}
const plant = (state: State, list: Notification[]) => {
  for (const n of list) state.notifications[n.id] = n;
};
/** The text of a line without the isolate marks that keep each name in its own direction. */
const line = (text: string) => (content: string) => content.replace(/[⁦-⁩]/g, '') === text;
const taskOf = (state: State) => Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!;
const towerOf = (state: State) => Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!;

describe('the bell line of a copy', () => {
  it('names the actor and the people of the original for a task, a project, a comment and a chat message', async () => {
    let names: Record<string, string> = {};
    await renderApp('/notifications', (state) => {
      const task = taskOf(state);
      task.title = 'Stair details';
      names = Object.fromEntries(Object.values(state.users).map((u) => [u.id, personName(u, 'en')]));
      plant(state, [
        copy({ targetId: task.id }),
        copy({ trigger: 'review_requested', targetId: task.id, forUserIds: ['usr_002'] }),
        copy({ trigger: 'task_approved', targetId: task.id, actorId: 'usr_003', forUserIds: ['usr_004', 'usr_005'] }),
        copy({ trigger: 'added_to_project', targetType: 'project', targetId: 'prj_001' }),
        copy({ trigger: 'mention', targetType: 'chat', targetId: towerOf(state).id, messageId: 'msg_1' }),
        copy({ trigger: 'mention', targetType: 'chat', targetId: towerOf(state).id, messageId: 'msg_2', reply: true }),
        copy({ trigger: 'mention', targetType: 'task', targetId: task.id, messageId: 'cmt_1' }),
      ]);
    });
    const p = (id: string) => names[id];
    expect(await screen.findByText(line(`${p('usr_002')} gave ${p('usr_004')} “Stair details”`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} sent “Stair details” to ${p('usr_002')} for review`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_003')} approved “Stair details” and told ${p('usr_004')} and ${p('usr_005')}`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} added ${p('usr_004')} to Corniche Office Tower`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} mentioned ${p('usr_004')} in Corniche Office Tower`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} replied to ${p('usr_004')} in Corniche Office Tower`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} mentioned ${p('usr_004')} in a comment on “Stair details”`))).toBeInTheDocument();
  });

  it('shortens a long list of people to two names and the number of the others', async () => {
    let names: Record<string, string> = {};
    await renderApp('/notifications', (state) => {
      names = Object.fromEntries(Object.values(state.users).map((u) => [u.id, personName(u, 'en')]));
      plant(state, [
        copy({ trigger: 'stage_changed', targetType: 'project', targetId: 'prj_001', forUserIds: ['usr_003', 'usr_004', 'usr_005'] }),
        copy({ trigger: 'stage_changed', targetType: 'project', targetId: 'prj_001', forUserIds: ['usr_003', 'usr_004', 'usr_005', 'usr_006', 'usr_007'] }),
      ]);
    });
    const p = (id: string) => names[id];
    expect(await screen.findByText(line(`${p('usr_002')} changed the stage of Corniche Office Tower and told ${p('usr_003')}, ${p('usr_004')} and ${p('usr_005')}`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} changed the stage of Corniche Office Tower and told ${p('usr_003')}, ${p('usr_004')} and 3 others`))).toBeInTheDocument();
  });

  it('opens like the original and counts on the bell', async () => {
    let id = '';
    await renderApp('/notifications', (state) => {
      id = taskOf(state).id;
      state.tasks[id].title = 'Stair details';
      plant(state, [copy({ targetId: id })]);
    });
    const row = (await screen.findByText(/gave .* “Stair details”/)).closest('li')!;
    expect(within(row).getByRole('link')).toHaveAttribute('href', expect.stringContaining(id));
  });

  it('says one line for a copy of an office task that the person no longer sees, and names nobody', async () => {
    await renderApp('/notifications', (state) => {
      // The person is no longer an Admin, so an office task of other people is hidden (owner, 2026-10-06).
      state.users.usr_001.systemRole = 'management';
      state.tasks.tsk_900 = { ...taskOf(state), id: 'tsk_900', projectId: null, stageId: null, title: 'Secret errand', ownerId: 'usr_003', createdBy: 'usr_003', helperIds: [] };
      plant(state, [copy({ targetId: 'tsk_900', forUserIds: ['usr_004'] })]);
    });
    expect(await screen.findByText('A change that you can no longer see')).toBeInTheDocument();
    expect(screen.queryByText(/Secret errand/)).toBeNull();
  });

  it('reads the Arabic lines, with the feminine verb after a woman', async () => {
    let names: Record<string, string> = {};
    await renderApp('/notifications', (state) => {
      state.users.usr_001.preferences.language = 'ar';
      names = Object.fromEntries(Object.values(state.users).map((u) => [u.id, personName(u, 'ar')]));
      const task = taskOf(state);
      task.title = 'التفاصيل';
      plant(state, [
        copy({ targetId: task.id, actorId: 'usr_003' }),
        copy({ trigger: 'task_deleted', targetId: task.id, actorId: 'usr_002', forUserIds: ['usr_004', 'usr_005'] }),
      ]);
    });
    const p = (id: string) => names[id];
    expect(await screen.findByText(line(`${p('usr_003')} أسندت إلى ${p('usr_004')} «التفاصيل»`))).toBeInTheDocument();
    expect(screen.getByText(line(`${p('usr_002')} حذف «التفاصيل» وأبلغ ${p('usr_004')} و${p('usr_005')}`))).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
  });
});
