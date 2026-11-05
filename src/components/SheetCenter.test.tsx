import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { phoneMedia } from '../test/phoneMedia';
import { Sheet } from './Sheet';

beforeEach(() => {
  initI18n('en');
});
afterEach(() => vi.useRealTimers());

const noop = () => undefined;

describe('the center window of a sheet on a desk (fbk_079)', () => {
  it('is one big window in the middle: 92 vw wide up to 1600 px, 90 dvh high, with the sheet marks', async () => {
    phoneMedia(false);
    render(<Sheet open onOpenChange={noop} title="Plan" center>Body</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Plan' });
    expect(sheet).toHaveAttribute('data-sheet-mode', 'center');
    expect(sheet).toHaveClass('inset-0', 'm-auto', 'h-[90dvh]', 'w-[min(92vw,1600px)]');
    // It is not the side panel: no edge place.
    expect(sheet.className).not.toContain('end-3');
    expect(sheet.className).not.toContain('top-3');
  });

  it('does nothing on a phone: the bottom sheet stays', async () => {
    phoneMedia(true);
    render(<Sheet open onOpenChange={noop} title="Plan" center>Body</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Plan' });
    expect(sheet).not.toHaveAttribute('data-sheet-mode');
    expect(sheet).toHaveClass('bottom-0', 'inset-x-0');
    expect(sheet.className).not.toContain('90dvh');
  });

  it('moves the focus in, closes on Escape, and gives the focus back to the control that opened it', async () => {
    phoneMedia(false);
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Sheet open={open} onOpenChange={setOpen} title="Plan" center>Body</Sheet>
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await userEvent.click(opener);
    const sheet = await screen.findByRole('dialog', { name: 'Plan' });
    expect(sheet.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByRole('dialog', { name: 'Plan' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('runs onClosed once after the close', async () => {
    phoneMedia(false);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const closed = vi.fn();
    const { rerender } = render(<Sheet open onOpenChange={noop} title="Plan" center onClosed={closed}>Body</Sheet>);
    await screen.findByRole('dialog', { name: 'Plan' });
    rerender(<Sheet open={false} onOpenChange={noop} title="Plan" center onClosed={closed}>Body</Sheet>);
    expect(closed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
