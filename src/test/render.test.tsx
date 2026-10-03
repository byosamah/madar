import { describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderApp } from './render';

describe('renderApp', () => {
  it('opens the route with no late popstate, so the screen mounts once (audit 2026-10-03, V-8)', async () => {
    const events: string[] = [];
    const listen = () => events.push(window.location.hash);
    window.addEventListener('popstate', listen);
    try {
      await renderApp('/settings');
      await screen.findByRole('heading', { level: 1, name: 'Settings' });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    } finally {
      window.removeEventListener('popstate', listen);
    }
    expect(events).toEqual([]);
    expect(window.location.hash).toBe('#/settings');
  });
});
