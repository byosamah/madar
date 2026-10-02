import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const rows = () => {
  const list = screen.queryByRole('list', { name: 'Projects' });
  return list ? within(list).queryAllByRole('listitem') : [];
};
const ready = () => screen.findByRole('link', { name: /Corniche Office Tower/ });
const openFilter = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  return screen.getByRole('dialog', { name: 'Filter' });
};

describe('the Projects screen', () => {
  it('shows the 9 active projects as calm rows, with no chips and no covers', async () => {
    await renderApp('/projects');
    await ready();
    expect(rows()).toHaveLength(9);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('img', { name: /Cover image/ })).toHaveLength(0);
  });

  it('shows a progress line in every row and a state word only when needed', async () => {
    await renderApp('/projects');
    const late = (await ready()).closest('li') as HTMLElement;
    expect(within(late).getByRole('progressbar')).toBeInTheDocument();
    expect(within(late).getByText('Late')).toBeInTheDocument();
    const calm = screen.getByRole('link', { name: /Eastern Shore Primary School/ }).closest('li') as HTMLElement;
    expect(within(calm).queryByText('On track')).toBeNull();
  });

  it('keeps every choice inside one filter button, and counts the active ones', async () => {
    await renderApp('/projects');
    await ready();
    const dialog = await openFilter();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Needs attention' }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(window.location.hash).toContain('filter=at_risk');
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });

  it('filters by the current stage and by status', async () => {
    await renderApp('/projects');
    await ready();
    const dialog = await openFilter();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Permits');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Any stage');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Status' }), 'on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    // The two paused samples: Gulf Crest waits for the client, Tamr Staff Housing has been paused long enough to be stale.
    expect(within(rows()[0]).getByText(/Awaiting client|Stale/)).toBeInTheDocument();
  });

  // Show and Stage are two separate choices (spec 3.3): a stage keeps "My projects" (audit PER-5).
  it('keeps My projects when a stage is picked, and keeps the stage when Show changes', async () => {
    await renderApp('/projects?filter=mine', (state) => { state.session.currentUserId = 'usr_002'; });
    await ready();
    const dialog = await openFilter();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Stage' }), 'Schematic Design');
    await waitFor(() => expect(window.location.hash).toContain('stage=Schematic'));
    expect(window.location.hash).toContain('filter=mine');
    expect(within(dialog).getByRole('radio', { name: 'My projects' })).toBeChecked();
    expect(screen.queryByRole('link', { name: /Eastern Shore Primary School/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'All' }));
    expect(window.location.hash).toContain('stage=Schematic');
    expect(await screen.findByRole('link', { name: /Eastern Shore Primary School/ })).toBeInTheDocument();
  });

  it('shows a member only their projects under My projects', async () => {
    await renderApp('/projects', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await ready();
    await userEvent.click(within(await openFilter()).getByRole('radio', { name: 'My projects' }));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.queryByRole('link', { name: /Tamr Boutique Hotel/ })).toBeNull();
  });

  it('sorts by name and keeps the sort for the next visit', async () => {
    const first = await renderApp('/projects');
    await ready();
    await userEvent.selectOptions(within(await openFilter()).getByRole('combobox', { name: 'Sort' }), 'name');
    await waitFor(() => expect(within(rows()[0]).getByRole('link')).toHaveAccessibleName(/^Al Waha Clinic Fit-out/));
    first.unmount();
    await renderApp('/projects');
    await ready();
    expect(within(await openFilter()).getByRole('combobox', { name: 'Sort' })).toHaveValue('name');
  });

  it('says when nothing matches and offers a way back', async () => {
    await renderApp('/projects');
    await ready();
    await userEvent.selectOptions(within(await openFilter()).getByRole('combobox', { name: 'Status' }), 'archived');
    expect(await screen.findByText('No projects match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(rows()).toHaveLength(12));
  });

  it('opens the New Project sheet from the one main button', async () => {
    await renderApp('/projects');
    const button = await screen.findByRole('button', { name: 'New Project' });
    expect(button).toHaveClass('signature');
    await userEvent.click(button);
    expect(await screen.findByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
  });

  it('opens with the filters in the link', async () => {
    const first = await renderApp('/projects?filter=at_risk');
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(within(await openFilter()).getByRole('radio', { name: 'Needs attention' })).toBeChecked();
    first.unmount();
    const second = await renderApp('/projects?stage=Permits');
    expect(await screen.findByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
    second.unmount();
    await renderApp('/projects?status=on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
  });
});
