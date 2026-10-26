import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SubCompany } from '../api/contract/entities';
import { SubCompaniesContext } from '../app/subCompanies';
import { OWNER_SHAPES } from '../test/projectShapes';
import { formPath, decodeMark } from '../lib/projectMark';
import { MarkForm, ProjectTile } from './ProjectTile';

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

  it('keeps the badge at 18 px at least, so a mark still reads on a small tile, and names the sub-company in a tooltip (PRJ-11)', () => {
    const { container } = render(tile({ subCompanyId: 'sub_001', size: 30 }));
    const badge = container.querySelector<HTMLElement>('[data-sub-company-badge]');
    expect(screen.getByRole('img', { name: 'Vado' })).toHaveStyle({ width: '18px', height: '18px' });
    expect(badge).toHaveAttribute('title', 'Vado');
  });

  it('draws the logo on a white plate in both themes, so a dark mark never vanishes in dark mode (PRJ-10)', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const withLogo: SubCompany = { ...vado, logo };
    const { container } = render(
      <SubCompaniesContext.Provider value={new Map([[withLogo.id, withLogo]])}>
        <ProjectTile id="prj_001" subCompanyId="sub_001" />
      </SubCompaniesContext.Provider>,
    );
    const plate = container.querySelector<HTMLElement>('[data-sub-company-badge] img')!.parentElement!;
    expect(plate.style.background).toBe('rgb(255, 255, 255)');
  });

  it('cuts a 2 px gap around the badge out of the tile, so the badge reads on any surface with no ring of its own (owner, 2026-10-20)', () => {
    const { container } = render(tile({ subCompanyId: 'sub_001', size: 40 }));
    const badge = container.querySelector<HTMLElement>('[data-sub-company-badge]')!;
    const mark = container.querySelector<HTMLElement>('[data-project-mark]')!;
    expect(mark).toHaveClass('tile-cut');
    // The badge is 18 px: a gap of 2 px around its radius of 9 px.
    expect(mark.style.getPropertyValue('--cut')).toBe('11px');
    expect(badge.style.boxShadow).toBe('');
  });

  it('keeps the box of the badge the size of the circle, so nothing draws a pill below it (owner, 2026-10-20)', () => {
    const { container } = render(tile({ subCompanyId: 'sub_001', size: 40 }));
    const badge = container.querySelector<HTMLElement>('[data-sub-company-badge]')!;
    // A flex box holds no line of text, so its height is the height of the logo, not the line height of the page.
    expect(badge).toHaveClass('flex');
    expect(badge).toHaveStyle({ width: '18px', height: '18px' });
  });

  it('cuts no gap in a tile with no sub-company', () => {
    const { container } = render(tile({ subCompanyId: null }));
    expect(container.querySelector('[data-project-mark]')).not.toHaveClass('tile-cut');
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

describe('the project tile and its own shape (owner, 2026-10-26)', () => {
  const pathOf = (container: HTMLElement) => container.querySelector('[data-project-mark] svg path')!;

  it('draws the drawn form, turned, when the project has no shape', () => {
    const { container } = render(<ProjectTile id="prj_001" mark={5} />);
    const { form } = decodeMark(5);
    expect(pathOf(container)).toHaveAttribute('d', formPath(form, 0, 0, 18));
    expect(pathOf(container)).toHaveAttribute('transform', `rotate(${form.turn * 90} 9 9)`);
  });

  it('draws the drawn form for a shape that is null or missing', () => {
    const { container, rerender } = render(<ProjectTile id="prj_001" mark={5} shape={null} />);
    expect(pathOf(container)).toHaveAttribute('transform');
    rerender(<ProjectTile id="prj_001" mark={5} shape={undefined} />);
    expect(pathOf(container)).toHaveAttribute('transform');
  });

  it.each(Object.entries(OWNER_SHAPES))('draws the shape of %s in the box of 18 by 18, in ink at 86 percent, with no turn', (_name, shape) => {
    const { container } = render(<ProjectTile id="prj_001" mark={5} shape={shape} />);
    const path = pathOf(container);
    expect(path).toHaveAttribute('d', shape);
    expect(path).not.toHaveAttribute('transform');
    expect(path).toHaveAttribute('fill', 'currentColor');
    expect(path).toHaveAttribute('fill-opacity', '0.86');
    expect(path.closest('svg')).toHaveAttribute('viewBox', '0 0 18 18');
    expect(path.closest('svg')).toHaveClass('text-ink');
  });

  it('keeps the glow of the mark when the shape changes: the same data attribute and background', () => {
    const plain = render(<ProjectTile id="prj_001" mark={5} />);
    const plainTile = plain.container.querySelector<HTMLElement>('[data-project-mark]')!;
    const shaped = render(<ProjectTile id="prj_001" mark={5} shape={OWNER_SHAPES.kutla} />);
    const shapedTile = shaped.container.querySelector<HTMLElement>('[data-project-mark]')!;
    expect(shapedTile.getAttribute('data-project-mark')).toBe(plainTile.getAttribute('data-project-mark'));
    expect(shapedTile.style.background).toBe(plainTile.style.background);
    expect(shapedTile.style.background).not.toBe('');
  });

  it('lets MarkForm draw the shape by itself, and the form without one', () => {
    const shaped = render(<MarkForm mark={5} shape={OWNER_SHAPES.madar} />);
    expect(shaped.container.querySelector('path')).toHaveAttribute('d', OWNER_SHAPES.madar);
    expect(shaped.container.querySelector('path')).not.toHaveAttribute('transform');
    const plain = render(<MarkForm mark={5} />);
    expect(plain.container.querySelector('path')).toHaveAttribute('transform');
  });
});
