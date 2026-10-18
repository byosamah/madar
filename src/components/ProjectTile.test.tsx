import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SubCompany } from '../api/contract/entities';
import { SubCompaniesContext } from '../app/subCompanies';
import { ProjectTile } from './ProjectTile';

const vado: SubCompany = { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' };

/** The tile under the sub-company list of the office (fbk_007). The list is the only context a tile needs. */
function tile(props: { subCompanyId?: string | null; size?: number }) {
  return (
    <SubCompaniesContext.Provider value={new Map([[vado.id, vado]])}>
      <ProjectTile id="prj_001" {...props} />
    </SubCompaniesContext.Provider>
  );
}

describe('the project tile and its sub-company (fbk_007)', () => {
  it('shows the logo of the sub-company at 45 percent of the tile, labelled with its name', () => {
    render(tile({ subCompanyId: 'sub_001', size: 40 }));
    const logo = screen.getByRole('img', { name: 'Vado' });
    expect(logo).toHaveStyle({ width: '18px', height: '18px' });
    expect(logo.closest('[data-sub-company-badge]')).not.toBeNull();
  });

  it('draws the badge with a 2 px ring in the card color', () => {
    const { container } = render(tile({ subCompanyId: 'sub_001' }));
    const badge = container.querySelector<HTMLElement>('[data-sub-company-badge]');
    expect(badge).not.toBeNull();
    expect(badge!.style.boxShadow).toContain('2px');
    expect(badge!.style.boxShadow).toContain('var(--c-panel)');
  });

  it('keeps the tile itself hidden from a screen reader, and the logo visible to it', () => {
    const { container } = render(tile({ subCompanyId: 'sub_001' }));
    expect(container.querySelector('[data-project-mark]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('img', { name: 'Vado' })).toBeInTheDocument();
  });

  it('draws no badge without a sub-company, or with one the office does not hold', () => {
    const { container, rerender } = render(tile({ subCompanyId: null }));
    expect(container.querySelector('[data-sub-company-badge]')).toBeNull();
    rerender(tile({ subCompanyId: 'sub_099' }));
    expect(container.querySelector('[data-sub-company-badge]')).toBeNull();
  });
});
