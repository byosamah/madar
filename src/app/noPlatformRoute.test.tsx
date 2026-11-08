import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/render';

// Madar enterprises is a separate site (design 12, D9). An old tab or a bookmark with the route /enterprises of the first build shows the normal
// not-found page of the companies' app: a calm page, not an error and not the platform page.
describe('the old route /enterprises in the companies app', () => {
  it('shows the normal not-found page and no platform page', async () => {
    await renderApp('/enterprises');
    expect(await screen.findByRole('heading', { name: 'This page does not exist' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Madar enterprises' })).toBeNull();
    expect(screen.queryByText('This page did not open')).toBeNull();
  });
});
