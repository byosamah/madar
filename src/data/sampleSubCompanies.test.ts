import { describe, expect, it } from 'vitest';
import { PICTURE_DATA } from '../api/contract/limits';
import { subCompaniesOf } from '../api/store';
import { bootstrap } from '../app/bootstrap';
import { memoryPersister } from '../api/persist';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';
import { addSampleSubCompanies } from './sampleSubCompanies';
import { buildSeed } from './seed';

describe('the sample sub-companies (INT-08, 2026-10-19)', () => {
  it('makes Vado and Bunah, each with a small logo that the picture rule accepts', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(Object.keys(subCompaniesOf(state))).toEqual([]);
    addSampleSubCompanies(state, TODAY);
    const subs = Object.values(subCompaniesOf(state));
    expect(subs.map((sub) => sub.name)).toEqual(['Vado', 'Bunah']);
    for (const sub of subs) {
      expect(sub.logo).toMatch(PICTURE_DATA);
      expect(sub.logo!.length).toBeLessThan(24_000);
    }
  });

  it('names a sub-company on every active and paused project, in turn, and none on a completed one', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    addSampleSubCompanies(state, TODAY);
    const projects = Object.values(state.projects);
    const open = projects.filter((project) => project.status === 'active' || project.status === 'on_hold');
    expect(open.every((project) => project.subCompanyId === 'sub_001' || project.subCompanyId === 'sub_002')).toBe(true);
    expect(new Set(open.map((project) => project.subCompanyId)).size).toBe(2);
    const closed = projects.filter((project) => project.status !== 'active' && project.status !== 'on_hold');
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((project) => !project.subCompanyId)).toBe(true);
  });

  it('is in the prototype office on its first start, and the plain seed stays without it', async () => {
    setNow(NOW);
    const first = await bootstrap({ persister: memoryPersister(), latencyMs: 0 });
    expect(Object.keys(subCompaniesOf(first.store.state))).toHaveLength(2);
    await first.api.call('session.resetSampleData', {});
    expect(Object.keys(subCompaniesOf(first.store.state))).toHaveLength(2);
  });
});
