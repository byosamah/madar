import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Group, PickRow, SwitchRow, ValueRow } from './DetailRows';

describe('PickRow', () => {
  it('keeps the select id and its label, and a change calls onChange', async () => {
    const onChange = vi.fn();
    render(
      <PickRow id="task-owner" label="Lead" value="a" display="Alice" onChange={onChange}>
        <option value="a">Alice</option>
        <option value="b">Bob</option>
      </PickRow>,
    );
    const select = screen.getByLabelText('Lead');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveAttribute('id', 'task-owner');
    expect(select).toHaveClass('opacity-0');
    await userEvent.selectOptions(select, 'b');
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('SwitchRow', () => {
  it('keeps role=switch and the id, and a tap on the row toggles it', async () => {
    const onChange = vi.fn();
    render(<SwitchRow id="task-flag" label="Flag" description="Mark this to-do as important." checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Flag' });
    expect(toggle).toHaveAttribute('id', 'task-flag');
    // The word of the row covers the whole row, so a tap anywhere on it reaches the switch.
    await userEvent.click(screen.getByText('Flag'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Flag').closest('[data-switch-row]')?.className).toContain('[&_label]:after:absolute');
  });
});

describe('Group and ValueRow', () => {
  it('names its section by its title', () => {
    render(
      <Group title="People" hint="A hint.">
        <ValueRow label="Lead">Alice</ValueRow>
      </Group>,
    );
    const section = screen.getByRole('region', { name: 'People' });
    expect(section).toHaveTextContent('Lead');
    expect(section).toHaveTextContent('Alice');
    expect(screen.getByText('A hint.')).toBeInTheDocument();
  });
});
