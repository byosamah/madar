import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateDraftField } from './Fields';

describe('DateDraftField', () => {
  it('sends a date once for Enter and the blur after it, and again when the person comes back after a refusal (review 2026-10-03)', async () => {
    const onCommit = vi.fn();
    render(<><DateDraftField id="due" label="Due" value="2026-10-01" onCommit={onCommit} /><button type="button">Away</button></>);
    const field = screen.getByLabelText('Due');
    fireEvent.change(field, { target: { value: '2026-10-12' } });
    field.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByText('Away'));
    expect(onCommit).toHaveBeenCalledTimes(1);
    // The server refused, so the value stays 2026-10-01. The person comes back and presses Enter on the same date.
    field.focus();
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('2026-10-12');
  });
});
