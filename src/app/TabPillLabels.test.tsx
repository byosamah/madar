import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/render';

describe('the tab pill labels', () => {
  // On a phone the tabs show icons only (owner, 2026-10-08). The word of each tab stays in the page for screen readers,
  // and it shows again from the small breakpoint (640 px) up.
  it('hides the word of each phone tab from view, and keeps its name', async () => {
    await renderApp('/');
    const pill = document.querySelector('[data-pill]') as HTMLElement;
    expect(pill).not.toBeNull();
    const projects = within(pill).getByRole('link', { name: 'Projects' });
    const word = projects.querySelector('span:not([aria-hidden])') as HTMLElement;
    expect(word).toHaveTextContent('Projects');
    expect(word).toHaveClass('sr-only');
    expect(word).toHaveClass('sm:not-sr-only');
  });
});
