import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TRACKER = '/projects/prj_001?tab=tracker';
const QUESTION = 'The client asked to move the lobby entrance';

async function openQuestion() {
  const loops = await screen.findByRole('group', { name: 'Waiting for our reply' });
  await userEvent.click(within(loops).getByRole('button', { name: `Open ${QUESTION}` }));
  return screen.findByRole('dialog', { name: QUESTION });
}

describe('the Tracker entry sheet', () => {
  // The sheet showed the direction words next to a mark that also said them to a screen reader (audit 2026-10-03, F-23).
  it('says the side of the entry one time', async () => {
    await renderApp(TRACKER, as('usr_002'));
    const sheet = await openQuestion();
    expect(within(sheet).getAllByText('From the client')).toHaveLength(1);
    expect(sheet.textContent?.match(/From the client/g)).toHaveLength(1);
  });

  // The Reply task block named only the person and the day, and nothing opened the task (audit 2026-10-03, F-11).
  it('names the reply task and opens it on a press', async () => {
    const { router, store } = await renderApp(TRACKER, as('usr_002'));
    const sheet = await openQuestion();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign a reply' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign' }));
    const link = await within(sheet).findByRole('link', { name: /Reply: The client asked to move the lobby entrance/ });
    const entry = Object.values(store.state.tracker ?? {}).find((e) => e.title === QUESTION);
    const taskId = entry?.replyTaskId as string;
    expect(taskId).toBeTruthy();
    await userEvent.click(link);
    await waitFor(() => expect(router.state.location.search).toContain(`task=${taskId}`));
    expect(router.state.location.search).toContain('tab=tasks');
    expect(await screen.findByRole('dialog', { name: `Reply: ${QUESTION}` })).toBeInTheDocument();
  });
});
