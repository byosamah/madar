import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { signOfProject, StatusSign, type SignState } from './StatusSign';

describe('the sign of a project', () => {
  const paused = (kind?: 'internal' | 'client') => ({ status: 'on_hold' as const, pause: kind ? { kind } : undefined });

  it('follows the health of an active project, and the status of any other', () => {
    expect(signOfProject({ project: { status: 'active' }, health: { value: 'late' }, staleDays: null })).toBe('late');
    expect(signOfProject({ project: { status: 'completed' }, health: null, staleDays: null })).toBe('completed');
    expect(signOfProject({ project: { status: 'archived' }, health: null, staleDays: null })).toBe('archived');
  });

  it('splits a paused project into Paused, Awaiting client and Stale', () => {
    expect(signOfProject({ project: paused(), health: null, staleDays: null })).toBe('paused');
    expect(signOfProject({ project: paused('internal'), health: null, staleDays: null })).toBe('paused');
    expect(signOfProject({ project: paused('client'), health: null, staleDays: null })).toBe('awaiting_client');
    expect(signOfProject({ project: paused('internal'), health: null, staleDays: 31 })).toBe('stale');
    expect(signOfProject({ project: paused('client'), health: null, staleDays: 31 })).toBe('stale');
  });

  it('draws a different shape for every paused state, and none of them red or orange', () => {
    const shapes = new Map<string, SignState>();
    for (const state of ['paused', 'awaiting_client', 'stale'] as const) {
      const { container, unmount } = render(<StatusSign state={state}>Word</StatusSign>);
      const svg = container.querySelector('svg') as SVGElement;
      shapes.set(svg.innerHTML, state);
      expect(svg.getAttribute('class')).not.toMatch(/red|orange|green/);
      expect(container.querySelector(`[data-sign="${state}"]`)).not.toBeNull();
      unmount();
    }
    expect(shapes.size).toBe(3);
  });
});

describe('a long sign in a narrow line (fbk_036)', () => {
  it('wraps to a second line when the row asks for it, and stays on one line by default', () => {
    const wrapped = render(<StatusSign state="late" wrap>Past due by 157 days</StatusSign>).container.querySelector('[data-sign="late"]') as HTMLElement;
    expect(wrapped.className).toContain('whitespace-normal');
    expect(wrapped.className).toContain('min-w-0');
    expect(wrapped.className).not.toContain('shrink-0');
    expect(wrapped.className).not.toContain('whitespace-nowrap');
    const plain = render(<StatusSign state="late">Late</StatusSign>).container.querySelector('[data-sign="late"]') as HTMLElement;
    expect(plain.className).toContain('whitespace-nowrap');
    expect(plain.className).toContain('shrink-0');
  });
});
