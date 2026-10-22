import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderLog, rowOf, talk } from './logHarness';

/**
 * The message log mounts the newest 60 bubbles at once and the rest at an idle moment (performance audit 2026-10-21, RN-1). A chat of 200
 * messages was 203 rows and 3,741 nodes at the open. The rest goes above the shown bubbles with the same re-anchor step as "Earlier messages",
 * so the reader keeps the place. A focus message and the New line are always in the first mount.
 */
const NEWEST = 60;
const bubblesNow = () => [...document.querySelectorAll<HTMLElement>('li[data-message-id]')];
const idsNow = () => bubblesNow().map((el) => el.getAttribute('data-message-id'));

/** jsdom draws nothing: the log is 100 px for each row, 500 px high, and a test sets its scroll position. */
function drawLog() {
  const view = { top: 0 };
  const isLog = (el: Element) => el.getAttribute('role') === 'log';
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
    return isLog(this) ? this.querySelectorAll('li').length * 100 : 0;
  });
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) { return isLog(this) ? 500 : 0; });
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) { return isLog(this) ? view.top : 0; });
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (this: Element, value: number) { if (isLog(this)) view.top = value; });
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the log of a chat with 200 messages (RN-1)', () => {
  it('mounts the newest 60 bubbles at once and the others after the first paint, in the same order', async () => {
    renderLog({ bubbles: talk(200) });
    // Before the fix the first paint held 200.
    expect(bubblesNow()).toHaveLength(NEWEST);
    expect(idsNow()[0]).toBe('msg_141');
    expect(idsNow().at(-1)).toBe('msg_200');
    await waitFor(() => expect(bubblesNow()).toHaveLength(200), { timeout: 3000 });
    expect(idsNow()).toEqual(Array.from({ length: 200 }, (_, i) => `msg_${i + 1}`));
  });

  it('does not stage a log of 60 bubbles or fewer', () => {
    renderLog({ bubbles: talk(NEWEST) });
    expect(bubblesNow()).toHaveLength(NEWEST);
  });

  it('keeps a reader at the bottom at the bottom when the older bubbles come', async () => {
    const view = drawLog();
    const { log } = renderLog({ bubbles: talk(200) });
    expect(view.top).toBe(log.scrollHeight);
    await waitFor(() => expect(bubblesNow()).toHaveLength(200), { timeout: 3000 });
    expect(view.top).toBe(log.scrollHeight);
  });

  it('keeps the distance from the bottom of a reader who scrolled up, so the bubble in view does not move', async () => {
    const view = drawLog();
    const { log } = renderLog({ bubbles: talk(200) });
    const before = log.scrollHeight;
    view.top = before - 1500;
    fireEvent.scroll(log);
    await waitFor(() => expect(bubblesNow()).toHaveLength(200), { timeout: 3000 });
    expect(log.scrollHeight - view.top).toBe(1500);
  });

  it('mounts the focus message at once, frames it, and still mounts the others later', async () => {
    const onFocused = vi.fn();
    renderLog({ bubbles: talk(200), focusId: 'msg_5', onFocused });
    // The first mount reaches back to the focus message.
    expect(rowOf('Note 5')).toHaveAttribute('data-framed');
    expect(onFocused).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(bubblesNow()).toHaveLength(200), { timeout: 3000 });
  });

  it('mounts a focus message that arrives while the rest waits (a press on a reply strip)', async () => {
    const list = talk(200);
    const onFocused = vi.fn();
    const view = renderLog({ bubbles: list, onFocused });
    expect(screen.queryByText('Note 20')).toBeNull();
    view.rerender({ bubbles: list, focusId: 'msg_20', onFocused });
    expect(rowOf('Note 20')).toHaveAttribute('data-framed');
    expect(onFocused).toHaveBeenCalledTimes(1);
  });

  it('draws the New line in the first mount when its message is older than the newest 60', async () => {
    const list = talk(200);
    // 100 messages are new: the line sits before msg_101.
    renderLog({ bubbles: list, readUpTo: list[99]!.createdAt, unreadAtOpen: 100 });
    const line = document.querySelector('[data-new-line]');
    expect(line).not.toBeNull();
    expect(line!.nextElementSibling).toHaveAttribute('data-message-id', 'msg_101');
    await waitFor(() => expect(bubblesNow()).toHaveLength(200), { timeout: 3000 });
    expect(document.querySelectorAll('[data-new-line]')).toHaveLength(1);
  });

  it('draws the New line of a small unread count and keeps the newest 60 for the first mount', () => {
    const list = talk(200);
    renderLog({ bubbles: list, readUpTo: list[189]!.createdAt, unreadAtOpen: 10 });
    expect(document.querySelector('[data-new-line]')!.nextElementSibling).toHaveAttribute('data-message-id', 'msg_191');
    expect(bubblesNow()).toHaveLength(NEWEST);
  });

  it('shows all the bubbles at once when the reader presses Earlier messages before the idle step', async () => {
    const load = vi.fn(async () => true);
    renderLog({ bubbles: talk(200), earlier: { load, pending: false } });
    expect(bubblesNow()).toHaveLength(NEWEST);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Earlier messages' })); });
    expect(bubblesNow()).toHaveLength(200);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('adds a new message to the staged log and the idle step still comes', async () => {
    const list = talk(201);
    const view = renderLog({ bubbles: list.slice(0, 200) });
    view.rerender({ bubbles: list });
    expect(bubblesNow()).toHaveLength(NEWEST + 1);
    expect(idsNow().at(-1)).toBe('msg_201');
    await waitFor(() => expect(bubblesNow()).toHaveLength(201), { timeout: 3000 });
  });

  it('waits through whenIdle, so Safari with no requestIdleCallback waits 200 ms', () => {
    const idle = vi.fn((run: () => void) => { void run; return 1; });
    vi.stubGlobal('requestIdleCallback', idle);
    renderLog({ bubbles: talk(200) });
    expect(idle).toHaveBeenCalledTimes(1);
    expect(bubblesNow()).toHaveLength(NEWEST);
    act(() => { idle.mock.calls[0]![0](); });
    expect(bubblesNow()).toHaveLength(200);
  });
});
