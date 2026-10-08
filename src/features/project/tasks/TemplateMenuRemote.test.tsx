import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderRemoteApp } from '../../../test/renderRemote';

const TASKS = '/projects/prj_001?tab=tasks';
const templateCalls = (sent: { name: string; input: unknown }[]) => sent.filter((call) => call.name === 'taskTemplates.list');

/** One more template whose stage name has other spaces and another case, so the menu must match names as the handler does. */
function addTemplate(state: State) {
  const author = Object.values(state.taskTemplates ?? {})[0].createdBy;
  state.taskTemplates!.ttp_900 = {
    id: 'ttp_900', name: 'Civil Defense letter', stageName: '  permits ', description: '', checklist: [], needsReview: false,
    schedule: 'static', durationDays: null, createdBy: author, createdAt: '2026-09-01T09:00:00.000+03:00',
  };
}

/** An active member who is not on the team of prj_001, so the tab offers no quick add and no template menu. */
function outsiderOf(state: State): string {
  const inTeam = (userId: string) => state.projects.prj_001.leaderId === userId
    || Object.values(state.members).some((member) => member.projectId === 'prj_001' && member.userId === userId);
  return Object.values(state.users).find((user) => user.kind === 'human' && user.active && user.systemRole === 'member' && !inTeam(user.id))!.id;
}

describe('From a template on the project Tasks tab (performance audit 2026-10-07, LIV-5)', () => {
  it('asks for all templates once, with the task list, and each stage menu lists the templates of its stage', async () => {
    let holding = true;
    const { sent, release, api } = await renderRemoteApp(TASKS, addTemplate, { hold: (name) => holding && name === 'tasks.list' });
    await waitFor(() => expect(sent.some((call) => call.name === 'tasks.list')).toBe(true));
    // The templates go out while the task list still waits, so both join the first request of the tab.
    await waitFor(() => expect(templateCalls(sent)).toEqual([{ name: 'taskTemplates.list', input: {} }]));
    holding = false;
    release();
    await screen.findByText('Stair details', undefined, { timeout: 10_000 });
    const stages = (await api.call('projects.get', { id: 'prj_001' })).stages;
    for (const stage of stages) {
      const names = (await api.call('taskTemplates.list', { stageName: stage.name })).map((template) => template.name);
      const label = `From a template in ${stage.name}`;
      if (names.length === 0) {
        expect(screen.queryByRole('button', { name: label })).toBeNull();
        continue;
      }
      await userEvent.click(await screen.findByRole('button', { name: label }));
      const menu = await screen.findByRole('menu', { name: label });
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(names);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu', { name: label })).toBeNull());
    }
    expect(stages.some((stage) => stage.name === 'Permits')).toBe(true);
    expect(templateCalls(sent).filter((call) => JSON.stringify(call.input) === '{}')).toHaveLength(1);
  });

  it('asks for no templates when the person sees no template menu', async () => {
    const { sent } = await renderRemoteApp(TASKS, (state) => {
      state.session.currentUserId = outsiderOf(state);
    });
    await screen.findByText('Stair details', undefined, { timeout: 10_000 });
    expect(screen.queryByRole('textbox', { name: /^Add a task in/ })).toBeNull();
    expect(templateCalls(sent)).toEqual([]);
  });
});
