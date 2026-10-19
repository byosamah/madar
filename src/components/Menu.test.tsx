import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, type MenuItem } from './Menu';

/** The radio items, the heading and the note of a menu (chat design item 21, "Notify me"). */
const items = (over: Partial<Record<'a' | 'b', Partial<MenuItem>>> = {}): MenuItem[] => [
  { label: 'Archive', onSelect: vi.fn() },
  { label: 'A', checked: true, heading: 'Notify me', onSelect: vi.fn(), ...over.a },
  { label: 'B', checked: false, note: 'The unread count still shows every message.', onSelect: vi.fn(), ...over.b },
];

async function open(menuItems: MenuItem[]) {
  render(<Menu label="Chat options" items={menuItems} />);
  await userEvent.click(screen.getByRole('button', { name: 'Chat options' }));
  return screen.getByRole('menu', { name: 'Chat options' });
}

describe('Menu: radio items, a heading and a note', () => {
  it('draws a radio item with aria-checked, and a check mark only on the checked one', async () => {
    const menu = await open(items());
    const a = within(menu).getByRole('menuitemradio', { name: 'A' });
    const b = within(menu).getByRole('menuitemradio', { name: 'B' });
    expect(a).toHaveAttribute('aria-checked', 'true');
    expect(b).toHaveAttribute('aria-checked', 'false');
    expect(a.querySelector('svg')).not.toBeNull();
    expect(b.querySelector('svg')).toBeNull();
    // A plain item stays a menuitem with no check state.
    const plain = within(menu).getByRole('menuitem', { name: 'Archive' });
    expect(plain).not.toHaveAttribute('aria-checked');
    expect(plain.querySelector('svg')).toBeNull();
  });

  it('draws the heading above its item and the note under it', async () => {
    const menu = await open(items());
    const heading = within(menu).getByText('Notify me');
    const note = within(menu).getByText('The unread count still shows every message.');
    const a = within(menu).getByRole('menuitemradio', { name: 'A' });
    const b = within(menu).getByRole('menuitemradio', { name: 'B' });
    expect(heading.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    // The heading and the note are text, not items.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
  });

  it('moves the focus over plain and radio items with the arrow keys', async () => {
    const menu = await open(items());
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitemradio', { name: 'A' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitemradio', { name: 'B' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(within(menu).getByRole('menuitemradio', { name: 'B' })).toHaveFocus();
  });

  it('runs onSelect of a radio item and closes the menu', async () => {
    const pick = vi.fn();
    await open(items({ b: { onSelect: pick } }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'B' }));
    expect(pick).toHaveBeenCalledOnce();
  });
});
