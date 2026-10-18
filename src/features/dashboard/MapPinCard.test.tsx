import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { SubCompany } from '../../api/contract/entities';
import { useCall } from '../../app/runtime';
import { SubCompaniesContext } from '../../app/subCompanies';
import { renderWithRuntime } from '../../test/render';
import { MapPinCard } from './MapPinCard';

const SUB: SubCompany = { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' };

/** The card of the first active project, with or without a sub-company. */
function Probe({ subCompanyId }: { subCompanyId: string | null }) {
  const list = useCall('projects.list', { status: 'active' });
  const first = list.data?.[0];
  return first ? <MapPinCard summary={{ ...first, subCompanyId }} /> : null;
}

const badge = () => document.querySelector('[data-sub-company-badge]');

describe('the card of a pin on the Dashboard map', () => {
  it('shows the logo of the sub-company beside the project picture (fbk_007)', async () => {
    await renderWithRuntime(
      <SubCompaniesContext.Provider value={new Map([[SUB.id, SUB]])}><Probe subCompanyId={SUB.id} /></SubCompaniesContext.Provider>,
      undefined,
      { path: '/dashboard' },
    );
    await screen.findByRole('link', { name: 'Open project' });
    expect(badge()).not.toBeNull();
  });

  it('shows no logo for a project without a sub-company', async () => {
    await renderWithRuntime(
      <SubCompaniesContext.Provider value={new Map([[SUB.id, SUB]])}><Probe subCompanyId={null} /></SubCompaniesContext.Provider>,
      undefined,
      { path: '/dashboard' },
    );
    await screen.findByRole('link', { name: 'Open project' });
    expect(badge()).toBeNull();
  });
});
