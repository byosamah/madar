import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * projects.get gives the project chat when the viewer may open it (chat design 2026-10-19, item 18), for the Project chat button.
 * Hala (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar (usr_004) is outside.
 */
describe('ProjectDetail.chatId', () => {
  it('gives the project chat to the Admin, the leader and the team, and null to a person off the team', async () => {
    const t = testApi({ ...projectCalls, ...chatCalls });
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
    for (const person of ['usr_001', 'usr_002', 'usr_003']) {
      t.as(person);
      expect((await t.api.call('projects.get', { id: 'prj_001' })).chatId, person).toBe(room);
    }
    t.as('usr_004');
    const outsider = await t.api.call('projects.get', { id: 'prj_001' });
    expect(outsider.chatId).toBeNull();
    expect(JSON.stringify(outsider)).not.toContain(room);
  });

  it('gives null for a project that has no chat', async () => {
    const t = testApi({ ...projectCalls, ...chatCalls });
    t.as('usr_001');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).chatId).toBeNull();
  });

  it('gives the agent of a team member the chat of its person', async () => {
    const t = testApi({ ...projectCalls, ...chatCalls });
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
    t.as('usr_005');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).chatId).toBe(room);
  });
});
