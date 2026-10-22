import { createElement, memo } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { EmojiPanel } from './EmojiPanel';

/**
 * The emoji panel draws Recent and the first group at once and the other groups at an idle moment (performance audit 2026-10-21, RN-8).
 * Each group keeps its id and its height before it fills, so the group buttons and the arrow keys work. A move of the focus renders
 * the two cells that change, not the panel. The counter wraps the cell of ./EmojiCell.
 */
const counts = vi.hoisted(() => ({ cells: 0, groups: 0 }));
vi.mock('./EmojiCell', async (importOriginal) => {
  const real = await importOriginal<typeof import('./EmojiCell')>();
  return {
    ...real,
    Cell: memo((props: Parameters<typeof real.Cell>[0]) => {
      counts.cells += 1;
      return createElement(real.Cell, props);
    }),
  };
});

vi.mock('./EmojiGroup', async (importOriginal) => {
  const real = await importOriginal<typeof import('./EmojiGroup')>();
  return {
    ...real,
    EmojiGroup: memo((props: Parameters<typeof real.EmojiGroup>[0]) => {
      counts.groups += 1;
      return createElement(real.EmojiGroup, props);
    }),
  };
});

beforeEach(() => {
  initI18n('en');
  counts.cells = 0;
  counts.groups = 0;
});
afterEach(() => vi.unstubAllGlobals());

const cellsNow = () => document.querySelectorAll('[data-emoji]').length;
const gridsNow = () => document.querySelectorAll('[data-grid]').length;
const sections = () => [...document.querySelectorAll<HTMLElement>('section[id]')];

async function settledGroups() {
  await waitFor(() => expect(gridsNow()).toBe(9), { timeout: 5000 });
}

describe('the emoji panel in stages (RN-8)', () => {
  it('draws Recent and the first group at once, and the other groups after the first paint', async () => {
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    // First paint: Recent and Smileys and people.
    expect(gridsNow()).toBe(2);
    const first = cellsNow();
    expect(first).toBeLessThan(700);
    await settledGroups();
    expect(cellsNow()).toBeGreaterThan(1800);
    // Before the fix the first paint held every cell: 1,878 and more.
    expect(first).toBeLessThan(cellsNow() / 3);
  });

  it('keeps the id and the height of each group before it fills, so the group buttons have a place to go', async () => {
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    const before = sections().map((section) => ({ id: section.id, height: section.style.containIntrinsicSize, box: section.querySelector<HTMLElement>('[data-slot]')?.style.height ?? null }));
    expect(before).toHaveLength(8);
    expect(sections()[7]!.querySelector('[data-grid]')).toBeNull();
    // A group that is not drawn yet holds a box of the height of its grid: rows of 44 px.
    const placeholder = sections()[7]!.querySelector<HTMLElement>('[data-slot]')!;
    const rows = Number.parseInt(placeholder.style.height, 10) / 44;
    expect(Number.isInteger(rows)).toBe(true);
    await settledGroups();
    const grid = sections()[7]!.querySelector<HTMLElement>('[data-grid]')!;
    expect(Math.ceil(grid.querySelectorAll('[data-emoji]').length / 8)).toBe(rows);
    expect(sections().map((section) => section.id)).toEqual(before.map((entry) => entry.id));
  });

  it('moves the focus by the arrow keys from the first group into the next one once it is drawn', async () => {
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    await settledGroups();
    const people = [...document.querySelectorAll<HTMLElement>('[data-cell^="people:"]')];
    const last = people[people.length - 1]!;
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement).dataset.cell?.startsWith('nature:')).toBe(true);
  });

  it('renders the two cells that change when the focus moves, not the panel', async () => {
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    await settledGroups();
    const cells = [...document.querySelectorAll<HTMLElement>('[data-cell^="food:"]')];
    act(() => cells[10]!.focus());
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 50); }));
    counts.cells = 0;
    counts.groups = 0;
    act(() => cells[11]!.focus());
    await act(() => new Promise((resolve) => { window.setTimeout(resolve, 50); }));
    // The cell that loses the tab stop and the cell that gets it. Before the fix this was 1,878 (every cell, by the parent).
    expect(counts.cells).toBeLessThanOrEqual(2);
    // The grid of a group is one memo part: a move inside the group renders that group alone, and the other 7 render nothing.
    expect(counts.groups).toBeLessThanOrEqual(1);
    expect(cells[11]).toHaveAttribute('tabindex', '0');
    expect(cells[10]).toHaveAttribute('tabindex', '-1');
  });

  it('draws the groups in stages again after a search is cleared', async () => {
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    await settledGroups();
    const field = screen.getByRole('searchbox', { name: 'Search emoji' });
    await userEvent.type(field, 'heart');
    expect(gridsNow()).toBe(1);
    await userEvent.clear(field);
    expect(gridsNow()).toBe(2);
    await settledGroups();
  });

  it('waits through whenIdle, so Safari with no requestIdleCallback waits 200 ms', async () => {
    const idle = vi.fn((run: () => void) => { void run; return 1; });
    vi.stubGlobal('requestIdleCallback', idle);
    render(<EmojiPanel onPick={vi.fn()} layout="panel" />);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(gridsNow()).toBe(2);
    act(() => { idle.mock.calls[0]![0](); });
    expect(gridsNow()).toBe(9);
  });
});
