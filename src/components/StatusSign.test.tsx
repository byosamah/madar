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
