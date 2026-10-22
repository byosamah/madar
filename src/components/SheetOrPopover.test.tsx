import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { phoneMedia } from '../test/phoneMedia';
import { SheetOrPopover } from './SheetOrPopover';

beforeEach(() => {
  initI18n('en');
});

function Anchored({ open, onOpenChange, withAnchor = true }: { open: boolean; onOpenChange: (open: boolean) => void; withAnchor?: boolean }) {
  return (
    <>
      <button type="button" data-testid="anchor">Open</button>
      <SheetOrPopover open={open} onOpenChange={onOpenChange} anchor={withAnchor ? (document.querySelector('[data-testid="anchor"]') as HTMLElement | null) : null} title="Pick a person">
        <p>Inside</p>
      </SheetOrPopover>
    </>
  );
}

describe('SheetOrPopover', () => {
  it('draws a Popover next to the anchor on a desk', async () => {
    phoneMedia(false);
    const onOpenChange = vi.fn();
    const { rerender } = render(<Anchored open={false} onOpenChange={onOpenChange} />);
    // The anchor is in the page after the first render, so the second render passes it in.
    rerender(<Anchored open onOpenChange={onOpenChange} />);
    const dialog = await screen.findByRole('dialog', { name: 'Pick a person' });
    expect(dialog).not.toHaveAttribute('data-vaul-drawer-direction');
    expect(screen.getByText('Inside')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('draws nothing on a desk with a null anchor', () => {
    phoneMedia(false);
    render(<Anchored open onOpenChange={() => undefined} withAnchor={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Inside')).toBeNull();
  });

  it('draws nothing on a desk while closed', () => {
    phoneMedia(false);
    const { rerender } = render(<Anchored open={false} onOpenChange={() => undefined} />);
    rerender(<Anchored open={false} onOpenChange={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('draws a bottom Sheet on a phone with the same children, and ignores the anchor', async () => {
    phoneMedia(true);
    render(<Anchored open onOpenChange={() => undefined} withAnchor={false} />);
    const dialog = await screen.findByRole('dialog', { name: 'Pick a person' });
    expect(dialog).toHaveAttribute('data-vaul-drawer-direction', 'bottom');
    expect(screen.getByText('Inside')).toBeInTheDocument();
  });
});
