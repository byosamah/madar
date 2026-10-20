import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// Feedback fbk_006 (2026-10-11): a press on the avatar of a task row opens a small pop-up for the lead and the helpers, so the
// person never opens the full task panel. A "+" beside the avatar shows on hover and opens the list of helpers to add. One press on
// a name makes the change at once, with no confirm button. In Corniche Office Tower (prj_001), Faisal Al-Harbi (usr_002) leads
// the project. Its team is Faisal, Sara Al-Qahtani (usr_005), Yousef Saleh (usr_006) and Khalid Al-Mutairi (usr_008).
// "Coordination meeting notes" (tsk_013) is led by Yousef and has no helper.
const TAB = '/projects/prj_001?tab=tasks';
const TITLE = 'Coordination meeting notes';
const asLeader = (state: State) => {
  state.session.currentUserId = 'usr_002';
};
const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const openPeople = async () => userEvent.click(await screen.findByRole('button', { name: `Lead and helpers of ${TITLE}` }));
const noPanel = () => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();

describe('the avatar of a task row', () => {
  it('opens a small list to change the lead, with no task panel, and a press on a name changes the lead at once', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await openPeople();
    const popover = await screen.findByRole('dialog', { name: 'Change the lead' });
    noPanel();
    // The leader may name anyone active. A person outside the team joins it, and the list says so.
    expect(within(popover).getByRole('button', { name: /Sara Al-Qahtani/ })).toBeInTheDocument();
    expect(within(within(popover).getByRole('button', { name: /Reem Al-Ghamdi/ })).getByText('Joins the team')).toBeInTheDocument();
    expect(within(within(popover).getByRole('button', { name: /Sara Al-Qahtani/ })).queryByText('Joins the team')).toBeNull();
    // The lead comes first and rests under the focus, then the team, then the people who would join it.
    const names = within(popover).getAllByRole('button').map((button) => button.textContent ?? '');
    expect(names[0]).toMatch(/Yousef Saleh/);
    expect(names.findIndex((name) => /Khalid Al-Mutairi/.test(name))).toBeLessThan(names.findIndex((name) => /Reem Al-Ghamdi/.test(name)));
    expect(within(popover).getByRole('button', { name: /Yousef Saleh/ })).toHaveAttribute('aria-current', 'true');
    await userEvent.click(within(popover).getByRole('button', { name: /Sara Al-Qahtani/ }));
    await waitFor(() => expect(store.state.tasks.tsk_013.ownerId).toBe('usr_005'));
    expect(screen.queryByRole('dialog', { name: 'Change the lead' })).toBeNull();
    expect(await screen.findByText('Sara Al-Qahtani now leads this to-do.')).toBeInTheDocument();
    noPanel();
  });

  it('adds a helper from the "+" with one press on a name, and the list leaves out the lead and the helpers', async () => {
    const { store } = await renderApp(TAB, (state) => {
      asLeader(state);
      state.tasks.tsk_013.helperIds = ['usr_005'];
    });
    await userEvent.click(await screen.findByRole('button', { name: `Add a helper to ${TITLE}` }));
    const popover = await screen.findByRole('dialog', { name: 'Add a helper' });
    noPanel();
    expect(within(popover).queryByRole('button', { name: /Yousef Saleh/ })).toBeNull();
    expect(within(popover).queryByRole('button', { name: /Sara Al-Qahtani/ })).toBeNull();
    expect(within(popover).queryByRole('button', { name: /Apply|Confirm|Save/ })).toBeNull();
    await userEvent.click(within(popover).getByRole('button', { name: /Khalid Al-Mutairi/ }));
    await waitFor(() => expect(store.state.tasks.tsk_013.helperIds).toEqual(['usr_005', 'usr_008']));
    expect(screen.queryByRole('dialog', { name: 'Add a helper' })).toBeNull();
    expect(await screen.findByText('Khalid Al-Mutairi helps on this to-do.')).toBeInTheDocument();
    noPanel();
  });

  it('reaches the helper list from the avatar list too, for a screen with no hover', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await openPeople();
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change the lead' })).getByRole('button', { name: 'Add a helper' }));
    const popover = await screen.findByRole('dialog', { name: 'Add a helper' });
    await userEvent.click(within(popover).getByRole('button', { name: /Sara Al-Qahtani/ }));
    await waitFor(() => expect(store.state.tasks.tsk_013.helperIds).toEqual(['usr_005']));
  });

  it('gives the maker of the task a list of the team only', async () => {
    await renderApp(TAB, (state) => {
      asSara(state);
      state.tasks.tsk_013.createdBy = 'usr_005';
    });
    await openPeople();
    const popover = await screen.findByRole('dialog', { name: 'Change the lead' });
    expect(within(popover).getByRole('button', { name: /Khalid Al-Mutairi/ })).toBeInTheDocument();
    expect(within(popover).queryByRole('button', { name: /Reem Al-Ghamdi/ })).toBeNull();
    expect(within(popover).queryByText('Joins the team')).toBeNull();
  });

  it('stays a plain picture for a person who may not change the lead or the helpers', async () => {
    await renderApp(TAB, asSara);
    await screen.findByText(TITLE);
    expect(screen.queryByRole('button', { name: `Lead and helpers of ${TITLE}` })).toBeNull();
    expect(screen.queryByRole('button', { name: `Add a helper to ${TITLE}` })).toBeNull();
  });

  it('closes on Escape and puts nothing in the task', async () => {
    const { store } = await renderApp(TAB, asLeader);
    await openPeople();
    await screen.findByRole('dialog', { name: 'Change the lead' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change the lead' })).toBeNull());
    expect(store.state.tasks.tsk_013.ownerId).toBe('usr_006');
  });
});
