import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';

// The agenda shows the late projects first. Shore Walk Retail Kiosks is late here, so it is the first project screen.
// Progress photos (tsk_130) is in progress there. Handover checklist (tsk_131) waits for review, with a person other than the viewer as owner.
const shoreWalkFirst = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};
const waitsForReview = (state: State) => {
  shoreWalkFirst(state);
  state.tasks.tsk_131.status = 'in_review';
};
const staticDates = (state: State) => {
  shoreWalkFirst(state);
  Object.assign(state.tasks.tsk_130, { startDate: '2026-10-04', schedule: 'static', durationDays: null, dueDate: '2026-10-20' });
};

describe('acting on a task in place, in the meeting (owner, 2026-10-02)', () => {
  it('opens the task panel over the meeting with a press, and closes it back to the same project', async () => {
    await renderApp(MEETING, shoreWalkFirst);
    const article = await screen.findByRole('article');
    expect(within(article).getByText(/Project 1 of 9/)).toBeInTheDocument();
    const progress = within(within(article).getByRole('region', { name: 'In progress now' }));
    await userEvent.click(progress.getByRole('button', { name: /^Progress photos/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Progress photos' });
    expect(window.location.hash).toContain('/dashboard/meeting');
    expect(window.location.hash).toContain('task=tsk_130');
    // The panel hides the page below it from a screen reader, so the queries below ask for hidden nodes too.
    expect(screen.getByRole('heading', { level: 1, name: 'Madar', hidden: true })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Progress photos' })).toBeNull());
    expect(window.location.hash).not.toContain('task=');
    expect(screen.getByText(/Project 1 of 9/)).toBeInTheDocument();
  });

  it('closes only the panel with Escape, and leaves the project alone with the arrow keys', async () => {
    await renderApp(`${MEETING}&task=tsk_130`, shoreWalkFirst);
    await screen.findByRole('dialog', { name: 'Progress photos' });
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText(/Project 1 of 9/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Progress photos' })).toBeNull());
    expect(window.location.hash).toContain('/dashboard/meeting');
    expect(screen.getByRole('heading', { level: 1, name: 'Madar' })).toBeInTheDocument();
    expect(screen.getByText(/Project 1 of 9/)).toBeInTheDocument();
  });

  it('updates the meeting screen at once when a task is approved in the panel', async () => {
    await renderApp(MEETING, waitsForReview);
    const attention = within(await screen.findByRole('region', { name: 'Needs attention' }));
    await userEvent.click(attention.getByRole('button', { name: /^Handover checklist.*Waiting for review/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Handover checklist' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Needs attention', hidden: true })).queryByRole('button', { name: /Handover checklist/, hidden: true })).toBeNull());
  });

  it('offers the meeting reason when a date moves in a meeting, and posts it as the reason', async () => {
    const { store } = await renderApp(`${MEETING}&task=tsk_130`, staticDates);
    const messages = () => Object.values(store.state.comments).filter((comment) => comment.targetId === 'tsk_130');
    const before = messages().length;
    const sheet = await screen.findByRole('dialog', { name: 'Progress photos' });
    const due = within(sheet).getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2026-10-26' } });
    fireEvent.blur(due);
    const ask = await screen.findByRole('dialog', { name: 'Why do the dates change?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Decided in the meeting on Wed 30 Sept' }));
    await waitFor(() => expect(store.state.tasks.tsk_130.dueDate).toBe('2026-10-26'));
    expect(messages()).toHaveLength(before + 1);
    expect(messages().some((comment) => comment.body === 'Decided in the meeting on Wed 30 Sept')).toBe(true);
  });
});
