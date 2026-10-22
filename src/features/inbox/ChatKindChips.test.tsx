import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../../i18n';
import { ChatKindChips } from './ChatKindChips';

initI18n('en');

const group = () => screen.getByRole('radiogroup', { name: 'Kind of chat' });

describe('ChatKindChips', () => {
  it('is a radiogroup of four chips of 44 px that wrap', () => {
    render(<ChatKindChips kind="all" onChange={() => undefined} />);
    expect(within(group()).getAllByRole('radio').map((r) => r.textContent)).toEqual(['All', 'Projects', 'To-dos', 'People']);
    expect(group()).toHaveClass('flex-wrap');
    for (const chip of within(group()).getAllByRole('radio')) expect(chip).toHaveClass('min-h-11');
  });

  it('marks the open chip with bg-card shadow-card text-ink and never with the signature look', () => {
    render(<ChatKindChips kind="projects" onChange={() => undefined} />);
    const chips = within(group()).getAllByRole('radio');
    const open = chips.find((chip) => chip.getAttribute('aria-checked') === 'true')!;
    expect(open).toHaveTextContent('Projects');
    expect(open).toHaveClass('bg-card', 'shadow-card', 'text-ink');
    for (const chip of chips) {
      expect(chip.className).not.toContain('signature');
      expect(chip.className).not.toContain('bg-accent');
    }
    // One tab stop that moves with the choice.
    expect(chips.map((chip) => chip.tabIndex)).toEqual([-1, 0, -1, -1]);
  });

  it('calls onChange for a press on a chip', async () => {
    const onChange = vi.fn();
    render(<ChatKindChips kind="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'People' }));
    expect(onChange).toHaveBeenCalledWith('people');
  });

  it('moves the choice with the end-side arrow key, and with the other arrow in Arabic', async () => {
    const onChange = vi.fn();
    render(<ChatKindChips kind="projects" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Projects' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('todos');
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('all');
    document.documentElement.dir = 'rtl';
    try {
      await userEvent.keyboard('{ArrowLeft}');
      expect(onChange).toHaveBeenLastCalledWith('todos');
    } finally {
      document.documentElement.dir = 'ltr';
    }
  });
});
