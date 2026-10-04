import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { MentionField } from './MentionField';

beforeEach(() => {
  initI18n('en');
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it('keeps the letters typed right after a pick in order, also when they come before the next frame (whole-product check after wave 4)', async () => {
    // A fast typist, or a slow phone, types before the frame in which the pick puts the caret after the name.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Box' }) as HTMLTextAreaElement;
    await userEvent.type(box, 'Hi @Li');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('ok');
    for (const callback of frames.splice(0)) callback(0);
    await userEvent.keyboard(' now');
    expect(box).toHaveValue('Hi @Lina Mansour ok now');
  });
});
