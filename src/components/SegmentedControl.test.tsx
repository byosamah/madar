import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SegmentedControl } from './SegmentedControl';

const A = { value: 'a', label: 'A' };
const B = { value: 'b', label: 'B' };
const C = { value: 'c', label: 'C' };

afterEach(() => document.documentElement.removeAttribute('dir'));

describe('SegmentedControl', () => {
  it('is unchanged without fill', () => {
    render(<SegmentedControl label="View" value="b" onChange={() => undefined} options={[A, B, C]} />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveClass('inline-flex', 'flex-wrap', 'self-start', 'rounded-full', 'bg-fill', 'p-0.5');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveClass('bg-card', 'text-ink', 'shadow-card');
    expect(group.querySelector('[data-thumb]')).toBeNull();
  });

  it('fills the width with equal options and one sliding thumb', () => {
    render(<SegmentedControl fill layoutId="work-switch" label="View" value="b" onChange={() => undefined} options={[A, B, C]} />);
    const group = screen.getByRole('radiogroup');
    expect(group).toHaveClass('flex', 'w-full');
    expect(group).not.toHaveClass('inline-flex');
    for (const r of screen.getAllByRole('radio')) expect(r).toHaveClass('flex-1', 'min-w-0', 'justify-center', 'whitespace-nowrap', 'min-h-11');
    const thumb = group.querySelector('[data-thumb="work-switch"]') as HTMLElement;
    expect(thumb).toHaveClass('bg-card', 'shadow-card', 'rounded-full');
    expect(screen.getByRole('radio', { name: 'B' })).toContainElement(thumb);
    expect(group.querySelectorAll('[data-thumb]')).toHaveLength(1);
  });

  it('moves the thumb to the new choice and keeps one Tab stop and the arrow keys, also in RTL', async () => {
    const seen: string[] = [];
    function Holder() {
      const [value, setValue] = useState('a');
      return <SegmentedControl fill layoutId="sw" label="View" value={value} onChange={(next) => { seen.push(next); setValue(next); }} options={[A, B, C]} />;
    }
    render(<Holder />);
    const radios = () => screen.getAllByRole('radio');
    expect(radios().filter((r) => r.tabIndex === 0)).toHaveLength(1);
    await userEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(screen.getByRole('radio', { name: 'C' }).querySelector('[data-thumb="sw"]')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'A' }).querySelector('[data-thumb]')).toBeNull();
    // The end-side arrow moves forward: ArrowRight in LTR, ArrowLeft in RTL.
    screen.getByRole('radio', { name: 'C' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(seen.at(-1)).toBe('a');
    document.documentElement.dir = 'rtl';
    await userEvent.keyboard('{ArrowLeft}');
    expect(seen.at(-1)).toBe('b');
  });

  it('calls onOptionPointerDown before the click, with the value', () => {
    const onChange = vi.fn();
    const onOptionPointerDown = vi.fn();
    render(<SegmentedControl label="View" value="a" onChange={onChange} onOptionPointerDown={onOptionPointerDown} options={[A, B]} />);
    fireEvent.pointerDown(screen.getByRole('radio', { name: 'B' }));
    expect(onOptionPointerDown).toHaveBeenCalledWith('b');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a Badge after the label when count is above 0, and nothing for 0', () => {
    render(
      <SegmentedControl
        label="Inbox"
        value="chats"
        onChange={() => undefined}
        options={[
          { value: 'chats', label: 'Chats', count: 3, countLabel: 'Unread messages: 3' },
          { value: 'notices', label: 'Notifications', count: 0, countLabel: 'Nothing new' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Chats Unread messages: 3' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Notifications' }).querySelector('.bg-badge')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Chats Unread messages: 3' }).querySelector('.bg-badge')).not.toBeNull();
  });

  it('takes a useId layoutId when fill has none', () => {
    render(<SegmentedControl fill label="View" value="a" onChange={() => undefined} options={[A, B]} />);
    const thumb = screen.getByRole('radiogroup').querySelector('[data-thumb]') as HTMLElement;
    expect(thumb.getAttribute('data-thumb')).toMatch(/\S/);
  });
});
