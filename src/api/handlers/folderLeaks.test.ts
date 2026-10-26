import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The folders of a hidden project (fbk_066, owner 2026-10-26; the rule of hidden projects, 2026-10-22). A folder and its name are seen by exactly
 * the people who see the files of the project. A person who does not see the project gets the answer of a missing folder or file on every read
 * and write path, and finds no folder name or id in a list, the History, the search or an error text.
 *
 * "Secret tower" is hidden (leader Faisal usr_002, team Sara usr_003, chosen Lina usr_006). Omar usr_004 is outside. usr_007 is Management
 * without the hidden switch. usr_008 is the agent of Omar, usr_009 the agent of Sara. usr_010 has a role without "See every project".
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const TEAM = 'usr_003';
const OUTSIDER = 'usr_004';
const CHOSEN = 'usr_006';
const MANAGEMENT = 'usr_007';
const AGENT_OF_OUTSIDER = 'usr_008';
const AGENT_OF_TEAM = 'usr_009';
const NARROW = 'usr_010';
const WITHOUT_VIEW = [OUTSIDER, AGENT_OF_OUTSIDER, MANAGEMENT, NARROW];
const WITH_VIEW = [ADMIN, LEADER, TEAM, CHOSEN, AGENT_OF_TEAM];

const SECRET = 'Secret mood folder';
const NARROW_ROLES: RoleSettings = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['project.seeAll'] }] };
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = NARROW_ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Chosen' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Turki Management', systemRole: 'management' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Omar Assistant', kind: 'agent', discipline: 'Agent', ownerId: OUTSIDER });
  state.users.usr_009 = makeUser('usr_009', { name: 'Sara Assistant', kind: 'agent', discipline: 'Agent', ownerId: TEAM });
  state.users.usr_010 = makeUser('usr_010', { name: 'Desk Person', roleId: 'rol_001' });
  state.counters.usr = 10;
  t.as(LEADER);
  const made = await t.api.call('projects.create', { name: 'Secret tower', teamIds: [TEAM] });
  const project = made.project.id;
  const stages = Object.values(state.stages).filter((stage) => stage.projectId === project);
  const stage = stages[0].id;
  const folder = await t.api.call('folders.create', { projectId: project, stageId: stage, name: SECRET });
  t.as(TEAM);
  const upload = await t.api.call('files.upload', { projectId: project, name: 'plan.pdf', blob: pdf('x'), folderId: folder.id });
  t.as(LEADER);
  await t.api.call('projects.setAccess', { id: project, hidden: true, viewerIds: [CHOSEN] });
  const event = Object.values(state.events).find((e) => e.verb === 'project.folders_changed')!;
  return { t, ids: { project, stage, folder: folder.id, file: upload.file.id, event: event.id, otherStage: stages[1]?.id ?? stage } };
}
type World = Awaited<ReturnType<typeof world>>;

const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
type Failure = { code: string; message: string; details?: Record<string, unknown> };
const failure = async (run: () => Promise<unknown>): Promise<Failure | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as Failure;
  }
};
/** The answer of a failed call with the id taken out, so a hidden id and a missing id compare equal. */
const shape = (error: Failure | null, id: string) => {
  if (error === null) return null;
  const swap = (text: string) => text.split(id).join('@');
  return { code: error.code, message: swap(error.message), details: JSON.parse(swap(JSON.stringify(error.details ?? {}))) as unknown };
};

describe('a hidden folder answers a person outside the project as a missing one', () => {
  it('on every call that names the folder, the file in it, or the project', async () => {
    const w = await world();
    const P = w.ids.project;
    const probes: [string, unknown, unknown, string][] = [
      ['folders.create', { projectId: P, stageId: w.ids.stage, name: 'Mine' }, { projectId: 'prj_999', stageId: w.ids.stage, name: 'Mine' }, P],
      ['folders.rename', { id: w.ids.folder, name: 'Mine' }, { id: 'fld_999', name: 'Mine' }, w.ids.folder],
      ['folders.delete', { id: w.ids.folder }, { id: 'fld_999' }, w.ids.folder],
      ['files.move', { id: w.ids.file, stageId: w.ids.stage, folderId: null }, { id: 'fil_999', stageId: w.ids.stage, folderId: null }, w.ids.file],
      ['files.move', { id: w.ids.file, stageId: w.ids.stage, folderId: w.ids.folder }, { id: 'fil_999', stageId: w.ids.stage, folderId: w.ids.folder }, w.ids.file],
      ['files.upload', { projectId: P, name: 'a.pdf', blob: pdf('y'), folderId: w.ids.folder }, { projectId: 'prj_999', name: 'a.pdf', blob: pdf('y'), folderId: w.ids.folder }, P],
      ['projects.get', { id: P }, { id: 'prj_999' }, P],
      ['files.list', { projectId: P }, { projectId: 'prj_999' }, P],
      ['events.undo', { eventId: w.ids.event }, { eventId: 'evt_999' }, w.ids.event],
    ];
    for (const person of WITHOUT_VIEW) {
      for (const [name, hidden, missing, id] of probes) {
        const seen = await as(w, person, () => failure(() => w.t.api.call(name as 'projects.get', hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(name as 'projects.get', missing as never)));
        const label = `${person} ${name}`;
        expect(seen, label).not.toBeNull();
        expect(seen!.code, label).toBe('not_found');
        expect(shape(seen, id), label).toEqual(shape(gone, missing && JSON.stringify(missing).match(/"((?:prj|fld|fil|evt)_999)"/)![1]));
        // No error text names the folder, its id or its file.
        expect(JSON.stringify(seen), label).not.toContain(SECRET);
      }
    }
  }, 120_000);

  it('answers the story of the folder as a missing story', async () => {
    const w = await world();
    const event = w.t.store.state.events[w.ids.event];
    const hidden = await as(w, OUTSIDER, () => failure(() => w.t.api.call('events.undoStory', { correlationId: event.correlationId })));
    const gone = await as(w, OUTSIDER, () => failure(() => w.t.api.call('events.undoStory', { correlationId: 'cor_999' })));
    expect(hidden).toMatchObject({ code: 'not_found' });
    expect(shape(hidden, event.correlationId)).toEqual(shape(gone, 'cor_999'));
  });
});

describe('no read path shows a hidden folder to a person outside the project', () => {
  it('shows no folder name or id in a list, the History, the search or the Dashboard', async () => {
    const w = await world();
    for (const person of WITHOUT_VIEW) {
      const reads: [string, unknown][] = [
        ['projects.list', {}],
        ['events.list', { limit: 500 }],
        ['events.list', { projectId: w.ids.project }],
        ['search.query', { q: 'mood' }],
        ['search.query', { q: 'plan' }],
        ['dashboard.get', {}],
        ['updates.list', { projectId: 'prj_001' }],
      ];
      for (const [name, input] of reads) {
        const text = await as(w, person, async () => {
          try {
            return JSON.stringify(await w.t.api.call(name as 'projects.list', input as never));
          } catch (error) {
            return JSON.stringify(error);
          }
        });
        expect(text, `${person} ${name}`).not.toMatch(new RegExp(`${SECRET}|${w.ids.folder}|Secret tower`));
      }
    }
  });

  it('keeps the folder names out of every project list row, also for the people who see the project', async () => {
    const w = await world();
    for (const person of WITH_VIEW) {
      const rows = await as(w, person, () => w.t.api.call('projects.list', {}));
      expect(JSON.stringify(rows), person).not.toContain(SECRET);
    }
  });

  it('shows the folder and the folder of its file to the leader, the team, the chosen person, the Admin and the agent of the team', async () => {
    const w = await world();
    for (const person of WITH_VIEW) {
      const detail = await as(w, person, () => w.t.api.call('projects.get', { id: w.ids.project }));
      expect(detail.folders.map((folder) => folder.name), person).toEqual([SECRET]);
      const files = await as(w, person, () => w.t.api.call('files.list', { projectId: w.ids.project }));
      expect(files.map((view) => view.file.folderId), person).toEqual([w.ids.folder]);
    }
  });

  it('lets the team change folders, and refuses the chosen person who may not upload', async () => {
    const w = await world();
    await expect(as(w, TEAM, () => w.t.api.call('folders.rename', { id: w.ids.folder, name: 'Moods' }))).resolves.toMatchObject({ name: 'Moods' });
    await expect(as(w, CHOSEN, () => w.t.api.call('folders.rename', { id: w.ids.folder, name: 'Mine' }))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(w, AGENT_OF_TEAM, () => w.t.api.call('files.move', { id: w.ids.file, stageId: w.ids.stage, folderId: null }))).resolves.toMatchObject({ file: { folderId: null } });
  });

  it('shows the folder again to nobody new when the chosen person is taken off', async () => {
    const w = await world();
    await as(w, LEADER, () => w.t.api.call('projects.setAccess', { id: w.ids.project, hidden: true, viewerIds: [] }));
    await expect(as(w, CHOSEN, () => w.t.api.call('projects.get', { id: w.ids.project }))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(w, CHOSEN, () => w.t.api.call('folders.rename', { id: w.ids.folder, name: 'Mine' }))).rejects.toMatchObject({ code: 'not_found' });
  });
});
