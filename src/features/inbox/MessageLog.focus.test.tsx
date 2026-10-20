import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { renderLog, rowOf, talk } from './logHarness';

let setTop: ReturnType<typeof vi.spyOn>;

const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} }) as DOMRect;
const ids = () => talk(10).map((b, i) => ({ ...b, id: `msg_${i + 1}` }));

// jsdom draws nothing, so the boxes get a place: the log from 100 to 700, and the focus message from 500 to 580.
beforeEach(() => {
  setTop = vi.spyOn(Element.prototype, 'scrollTop', 'set');
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'log') return rect(100, 600);
    if (this.getAttribute('data-message-id') === 'msg_5' || this.getAttribute('data-message-id') === 'msg_2') return rect(500, 80);
    if (this.hasAttribute('data-new-line')) return rect(400, 24);
    return rect(0, 0);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('open at one message (design items 10 and 17)', () => {
  it('puts the focus message in the middle of the log, frames it for one second, and calls onFocused once', async () => {
    const onFocused = vi.fn();
    renderLog({ bubbles: ids(), focusId: 'msg_5', onFocused });
    expect(setTop).toHaveBeenLastCalledWith(140);
    expect(onFocused).toHaveBeenCalledTimes(1);
    const row = rowOf('Note 5');
    expect(row).toHaveAttribute('data-framed');
    await waitFor(() => expect(row).not.toHaveAttribute('data-framed'), { timeout: 2000 });
  });
  it('waits for a focus message that is not in the log yet, and centers it when it arrives', () => {
    const onFocused = vi.fn();
    const list = ids();
    const view = renderLog({ bubbles: list.slice(5), focusId: 'msg_5', onFocused });
    expect(onFocused).not.toHaveBeenCalled();
    view.rerender({ bubbles: list, focusId: 'msg_5', onFocused });
    expect(onFocused).toHaveBeenCalledTimes(1);
    expect(rowOf('Note 5')).toHaveAttribute('data-framed');
  });
  it('wins over the New line at the open, and still draws the line', () => {
    const list = ids();
    renderLog({ bubbles: list, focusId: 'msg_5', onFocused: () => undefined, readUpTo: list[6].createdAt, unreadAtOpen: 3 });
    expect(setTop).toHaveBeenLastCalledWith(140);
    expect(document.querySelector('[data-new-line]')).not.toBeNull();
  });
  it('frames a message in the Arabic log too, with no motion and no red', () => {
    const list = ids().slice(0, 3);
    renderLog({ bubbles: list, focusId: 'msg_2', onFocused: () => undefined }, { lang: 'ar' });
    expect(rowOf('Note 2').className).toMatch(/outline-link\/40/);
    expect(rowOf('Note 2').className).not.toMatch(/late|red|animate-/);
  });
});
