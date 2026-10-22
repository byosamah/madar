import { describe, expect, it } from 'vitest';
import { within } from '@testing-library/react';
import { renderApp } from '../test/render';

describe('the tab pill labels', () => {
  // The desk pill keeps the word of each tab in the page for screen readers, and it shows from the small breakpoint (640 px) up.
  // The phone bar has its own words (PhoneTabBar.test.tsx).
  it('keeps the word of each desk tab hidden below 640 px, and keeps its name', async () => {
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    expect(pill).not.toBeNull();
    const projects = within(pill).getByRole('link', { name: 'Projects' });
    const word = within(projects).getByText('Projects');
    expect(word).toHaveClass('sr-only');
    expect(word).toHaveClass('sm:not-sr-only');
  });
});
