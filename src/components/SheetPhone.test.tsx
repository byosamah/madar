import { act, render, screen } from '@testing-library/react';
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

describe('the phone props of a sheet (Direction D)', () => {
  it('takes the full free height with tall', async () => {
    phoneMedia(true);
    render(<Sheet open onOpenChange={noop} title="Task" tall>Body</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Task' });
    expect(sheet).toHaveClass('h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]');
  });

  it('keeps max-h and no fixed height without tall', async () => {
    phoneMedia(true);
    render(<Sheet open onOpenChange={noop} title="Task">Body</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Task' });
    expect(sheet).toHaveClass('max-h-[calc(100dvh_-_5.25rem_-_env(safe-area-inset-top))]');
    expect(sheet.className).not.toMatch(/(^|\s)h-\[/);
  });

  it('replaces the title text by phoneHeader, and keeps the real title as sr-only, with the Close button and headerAction in the row', async () => {
    phoneMedia(true);
    render(
      <Sheet open onOpenChange={noop} title="Stair details" phoneHeader={<div>Custom row</div>} headerAction={<button type="button">Focus</button>}>Body</Sheet>,
    );
    const title = await screen.findByText('Stair details');
    expect(title).toHaveClass('sr-only');
    expect(title).toHaveAttribute('data-sheet-title');
    expect(title).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Custom row')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });

  it('gives the focus to the sr-only title when no field takes it', async () => {
    phoneMedia(true);
    render(<Sheet open onOpenChange={noop} title="Stair details" phoneHeader={<div>Custom row</div>}>Body</Sheet>);
    const title = await screen.findByText('Stair details');
    await vi.waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('ignores tall and phoneHeader at desk width', async () => {
    phoneMedia(false);
    render(<Sheet open onOpenChange={noop} title="Task" tall phoneHeader={<div>Custom row</div>}>Body</Sheet>);
    const sheet = await screen.findByRole('dialog', { name: 'Task' });
    const title = screen.getByText('Task');
    expect(title).not.toHaveClass('sr-only');
    expect(screen.queryByText('Custom row')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(sheet.className).not.toMatch(/(^|\s)h-\[/);
  });

  it('calls onClosed once, after the close animation, also when the parent closes the sheet', async () => {
    phoneMedia(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClosed = vi.fn();
    function Holder() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>Shut</button>
          <Sheet open={open} onOpenChange={setOpen} title="Task" onClosed={onClosed}>Body</Sheet>
        </>
      );
    }
    render(<Holder />);
    await screen.findByRole('dialog', { name: 'Task' });
    expect(onClosed).not.toHaveBeenCalled();
    await act(async () => { screen.getByRole('button', { name: 'Shut', hidden: true }).click(); });
    expect(onClosed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('does not call onClosed when the sheet opens again before the animation ends', async () => {
    phoneMedia(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClosed = vi.fn();
    const { rerender } = render(<Sheet open onOpenChange={noop} title="Task" onClosed={onClosed}>Body</Sheet>);
    await screen.findByRole('dialog', { name: 'Task' });
    rerender(<Sheet open={false} onOpenChange={noop} title="Task" onClosed={onClosed}>Body</Sheet>);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    rerender(<Sheet open onOpenChange={noop} title="Task" onClosed={onClosed}>Body</Sheet>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(onClosed).not.toHaveBeenCalled();
  });
});
