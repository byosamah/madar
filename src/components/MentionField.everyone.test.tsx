import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { ar, en } from '../i18n/trees';
import { MentionField } from './MentionField';

beforeEach(() => {
  initI18n('en');
});
afterEach(() => cleanup());

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });
const PEOPLE = [person('usr_005', 'Sara Al-Qahtani'), person('usr_007', 'Lina Mansour'), person('usr_008', 'Alaa Hamad')];

function Harness({ everyone }: { everyone?: number }) {
  const [value, setValue] = useState('');
  return <MentionField id="box" label="Box" value={value} onChange={setValue} people={PEOPLE} everyone={everyone} />;
}

const options = () => screen.getAllByRole('option').map((option) => option.querySelector('bdi')?.textContent ?? option.textContent);

/** The row "Everyone" of the mention list (owner, 2026-10-22, fbk_041). */
describe('the Everyone row of the mention list', () => {
  it('comes first, with the count, when nothing is typed after the @', async () => {
    render(<Harness everyone={6} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), 'Hi @');
    expect(options()).toEqual(['Everyone · 6 people', 'Sara Al-Qahtani', 'Lina Mansour', 'Alaa Hamad']);
  });

  it('shows "1 person" for one person', async () => {
    render(<Harness everyone={1} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@');
    expect(options()[0]).toBe('Everyone · 1 person');
  });

  it('shows when the typed letters fit everyone, all or الجميع, and not otherwise', async () => {
    render(<Harness everyone={3} />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@ev');
    expect(options()).toEqual(['Everyone · 3 people']);
    await userEvent.clear(box);
    await userEvent.type(box, '@al');
    // The names that hold the letters follow the row: Alaa starts with them, Sara Al-Qahtani holds them in the second word.
    expect(options()[0]).toBe('Everyone · 3 people');
    expect(options()).toContain('Alaa Hamad');
    await userEvent.clear(box);
    await userEvent.type(box, '@Sa');
    expect(options()).toEqual(['Sara Al-Qahtani']);
    await userEvent.clear(box);
    await userEvent.type(box, '@الج');
    expect(options()).toEqual(['Everyone · 3 people']);
  });

  it('is not there without a count: a direct chat, or a person without "Mention everyone"', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@');
    expect(options()).toEqual(['Sara Al-Qahtani', 'Lina Mansour', 'Alaa Hamad']);
  });

  it('puts @everyone into the box on an English screen, with Enter or a press', async () => {
    render(<Harness everyone={3} />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, 'Hi @ev');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Hi @everyone ');
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(box, 'and @');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getAllByRole('option')[0] });
    expect(box).toHaveValue('Hi @everyone and @everyone ');
  });

  it('puts @الجميع into the box on an Arabic screen, and reads the row in Arabic', async () => {
    initI18n('ar');
    render(<Harness everyone={3} />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@');
    expect(options()[0]).toBe('الجميع · 3 أشخاص');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@الجميع ');
  });

  it('moves with the arrow keys over the row and the names', async () => {
    render(<Harness everyone={3} />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@');
    expect(box).toHaveAttribute('aria-activedescendant', 'box-mentions-everyone');
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', 'box-mentions-usr_005');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(box).toHaveAttribute('aria-activedescendant', 'box-mentions-usr_008');
  });

  it('has its words in both languages', () => {
    const words = (tree: unknown) => (tree as { mentionEveryone: Record<string, string> }).mentionEveryone;
    expect(words(en).word).toBe('@everyone');
    expect(words(ar).word).toBe('@الجميع');
    for (const key of ['row_one', 'row_other']) expect(words(en)[key]).toContain('Everyone');
    for (const key of ['row_one', 'row_two', 'row_few', 'row_many', 'row_other']) expect(words(ar)[key]).toContain('الجميع');
  });
});
