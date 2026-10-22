import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import { makeProject, makeStage, makeTask, makeUser, makeWorld, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey, nextId, paymentsOf, subCompaniesOf, trackerOf, type State } from '../store';

beforeEach(() => setNow(NOW));

/**
 * The leak tests of the lists (hidden projects, wave D2, owner 2026-10-22). prj_001 is open. prj_002 "Secret Pavilion" is hidden: its
 * leader is Faisal (usr_002), Sara (usr_003) is on its team, Reem (usr_006) is a chosen person. prj_003 is a paused hidden project that
 * turned stale. Hala (usr_001) is the Admin, Omar (usr_004) is a Member outside, Mona (usr_007) is Management with no switch for hidden
 * projects, usr_008 is the agent of Omar. prj_004 is open, and a role without "See every project" must not see it unless it works there.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const TEAM = 'usr_003';
const OUTSIDER = 'usr_004';
const CHOSEN = 'usr_006';
const MANAGEMENT = 'usr_007';
const OUTSIDER_AGENT = 'usr_008';
const HIDDEN = 'prj_002';
const HIDDEN_TASKS = ['tsk_002', 'tsk_003', 'tsk_004'];
const MARKERS = ['prj_002', 'prj_003', 'Secret Pavilion', 'KH-26-002', 'Secret handover', 'Secret pavilion', 'Riser 9031', 'Secret Wing', 'tsk_002', 'tsk_003', 'tsk_004'];

function build(): State {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Reem Chosen' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Mona Management', systemRole: 'management' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Omar Assistant', kind: 'agent', discipline: 'Agent', ownerId: OUTSIDER });
  state.counters.usr = 8;
  subCompaniesOf(state).sub_001 = { id: 'sub_001', name: 'Secret Wing', nameAr: 'الجناح السري', logo: null, createdBy: ADMIN, createdAt: STAMP };
  // The hidden project, with two stages, three to-dos, a deadline, a payment and a Tracker entry that waits for our reply.
  state.projects[HIDDEN] = makeProject({
    id: HIDDEN, code: 'KH-26-002', name: 'Secret Pavilion', leaderId: LEADER, currentStageId: 'stg_004', areaM2: null, subCompanyId: 'sub_001',
    access: { hidden: true, viewerIds: [CHOSEN] },
    templateLink: { templateId: 'ptp_001', linkedAt: STAMP, syncedAt: null, rolePeople: {}, droppedPartIds: [] },
  });
  state.stages.stg_003 = makeStage({ id: 'stg_003', projectId: HIDDEN, name: 'Concept', order: 0, startDate: '2026-09-01', endDate: '2026-09-20' });
  state.stages.stg_004 = makeStage({ id: 'stg_004', projectId: HIDDEN, name: 'Schematic Design', order: 1, startDate: '2026-09-21', endDate: null });
  for (const userId of [LEADER, TEAM]) state.members[memberKey(HIDDEN, userId)] = { projectId: HIDDEN, userId, discipline: 'Architect' };
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: TEAM, dueDate: '2026-10-03' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', projectId: HIDDEN, stageId: 'stg_004', title: 'Secret pavilion plan', ownerId: TEAM, dueDate: '2026-09-20', status: 'in_progress' });
  state.tasks.tsk_003 = makeTask({ id: 'tsk_003', projectId: HIDDEN, stageId: 'stg_004', title: 'Secret pavilion review', ownerId: TEAM, dueDate: '2026-10-01', status: 'in_review' });
  state.tasks.tsk_004 = makeTask({ id: 'tsk_004', projectId: HIDDEN, stageId: 'stg_004', title: 'Secret pavilion section', ownerId: null, dueDate: '2026-10-02' });
  state.counters.tsk = 4;
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: HIDDEN, stageId: null, name: 'Secret handover', date: '2026-10-05' };
  paymentsOf(state).pay_002 = {
    id: 'pay_002', projectId: HIDDEN, name: 'Secret advance', amount: 5000, dueDate: '2026-09-25', receivedOn: null, note: '', createdBy: ADMIN, createdAt: STAMP,
  };
  trackerOf(state).trk_002 = {
    id: 'trk_002', projectId: HIDDEN, type: 'message', direction: 'in', title: 'Secret client question', note: '', date: '2026-09-28', waiting: 'us', closedAt: null,
    closedBy: null, fileIds: [], peopleIds: [], auto: null, createdBy: LEADER, createdAt: STAMP,
  };
  // A second hidden project: paused long ago, so it turns stale.
  state.projects.prj_003 = makeProject({
    id: 'prj_003', code: 'KH-26-003', name: 'Secret Annex', status: 'on_hold', leaderId: LEADER, currentStageId: 'stg_005', access: { hidden: true, viewerIds: [] },
    pause: { reason: 'Waiting', resumeOn: null, by: LEADER, at: '2026-06-01T09:00:00.000+03:00', kind: 'internal' },
  });
  for (const userId of [LEADER, TEAM]) state.members[memberKey('prj_003', userId)] = { projectId: 'prj_003', userId, discipline: 'Architect' };
  state.stages.stg_005 = makeStage({ id: 'stg_005', projectId: 'prj_003', name: 'Concept', order: 0, startDate: '2026-06-01', endDate: '2026-12-31' });
  // An open project where only Faisal and Sara work: the test of a role without "See every project".
  state.projects.prj_004 = makeProject({ id: 'prj_004', code: 'KH-26-004', name: 'Open Courtyard', leaderId: LEADER, currentStageId: 'stg_006' });
  state.stages.stg_006 = makeStage({ id: 'stg_006', projectId: 'prj_004', name: 'Concept', order: 0, startDate: '2026-09-01', endDate: '2026-10-31' });
  state.members[memberKey('prj_004', LEADER)] = { projectId: 'prj_004', userId: LEADER, discipline: 'Architect' };
  state.tasks.tsk_005 = makeTask({ id: 'tsk_005', projectId: 'prj_004', stageId: 'stg_006', title: 'Courtyard levels', ownerId: LEADER, dueDate: '2026-10-04' });
  state.counters.tsk = 5;
  state.counters.prj = 4;
  state.counters.stg = 6;
  addProjectConversation(state, HIDDEN, STAMP);
  const chatId = Object.values(state.conversations).find((c) => c.projectId === HIDDEN)!.id;
  state.messages[nextId(state, 'msg')] = {
    id: 'msg_001', conversationId: chatId, authorId: LEADER, actingForId: LEADER, body: 'Riser 9031 @' + TEAM, mentions: [], createdAt: '2026-09-30T10:00:00.000+03:00', editedAt: null,
  };
  state.comments.cmt_001 = {
    id: 'cmt_001', targetType: 'task', targetId: 'tsk_002', authorId: TEAM, body: 'Riser 9031 in the pavilion', reactions: { '👍': [], '✅': [], '👀': [] },
    fileIds: [], createdAt: '2026-09-30T11:00:00.000+03:00', editedAt: null,
  } as never;
  return state;
}

function world() {
  const t = testApi(calls, build());
  return t;
}
type World = ReturnType<typeof world>;

/** Runs a read as one person and gives the answer as text, to search for leaked markers. */
async function text(t: World, userId: string, name: string, input: Record<string, unknown> = {}): Promise<string> {
  t.as(userId);
  return JSON.stringify(await (t.api.call as (n: string, i: unknown) => Promise<unknown>)(name, input));
}
async function answer<T = never>(t: World, userId: string, name: string, input: Record<string, unknown> = {}): Promise<T> {
  t.as(userId);
  return (t.api.call as (n: string, i: unknown) => Promise<unknown>)(name, input) as Promise<T>;
}
function expectNone(body: string, who: string, what: string) {
  for (const marker of MARKERS) expect(body, `${who} ${what} leaks ${marker}`).not.toContain(marker);
}

type Row = { project: { id: string } };
const projectIds = (rows: Row[]) => rows.map((row) => row.project.id).sort();

describe('projects.list shows only the projects the person sees', () => {
  it('hides a hidden project from an outsider, the agent of the outsider and Management without the switch', async () => {
    const t = world();
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      const rows = await answer<Row[]>(t, who, 'projects.list', { status: 'all' });
      expect(projectIds(rows), who).toEqual(['prj_001', 'prj_004']);
      expectNone(JSON.stringify(rows), who, 'projects.list');
    }
  });

  it('shows it to the leader, a team member, the Admin and the agent of a team member', async () => {
    const t = world();
    for (const who of [LEADER, TEAM, ADMIN, 'usr_005']) {
      const rows = await answer<Row[]>(t, who, 'projects.list', { status: 'all' });
      expect(projectIds(rows), who).toEqual(['prj_001', 'prj_002', 'prj_003', 'prj_004']);
    }
  });

  it('shows a chosen person the hidden project that names the person, and no other', async () => {
    const t = world();
    expect(projectIds(await answer<Row[]>(t, CHOSEN, 'projects.list', { status: 'all' }))).toEqual(['prj_001', 'prj_002', 'prj_004']);
  });

  it('keeps the filters from showing it: team, leader, sub-company, mine, no_area, stage_no_end', async () => {
    const t = world();
    const filters: Record<string, unknown>[] = [
      { status: 'all', leaderId: LEADER }, { status: 'all', subCompanyId: 'sub_001' }, { status: 'all', filter: 'no_area' },
      { status: 'all', filter: 'stage_no_end' }, { status: 'all', filter: 'no_sub_company' }, { status: 'on_hold' },
    ];
    for (const input of filters) expectNone(await text(t, OUTSIDER, 'projects.list', input), OUTSIDER, JSON.stringify(input));
  });

  it('hides an open project from a role without "See every project", unless the person works on it', async () => {
    const t = world();
    t.store.state.settings.roles = { off: { member: ['project.seeAll'] } };
    expect(projectIds(await answer<Row[]>(t, OUTSIDER, 'projects.list', { status: 'all' }))).toEqual([]);
    expect(projectIds(await answer<Row[]>(t, TEAM, 'projects.list', { status: 'all' }))).toEqual(['prj_001', 'prj_002', 'prj_003']);
    expect(projectIds(await answer<Row[]>(t, LEADER, 'projects.list', { status: 'all' }))).toEqual(['prj_001', 'prj_002', 'prj_003', 'prj_004']);
    // Management keeps its switch, and a chosen person sees a hidden project.
    expect(projectIds(await answer<Row[]>(t, MANAGEMENT, 'projects.list', { status: 'all' }))).toEqual(['prj_001', 'prj_004']);
    expect(projectIds(await answer<Row[]>(t, CHOSEN, 'projects.list', { status: 'all' }))).toEqual(['prj_002']);
  });

  it('answers as before with the default rights and no hidden project', async () => {
    const t = world();
    for (const project of Object.values(t.store.state.projects)) delete project.access;
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      expect(projectIds(await answer<Row[]>(t, who, 'projects.list', { status: 'all' })), who).toEqual(['prj_001', 'prj_002', 'prj_003', 'prj_004']);
    }
  });
});

describe('tasks.list and deadlines.list', () => {
  it('give an outsider no to-do and no deadline of a hidden project', async () => {
    const t = world();
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      for (const input of [{}, { activeProjectsOnly: false }, { projectId: HIDDEN }, { filter: 'no_lead' }, { filter: 'overdue' }, { workOf: TEAM }, { ownerId: TEAM }, { leaderId: LEADER }, { subCompanyId: 'sub_001' }]) {
        expectNone(await text(t, who, 'tasks.list', input), who, `tasks.list ${JSON.stringify(input)}`);
      }
      for (const input of [{}, { status: 'all' }, { leaderId: LEADER }, { subCompanyId: 'sub_001' }]) {
        expectNone(await text(t, who, 'deadlines.list', input), who, `deadlines.list ${JSON.stringify(input)}`);
      }
    }
  });

  it('give the team, the leader, a chosen person and the Admin the to-dos and the deadline', async () => {
    const t = world();
    for (const who of [LEADER, TEAM, CHOSEN, ADMIN]) {
      const rows = await answer<{ task: { id: string } }[]>(t, who, 'tasks.list', {});
      expect(rows.map((row) => row.task.id).filter((id) => HIDDEN_TASKS.includes(id)).sort(), who).toEqual(HIDDEN_TASKS);
      expect((await answer<Row[]>(t, who, 'deadlines.list', {})).map((row) => (row as unknown as { deadline: { id: string } }).deadline.id), who).toContain('ddl_002');
    }
  });

  it('hide the to-dos and deadlines of an open project from a role without "See every project"', async () => {
    const t = world();
    t.store.state.settings.roles = { off: { member: ['project.seeAll'] } };
    expect(await answer<unknown[]>(t, OUTSIDER, 'tasks.list', {})).toEqual([]);
    expect(await answer<unknown[]>(t, OUTSIDER, 'deadlines.list', { status: 'all' })).toEqual([]);
    const mine = await answer<{ task: { id: string } }[]>(t, TEAM, 'tasks.list', {});
    expect(mine.map((row) => row.task.id).sort()).toEqual(['tsk_001', 'tsk_002', 'tsk_003', 'tsk_004']);
  });
});

describe('dashboard.get counts only the projects the person sees', () => {
  it('shows an outsider no tile, row, schedule line, review, stale project, leader or money of a hidden project', async () => {
    const t = world();
    // The Admin lets Management see the Dashboard numbers of money and gaps, so those parts are tested too.
    t.store.state.settings.roles = { rights: { management: ['gaps.view', 'payment.view'] } };
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      for (const input of [{}, { status: 'all' }, { status: 'on_hold' }, { leaderId: LEADER }, { subCompanyId: 'sub_001' }]) {
        expectNone(await text(t, who, 'dashboard.get', input), who, `dashboard.get ${JSON.stringify(input)}`);
      }
    }
    const d = await answer<{
      tiles: { activeProjects: number; overdueTasks: number; deadlinesNext14: number; inDesignWithoutArea: number };
      workload: { rows: { user: { id: string }; overdue: number; counts: number[] }[]; unassigned: { overdue: number; counts: number[] } | null };
      schedule: unknown[]; waitingForUs: unknown[]; inReview: unknown[]; attention: { stale: unknown[] }; leaders: { id: string }[];
      money: { pastDue: { count: number; total: number } } | null; gaps: { noLead: number; noArea: number; projectsStageNoEnd: number } | null;
    }>(t, MANAGEMENT, 'dashboard.get', { status: 'all' });
    expect(d.tiles).toMatchObject({ activeProjects: 2, deadlinesNext14: 0, inDesignWithoutArea: 0 });
    expect(d.schedule).toHaveLength(2);
    expect(d.waitingForUs).toEqual([]);
    expect(d.inReview).toEqual([]);
    expect(d.attention.stale).toEqual([]);
    // Sara has only tsk_001 in sight: tsk_002, tsk_003 and tsk_004 are of the hidden project.
    expect(d.workload.rows.find((row) => row.user.id === TEAM)).toMatchObject({ overdue: 0 });
    expect(d.workload.unassigned).toEqual({ overdue: 0, counts: [0, 0, 0, 0] });
    expect(d.money?.pastDue).toMatchObject({ count: 0, total: 0 });
    expect(d.gaps).toMatchObject({ noLead: 0, noArea: 0, projectsStageNoEnd: 0 });
    expect(d.leaders.map((one) => one.id)).toEqual([LEADER]);
  });

  it('counts the hidden project for the team, the leader and the Admin', async () => {
    const t = world();
    for (const who of [LEADER, TEAM, ADMIN]) {
      const d = await answer<{
        tiles: { activeProjects: number; overdueTasks: number }; workload: { rows: { user: { id: string }; overdue: number }[]; unassigned: { overdue: number; counts: number[] } };
        schedule: { project: { id: string } }[]; waitingForUs: { project: { id: string } }[]; inReview: { tasks: { id: string }[] }[]; attention: { stale: { project: { id: string } }[] };
      }>(t, who, 'dashboard.get', { status: 'all' });
      expect(d.tiles.activeProjects, who).toBe(3);
      expect(d.schedule.map((row) => row.project.id).sort(), who).toEqual(['prj_001', 'prj_002', 'prj_003', 'prj_004']);
      expect(d.workload.rows.find((row) => row.user.id === TEAM)?.overdue, who).toBe(1);
      expect(d.workload.unassigned.counts.reduce((a, b) => a + b, 0), who).toBe(1);
      expect(d.waitingForUs.map((row) => row.project.id), who).toEqual([HIDDEN]);
      expect(d.inReview.flatMap((row) => row.tasks.map((task) => task.id)), who).toContain('tsk_003');
      expect(d.attention.stale.map((row) => row.project.id), who).toEqual(['prj_003']);
    }
  });

  it('counts the work of another person only on the projects the viewer sees, for a role without "See every project"', async () => {
    const t = world();
    t.store.state.settings.roles = { off: { member: ['project.seeAll'] } };
    const d = await answer<{ tiles: { activeProjects: number }; workload: { rows: { user: { id: string }; overdue: number; counts: number[] }[] }; schedule: unknown[] }>(t, OUTSIDER, 'dashboard.get', {});
    expect(d.tiles.activeProjects).toBe(0);
    expect(d.schedule).toEqual([]);
    for (const row of d.workload.rows) expect([row.user.id, row.overdue, row.counts.reduce((a, b) => a + b, 0)]).toEqual([row.user.id, 0, 0]);
  });
});

describe('search.query', () => {
  it('finds no project, to-do, file, comment or chat message of a hidden project for an outsider', async () => {
    const t = world();
    t.as(TEAM);
    await t.api.call('files.upload', { name: 'Secret pavilion plan.pdf', projectId: HIDDEN, blob: new Blob(['x'], { type: 'application/pdf' }) });
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      for (const query of ['secret', 'pavilion', 'KH-26-002', '#KH-26-002', 'Riser 9031', 'Secret Wing']) {
        const body = await text(t, who, 'search.query', { text: query });
        for (const marker of ['prj_002', 'prj_003', 'tsk_002', 'tsk_003', 'tsk_004', 'cmt_001', 'msg_001', 'Secret Pavilion', 'Secret pavilion', 'KH-26-002', 'Riser 9031 in', 'plan.pdf']) {
          expect(body, `${who} ${query} leaks ${marker}`).not.toContain(marker);
        }
      }
    }
  });

  it('counts a sub-company with its visible projects only', async () => {
    const t = world();
    const view = (who: string) => answer<{ subCompanies: { id: string; projects: number }[] }>(t, who, 'search.query', { text: 'Secret Wing' });
    expect((await view(OUTSIDER)).subCompanies).toEqual([expect.objectContaining({ id: 'sub_001', projects: 0 })]);
    expect((await view(TEAM)).subCompanies).toEqual([expect.objectContaining({ id: 'sub_001', projects: 1 })]);
    expect((await view(ADMIN)).subCompanies).toEqual([expect.objectContaining({ id: 'sub_001', projects: 1 })]);
  });

  it('finds the hidden project, its to-dos, its files, its comments and its chat for the team, a chosen person and the Admin', async () => {
    const t = world();
    t.as(TEAM);
    await t.api.call('files.upload', { name: 'Secret pavilion plan.pdf', projectId: HIDDEN, blob: new Blob(['x'], { type: 'application/pdf' }) });
    for (const who of [LEADER, TEAM, ADMIN]) {
      const found = await answer<{ projects: { id: string }[]; tasks: { id: string }[]; files: { name: string }[]; messages: { id: string }[] }>(t, who, 'search.query', { text: 'secret' });
      expect(found.projects.map((p) => p.id), who).toEqual(expect.arrayContaining([HIDDEN]));
      expect(found.tasks.map((p) => p.id), who).toEqual(expect.arrayContaining(['tsk_002']));
      expect(found.files.map((p) => p.name), who).toEqual(['Secret pavilion plan.pdf']);
      const hits = await answer<{ messages: { id: string }[] }>(t, who, 'search.query', { text: 'Riser 9031' });
      expect(hits.messages.map((m) => m.id).sort(), who).toEqual(['cmt_001', 'msg_001']);
    }
    const chosen = await answer<{ projects: { id: string }[]; tasks: { id: string }[] }>(t, CHOSEN, 'search.query', { text: 'secret' });
    expect(chosen.projects.map((p) => p.id)).toContain(HIDDEN);
    expect(chosen.tasks.map((p) => p.id)).toContain('tsk_002');
  });

  it('hides the open project and its to-dos from a role without "See every project"', async () => {
    const t = world();
    t.store.state.settings.roles = { off: { member: ['project.seeAll'] } };
    const found = await answer<{ projects: unknown[]; tasks: unknown[] }>(t, OUTSIDER, 'search.query', { text: 'courtyard' });
    expect(found.projects).toEqual([]);
    expect(found.tasks).toEqual([]);
    expect((await answer<{ tasks: unknown[] }>(t, LEADER, 'search.query', { text: 'courtyard' })).tasks).toHaveLength(1);
  });
});

describe('reports.office', () => {
  it('counts nothing of a hidden project for a person outside it', async () => {
    const t = world();
    t.store.state.settings.roles = { rights: { management: ['report.office', 'payment.view'] } };
    const input = { period: 'range', from: '2026-09-01', to: '2026-09-30' };
    const outside = await answer<{ projects: { project: { id: string } }[]; totals: { tasks: { made: number; pastDueAtEnd: number }; projects: { active: number } }; money: { pastDueAtEnd: number } | null }>(t, MANAGEMENT, 'reports.office', input);
    expectNone(JSON.stringify(outside), MANAGEMENT, 'reports.office');
    expect(outside.projects.map((row) => row.project.id).sort()).toEqual(['prj_001', 'prj_004']);
    expect(outside.totals.projects.active).toBe(2);
    expect(outside.money?.pastDueAtEnd).toBe(0);
    const admin = await answer<{ projects: { project: { id: string } }[]; totals: { projects: { active: number } } }>(t, ADMIN, 'reports.office', input);
    expect(admin.projects.map((row) => row.project.id)).toEqual(expect.arrayContaining([HIDDEN]));
    expect(admin.totals.projects.active).toBe(3);
  });

  it('counts the stage moves of a hidden project only for the people who see it', async () => {
    const t = world();
    t.store.state.settings.roles = { rights: { management: ['report.office'] } };
    t.store.state.events.evt_001 = {
      id: 'evt_001', seq: 1, projectId: HIDDEN, targetType: 'project', targetId: HIDDEN, verb: 'project.stage_changed', before: null, after: null,
      actorId: LEADER, actorKind: 'human', actingForId: LEADER, correlationId: 'cor_1', createdAt: '2026-09-15T10:00:00.000+03:00', undoneBy: null,
    } as never;
    t.store.state.events.evt_002 = { ...t.store.state.events.evt_001, id: 'evt_002', seq: 2, projectId: 'prj_001', targetId: 'prj_001' };
    const input = { period: 'range', from: '2026-09-01', to: '2026-09-30' };
    const moves = async (who: string) => (await answer<{ totals: { stageMoves: number } }>(t, who, 'reports.office', input)).totals.stageMoves;
    expect(await moves(MANAGEMENT)).toBe(1);
    expect(await moves(ADMIN)).toBe(2);
  });
});

describe('the other lists', () => {
  it('subCompanies.list counts the projects of a sub-company that the person sees', async () => {
    const t = world();
    const count = async (who: string) => (await answer<{ id: string; projectCount?: number }[]>(t, who, 'subCompanies.list')).find((sub) => sub.id === 'sub_001')?.projectCount;
    expect(await count(OUTSIDER)).toBe(0);
    expect(await count(OUTSIDER_AGENT)).toBe(0);
    expect(await count(TEAM)).toBe(1);
    expect(await count(CHOSEN)).toBe(1);
    expect(await count(ADMIN)).toBe(1);
  });

  it('projectTemplates.list followers and projectTemplates.usage leave out a hidden project for a holder who does not see it', async () => {
    const t = world();
    t.store.state.settings.roles = { rights: { management: ['templates.updateProjects', 'templates.projectCreate'] } };
    t.as(ADMIN);
    const saved = await t.api.call('projectTemplates.save', {
      name: 'Pavilion', roles: [], stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }], tasks: [],
    } as never);
    t.store.state.projects[HIDDEN].templateLink!.templateId = saved.id;
    t.store.state.projects.prj_004.templateLink = { templateId: saved.id, linkedAt: STAMP, syncedAt: null, rolePeople: {}, droppedPartIds: [] };
    const followers = async (who: string) => (await answer<{ id: string; followers?: number }[]>(t, who, 'projectTemplates.list')).find((row) => row.id === saved.id)?.followers;
    expect(await followers(MANAGEMENT)).toBe(1);
    expect(await followers(ADMIN)).toBe(2);
    const usage = await answer<{ linked: { project: { id: string } }[]; notLinked: { project: { id: string } }[] }>(t, MANAGEMENT, 'projectTemplates.usage', { templateId: saved.id });
    expectNone(JSON.stringify(usage), MANAGEMENT, 'projectTemplates.usage');
    expect(usage.linked.map((row) => row.project.id)).toEqual(['prj_004']);
    expect(usage.notLinked.map((row) => row.project.id)).toEqual(['prj_001']);
    const admin = await answer<{ linked: { project: { id: string } }[]; notLinked: { project: { id: string } }[] }>(t, ADMIN, 'projectTemplates.usage', { templateId: saved.id });
    expect(admin.linked.map((row) => row.project.id).sort()).toEqual([HIDDEN, 'prj_004']);
    expect(admin.notLinked.map((row) => row.project.id).sort()).toEqual(['prj_001', 'prj_003']);
  });

  it('session.get gives the leader hint only for a leader of a project the person sees', async () => {
    const t = world();
    t.store.state.projects.prj_001.leaderId = 'usr_002';
    // usr_006 leads only the hidden project prj_003 here, so a person who does not see it reads the hint "member".
    t.store.state.projects.prj_003.leaderId = CHOSEN;
    t.store.state.projects.prj_003.access = { hidden: true, viewerIds: [] };
    const hint = async (who: string) => (await answer<{ previewUsers: { id: string; hint: string }[] }>(t, who, 'session.get')).previewUsers.find((u) => u.id === CHOSEN)?.hint;
    expect(await hint(OUTSIDER)).toBe('member');
    expect(await hint(ADMIN)).toBe('leader');
    expect(await hint(CHOSEN)).toBe('leader');
  });
});

describe('the Inbox', () => {
  it('lists no task thread, no unread count and no waiting row of a hidden project for an outsider, and keeps them for the team', async () => {
    const t = world();
    // Faisal asked Sara a question on the hidden to-do. Omar once commented there (he lost the view since, or was an old team member).
    t.store.state.comments.cmt_002 = {
      id: 'cmt_002', targetType: 'task', targetId: 'tsk_002', authorId: OUTSIDER, body: 'Old words', reactions: { '👍': [], '✅': [], '👀': [] },
      fileIds: [], createdAt: '2026-09-29T11:00:00.000+03:00', editedAt: null,
    } as never;
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      for (const name of ['chats.list', 'chats.waiting', 'chats.unreadCount']) expectNone(await text(t, who, name), who, name);
    }
    for (const who of [TEAM, LEADER]) {
      const rows = await answer<{ id: string }[]>(t, who, 'chats.list');
      expect(rows.map((row) => row.id), who).toEqual(expect.arrayContaining(['tsk_002']));
    }
    const rows = await answer<{ kind: string; id: string }[]>(t, OUTSIDER, 'chats.list');
    expect(rows.filter((row) => row.kind === 'task' || row.id.startsWith('cnv_'))).toEqual([]);
  });

  it('lists no thread, no unread count and no waiting row for the lead of a to-do of a hidden project who lost the view, and keeps the thread for the team', async () => {
    const t = world();
    // Omar led tsk_003 before the project was hidden. Sara wrote the last comment on it.
    t.store.state.tasks.tsk_003.ownerId = OUTSIDER;
    t.store.state.comments.cmt_003 = {
      id: 'cmt_003', targetType: 'task', targetId: 'tsk_003', authorId: TEAM, body: 'Please answer', reactions: { '👍': [], '✅': [], '👀': [] },
      fileIds: [], createdAt: '2026-09-30T12:00:00.000+03:00', editedAt: null,
    } as never;
    for (const who of [OUTSIDER, OUTSIDER_AGENT]) {
      expect(JSON.stringify(await answer(t, who, 'chats.list')), who).not.toContain('tsk_003');
      expect(JSON.stringify(await answer(t, who, 'chats.waiting')), who).not.toContain('tsk_003');
      expect(await answer(t, who, 'chats.unreadCount'), who).toMatchObject({ unread: 0 });
    }
    const team = await answer<{ id: string; unread: number }[]>(t, TEAM, 'chats.list');
    expect(team.map((row) => row.id)).toContain('tsk_003');
    expect((await answer<{ unread: number }>(t, TEAM, 'chats.unreadCount')).unread).toBeGreaterThan(0);
  });

  it('does not list the project chat of a hidden project for a person who holds "Choose all project chats" but does not see the project', async () => {
    const t = world();
    t.store.state.settings.roles = { rights: { management: ['chat.project.all'] } };
    const rows = await answer<{ kind: string; project: { id: string } | null }[]>(t, MANAGEMENT, 'chats.list');
    expect(rows.some((row) => row.project?.id === HIDDEN)).toBe(false);
    expect((await answer<{ kind: string; project: { id: string } | null }[]>(t, ADMIN, 'chats.list')).some((row) => row.project?.id === HIDDEN)).toBe(true);
  });
});

describe('events.list', () => {
  function history(t: World) {
    const base = {
      verb: 'task.updated', targetType: 'task', targetId: 'tsk_002', before: null, after: null, actorId: TEAM, actorKind: 'human', actingForId: TEAM, correlationId: 'cor_9',
      createdAt: '2026-09-30T08:00:00.000+03:00', undoneBy: null,
    };
    t.store.state.events.evt_100 = { ...base, id: 'evt_100', seq: 100, projectId: HIDDEN } as never;
    t.store.state.events.evt_101 = { ...base, id: 'evt_101', seq: 101, projectId: 'prj_001', targetId: 'tsk_001' } as never;
  }

  it('gives an outsider no event of a hidden project', async () => {
    const t = world();
    history(t);
    for (const who of [OUTSIDER, OUTSIDER_AGENT, MANAGEMENT]) {
      for (const input of [{}, { projectId: HIDDEN }, { targetId: 'tsk_002' }, { limit: 1 }]) expectNone(await text(t, who, 'events.list', input), who, `events.list ${JSON.stringify(input)}`);
      const rows = await answer<{ event: { id: string } }[]>(t, who, 'events.list', { limit: 1 });
      expect(rows.map((row) => row.event.id), who).toEqual(['evt_101']);
    }
  });

  it('gives the team and the Admin the event of the hidden project', async () => {
    const t = world();
    history(t);
    for (const who of [TEAM, LEADER, CHOSEN, ADMIN]) {
      const rows = await answer<{ event: { id: string } }[]>(t, who, 'events.list', { limit: 5 });
      expect(rows.map((row) => row.event.id), who).toContain('evt_100');
    }
  });

  it('shows the events of a deleted project that was hidden only to a holder of "See hidden projects"', async () => {
    const t = world();
    history(t);
    t.store.state.events.evt_102 = {
      id: 'evt_102', seq: 102, projectId: 'prj_099', targetType: 'task', targetId: 'tsk_099', verb: 'task.updated', before: null, after: null, actorId: TEAM, actorKind: 'human', actingForId: TEAM,
      correlationId: 'cor_10', createdAt: '2026-09-30T08:05:00.000+03:00', undoneBy: null,
    } as never;
    t.store.state.events.evt_103 = {
      id: 'evt_103', seq: 103, projectId: 'prj_099', targetType: 'project', targetId: 'prj_099', verb: 'project.deleted', actorId: ADMIN, actorKind: 'human', actingForId: ADMIN, correlationId: 'cor_11',
      before: makeProject({ id: 'prj_099', code: 'KH-26-099', name: 'Gone Secret', access: { hidden: true, viewerIds: [] } }), after: null,
      createdAt: '2026-09-30T08:06:00.000+03:00', undoneBy: null,
    } as never;
    t.store.state.events.evt_104 = { ...t.store.state.events.evt_102, id: 'evt_104', seq: 104, projectId: 'prj_098', targetId: 'tsk_098' };
    t.store.state.events.evt_105 = {
      ...t.store.state.events.evt_103, id: 'evt_105', seq: 105, projectId: 'prj_098', targetId: 'prj_098', before: makeProject({ id: 'prj_098', code: 'KH-26-098', name: 'Gone Open' }),
    };
    const ids = async (who: string) => (await answer<{ event: { id: string } }[]>(t, who, 'events.list', { limit: 50 })).map((row) => row.event.id);
    const outsider = await ids(OUTSIDER);
    expect(outsider).not.toContain('evt_102');
    expect(outsider).not.toContain('evt_103');
    expect(outsider).toEqual(expect.arrayContaining(['evt_104', 'evt_105']));
    expect(await ids(MANAGEMENT)).not.toContain('evt_103');
    expect(await ids(ADMIN)).toEqual(expect.arrayContaining(['evt_102', 'evt_103', 'evt_104', 'evt_105']));
  });
});
