import { describe, expect, it } from 'vitest';
import { mayShareProjectFile, shareRuleOf } from './attach';
import type { Ctx } from '../registry';
import type { State } from '../store';
import { withRights } from '../rights';
import { makeProject, testApi } from '../../test/factories';
import { memberKey } from '../rowKeys';

/**
 * The picker list of a chat (chats.insertProjects) asks the share rule for every project of the office (review 2026-11-03). The rights of
 * each person of the chat do not change from one project to the next, so the rule builds them once. Each build reads state.settings (the
 * role rights), so the test counts those reads.
 */
function office(projects: number) {
  const state = testApi({}).store.state;
  for (let n = 1; n <= projects; n += 1) {
    const id = `prj_${String(100 + n)}`;
    state.projects[id] = makeProject({ id, code: `P-${100 + n}`, name: `Project ${n}`, leaderId: n % 2 === 0 ? 'usr_002' : 'usr_004' });
    if (n % 3 === 0) state.members[memberKey(id, 'usr_003')] = { projectId: id, userId: 'usr_003', discipline: 'Architect' };
  }
  return state;
}

function counted(state: State) {
  let reads = 0;
  const proxy = new Proxy(state, {
    get(target, key, receiver) {
      if (key === 'settings') reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, reads: () => reads };
}

describe('the share rule of many projects', () => {
  it('builds the rights of each person of the chat once, not once for each project', () => {
    const state = office(40);
    const { proxy, reads } = counted(state);
    const ctx = { state: proxy, authority: withRights(state, state.users.usr_003) } as unknown as Ctx;
    const blockOf = shareRuleOf(ctx, ['usr_002', 'usr_004']);
    for (const id of Object.keys(state.projects)) blockOf(id);
    // The sender and the two others: three builds at most, for 41 projects.
    expect(reads()).toBeLessThanOrEqual(3);
  });

  it('gives the answer of the rule for one project, for every project', () => {
    const state = office(40);
    const ctx = { state, authority: withRights(state, state.users.usr_003) } as unknown as Ctx;
    const others = ['usr_002', 'usr_004'];
    const blockOf = shareRuleOf(ctx, others);
    for (const id of Object.keys(state.projects)) {
      const expected = !mayShareProjectFile(ctx, id, 'usr_003') ? 'file_not_visible'
        : others.every((other) => mayShareProjectFile(ctx, id, other)) ? null : 'recipient_not_on_project';
      expect({ id, block: blockOf(id) }).toEqual({ id, block: expected });
    }
    // The office holds both answers, so the test compares real cases.
    const answers = new Set(Object.keys(state.projects).map((id) => blockOf(id)));
    expect(answers.size).toBeGreaterThan(1);
  });
});
