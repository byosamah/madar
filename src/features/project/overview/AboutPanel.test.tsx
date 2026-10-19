import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('the About panel and the pin (audit 2026-10-19, PRJ-04)', () => {
  it('gives one tap to directions: the Location line holds an Open in Google Maps link built from the pin', async () => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_002')(state);
      state.projects.prj_001.geo = { lat: 26.2928, lng: 50.2172 };
    });
    const about = await screen.findByRole('region', { name: 'About' });
    const link = await within(about).findByRole('link', { name: 'Open in Google Maps' });
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps?q=26.2928,50.2172');
    expect(link).toHaveAttribute('target', '_blank');
    // The link sits with the Location text, not as a separate record.
    expect(link.closest('div')?.textContent).toContain('Location');
  });

  it('shows no link for a project with no place', async () => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_002')(state);
      state.projects.prj_001.geo = null;
    });
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).queryByRole('link', { name: 'Open in Google Maps' })).toBeNull();
  });
});
