import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { MentionField } from './MentionField';

beforeEach(() => {
  initI18n('en');
});

afterEach(async () => {
  await act(async () => { await i18n.changeLanguage('en'); });
});

const people = [
  { id: 'usr_005', name: 'Sara Al-Qahtani', nameAr: 'سارة القحطاني', avatarUrl: null, kind: 'human' as const, discipline: 'Architect' },
  { id: 'usr_007', name: 'Lina Mansour', avatarUrl: null, kind: 'human' as const, discipline: 'Interior' },
];

function Harness() {
  const [value, setValue] = useState('');
  return <MentionField id="box" label="Box" value={value} onChange={setValue} people={people} />;
}

/** The mention box with the English and the Arabic name of a person (owner item 12, 2026-10-05). */
describe('the mention box with two names', () => {
  it('finds a person by the Arabic name on an English screen, and puts in the English name', async () => {
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@القح');
    expect(screen.getByRole('option')).toHaveTextContent('Sara Al-Qahtani');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@Sara Al-Qahtani ');
  });

  it('shows and puts in the Arabic name on an Arabic screen, and the English name when there is no Arabic one', async () => {
    await act(async () => { await i18n.changeLanguage('ar'); });
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@sar');
    expect(screen.getByRole('option')).toHaveTextContent('سارة القحطاني');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@سارة القحطاني ');
    await userEvent.type(box, '@lin');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@سارة القحطاني @Lina Mansour ');
  });
});
