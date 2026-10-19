import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRuntime } from '../../test/render';
import { TimeField } from './TimeField';

describe('TimeField', () => {
  it('lists the 15-minute steps from 06:00 to 22:00 in the clock of the screen', async () => {
    await renderWithRuntime(<TimeField id="t" label="Time" value="10:00" onChange={() => undefined} />);
    const select = screen.getByRole('combobox', { name: 'Time' });
    const options = [...select.querySelectorAll('option')];
    expect(options).toHaveLength(65);
    expect(options[0]).toHaveTextContent(/^6:00$/);
    expect(options.at(-1)).toHaveTextContent(/^22:00$/);
    expect(select).toHaveValue('10:00');
  });

  it('keeps a time outside the steps while it is the value', async () => {
    await renderWithRuntime(<TimeField id="t" label="Time" value="10:05" onChange={() => undefined} />);
    expect(screen.getByRole('combobox', { name: 'Time' })).toHaveDisplayValue('10:05');
    expect(screen.getByRole('combobox', { name: 'Time' }).querySelectorAll('option')).toHaveLength(66);
  });

  it('gives the chosen time as HH:MM', async () => {
    const onChange = vi.fn();
    await renderWithRuntime(<TimeField id="t" label="Time" value="10:00" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Time' }), '13:45');
    expect(onChange).toHaveBeenCalledWith('13:45');
  });
});
