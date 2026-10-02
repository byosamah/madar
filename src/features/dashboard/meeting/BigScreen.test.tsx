import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const MEETING = '/dashboard/meeting?mode=projects';
const BIG = 'madar.meeting.bigScreen';

const shoreWalkFirst = (state: State) => {
  state.projects.prj_011.healthOverride = { value: 'late', reason: 'The client moved the opening.', setBy: 'usr_001', setAt: '2026-09-30T09:00:00.000+03:00' };
};
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
const position = () => screen.getByRole('button', { name: /^Agenda/ }).textContent;
const setWakeLock = (value: unknown) => Object.defineProperty(navigator, 'wakeLock', { configurable: true, value });

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem(BIG);
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

describe('meeting keys (owner, 2026-10-02)', () => {
  it('moves along the agenda with N and B, opens the agenda with A, and works by physical key', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    expect(position()).toContain('1 of 9');
    await userEvent.keyboard('n');
    expect(position()).toContain('2 of 9');
    await userEvent.keyboard('b');
    expect(position()).toContain('1 of 9');
    // An Arabic keyboard sends other letters for the same physical keys.
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ي', code: 'KeyN', bubbles: true })); });
    expect(position()).toContain('2 of 9');
    await userEvent.keyboard('a');
    expect(await screen.findByRole('dialog', { name: 'Agenda' })).toBeInTheDocument();
  });

  it('pauses and resumes the timer with T', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    await renderApp(MEETING);
    await screen.findByRole('article');
    await flush();
    await flush();
    await userEvent.keyboard('t');
    expect(screen.getByRole('button', { name: 'Resume timer' })).toBeInTheDocument();
    const text = screen.getByRole('timer').textContent;
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByRole('timer').textContent).toBe(text);
    await userEvent.keyboard('t');
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
  });

  it('ignores N while the person types in the decision field', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    const field = screen.getByRole('textbox', { name: 'Write a decision' });
    await userEvent.type(field, 'n');
    expect(field).toHaveValue('n');
    expect(position()).toContain('1 of 9');
  });

  it('ignores N with a modifier key down and while a task panel is open', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    await userEvent.keyboard('{Control>}n{/Control}');
    expect(position()).toContain('1 of 9');
    await userEvent.keyboard('{Meta>}n{/Meta}');
    expect(position()).toContain('1 of 9');
  });

  it('ignores N while a task panel is open', async () => {
    await renderApp(`${MEETING}&task=tsk_130`, shoreWalkFirst);
    await screen.findByRole('dialog', { name: 'Progress photos' });
    await userEvent.keyboard('n');
    expect(screen.getByRole('button', { name: /^Agenda/, hidden: true })).toHaveTextContent('1 of 9');
  });

  it('keeps the meeting and the typed text when Escape is pressed in a field', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    await userEvent.type(screen.getByRole('textbox', { name: 'Write a decision' }), 'Use the stone tiles');
    await userEvent.keyboard('{Escape}');
    expect(window.location.hash).toContain('/dashboard/meeting');
    expect(screen.getByRole('textbox', { name: 'Write a decision' })).toHaveValue('Use the stone tiles');
  });

  it('closes the summary with Escape first, and leaves the meeting with the next Escape', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    await screen.findByRole('region', { name: 'Meeting summary' });
    await userEvent.keyboard('{Escape}');
    expect(window.location.hash).toContain('/dashboard/meeting');
    expect(screen.queryByRole('region', { name: 'Meeting summary' })).toBeNull();
    expect(position()).toContain('1 of 9');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(window.location.hash).not.toContain('/dashboard/meeting'));
  });

  it('moves one step for a held key, not one step for each repeat', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    await userEvent.keyboard('{n>4/}');
    expect(position()).toContain('2 of 9');
    await userEvent.keyboard('{ArrowRight>4/}');
    expect(position()).toContain('3 of 9');
    await userEvent.keyboard('{t>3/}');
    expect(screen.getByRole('button', { name: 'Resume timer' })).toBeInTheDocument();
  });

  it('does nothing with N and B on the timeline', async () => {
    await renderApp('/dashboard/meeting');
    await screen.findByRole('list', { name: 'Project timeline' });
    await userEvent.keyboard('n');
    expect(window.location.hash).not.toContain('mode=projects');
    expect(screen.getByRole('list', { name: 'Project timeline' })).toBeInTheDocument();
  });

  it('lists the keys on the agenda sheet', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    await userEvent.keyboard('a');
    const sheet = await screen.findByRole('dialog', { name: 'Agenda' });
    expect(within(sheet).getByText('Keys:')).toBeInTheDocument();
    const keys = Array.from(sheet.querySelectorAll('kbd')).map((node) => node.textContent);
    expect(keys).toEqual(['N', 'B', 'A', 'T', 'Esc']);
    expect(within(sheet).getByText('leave')).toBeInTheDocument();
  });
});

describe('big screen (owner, 2026-10-02)', () => {
  it('toggles aria-pressed and stays on after the view renders again', async () => {
    await renderApp(MEETING);
    await screen.findByRole('article');
    const button = screen.getByRole('button', { name: 'Big screen' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Big screen' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(BIG)).toBe('1');
    cleanup();
    await renderApp(MEETING);
    await screen.findByRole('article');
    expect(screen.getByRole('button', { name: 'Big screen' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('screen that stays awake (owner, 2026-10-02)', () => {
  it('asks for a lock when the meeting opens and releases it on Exit', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release, addEventListener: vi.fn() });
    setWakeLock({ request });
    await renderApp(MEETING);
    await screen.findByRole('article');
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await flush();
    expect(release).toHaveBeenCalled();
  });

  it('never holds two locks, and asks again after the browser released the lock', async () => {
    const made: { release: ReturnType<typeof vi.fn>; fire: () => void; live: boolean }[] = [];
    const request = vi.fn().mockImplementation(async () => {
      let onRelease: () => void = () => undefined;
      const lock = {
        live: true,
        fire: () => { lock.live = false; onRelease(); },
        release: vi.fn().mockImplementation(async () => { lock.live = false; }),
        addEventListener: (_: string, fn: () => void) => { onRelease = fn; },
      };
      made.push(lock);
      return lock;
    });
    setWakeLock({ request });
    await renderApp(MEETING);
    await screen.findByRole('article');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    // Visible again with no hide between: the lock stays, no second request.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    // The browser releases the lock when the page hides. The next show asks again, once.
    act(() => { made[0].fire(); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(made.filter((lock) => lock.live)).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await flush();
    expect(made.filter((lock) => lock.live)).toHaveLength(0);
  });

  it('renders with no error when the browser has no wake lock or refuses it', async () => {
    await renderApp(MEETING);
    expect(await screen.findByRole('article')).toBeInTheDocument();
    cleanup();
    setWakeLock({ request: vi.fn().mockRejectedValue(new Error('no')) });
    await renderApp(MEETING);
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });
});
