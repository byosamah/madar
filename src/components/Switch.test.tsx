import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Switch, SwitchButton } from './Switch';

/** jsdom has no layout, so the test reads the press area from the classes: the box plus the invisible ::after area. */
function pressArea(button: HTMLElement): { width: number; height: number } {
  const classes = [...button.classList];
  const size = (prefix: string) => Number(classes.find((name) => name.startsWith(prefix))?.match(/\[(-?\d+(?:\.\d+)?)px\]/)?.[1] ?? Number.NaN);
  const grow = (prefix: string) => {
    const found = classes.find((name) => name.startsWith(prefix));
    return found ? Math.abs(Number(found.match(/\[(-?\d+(?:\.\d+)?)px\]/)?.[1] ?? Number.NaN)) : 0;
  };
  return {
    width: size('w-[') + 2 * grow('after:-inset-x-['),
    height: size('h-[') + 2 * grow('after:-inset-y-['),
  };
}

describe('Switch', () => {
  it('keeps the round button at 51 by 31 px and gives it a press area of 44 px or more with an invisible after area', () => {
    render(<Switch id="s" label="Sound" checked={false} onChange={() => {}} />);
    const button = screen.getByRole('switch', { name: 'Sound' });
    expect(button).toHaveClass('h-[31px]', 'w-[51px]', 'relative', 'after:absolute');
    const area = pressArea(button);
    expect(area.width).toBeGreaterThanOrEqual(44);
    expect(area.height).toBeGreaterThanOrEqual(44);
  });

  it('gives the bare SwitchButton of the Me rows the same press area', () => {
    render(<SwitchButton id="b" checked onChange={() => {}} />);
    const area = pressArea(screen.getByRole('switch'));
    expect(area.width).toBeGreaterThanOrEqual(44);
    expect(area.height).toBeGreaterThanOrEqual(44);
  });
});
