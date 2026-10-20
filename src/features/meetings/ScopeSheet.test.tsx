import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRuntime } from '../../test/render';
import { ScopeSheet } from './ScopeSheet';

/** The question before a change or a cancel of a meeting that repeats (fbk_022, wave 3): two plain buttons, "This meeting" and "This and later meetings". */
describe('ScopeSheet', () => {
  it('asks which meetings to change, with two plain buttons and the focus on the lesser one', async () => {
    await renderWithRuntime(<ScopeSheet mode="edit" onPick={() => undefined} onClose={() => undefined} />);
    const box = await screen.findByRole('dialog', { name: 'Change which meetings?' });
    const buttons = within(box).getAllByRole('button').filter((button) => !/close/i.test(button.getAttribute('aria-label') ?? ''));
    expect(buttons.map((button) => button.textContent)).toEqual(['This meeting', 'This and later meetings']);
    expect(buttons[0]).toHaveFocus();
    expect(within(box).getByText('This meeting is one of a series.')).toBeInTheDocument();
    // No main (signature) button: both are plain, and nothing else asks for a choice.
    expect(box.querySelectorAll('.signature')).toHaveLength(0);
  });

  it('asks which meetings to cancel, in red words for both buttons', async () => {
    await renderWithRuntime(<ScopeSheet mode="cancel" onPick={() => undefined} onClose={() => undefined} />);
    const box = await screen.findByRole('dialog', { name: 'Cancel which meetings?' });
    expect(within(box).getByText('This meeting is one of a series. The people get one notice.')).toBeInTheDocument();
    for (const name of ['This meeting', 'This and later meetings']) expect(within(box).getByRole('button', { name }).className).toContain('text-late');
  });

  it('gives the scope that the person pressed', async () => {
    const onPick = vi.fn();
    await renderWithRuntime(<ScopeSheet mode="edit" onPick={onPick} onClose={() => undefined} />);
    await userEvent.click(await screen.findByRole('button', { name: 'This and later meetings' }));
    expect(onPick).toHaveBeenLastCalledWith('later');
    await userEvent.click(screen.getByRole('button', { name: 'This meeting' }));
    expect(onPick).toHaveBeenLastCalledWith('one');
  });

  it('closes with the Escape key and gives no scope', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    await renderWithRuntime(<ScopeSheet mode="cancel" onPick={onPick} onClose={onClose} />);
    await screen.findByRole('dialog', { name: 'Cancel which meetings?' });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('turns off the later choice and says why when the change moves the meeting to a new day', async () => {
    const onPick = vi.fn();
    await renderWithRuntime(<ScopeSheet mode="edit" laterDisabled onPick={onPick} onClose={() => undefined} />);
    const later = await screen.findByRole('button', { name: 'This and later meetings' });
    expect(later).toBeDisabled();
    expect(screen.getByText('A new day changes one meeting at a time.')).toBeInTheDocument();
    await userEvent.click(later);
    expect(onPick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'This meeting' }));
    expect(onPick).toHaveBeenCalledWith('one');
  });
});
