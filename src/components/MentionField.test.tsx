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

// chats-01 (UX audit 2026-10-19): the list of names hid under the edge of the chat panel, and "@Sa" then Enter picked Faisal.
describe('the mention list: place and order', () => {
  const people = [person('usr_002', 'Faisal Al-Harbi'), person('usr_008', 'Omar Sabbagh'), person('usr_005', 'Sara Al-Qahtani'), person('usr_007', 'Lina Mansour')];
  function Rank({ placement }: { placement?: 'above' | 'below' }) {
    const [value, setValue] = useState('');
    return <MentionField id="box" label="Box" value={value} onChange={setValue} people={people} placement={placement} />;
  }

  it('lists the names that start with the letters first, so "@Sa" then Enter picks Sara, not Faisal', async () => {
    render(<Rank />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, '@Sa');
    const names = screen.getAllByRole('option').map((option) => option.querySelector('bdi')?.textContent);
    // Sara starts with "sa" (first name). Faisal only holds "sa" inside the name, so he comes after Sara and the names that start with it.
    expect(names[0]).toBe('Sara Al-Qahtani');
    expect(names[1]).toBe('Omar Sabbagh');
    expect(names.at(-1)).toBe('Faisal Al-Harbi');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('@Sara Al-Qahtani ');
  });

  it('ranks a name whose last name starts with the letters before a name that holds them inside', async () => {
    function Last() {
      const [value, setValue] = useState('');
      return <MentionField id="box" label="Box" value={value} onChange={setValue} people={[person('usr_030', 'Halal Nasser'), person('usr_002', 'Faisal Al-Harbi'), person('usr_031', 'Al Mansour')]} />;
    }
    render(<Last />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@Al');
    const names = screen.getAllByRole('option').map((option) => option.querySelector('bdi')?.textContent);
    // The first name starts with it, then the last name starts with it, then the name that holds it inside.
    expect(names).toEqual(['Al Mansour', 'Faisal Al-Harbi', 'Halal Nasser']);
  });

  it('opens above the box when asked, and below it by default', async () => {
    const { unmount } = render(<Rank placement="above" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@');
    expect(screen.getByRole('listbox')).toHaveClass('bottom-full');
    expect(screen.getByRole('listbox')).not.toHaveClass('top-full');
    unmount();
    render(<Rank />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@');
    expect(screen.getByRole('listbox')).toHaveClass('top-full');
  });

  it('stays wide enough for one line a name beside a narrow box, and grows into the free space on the end side (owner, 2026-10-22)', async () => {
    render(<Rank placement="above" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@');
    const list = screen.getByRole('listbox');
    // A chat box on a phone sits between the Attach, emoji and Send buttons, so the list took its narrow width and long names wrapped.
    // The list is at least 18rem wide (never wider than the screen less 2rem) and lines up with the end of the box.
    expect(list).toHaveClass('end-0', 'w-[max(100%,min(18rem,calc(100vw_-_2rem)))]');
    expect(list).not.toHaveClass('inset-x-0');
  });

  it('shows at most five names', async () => {
    const many = Array.from({ length: 8 }, (_, i) => person(`usr_0${20 + i}`, `Sami Person${i}`));
    function Many() {
      const [value, setValue] = useState('');
      return <MentionField id="box" label="Box" value={value} onChange={setValue} people={many} />;
    }
    render(<Many />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@Sam');
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });
});

describe('the list height (Direction D)', () => {
  function WithHeight({ listMaxHeight }: { listMaxHeight?: string }) {
    const [value, setValue] = useState('');
    return <MentionField id="box" label="Box" value={value} onChange={setValue} people={[person('usr_005', 'Sara Al-Qahtani')]} {...(listMaxHeight ? { listMaxHeight } : {})} />;
  }

  it('sets the max height of the list and lets it scroll', async () => {
    render(<WithHeight listMaxHeight="12rem" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), 'Hi @');
    const list = screen.getByRole('listbox');
    expect(list.style.maxHeight).toBe('12rem');
    expect(list.className).toContain('overflow-y-auto');
  });

  it('sets no style and no scroll class without the prop', async () => {
    render(<WithHeight />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), 'Hi @');
    const list = screen.getByRole('listbox');
    expect(list.getAttribute('style')).toBeNull();
    expect(list.className).not.toContain('overflow-y-auto');
  });
});
