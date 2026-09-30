import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { MentionField } from './MentionField';

beforeEach(() => {
  initI18n('en');
});

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });

function Harness() {
  const [value, setValue] = useState('');
  return <MentionField id="box" label="Box" value={value} onChange={setValue} people={[person('usr_005', 'Sara Al-Qahtani'), person('usr_007', 'Lina Mansour')]} />;
}

describe('the mention box', () => {
  it('picks a name with the arrow keys and Enter', async () => {
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, 'Hi @');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', 'box-mentions-usr_007');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Hi @Lina Mansour ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the list with Escape', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@Sa');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
