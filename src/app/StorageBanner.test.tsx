import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/render';
import { en } from '../i18n/trees';

// The prototype with no browser storage runs in memory and says so. The line floats in the lane of the toasts, so it never sits
// under the header or moves it (owner, 2026-10-20).
describe('the line of a prototype in memory', () => {
  it('shows in the toast lane, not at the top of the page', async () => {
    await renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    const lane = document.querySelector('[data-toasts]') as HTMLElement;
    expect(await within(lane).findByText(en.storage.notSaved)).toBeInTheDocument();
    expect(document.querySelector('.app-page')?.previousElementSibling?.textContent ?? '').not.toContain(en.storage.notSaved);
  });
});
