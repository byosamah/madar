import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addSampleInternalProject } from '../../data/sampleInternalProject';
import { phoneMedia } from '../../test/phoneMedia';
import { TODAY } from '../../test/factories';
import { renderApp } from '../../test/render';
import { PROJECT_VIEW_KEY } from './projectView';

const withInternal = (state: Parameters<typeof addSampleInternalProject>[0]) => addSampleInternalProject(state, TODAY);
const isBox = (link: HTMLElement) => link.hasAttribute('data-project-box');

// fbk_080 (owner, 2026-11-05, option B): Projects and Home show rows or boxes by the choice of the person. One choice serves both.
describe('the View choice of the Projects list', () => {
  it('shows rows at first, and the View button opens Rows and Boxes', async () => {
    await renderApp('/projects');
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(within(list).getAllByRole('link').some(isBox)).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('radio', { name: 'Rows' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Boxes' })).not.toBeChecked();
  });

  it('switches to boxes, keeps the choice in the browser, and shows boxes on the next visit', async () => {
    const first = await renderApp('/projects');
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Boxes' }));
    const list = screen.getByRole('list', { name: 'Projects' });
    const links = within(list).getAllByRole('link');
    expect(links.length).toBeGreaterThan(1);
    expect(links.every(isBox)).toBe(true);
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('boxes');
    first.unmount();
    await renderApp('/projects');
    const again = await screen.findByRole('list', { name: 'Projects' });
    expect(within(again).getAllByRole('link').every(isBox)).toBe(true);
  });

  it('goes back to rows from the same choice', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    await renderApp('/projects');
    await screen.findByRole('list', { name: 'Projects' });
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('radio', { name: 'Rows' }));
    expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('link').some(isBox)).toBe(false);
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('rows');
  });

  it('keeps the groups Projects and Internal in boxes, each with its own grid', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    await renderApp('/projects?status=all', withInternal);
    await screen.findByRole('link', { name: /Portfolio 2026/ });
    const lists = screen.getAllByRole('list', { name: /^(Projects|Internal)$/ });
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual(['Projects', 'Internal']);
    for (const list of lists) {
      expect(list.className).toContain('grid');
      expect(within(list).getAllByRole('link').every(isBox)).toBe(true);
    }
    expect(within(lists[1]).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Internal' })).toBeInTheDocument();
  });

  it('uses a grid of boxes that holds 2 columns on a phone and fills a desk by width', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    await renderApp('/projects');
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(list.className).toContain('grid-cols-2');
    expect(list.className).toContain('sm:grid-cols-[repeat(auto-fill,minmax(236px,1fr))]');
    expect(list.className).toContain('gap-4');
  });

  it('keeps an unknown stored value as rows', async () => {
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'cards');
    await renderApp('/projects');
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(within(list).getAllByRole('link').some(isBox)).toBe(false);
  });
});

describe('the View choice on a phone', () => {
  it('shows one round toggle in place of the View button, and the search still filters boxes', async () => {
    phoneMedia(true);
    window.localStorage.setItem(PROJECT_VIEW_KEY, 'boxes');
    await renderApp('/projects');
    await screen.findByRole('list', { name: 'Projects' });
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show as boxes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('size-11', 'rounded-full');
    await userEvent.type(screen.getByRole('searchbox'), 'Corniche');
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('link')).toHaveLength(1));
    expect(isBox(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('link')[0])).toBe(true);
  });

  it('switches between rows and boxes with one press', async () => {
    phoneMedia(true);
    await renderApp('/projects');
    await screen.findByRole('list', { name: 'Projects' });
    const toggle = screen.getByRole('button', { name: 'Show as boxes' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show as boxes' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list', { name: 'Projects' })).getAllByRole('link').every(isBox)).toBe(true);
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('boxes');
    await userEvent.click(screen.getByRole('button', { name: 'Show as boxes' }));
    expect(window.localStorage.getItem(PROJECT_VIEW_KEY)).toBe('rows');
  });
});
