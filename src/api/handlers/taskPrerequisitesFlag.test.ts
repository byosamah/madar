import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import { memberKey } from '../store';
import type { RoleSettings } from '../contract/entities';
import { calls } from '../calls';

beforeEach(() => setNow(NOW));

/**
 * The flag viewerCan.editPrerequisites (tsk_418). It follows the rule of tasks.update for the waits of a to-do: a person who may
 * change any to-do, or the maker with task.details. A role with task.details and without task.assign gives the maker the field.
 * usr_003 holds the role "Details only" (every basic switch except task.assign). usr_006 holds "No details" (every basic switch
 * except task.details). usr_002 leads prj_001. usr_004 is outside the project.
 */
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Details only', nameAr: 'التفاصيل فقط', off: ['task.assign'], rights: [] },
    { id: 'rol_002', name: 'No details', nameAr: 'بلا تفاصيل', off: ['task.details'], rights: [] },
  ],
};

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = structuredClone(ROLES);
  state.users.usr_003 = makeUser('usr_003', { name: 'Sara Team', roleId: 'rol_001' });
  state.users.usr_006 = makeUser('usr_006', { name: 'Nour Assign', roleId: 'rol_002' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.counters.usr = 6;
  // Sara made tsk_900. Faisal leads it. So Sara is the maker and not the lead.
  state.tasks.tsk_900 = makeTask({ id: 'tsk_900', stageId: 'stg_001', ownerId: 'usr_002', createdBy: 'usr_003' });
  // Faisal made tsk_901 and leads it. Sara is neither maker nor lead.
  state.tasks.tsk_901 = makeTask({ id: 'tsk_901', stageId: 'stg_001', ownerId: 'usr_002', createdBy: 'usr_002' });
  // Sara leads tsk_902 and Faisal made it. Sara leads it and did not make it.
  state.tasks.tsk_902 = makeTask({ id: 'tsk_902', stageId: 'stg_001', ownerId: 'usr_003', createdBy: 'usr_002' });
  // An office to-do that Sara made.
  state.tasks.tsk_903 = makeTask({ id: 'tsk_903', projectId: null, stageId: null, ownerId: null, createdBy: 'usr_003' });
  state.counters.tsk = 903;
  return t;
}

describe('viewerCan.editPrerequisites', () => {
  it('shows the field to the maker whose role has task.details and not task.assign', async () => {
    const t = world();
    t.as('usr_003');
    const { viewerCan } = await t.api.call('tasks.get', { id: 'tsk_900' });
    expect(viewerCan.editAll, 'the role has no task.assign').toBe(false);
    expect(viewerCan.editDetails).toBe(true);
    expect(viewerCan.editPrerequisites).toBe(true);
  });

  it('hides the field from a person who is neither the maker nor a holder of task.any', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('tasks.get', { id: 'tsk_901' })).viewerCan.editPrerequisites).toBe(false);
    // The lead who did not make the to-do keeps the server refusal, so the field stays hidden.
    expect((await t.api.call('tasks.get', { id: 'tsk_902' })).viewerCan.editPrerequisites).toBe(false);
  });

  it('shows the field to the leader (task.any) and to the Admin on every to-do', async () => {
    const t = world();
    for (const user of ['usr_001', 'usr_002']) {
      t.as(user);
      for (const id of ['tsk_900', 'tsk_901', 'tsk_902']) {
        expect((await t.api.call('tasks.get', { id })).viewerCan.editPrerequisites, `${user} ${id}`).toBe(true);
      }
    }
  });

  it('hides the field from a maker whose role has no task.details', async () => {
    const t = world();
    t.store.state.tasks.tsk_904 = makeTask({ id: 'tsk_904', stageId: 'stg_001', ownerId: 'usr_002', createdBy: 'usr_006' });
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id: 'tsk_904' })).viewerCan.editPrerequisites).toBe(false);
  });

  it('equals what tasks.update accepts, for every person and every to-do', async () => {
    const t = world();
    t.store.state.tasks.tsk_904 = makeTask({ id: 'tsk_904', stageId: 'stg_001', ownerId: 'usr_002', createdBy: 'usr_006' });
    let checked = 0;
    for (const userId of Object.keys(t.store.state.users)) {
      for (const id of ['tsk_900', 'tsk_901', 'tsk_902', 'tsk_903', 'tsk_904']) {
        t.as(userId);
        let flag: boolean | undefined;
        try {
          flag = (await t.api.call('tasks.get', { id })).viewerCan.editPrerequisites;
        } catch {
          continue; // This person may not open the to-do.
        }
        expect(typeof flag, `${userId} ${id}`).toBe('boolean');
        let accepted = true;
        try {
          await t.api.call('tasks.update', { id, patch: { prerequisiteIds: [] } });
        } catch (error) {
          const code = (error as { code?: string }).code;
          // An office to-do waits for no task: a later rule refuses it with invalid_input, after the gate let the person pass.
          expect(['forbidden', 'invalid_input'], `${userId} ${id}`).toContain(code);
          accepted = code !== 'forbidden';
        }
        expect(flag, `${userId} ${id}`).toBe(accepted);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });
});
