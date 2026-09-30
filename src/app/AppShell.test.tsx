import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

describe('app shell', () => {
  it('shows the navigation and a placeholder screen', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('This screen arrives in build step 4.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'My Work' }).length).toBeGreaterThan(0);
  });

  it('moves between screens', async () => {
    await renderApp('/');
    await userEvent.click((await screen.findAllByRole('link', { name: 'My Work' }))[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/work');
  });

  it('warns that changes are not saved when storage is in memory', async () => {
    await renderApp('/');
    expect(await screen.findByText('Changes will not be saved in this window.')).toBeInTheDocument();
  });

  it('shows the Inbox badge for items that need action', async () => {
    await renderApp('/');
    expect((await screen.findAllByText(/items need action/)).length).toBeGreaterThan(0);
  });

  it('switches to Arabic and mirrors the page', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'العربية' }))[0]);
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المعلومات' })).toBeInTheDocument();
  });

  it('opens Search with Ctrl+K', async () => {
    await renderApp('/');
    await screen.findAllByRole('link', { name: 'My Work' });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
  });
});
