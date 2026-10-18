import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { subCompanyCalls } from './subCompanies';
import { makeUser, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

const calls = { ...subCompanyCalls, ...historyCalls, ...projectCalls };

beforeEach(() => setNow(NOW));

/** The world of the factories (Hala Admin, usr_001, is the actor) plus a Management person (usr_006) and a member (usr_003). */
function office() {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' });
  return testApi(calls, state);
}

const logo = 'data:image/png;base64,iVBORw0KGgo=';

describe('sub-companies', () => {
  it('lets the Admin save sub-companies, and lists them by English name for everyone', async () => {
    const t = office();
    const bunah = await t.api.call('subCompanies.save', { name: 'Bunah', nameAr: 'بناة', logo: null });
    expect(bunah).toMatchObject({ id: 'sub_001', name: 'Bunah', nameAr: 'بناة', logo: null, createdBy: 'usr_001' });
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo });
    expect(vado.id).toBe('sub_002');
    t.as('usr_003');
    expect((await t.api.call('subCompanies.list', {})).map((item) => item.name)).toEqual(['Bunah', 'Vado']);
  });

  it('lets only the Admin save and delete, and refuses Management and a member', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    t.as('usr_006');
    await expect(t.api.call('subCompanies.save', { name: 'Other', nameAr: 'آخر', logo: null })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('subCompanies.delete', { id: vado.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('subCompanies.save', { id: vado.id, name: 'Vado', nameAr: 'فادو', logo: null })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('subCompanies.delete', { id: vado.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual(['sub_001']);
  });

  it('refuses a name that another sub-company has in either language, ignoring case', async () => {
    const t = office();
    await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    await expect(t.api.call('subCompanies.save', { name: 'vado', nameAr: 'شركة', logo: null }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['name'], reason: 'duplicate_name' } });
    await expect(t.api.call('subCompanies.save', { name: 'Bunah', nameAr: 'فادو', logo: null }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['nameAr'], reason: 'duplicate_name' } });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toHaveLength(1);
  });

  it('keeps its own names on an edit, and changes the logo and the names', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    expect(await t.api.call('subCompanies.save', { id: vado.id, name: 'vado', nameAr: 'فادو', logo })).toMatchObject({ id: vado.id, logo });
    expect(await t.api.call('subCompanies.save', { id: vado.id, name: 'Vado Group', nameAr: 'مجموعة فادو', logo: null }))
      .toMatchObject({ name: 'Vado Group', nameAr: 'مجموعة فادو', logo: null });
  });

  it('refuses a logo that is not picture data', async () => {
    const t = office();
    await expect(t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: 'https://example.com/logo.png' }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual([]);
  });

  it('answers not_found for a missing sub-company on an edit or a delete', async () => {
    const t = office();
    await expect(t.api.call('subCompanies.save', { id: 'sub_009', name: 'Vado', nameAr: 'فادو', logo: null })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('subCompanies.delete', { id: 'sub_009' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses to delete a sub-company that a project names, and says how many projects name it', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    Object.assign(t.store.state.projects.prj_001, { subCompanyId: vado.id });
    await expect(t.api.call('subCompanies.delete', { id: vado.id }))
      .rejects.toMatchObject({ code: 'conflict', details: { reason: 'sub_company_in_use', count: 1 } });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual([vado.id]);
  });

  it('deletes a sub-company that no project names, and Undo brings it back', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    expect(await t.api.call('subCompanies.delete', { id: vado.id })).toEqual({});
    expect(await t.api.call('subCompanies.list', {})).toEqual([]);
    const removal = Object.values(t.store.state.events).find((event) => event.verb === 'subCompany.deleted');
    expect(removal).toMatchObject({ targetType: 'subCompany', targetId: vado.id });
    await t.api.call('events.undo', { eventId: removal!.id });
    expect((await t.api.call('subCompanies.list', {})).map((item) => item.id)).toEqual([vado.id]);
  });

  it('refuses to undo the making of a sub-company that a project names', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: vado.id } });
    const making = Object.values(t.store.state.events).find((event) => event.verb === 'subCompany.created');
    await expect(t.api.call('events.undo', { eventId: making!.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual([vado.id]);
    expect(t.store.state.projects.prj_001.subCompanyId).toBe(vado.id);
  });

  it('refuses to undo a project move back to a sub-company that a delete removed since', async () => {
    const t = office();
    const vado = await t.api.call('subCompanies.save', { name: 'Vado', nameAr: 'فادو', logo: null });
    const bunah = await t.api.call('subCompanies.save', { name: 'Bunah', nameAr: 'بناة', logo: null });
    await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: vado.id } });
    await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: bunah.id } });
    await t.api.call('subCompanies.delete', { id: vado.id });
    const move = Object.values(t.store.state.events).find(
      (event) => event.targetType === 'project' && (event.after as { subCompanyId?: string } | null)?.subCompanyId === bunah.id,
    );
    await expect(t.api.call('events.undo', { eventId: move!.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(t.store.state.projects.prj_001.subCompanyId).toBe(bunah.id);
  });
});
