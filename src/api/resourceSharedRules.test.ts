import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from './calls';
import type { Event, FileRec, RoleSettings } from './contract/entities';
import { eventForViewer, eventHiddenByLock, fileHiddenByLock } from './folderLock';
import { withRights } from './rights';
import { makeUser, NOW, testApi } from '../test/factories';
import { setNow } from '../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The shared lock rules of folderLock.ts also hide a file of Resources and the events about a locked folder of Resources (security review, 2026-11-05):
 * the paths that call fileHiddenByLock, eventHiddenByLock and eventForViewer need no second call. Hana (usr_003) holds no switch, the Admin holds both.
 */
const AT = '2026-10-04T10:00:00.000+03:00';
const ROLES: RoleSettings = { custom: [{ id: 'rol_001', name: 'Settings keeper', nameAr: 'مدير', rights: ['office.settings'] }] };

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Settings Keeper', roleId: 'rol_001' });
  state.settings.resourceFolders = [
    { id: 'fld_901', name: 'Office codes', createdBy: 'usr_001', createdAt: AT },
    { id: 'fld_902', name: 'Private papers', createdBy: 'usr_001', createdAt: AT, locked: true },
  ];
  const file = (id: string, folderId?: string): FileRec => ({
    id, projectId: null, stageId: null, taskId: null, resource: true, ...(folderId ? { folderId } : {}), name: `${id}.pdf`,
    versions: [{ letter: 'A', blobKey: 'b', mimeType: 'application/pdf', size: 1, uploadedBy: 'usr_001', uploadedAt: AT }],
  });
  state.files.fil_901 = file('fil_901', 'fld_901');
  state.files.fil_902 = file('fil_902', 'fld_902');
  const event = (verb: string, targetType: Event['targetType'], targetId: string, before: unknown, after: unknown): Event => ({
    id: 'evt_901', seq: 901, projectId: null, actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'sty_x',
    verb, targetType, targetId, before, after, createdAt: AT, undoneBy: null,
  });
  return { t, state, file, event };
}

describe('fileHiddenByLock', () => {
  it('hides a file of a locked folder of Resources from a person without the switch, and shows it to a holder', () => {
    const { state } = world();
    const hana = withRights(state, state.users.usr_003);
    const admin = withRights(state, state.users.usr_001);
    expect(fileHiddenByLock(state, hana, state.files.fil_902)).toBe(true);
    expect(fileHiddenByLock(state, admin, state.files.fil_902)).toBe(false);
    expect(fileHiddenByLock(state, hana, state.files.fil_901)).toBe(false);
  });
});

describe('eventHiddenByLock and eventForViewer', () => {
  it('hide the events of a locked folder of Resources, whatever the module that asks', () => {
    const { state, event } = world();
    const hana = withRights(state, state.users.usr_003);
    const admin = withRights(state, state.users.usr_001);
    const lists = { resourceFolders: state.settings.resourceFolders };
    const folderEvent = event('resources.folders_changed', 'settings', 'resources', { resourceFolders: [] }, lists);
    const fileEvent = event('file.added', 'file', 'fil_902', null, state.files.fil_902);
    const openEvent = event('file.added', 'file', 'fil_901', null, state.files.fil_901);
    expect(eventHiddenByLock(state, hana, folderEvent)).toBe(true);
    expect(eventHiddenByLock(state, hana, fileEvent)).toBe(true);
    expect(eventHiddenByLock(state, hana, openEvent)).toBe(false);
    expect(eventHiddenByLock(state, admin, folderEvent)).toBe(false);
    expect(eventHiddenByLock(state, admin, fileEvent)).toBe(false);
    // A list that mixes both kinds keeps the open folder and drops the locked one for a person without the switch.
    const shown = eventForViewer(state, hana, event('undo', 'settings', 'resources', lists, lists));
    expect(JSON.stringify(shown)).not.toContain('Private papers');
    expect(JSON.stringify(shown)).toContain('Office codes');
    expect(JSON.stringify(eventForViewer(state, admin, folderEvent))).toContain('Private papers');
  });
});

describe('every path that returns the settings', () => {
  it('leaves the folders of Resources out of settings.get and settings.update, also for a holder of the settings switch', async () => {
    const { t } = world();
    for (const person of ['usr_003', 'usr_006', 'usr_001']) {
      t.as(person);
      const got = JSON.stringify(await t.api.call('settings.get', {}));
      expect(got, person).not.toMatch(/resourceFolders|Private papers|fld_902/);
    }
    t.as('usr_006');
    const updated = JSON.stringify(await t.api.call('settings.update', { workloadLimit: 11 }));
    expect(updated).not.toMatch(/resourceFolders|Private papers|fld_902/);
    // The History of the settings holds only the changed field.
    const events = JSON.stringify(await t.api.call('events.list', { targetType: 'settings', limit: 50 }));
    expect(events).not.toMatch(/Private papers|fld_902/);
  });

  it('gives the session no folder of Resources', async () => {
    const { t } = world();
    t.as('usr_003');
    expect(JSON.stringify(await t.api.call('session.get', {}))).not.toMatch(/Private papers|resourceFolders/);
  });
});
