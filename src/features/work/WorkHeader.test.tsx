import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { workTabLink } from '../../app/lastList';
import { todayISO } from '../../lib/dates';
import { renderHeldRemoteApp } from '../../test/heldRemoteApp';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { without } from '../../test/rr2work';
import { meetingsListInput } from '../meetings/readInputs';

// The Work header on a phone (phone design D, task W7): the title Work, the three-part switch and the View toggle. usr_001 is the Admin.
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const flush = (ms = 20) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const phone = () => phoneMedia({ phone: true, coarse: true });

describe('the Work header on a phone', () => {
  it('draws the title Work, four parts in order (Resources is the fourth, fbk_078), and one main button', async () => {
    phone();
    await renderApp('/work', as('usr_001'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Work' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['To-dos', 'Meetings', 'Projects', 'Resources']);
    expect(within(group).getByRole('radio', { name: 'To-dos' })).toBeChecked();
    expect(screen.getAllByRole('button', { name: 'New office to-do' })).toHaveLength(1);
    // The switch fills the row and slides (layoutId of the Work switch).
    expect(group).toHaveClass('w-full');
    expect(group.querySelector('[data-thumb="work-switch"]')).not.toBeNull();
  });

  it('follows the view: New meeting on Meetings, and the Work tab link is remembered', async () => {
    phone();
    await renderApp('/work', as('usr_001'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Meetings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Work' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'New meeting' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New office to-do' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Meetings' })).toBeChecked();
    await waitFor(() => expect(workTabLink()).toBe('/meetings'));
    await userEvent.click(screen.getByRole('radio', { name: 'To-dos' }));
    await screen.findByRole('button', { name: 'New office to-do' });
    await waitFor(() => expect(workTabLink()).toBe('/work'));
  });

  it('toggles List and Board with one 44 px round button', async () => {
    phone();
    localStorage.removeItem('madar.work.view');
    await renderApp('/work', as('usr_005'));
    const button = await screen.findByRole('button', { name: 'Board' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveClass('size-11', 'rounded-full', 'bg-fill');
    await userEvent.click(button);
    expect(await screen.findByRole('region', { name: /^To do/ })).toBeInTheDocument();
    const on = screen.getByRole('button', { name: 'Board' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('bg-fill-strong', 'ring-1');
    expect(localStorage.getItem('madar.work.view')).toBe('board');
    await userEvent.click(on);
    await waitFor(() => expect(screen.queryByRole('region', { name: /^To do/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('madar.work.view')).toBe('list');
  });

  it('has no View button on the Meetings view', async () => {
    phone();
    await renderApp('/meetings', as('usr_001'));
    await screen.findByRole('button', { name: 'New meeting' });
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
  });

  it('moves the focus to the new radio after the route changes', async () => {
    phone();
    await renderApp('/work', as('usr_001'));
    const first = await screen.findByRole('radio', { name: 'To-dos' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await screen.findByRole('button', { name: 'New meeting' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Meetings' })));
  });

  it('moves the focus the other way in Arabic', async () => {
    phone();
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_001';
      state.users.usr_001.preferences.language = 'ar';
    });
    const group = await screen.findByRole('radiogroup');
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    radios[0]!.focus();
    // In right to left, the end-side arrow is the left arrow.
    fireEvent.keyDown(radios[0]!, { key: 'ArrowLeft' });
    await waitFor(() => expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')[1]).toBeChecked());
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('radiogroup')).getAllByRole('radio')[1]));
  });

  it('shows the Arabic title and the button without a layout break', async () => {
    phone();
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_001';
      state.users.usr_001.preferences.language = 'ar';
    });
    const title = await screen.findByRole('heading', { level: 1, name: 'العمل' });
    // The title row holds one heading, the View toggle and the main button.
    const row = title.parentElement!.parentElement!;
    expect(row.querySelectorAll('h1')).toHaveLength(1);
    expect(row.querySelectorAll('button')).toHaveLength(2);
  });

  it('puts the View toggle in the title row, before the main button, and gives the switch the whole row under it', async () => {
    phone();
    await renderApp('/work', as('usr_001'));
    const title = await screen.findByRole('heading', { level: 1, name: 'Work' });
    const titleRow = title.parentElement!.parentElement!;
    const toggle = screen.getByRole('button', { name: 'Board' });
    const main = screen.getByRole('button', { name: 'New office to-do' });
    expect(titleRow).toContainElement(toggle);
    expect(titleRow).toContainElement(main);
    // The toggle comes first, then the main button.
    expect(toggle.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The switch row holds only the switch.
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    const switchRow = group.parentElement!;
    expect(switchRow).not.toBe(titleRow);
    expect(switchRow.contains(toggle)).toBe(false);
    expect(switchRow.contains(main)).toBe(false);
    expect(switchRow.querySelectorAll('button:not([role="radio"])')).toHaveLength(0);
    expect(within(switchRow).getAllByRole('radio')).toHaveLength(4);
    expect(titleRow.contains(group)).toBe(false);
  });

  it('puts the View toggle alone at the end of the title row when the person has no main button', async () => {
    phone();
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = without('task.add.office');
    });
    const title = await screen.findByRole('heading', { level: 1, name: 'Work' });
    const titleRow = title.parentElement!.parentElement!;
    const toggle = screen.getByRole('button', { name: 'Board' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'New office to-do' })).toBeNull());
    expect(titleRow).toContainElement(toggle);
    expect(titleRow.querySelectorAll('button')).toHaveLength(1);
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    expect(group.parentElement!.contains(toggle)).toBe(false);
  });

  it('starts the reads of a view on pointer down', async () => {
    phone();
    const app = await renderHeldRemoteApp('/work', as('usr_001'));
    await waitFor(() => expect(app.queryClient.getQueryData(['api', 'session.get', {}])).toBeDefined(), { timeout: 10_000 });
    await flush(150);
    app.hold();
    const before = app.asked.length;
    fireEvent.pointerDown(await screen.findByRole('radio', { name: 'Projects' }));
    await flush();
    expect(app.asked.slice(before).some((call) => call.name === 'projects.list')).toBe(true);
    fireEvent.pointerDown(screen.getByRole('radio', { name: 'Meetings' }));
    await flush();
    const meetings = app.asked.slice(before).find((call) => call.name === 'meetings.list');
    expect(meetings?.input).toEqual(meetingsListInput(todayISO()));
    app.release();
  }, 60_000);

  it('keeps the desk as it is', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', as('usr_005'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Show' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(group.parentElement).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-3', 'pb-4');
  });
});
