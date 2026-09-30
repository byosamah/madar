import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const cards = () => screen.queryAllByRole('article');

describe('the Projects screen', () => {
  it('shows the 10 active projects as cards', async () => {
    await renderApp('/');
    expect(await screen.findByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(cards()).toHaveLength(10);
  });

  it('filters to the late and at-risk projects', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'At risk' }));
    await waitFor(() => expect(cards()).toHaveLength(5));
  });

  it('filters by the current stage and by status', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'Permits' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
  });

  it("shows a member only their projects under My projects", async () => {
    await renderApp('/', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'My projects' }));
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(screen.queryByRole('link', { name: /Tamr Boutique Hotel/ })).toBeNull();
  });

  it('sorts by name and keeps the list view for the next visit', async () => {
    const first = await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    await waitFor(() => expect(within(cards()[0]).getByRole('heading')).toHaveTextContent('Al Waha Clinic Fit-out'));
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(screen.getAllByRole('link', { name: /KH-/ }).length).toBe(10);
    first.unmount();
    await renderApp('/');
    expect(await screen.findByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says when nothing matches and offers a way back', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'archived');
    expect(await screen.findByText('No projects match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(cards()).toHaveLength(12));
  });

  it('opens the New Project sheet', async () => {
    await renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    expect(await screen.findByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
  });

  it('opens with the filters in the link', async () => {
    const first = await renderApp('/?filter=at_risk');
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(screen.getByRole('radio', { name: 'At risk' })).toHaveAttribute('aria-checked', 'true');
    first.unmount();
    const second = await renderApp('/?stage=Permits');
    expect(await screen.findByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
    second.unmount();
    await renderApp('/?status=on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
  });

  it('writes a chip choice into the link', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'At risk' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=at_risk'));
  });
});
