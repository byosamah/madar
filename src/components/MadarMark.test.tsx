import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MADAR_DOORS, MADAR_GLOW, MadarMark } from './MadarMark';

/**
 * The Madar logo (owner's choice "3 · Turning doors", 2026-10-04; TASKS.md, Logo): a glow tile like a project picture, with the
 * three lights of Next for you and the pinwheel of the four doors.
 */
describe('MadarMark', () => {
  it('draws the four doors of the pinwheel in ink at 0.86, at 45% of the tile', () => {
    const { container } = render(<MadarMark />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 18 18');
    expect(MADAR_DOORS).toBe('M8 0H0A8 8 0 0 0 8 8Z M18 8V0A8 8 0 0 0 10 8Z M10 18H18A8 8 0 0 0 10 10Z M0 10V18A8 8 0 0 0 8 10Z');
    const path = svg.querySelector('path')!;
    expect(path).toHaveAttribute('d', MADAR_DOORS);
    expect(path).toHaveAttribute('fill', 'currentColor');
    expect(path).toHaveAttribute('fill-opacity', '0.86');
    expect(svg.style.width).toBe('45%');
    expect(svg.style.height).toBe('45%');
    expect(svg.style.color).toBe('var(--c-ink)');
  });

  it('is a glow tile: 30% corners, the inset ink/10 ring, the three Next for you lights on the panel, all from the tokens', () => {
    const { container } = render(<MadarMark size={48} />);
    const tile = container.firstElementChild as HTMLElement;
    expect(tile.style.width).toBe('48px');
    expect(tile.style.height).toBe('48px');
    expect(tile.style.borderRadius).toBe('30%');
    expect(tile.style.boxShadow).toBe('inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 10%, transparent)');
    // The tokens hold the light and the dark values, so one tile serves both themes.
    for (const light of ['var(--glow-a)', 'var(--glow-b)', 'var(--glow-c)', 'var(--c-panel)']) expect(MADAR_GLOW).toContain(light);
    expect(MADAR_GLOW).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(tile.style.background).toBe(MADAR_GLOW);
  });

  it('places the three lights as the owner chose them (canvas PPsLwvwBp6uDueSWDM31qz)', () => {
    expect(MADAR_GLOW).toBe(
      'radial-gradient(62% 62% at 26% 24%, var(--glow-a) 0%, transparent 100%), radial-gradient(58% 58% at 80% 36%, var(--glow-b) 0%, transparent 100%), radial-gradient(64% 64% at 52% 86%, var(--glow-c) 0%, transparent 100%), var(--c-panel)',
    );
  });

  it('is 34 px by default, as a project picture', () => {
    const { container } = render(<MadarMark />);
    expect((container.firstElementChild as HTMLElement).style.width).toBe('34px');
  });

  it('is hidden from screen readers by default, because the name sits next to it', () => {
    const { container } = render(<MadarMark />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is one picture with a name when it has a label', () => {
    render(<MadarMark label="Madar" />);
    const img = screen.getByRole('img', { name: 'Madar' });
    expect(img).not.toHaveAttribute('aria-hidden');
    // The drawing inside is not a second picture.
    expect(img.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('never shows inside a project list: only the sign-in frame, the top of the app frame and the office card of the map use it, so nobody reads it as a project', () => {
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && /\bMadarMark\b/.test(readFileSync(path, 'utf8'))) users.push(path);
      }
    };
    walk('src');
    // The app frame shows it at the top start of every screen (owner, 2026-10-04). The Open space map shows it on its office
    // card, the root of the map and not a project (owner plan 2026-10-18, fbk_015). No project list uses it.
    expect(users.sort()).toEqual(['src/app/HomeMark.tsx', 'src/components/MadarMark.tsx', 'src/features/auth/AuthPage.tsx', 'src/features/space/SpaceNode.tsx']);
  });
});
