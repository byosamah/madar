import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Tabs } from './Tabs';

const OPTIONS = [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }];

// The owner (2026-10-05, item 7): the tab row of a project and of the Dashboard showed a small vertical scrollbar at its end.
// The row scrolls sideways, so the browser also let it scroll up and down, and the underline of the open tab stood 1 px below the row.
describe('the tab row (owner, 2026-10-05, item 7)', () => {
  it('scrolls only sideways and shows no scrollbar of its own', () => {
    render(<Tabs label="Sections" value="one" onChange={() => undefined} options={OPTIONS} />);
    const row = screen.getByRole('tablist');
    expect(row).toHaveClass('overflow-x-auto', 'overflow-y-hidden', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden');
  });

  it('draws the underline of the open tab inside the row, over the hairline', () => {
    render(<Tabs label="Sections" value="one" onChange={() => undefined} options={OPTIONS} />);
    const row = screen.getByRole('tablist');
    // The hairline is an inner shadow, so the underline can cover it without leaving the row.
    expect(row).not.toHaveClass('border-b');
    expect(row).toHaveClass('shadow-[inset_0_-1px_0_var(--c-hairline)]');
    const underline = screen.getByRole('tab', { name: 'One' }).querySelector('span');
    expect(underline).toHaveClass('bottom-0');
    expect(underline).not.toHaveClass('-bottom-px');
  });

  // Performance audit 2026-10-21, LV-10: a screen can start the work of a tab when the finger goes down, before the click ends.
  it('tells the screen which tab got a pointer down, and still changes the tab at the click', async () => {
    const onChange = vi.fn();
    const onTabPointerDown = vi.fn();
    render(<Tabs label="Sections" value="one" onChange={onChange} options={OPTIONS} onTabPointerDown={onTabPointerDown} />);
    fireEvent.pointerDown(screen.getByRole('tab', { name: 'Two' }));
    expect(onTabPointerDown).toHaveBeenCalledWith('two');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });
});
