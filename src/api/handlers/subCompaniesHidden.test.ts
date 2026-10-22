import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { subCompaniesOf } from '../store';
import { makeProject, makeUser, NOW, testApi } from '../../test/factories';
import { DEFAULT_EXTRA } from '../rightsCatalog';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * subCompanies.delete and a hidden project (hidden projects, owner 2026-10-22). A manager without "See hidden projects" must not learn that
 * a hidden project names the sub-company: the refusal counts the projects the person sees, and when the person sees none while a hidden
 * one remains, only a holder of "See hidden projects" deletes. A move with moveToId still moves every project.
 * usr_007 is Management with "Manage sub-companies"; usr_008 is Management with "See hidden projects" too.
 */
async function world(options: { open?: boolean } = {}) {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_007 = makeUser('usr_007', { name: 'Manager', systemRole: 'management' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Manager Plus', systemRole: 'management' });
  state.settings.roles = { rights: { management: [...DEFAULT_EXTRA.management, 'subCompanies.manage'] } };
  t.as('usr_001');
  const one = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
  const two = await t.api.call('subCompanies.save', { name: 'Bunah', nameAr: 'بناء', logo: null });
  state.projects.prj_001.subCompanyId = options.open === false ? null : one.id;
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', subCompanyId: one.id, access: { hidden: true, viewerIds: [] } });
  state.stages.stg_003 = { id: 'stg_003', projectId: 'prj_002', name: 'Concept', order: 0, startDate: null, endDate: null };
  state.projects.prj_002.currentStageId = 'stg_003';
  state.counters.prj = 2;
  return { t, state, one: one.id, two: two.id };
}

describe('subCompanies.delete with a hidden project', () => {
  it('counts only the projects the person sees in the refusal', async () => {
    const { t, one } = await world();
    t.as('usr_007');
    await expect(t.api.call('subCompanies.delete', { id: one })).rejects.toMatchObject({ code: 'conflict', details: { reason: 'sub_company_in_use', count: 1 } });
  });

  it('counts every project for a holder of See hidden projects, and for the Admin', async () => {
    const { t, state, one } = await world();
    state.settings.roles = { rights: { management: [...DEFAULT_EXTRA.management, 'subCompanies.manage', 'project.hidden'] } };
    for (const person of ['usr_001', 'usr_008']) {
      t.as(person);
      await expect(t.api.call('subCompanies.delete', { id: one }), person).rejects.toMatchObject({ details: { reason: 'sub_company_in_use', count: 2 } });
    }
  });

  it('refuses a person who sees none of them while a hidden one remains, and never answers with a count of 0', async () => {
    const { t, one } = await world({ open: false });
    t.as('usr_007');
    const error = await t.api.call('subCompanies.delete', { id: one }).then(() => null, (e: unknown) => e as { code: string; details?: Record<string, unknown> });
    expect(error).toMatchObject({ code: 'forbidden', details: { action: 'project.hidden' } });
    expect(error?.details).not.toHaveProperty('count');
    expect(subCompaniesOf(t.store.state)[one]).toBeDefined();
  });

  it('lets the Admin delete it, moving the hidden project, when only a hidden project names it', async () => {
    const { t, one, two } = await world({ open: false });
    t.as('usr_001');
    await expect(t.api.call('subCompanies.delete', { id: one })).rejects.toMatchObject({ details: { reason: 'sub_company_in_use', count: 1 } });
    await t.api.call('subCompanies.delete', { id: one, moveToId: two });
    // A refused call puts the state back, so the test reads the store again.
    expect(t.store.state.projects.prj_002.subCompanyId).toBe(two);
    expect(subCompaniesOf(t.store.state)[one]).toBeUndefined();
  });

  it('moves every project, the hidden one too, when a person who sees only one of them gives moveToId', async () => {
    const { t, state, one, two } = await world();
    t.as('usr_007');
    await t.api.call('subCompanies.delete', { id: one, moveToId: two });
    expect(state.projects.prj_001.subCompanyId).toBe(two);
    expect(state.projects.prj_002.subCompanyId).toBe(two);
  });

  it('deletes a sub-company that no project names, for anyone with the right', async () => {
    const { t, state, two } = await world();
    t.as('usr_007');
    await t.api.call('subCompanies.delete', { id: two });
    expect(subCompaniesOf(state)[two]).toBeUndefined();
  });
});
