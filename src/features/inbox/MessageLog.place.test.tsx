import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HALA, OMAR, makeBubble, measureLog, renderLog, rowOf, talk } from './logHarness';

const LATER = '2026-09-29T11:00:00.000+03:00';
afterEach(() => vi.restoreAllMocks());

const newest = () => within(screen.getByRole('log', { name: 'Messages' })).queryByRole('button', { name: 'Go to the newest message' });

describe('the log keeps the place of the reader (design item 1)', () => {
  it('keeps a person who reads older messages still when a message of another person comes, and shows the Newest button', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_new', author: OMAR, createdAt: LATER, body: 'A new note.' })] });
    expect(box.top()).toBe(100);
    expect(newest()).toBeInTheDocument();
  });
  it('follows the newest message for a person at the bottom, and shows no Newest button there', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(500); fireEvent.scroll(view.log);
    expect(newest()).toBeNull();
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_new', author: OMAR, createdAt: LATER, body: 'A new note.' })] });
    expect(box.top()).toBe(1000);
  });
  it('goes down for your own new message, also when you read older ones', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: [...talk(10), makeBubble({ id: 'msg_mine', author: HALA, mine: true, createdAt: LATER, body: 'My answer.' })] });
    expect(box.top()).toBe(1000);
  });
  it('does not move when the last message goes (a delete), because that is no new message', () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    view.rerender({ bubbles: talk(10).slice(0, 9) });
    expect(box.top()).toBe(100);
  });
  it('goes to the newest message on a press of Newest, puts the focus in the log, and the button goes', async () => {
    const view = renderLog({ bubbles: talk(10) });
    const box = measureLog(view.log);
    box.at(100); fireEvent.scroll(view.log);
    await userEvent.click(newest()!);
    expect(box.top()).toBe(1000);
    expect(view.log).toHaveFocus();
    expect(newest()).toBeNull();
  });
  it('draws a still button: no count, no motion, not navy, a 44 px round press area', () => {
    const view = renderLog({ bubbles: talk(10) });
    measureLog(view.log).at(100); fireEvent.scroll(view.log);
    const button = newest()!;
    expect(button.textContent).toBe('');
    expect(button.className).not.toMatch(/signature|animate-/);
    expect(button.className).toMatch(/(^|\s)size-11(\s|$)/);
    expect(button.closest('[aria-live="off"]')).not.toBeNull();
  });
  it('names the button in Arabic', () => {
    const view = renderLog({ bubbles: talk(10) }, { lang: 'ar' });
    measureLog(view.log).at(100); fireEvent.scroll(view.log);
    expect(within(view.log).getByRole('button', { name: 'انتقل إلى أحدث رسالة' })).toBeInTheDocument();
  });
  it('opens at the New line: the line sits 16 px under the top of the log (design item 3)', () => {
    const setTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
    const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') === 'log') return rect(100, 600);
      if (this.hasAttribute('data-new-line')) return rect(400, 24);
      return rect(0, 0);
    });
    const list = talk(10);
    renderLog({ bubbles: list, readUpTo: list[6].createdAt, unreadAtOpen: 3 });
    expect(setTop).toHaveBeenLastCalledWith(284);
    expect(rowOf('Note 8').previousElementSibling).toHaveAttribute('data-new-line');
  });
});
