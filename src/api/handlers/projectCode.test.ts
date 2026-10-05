import { beforeEach, describe, expect, it } from 'vitest';
import { Client, Project } from '../contract/entities';
import type { State } from '../store';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { makeProject, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...projectCalls, ...peopleCalls, ...historyCalls, ...insightCalls };

/** The test world (today 2026-09-30) with two clients: one with initials, one from before initials existed. */
function world(): State {
  const state = makeWorld();
  state.clients.cli_001 = { id: 'cli_001', name: 'Al Zahra Trading', nameAr: '', contactName: '', phone: '', email: '', initials: 'AZT' };
  state.clients.cli_002 = { id: 'cli_002', name: 'Bay Holding', nameAr: '', contactName: '', phone: '', email: '' };
  state.counters = { ...state.counters, cli: 2 };
  return state;
}

const villa = { initials: 'AZT', classification: 'RES', type: 'Multi-unit Dev.' } as const;

describe('the client initials (item 6b)', () => {
  it('reads a client saved before initials existed', () => {
    expect(Client.safeParse({ id: 'cli_009', name: 'Old', contactName: '', phone: '', email: '' }).success).toBe(true);
  });

  it('refuses initials that are not 3 or 4 capital letters', () => {
    for (const initials of ['AZ', 'AZTXY', 'azt', 'A1T', 'أبج']) {
      expect(Client.safeParse({ id: 'cli_009', name: 'X', contactName: '', phone: '', email: '', initials }).success).toBe(false);
    }
  });

  it('saves the initials of a new client, and the Admin changes them', async () => {
    const t = testApi(calls, world());
    const made = await t.api.call('clients.create', { name: 'Coral Homes', initials: 'CRH' });
    expect(t.store.state.clients[made.id].initials).toBe('CRH');
    await t.api.call('clients.update', { id: made.id, patch: { initials: 'CORL' } });
    expect(t.store.state.clients[made.id].initials).toBe('CORL');
  });

  it('refuses wrong initials on create, with the field named', async () => {
    const t = testApi(calls, world());
    await expect(t.api.call('clients.create', { name: 'Coral Homes', initials: 'cr' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['initials'] } });
  });
});

describe('projects.create with the new code (item 6b)', () => {
  it('builds the code from the parts: this month, series 00, the initials, the class and the type', async () => {
    const t = testApi(calls, world());
    const detail = await t.api.call('projects.create', { name: 'Zahra Villas', clientId: 'cli_001', codeParts: villa });
    expect(detail.project.code).toBe('260900AZT-RES-Multi-unit Dev.');
  });

  it('gives the next project of the month the next series', async () => {
    const t = testApi(calls, world());
    await t.api.call('projects.create', { name: 'Zahra Villas', clientId: 'cli_001', codeParts: villa });
    const next = await t.api.call('projects.create', { name: 'Bay Offices', clientId: 'cli_002', codeParts: { initials: 'BAY', classification: 'COM', type: 'Offices' } });
    expect(next.project.code).toBe('260901BAY-COM-Offices');
  });

  it('counts a series that a code typed by hand used', async () => {
    const t = testApi(calls, world());
    await t.api.call('projects.create', { name: 'Old Contract', code: '260907AZT-RES-Villa' });
    const next = await t.api.call('projects.create', { name: 'Zahra Villas', codeParts: villa });
    expect(next.project.code).toBe('260908AZT-RES-Multi-unit Dev.');
  });

  it('saves the initials on a client that has none', async () => {
    const t = testApi(calls, world());
    await t.api.call('projects.create', { name: 'Bay Offices', clientId: 'cli_002', codeParts: { initials: 'BAY', classification: 'COM', type: 'Offices' } });
    expect(t.store.state.clients.cli_002.initials).toBe('BAY');
  });

  it('refuses other initials than those of the client', async () => {
    const t = testApi(calls, world());
    await expect(t.api.call('projects.create', { name: 'Zahra Villas', clientId: 'cli_001', codeParts: { ...villa, initials: 'ZAH' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'initials_mismatch' } });
    expect(Object.keys(t.store.state.projects)).toEqual(['prj_001']);
  });

  it('refuses a wrong class, wrong initials and an empty or long type', async () => {
    const t = testApi(calls, world());
    for (const codeParts of [{ ...villa, classification: 'HOM' }, { ...villa, initials: 'az' }, { ...villa, type: '  ' }, { ...villa, type: 'a'.repeat(41) }]) {
      await expect(t.api.call('projects.create', { name: 'X', codeParts } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    }
  });

  it('takes a full code typed by hand, in the new or the old form', async () => {
    const t = testApi(calls, world());
    const typed = await t.api.call('projects.create', { name: 'Typed', code: '250311AZT-INS-Mosque' });
    expect(typed.project.code).toBe('250311AZT-INS-Mosque');
    const old = await t.api.call('projects.create', { name: 'Old', code: 'KH-24-031' });
    expect(old.project.code).toBe('KH-24-031');
  });

  it('refuses a typed code whose YYMMSS belongs to another contract', async () => {
    const t = testApi(calls, world());
    await t.api.call('projects.create', { name: 'First', code: '250311AZT-INS-Mosque' });
    await expect(t.api.call('projects.create', { name: 'Second', code: '250311BAY-COM-Shop' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['code'], reason: 'code_taken' } });
  });

  it('lets two projects of one contract share one code', async () => {
    const t = testApi(calls, world());
    const first = await t.api.call('projects.create', { name: 'Phase 1', code: '250311AZT-INS-Mosque' });
    const second = await t.api.call('projects.create', { name: 'Phase 2', code: '250311AZT-INS-Mosque' });
    expect(second.project.code).toBe(first.project.code);
  });

  it('copies the code of another project with "same contract as"', async () => {
    const t = testApi(calls, world());
    const first = await t.api.call('projects.create', { name: 'Zahra Villas', clientId: 'cli_001', codeParts: villa });
    const second = await t.api.call('projects.create', { name: 'Zahra Villas annex', clientId: 'cli_001', sameContractAs: first.project.id });
    expect(second.project.code).toBe(first.project.code);
    await expect(t.api.call('projects.create', { name: 'X', sameContractAs: 'prj_404' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['sameContractAs'] } });
  });

  it('takes only one way to give the code', async () => {
    const t = testApi(calls, world());
    await expect(t.api.call('projects.create', { name: 'X', codeParts: villa, code: '250311AZT-INS-Mosque' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['code'] } });
  });

  it('keeps the old automatic code when no code is given, so old callers work', async () => {
    const t = testApi(calls, world());
    const detail = await t.api.call('projects.create', { name: 'Beach Pavilion' });
    expect(detail.project.code).toBe('KH-26-002');
  });

  it('refuses a new series after 99 in one month', async () => {
    const state = world();
    state.projects.prj_002 = makeProject({ id: 'prj_002', code: '260999AZT-RES-Villa' });
    const t = testApi(calls, state);
    await expect(t.api.call('projects.create', { name: 'X', codeParts: villa })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'code_series_full' } });
  });
});

describe('projects.update of the code: the Admin only (item 6b)', () => {
  it('reads both forms of the code in the record', () => {
    const base = makeProject();
    expect(Project.safeParse({ ...base, code: 'KH-26-014' }).success).toBe(true);
    expect(Project.safeParse({ ...base, code: '260902AZT-RES-Multi-unit Dev.' }).success).toBe(true);
    expect(Project.safeParse({ ...base, code: '260902AZT-XXX-Villa' }).success).toBe(false);
  });

  it('lets the Admin correct the code, and the History records it', async () => {
    const t = testApi(calls, world());
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } });
    expect(detail.project.code).toBe('260902AZT-RES-Villa');
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'project.code_changed');
    expect(event).toMatchObject({ targetId: 'prj_001', before: { code: 'KH-26-001' }, after: { code: '260902AZT-RES-Villa' } });
  });

  it('refuses a code change by the project leader, and changes nothing', async () => {
    const t = testApi(calls, world());
    t.as('usr_002');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { code: '260902AZT-RES-Villa', name: 'Renamed' } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.code).toBe('KH-26-001');
    expect(t.store.state.projects.prj_001.name).not.toBe('Renamed');
  });

  it('refuses a corrected code whose YYMMSS belongs to another contract', async () => {
    const state = world();
    state.projects.prj_002 = makeProject({ id: 'prj_002', code: '260902BAY-COM-Shop' });
    const t = testApi(calls, state);
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'code_taken' } });
  });

  it('tells the screens that only the Admin may correct the code', async () => {
    const t = testApi(calls, world());
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.editCode).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.editCode).toBe(false);
  });

  it('lets only the Admin undo a code change', async () => {
    const t = testApi(calls, world());
    await t.api.call('projects.update', { id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'project.code_changed')!;
    t.as('usr_002');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.projects.prj_001.code).toBe('KH-26-001');
  });
});

describe('search.query finds a project by its code (item 6b)', () => {
  it('finds a project by its key, by its full code and by a link mark, and answers with the full code', async () => {
    const state = world();
    state.projects.prj_001.code = '260902AZT-RES-Multi-unit Dev.';
    const t = testApi(calls, state);
    for (const text of ['260902AZT', '260902azt', '#260902AZT', '260902AZT-RES-Multi-unit Dev.']) {
      const found = await t.api.call('search.query', { text });
      expect(found.projects.map((p) => p.code), text).toEqual(['260902AZT-RES-Multi-unit Dev.']);
    }
  });

  it('still finds an old code', async () => {
    const t = testApi(calls, world());
    expect((await t.api.call('search.query', { text: '#KH-26-001' })).projects.map((p) => p.id)).toEqual(['prj_001']);
  });
});
