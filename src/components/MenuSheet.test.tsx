import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { phoneMedia } from '../test/phoneMedia';
import { Menu, type MenuItem } from './Menu';

beforeEach(() => {
  initI18n('en');
});
afterEach(() => vi.useRealTimers());

const make = () => {
  const onSelect = vi.fn();
  const del = vi.fn();
  const items: MenuItem[] = [
    { label: 'Rename', onSelect },
    { label: 'Delete', onSelect: del, destructive: true },
    { label: 'Hidden', onSelect, hidden: true },
  ];
  return { onSelect, del, items };
};

async function openSheet(items: MenuItem[], user: ReturnType<typeof userEvent.setup> = userEvent.setup()) {
  render(<Menu label="More actions" items={items} sheetOnPhone />);
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.findByRole('dialog', { name: 'More actions' });
}

describe('Menu as a bottom sheet on a phone (Direction D)', () => {
  it('opens a bottom sheet of 44 px rows on a phone', async () => {
    phoneMedia(true);
    const { items } = make();
    const sheet = await openSheet(items);
    expect(sheet).toHaveAttribute('data-vaul-drawer-direction', 'bottom');
    const rows = within(sheet).getAllByRole('menuitem');
    expect(rows.map((r) => r.textContent)).toEqual(['Rename', 'Delete']);
    for (const r of rows) expect(r).toHaveClass('min-h-11', 'w-full');
    expect(within(sheet).getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-late');
  });

  it('runs onSelect once after the sheet closes', async () => {
    phoneMedia(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { items, onSelect } = make();
    const sheet = await openSheet(items, user);
    await user.click(within(sheet).getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the pop-up menu without the prop, and on a desk with the prop', async () => {
    phoneMedia(true);
    const { items } = make();
    const first = render(<Menu label="More actions" items={items} />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    first.unmount();
    phoneMedia(false);
    render(<Menu label="More actions" items={items} sheetOnPhone />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menu', { name: 'More actions' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps radio items, headings, notes and onPrepare in the sheet', async () => {
    phoneMedia(true);
    const onPrepare = vi.fn();
    const items: MenuItem[] = [
      { label: 'Archive', onSelect: vi.fn(), onPrepare },
      { label: 'All messages', checked: true, heading: 'Notify me', onSelect: vi.fn() },
      { label: 'Mentions only', checked: false, note: 'The unread count still shows every message.', onSelect: vi.fn() },
    ];
    const sheet = await openSheet(items);
    expect(within(sheet).getByText('Notify me')).toBeInTheDocument();
    expect(within(sheet).getByText('The unread count still shows every message.')).toBeInTheDocument();
    expect(within(sheet).getByRole('menuitemradio', { name: 'All messages' })).toHaveAttribute('aria-checked', 'true');
    expect(within(sheet).getByRole('menuitemradio', { name: 'Mentions only' })).toHaveAttribute('aria-checked', 'false');
    const archive = within(sheet).getByRole('menuitem', { name: 'Archive' });
    archive.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onPrepare).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape without running an item', async () => {
    phoneMedia(true);
    const { items, onSelect, del } = make();
    const sheet = await openSheet(items);
    expect(sheet).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'More actions' })).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
