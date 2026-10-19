import { describe, expect, it } from 'vitest';
import { renderWithRuntime } from '../../test/render';
import { ProjectPin } from './ProjectPin';

describe('ProjectPin (PRJ-14)', () => {
  it('draws the project tile, with the status shape for a late project only', async () => {
    const late = await renderWithRuntime(<ProjectPin id="prj_001" subCompanyId={null} sign="late" selected={false} />);
    expect(late.container.querySelector('[data-project-mark]')).not.toBeNull();
    expect(late.container.querySelector('[data-pin-sign="late"] svg')).not.toBeNull();
    late.unmount();
    const calm = await renderWithRuntime(<ProjectPin id="prj_001" subCompanyId={null} sign={null} selected={false} />);
    expect(calm.container.querySelector('[data-pin-sign]')).toBeNull();
  });

  it('shows the half circle for At risk, and an accent ring on the chosen pin', async () => {
    const risk = await renderWithRuntime(<ProjectPin id="prj_002" subCompanyId={null} sign="at_risk" selected />);
    expect(risk.container.querySelector('[data-pin-sign="at_risk"] svg')).not.toBeNull();
    expect(risk.container.innerHTML).toContain('var(--c-accent)');
  });
});
