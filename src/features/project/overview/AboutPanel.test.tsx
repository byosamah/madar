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

describe('the Location line is the address of the pin (owner, 2026-10-19)', () => {
  const locationOf = async (prepare: (state: State) => void) => {
    await renderApp('/projects/prj_001', (state) => {
      as('usr_002')(state);
      prepare(state);
    });
    const about = await screen.findByRole('region', { name: 'About' });
    const row = within(about).getByText('Location', { selector: 'dt' }).closest('div')!;
    return { about, row };
  };

  it('shows the address of the pin, then Open in Google Maps', async () => {
    const { row } = await locationOf((state) => {
      state.projects.prj_001.geo = { lat: 26.2928, lng: 50.2172 };
      state.projects.prj_001.location = 'King Fahd Road, Dammam';
    });
    expect(row).toHaveTextContent('King Fahd Road, Dammam');
    const link = within(row).getByRole('link', { name: 'Open in Google Maps' });
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps?q=26.2928,50.2172');
    // The address comes first, the link after it.
    expect(row.textContent!.indexOf('King Fahd Road, Dammam')).toBeLessThan(row.textContent!.indexOf('Open in Google Maps'));
  });

  it('shows only the link when the pin has no address, and no empty mark beside it', async () => {
    const { row } = await locationOf((state) => {
      state.projects.prj_001.geo = { lat: 26.2928, lng: 50.2172 };
      state.projects.prj_001.location = '';
    });
    expect(within(row).getByRole('link', { name: 'Open in Google Maps' })).toBeInTheDocument();
    expect(row).not.toHaveTextContent('Not set');
    expect(row.textContent).toBe('LocationOpen in Google Maps');
  });

  it('keeps the old typed text of a project with no pin, with no link', async () => {
    const { row } = await locationOf((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = 'Dammam, King Fahd Road';
    });
    expect(row).toHaveTextContent('Dammam, King Fahd Road');
    expect(within(row).queryByRole('link', { name: 'Open in Google Maps' })).toBeNull();
  });

  it('says Not set for a project with no pin and no text', async () => {
    const { row } = await locationOf((state) => {
      state.projects.prj_001.geo = null;
      state.projects.prj_001.location = '';
    });
    expect(row).toHaveTextContent('Not set');
  });
});
