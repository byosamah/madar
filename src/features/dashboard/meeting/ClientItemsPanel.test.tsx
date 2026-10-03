import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

// The sample day is Wednesday 30 September 2026.
const shoreWalk = (state: State) => Object.values(state.projects).find((project) => project.name === 'Shore Walk Retail Kiosks')!;

/**
 * Two items wait for our reply (5 and 2 days old, shown oldest first) and one waits for the client (3 days old).
 * The agenda shows the late projects first, so Shore Walk Retail Kiosks is late here to be the first project screen.
 */
const withItems = (state: State) => {
  const project = shoreWalk(state);
  project.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
  const base = { projectId: project.id, type: 'message' as const, note: '', closedAt: null, closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: project.leaderId!, createdAt: '2026-09-25T10:00:00.000+03:00' };
  state.tracker = {
    ...state.tracker,
    trk_901: { ...base, id: 'trk_901', direction: 'in', title: 'Client asked for a taller kiosk', date: '2026-09-28', waiting: 'us' },
    trk_902: { ...base, id: 'trk_902', direction: 'in', title: 'Client asked for the lease plan', date: '2026-09-25', waiting: 'us' },
    trk_903: { ...base, id: 'trk_903', direction: 'out', title: 'We asked for the signed brief', date: '2026-09-27', waiting: 'client' },
  };
};

const panel = async () => within(await screen.findByRole('region', { name: 'Client items' }));

describe('client items on each project, in the meeting (owner, 2026-10-02)', () => {
  it('shows both groups with titles and ages, oldest first', async () => {
    await renderApp(MEETING, withItems);
    const items = await panel();
    const us = within(items.getByRole('group', { name: 'Waiting for our reply' }));
    expect(us.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Client asked for the lease plan'),
      expect.stringContaining('Client asked for a taller kiosk'),
    ]);
    expect(us.getByText('5 days')).toBeInTheDocument();
    expect(us.getByText('2 days')).toBeInTheDocument();
    const client = within(items.getByRole('group', { name: 'Waiting for the client' }));
    expect(client.getByText('We asked for the signed brief')).toBeInTheDocument();
    expect(client.getByText('3 days')).toBeInTheDocument();
  });

  it('closes an item with one press and the item leaves the panel', async () => {
    const { store } = await renderApp(MEETING, withItems);
    const items = await panel();
    await userEvent.click(items.getByRole('button', { name: /Answered.*lease plan/ }));
    await waitFor(() => expect(items.queryByText('Client asked for the lease plan')).toBeNull());
    expect(store.state.tracker?.trk_902.closedAt).not.toBeNull();
    await userEvent.click(items.getByRole('button', { name: /Received.*signed brief/ }));
    await waitFor(() => expect(items.queryByText('We asked for the signed brief')).toBeNull());
    expect(items.getByText('Client asked for a taller kiosk')).toBeInTheDocument();
  });

  it('assigns a reply with a person and a date, and then shows the person', async () => {
    const { store } = await renderApp(MEETING, withItems);
    const items = await panel();
    const buttons = items.getAllByRole('button', { name: /Who replies\?/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]);
    const sheet = await screen.findByRole('dialog', { name: 'Client asked for a taller kiosk' });
    const who = within(sheet).getByRole('combobox', { name: 'Who replies?' });
    const person = store.state.users[shoreWalk(store.state).leaderId!];
    await userEvent.selectOptions(who, person.id);
    const by = within(sheet).getByLabelText('Reply by');
    await userEvent.clear(by);
    await userEvent.type(by, '2026-10-05');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Client asked for a taller kiosk' })).toBeNull());
    const line = await items.findByText(new RegExp(`Reply: ${person.name} · `));
    expect(line).toBeInTheDocument();
    expect(items.getAllByRole('button', { name: /Who replies\?/ })).toHaveLength(1);
  });

  it('leaves an inactive member out of Who replies, because the API refuses that person (audit 2026-10-03, V-4)', async () => {
    let gone = '';
    const { store } = await renderApp(MEETING, (state) => {
      withItems(state);
      const project = shoreWalk(state);
      gone = Object.values(state.members).find((member) => member.projectId === project.id && member.userId !== project.leaderId)!.userId;
      state.users[gone].active = false;
    });
    const items = await panel();
    await userEvent.click(items.getAllByRole('button', { name: /Who replies\?/ })[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Client asked for the lease plan' });
    const options = within(within(sheet).getByRole('combobox', { name: 'Who replies?' })).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(options).not.toContain(gone);
    expect(options).toContain(shoreWalk(store.state).leaderId);
  });

  it('shows no Client items region when the project has no open items', async () => {
    await renderApp(MEETING, (state) => { state.tracker = {}; });
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Client items' })).toBeNull();
  });

  it('shows the items and no buttons to a viewer who may not post', async () => {
    await renderApp(MEETING, (state) => {
      withItems(state);
      const project = shoreWalk(state);
      const outsider = Object.values(state.users).find((user) => user.kind === 'human' && user.systemRole === 'member' && user.id !== project.leaderId && !Object.values(state.members).some((m) => m.projectId === project.id && m.userId === user.id));
      state.session.currentUserId = outsider!.id;
    });
    const items = await panel();
    expect(items.getByText('Client asked for the lease plan')).toBeInTheDocument();
    expect(items.queryByRole('button')).toBeNull();
  });
});
