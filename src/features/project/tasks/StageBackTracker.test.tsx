import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State, Store } from '../../../api/store';
import { renderApp } from '../../../test/render';
import { without } from '../../../test/rr2work';

// A switch that takes away only the Tracker posting right. Today every person who may move a stage back also has it, so the
// test needs the switch to reach the case where the two rights differ.
const rights = vi.hoisted(() => ({ denyPost: false }));
vi.mock('../../../api/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/permissions')>();
  return {
    ...actual,
    can: (...args: Parameters<typeof actual.can>) => (rights.denyPost && args[1] === 'tracker.log' ? false : actual.can(...args)),
  };
});

beforeEach(() => {
  rights.denyPost = false;
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
// "Ground floor plan" is done and sits in Design Development, before the stage the project is in. Opening it again moves the project back.
const TASK = '/projects/prj_001?task=tsk_003';
// The type is Government since 2026-10-12: a permit step is with any government body, not only Balady (owner).
const BOX = 'Also log this in the Tracker as a government update';
const ASK = 'This moves the project back to Design Development. Why?';
const logged = (store: Store, title: string) => Object.values(store.state.tracker ?? {}).filter((entry) => entry.title === title);

async function reopen() {
  const panel = await screen.findByRole('dialog', { name: 'Ground floor plan' });
  await userEvent.selectOptions(await within(panel).findByLabelText('Status'), 'To do');
  return screen.findByRole('dialog', { name: ASK });
}

describe('the Balady tick box on the move-back sheet (owner, 2026-10-03, API-14)', () => {
  it('sits under the reason, unticked, and logs nothing while it stays unticked', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const ask = await reopen();
    const reason = within(ask).getByRole('textbox', { name: 'Reason' });
    const box = within(ask).getByRole('checkbox', { name: BOX });
    expect(box).not.toBeChecked();
    expect(reason.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.type(reason, 'The client changed the brief');
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(store.state.tasks.tsk_003.status).toBe('todo'));
    expect(logged(store, 'The client changed the brief')).toHaveLength(0);
  });

  it('logs one Balady entry with the reason when ticked, and the Tracker shows it', async () => {
    const { store, router } = await renderApp(TASK, as('usr_002'));
    const ask = await reopen();
    const reason = 'Balady asked for changes to the drawings';
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), reason);
    await userEvent.click(within(ask).getByRole('checkbox', { name: BOX }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(logged(store, reason)).toHaveLength(1));
    expect(logged(store, reason)[0]).toMatchObject({ projectId: 'prj_001', type: 'balady', direction: 'third_party', note: '' });
    expect(store.state.tasks.tsk_003.status).toBe('todo');
    await router.navigate('/projects/prj_001?tab=tracker');
    expect(await screen.findByText(reason, undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('takes the entry back with the move in one Undo', async () => {
    const { store } = await renderApp(TASK, as('usr_002'));
    const ask = await reopen();
    const reason = 'Balady asked for new drawings';
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), reason);
    await userEvent.click(within(ask).getByRole('checkbox', { name: BOX }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(logged(store, reason)).toHaveLength(1));
    // The toast stays 5 seconds, so Undo comes first.
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(logged(store, reason)).toHaveLength(0));
    expect(store.state.tasks.tsk_003.status).toBe('done');
  });

  it('is there when a new task moves the project back, through the quick add', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=tasks', as('usr_002'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a to-do in Design Development' }, { timeout: 3000 }), 'Material samples{Enter}');
    const ask = await screen.findByRole('dialog', { name: ASK });
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'Balady asked for material samples');
    await userEvent.click(within(ask).getByRole('checkbox', { name: BOX }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(logged(store, 'Balady asked for material samples')).toHaveLength(1));
    expect(Object.values(store.state.tasks).some((task) => task.title === 'Material samples')).toBe(true);
  });

  it('does not show for a person without the Tracker posting right, who still moves the project back', async () => {
    rights.denyPost = true;
    const { store } = await renderApp(TASK, as('usr_002'));
    const ask = await reopen();
    expect(within(ask).queryByRole('checkbox')).toBeNull();
    await userEvent.type(within(ask).getByRole('textbox', { name: 'Reason' }), 'The client changed the brief');
    await userEvent.click(within(ask).getByRole('button', { name: 'Move back' }));
    await waitFor(() => expect(store.state.tasks.tsk_003.status).toBe('todo'));
    expect(logged(store, 'The client changed the brief')).toHaveLength(0);
  });

  // Role rights version 2: the tick box needs tracker.log, and the server says so in the refusal (canLog).
  it('does not show with the switch tracker.log off, and shows with it on', async () => {
    const off = await renderApp(TASK, (state) => {
      state.session.currentUserId = 'usr_002';
      state.settings.roles = without('tracker.log.team');
    });
    const ask = await reopen();
    expect(within(ask).queryByRole('checkbox')).toBeNull();
    off.unmount();
  });

  it('shows the box with the switch tracker.log on', async () => {
    await renderApp(TASK, as('usr_002'));
    const ask = await reopen();
    expect(within(ask).getByRole('checkbox', { name: BOX })).toBeInTheDocument();
  });
});
