import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';
import { reduceMotion } from '../project/tasks/testMotion';

// The snap lane, the dots and the column notes of the Board on a phone (phone design D, task W4). In the sample office usr_005 is
// Sara Al-Qahtani (a member). Today is 2026-09-30.
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const KEY = 'madar.work.view';

/** An IntersectionObserver that keeps its callback and its targets, so a test can tell it what the lane shows. */
class FakeObserver {
  static all: FakeObserver[] = [];
  targets = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords() { return []; }
  show(ratios: Record<string, number>) {
    const entries = [...this.targets].map((target) => ({
      target, intersectionRatio: ratios[target.getAttribute('data-column') ?? ''] ?? 0, isIntersecting: (ratios[target.getAttribute('data-column') ?? ''] ?? 0) > 0,
    }));
    act(() => this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver));
  }
}

const original = { observer: window.IntersectionObserver, scroll: Element.prototype.scrollIntoView };
beforeEach(() => {
  FakeObserver.all = [];
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.setItem(KEY, 'board');
});
afterEach(() => {
  window.IntersectionObserver = original.observer;
  Element.prototype.scrollIntoView = original.scroll;
  localStorage.removeItem(KEY);
  vi.restoreAllMocks();
});

const todo = () => screen.findByRole('region', { name: /^To do/ });
const dots = () => ['To do', 'In progress', 'In review', 'Done'].map((name) => screen.getByRole('button', { name: new RegExp(`^${name}: \\d+$`) }));

describe('the Board lane on a phone', () => {
  it('draws the snap lane', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    const lane = (await todo()).parentElement!;
    expect(lane).toHaveClass('max-sm:snap-x', 'max-sm:snap-mandatory', 'max-sm:overscroll-x-contain', 'max-sm:scroll-ps-4', 'max-sm:auto-cols-[calc(100%-3rem)]');
    expect(lane.children).toHaveLength(4);
    for (const column of lane.children) expect(column).toHaveClass('max-sm:snap-start');
  });

  it('draws four dots of 44 px, named like the columns', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    await todo();
    const buttons = dots();
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect(button).toHaveClass('size-11');
    // The name of a dot is the name of its column, count included.
    for (const button of buttons) expect(screen.getByRole('region', { name: button.getAttribute('aria-label')! })).toBeInTheDocument();
  });

  it('draws no dots on a desk', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', as('usr_005'));
    await todo();
    expect(screen.queryByRole('button', { name: /^To do: \d+$/ })).toBeNull();
  });

  it('marks the dot of the column that the lane shows', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    await todo();
    // Before any report the first dot is open.
    expect(dots()[0]).toHaveAttribute('aria-current', 'true');
    const observer = FakeObserver.all.find((item) => item.targets.size === 4)!;
    expect(observer).toBeTruthy();
    expect(observer.options?.threshold).toEqual([0, 0.25, 0.5, 0.75, 1]);
    observer.show({ todo: 0.1, in_progress: 0.9 });
    await waitFor(() => expect(dots()[1]).toHaveAttribute('aria-current', 'true'));
    expect(dots()[0]).not.toHaveAttribute('aria-current');
  });

  it('scrolls to a column on a press of its dot', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    await todo();
    await userEvent.click(dots()[3]!);
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('[data-column="done"]'));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  });

  it('scrolls with no glide under reduced motion', async () => {
    phoneMedia({ phone: true, coarse: true });
    reduceMotion();
    await renderApp('/work', as('usr_005'));
    await todo();
    await userEvent.click(dots()[2]!);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', inline: 'start', block: 'nearest' });
  });

  it('says "Last 7 days" in the Done header on a phone only', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    await todo();
    expect(within(screen.getByRole('region', { name: /^Done/ })).getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getAllByText('Last 7 days')).toHaveLength(1);
  });

  it('says nothing about 7 days on a desk', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', as('usr_005'));
    await todo();
    expect(screen.queryByText('Last 7 days')).toBeNull();
  });

  it('shows "Nothing here." in an empty column on a phone and keeps its height', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', as('usr_005'));
    const doneColumn = await screen.findByRole('region', { name: /^Done: 0/ });
    expect(within(doneColumn).getByText('Nothing here.')).toBeInTheDocument();
    expect(doneColumn).toHaveClass('min-h-48');
    // A column with cards says nothing.
    expect(within(await todo()).queryByText('Nothing here.')).toBeNull();
  });

  it('shows no such line on a desk', async () => {
    phoneMedia({ phone: false });
    await renderApp('/work', as('usr_005'));
    await todo();
    expect(screen.queryByText('Nothing here.')).toBeNull();
  });

  it('draws no dots for an empty board', async () => {
    phoneMedia({ phone: true, coarse: true });
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_005';
      for (const task of Object.values(state.tasks)) {
        task.status = 'done';
        task.completedAt = '2026-08-01T09:00:00.000+03:00';
      }
    });
    expect(await screen.findByText('All clear')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^To do: \d+$/ })).toBeNull();
  });
});
