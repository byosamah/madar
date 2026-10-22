import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { SUMMARY_COUNTS_SQL, SUMMARY_TASKS_SQL, buildMorning, viewSql } from './summary';

/**
 * The morning summary and a hidden project (hidden projects, owner 2026-10-22, wave D3). A line of the summary never names a to-do of a
 * project that the person does not view, and the count of the tasks due today leaves it out. The SQLite form runs here; the Postgres
 * form is checked as text, and server/it runs it on the database. prj_001 (leader usr_002, team usr_002, usr_005, usr_006, usr_008) is
 * hidden, with usr_007 chosen. usr_003 is an outsider who still leads one of its to-dos. The control task sits in an open project.
 */

const TODAY = '2026-10-05';
const SECRET = 'Secret hidden title 5521';
const OPEN_TITLE = 'Open control task';

async function office(edit: (seed: State) => void = () => undefined) {
  const lite = await freshLite();
  const seed = await buildSeed('2026-10-04', async () => undefined);
  const hiddenTask = Object.values(seed.tasks).find((t) => t.projectId === 'prj_001' && t.status === 'todo')!;
  const openTask = Object.values(seed.tasks).find((t) => t.projectId === 'prj_002' && t.status === 'todo')!;
  for (const [task, title] of [[hiddenTask, SECRET], [openTask, OPEN_TITLE]] as const) {
    seed.tasks[task.id] = { ...task, title, ownerId: 'usr_003', helperIds: [], dueDate: TODAY, status: 'todo' };
  }
  seed.projects.prj_001 = { ...seed.projects.prj_001, access: { hidden: true, viewerIds: ['usr_007'] } };
  edit(seed);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const morning = (userId: string) => lite.db.tx('read', (q) => buildMorning(q, { id: userId }, TODAY));
  return { lite, seed, hiddenTask, openTask, morning };
}

const titlesOf = (morning: Awaited<ReturnType<Awaited<ReturnType<typeof office>>['morning']>>) =>
  morning ? [...morning.tasks.pastDue, ...morning.tasks.today, ...morning.tasks.week].map((line) => line.title) : [];

describe('the morning summary of a person who does not view a hidden project', () => {
  it('names no to-do of the project, though the person leads it, and counts it no more', async () => {
    const { morning } = await office();
    const mine = await morning('usr_003');
    expect(titlesOf(mine)).toEqual([OPEN_TITLE]);
    expect(JSON.stringify(mine)).not.toContain(SECRET);
    expect(JSON.stringify(mine)).not.toContain('KH-26-001');
  });

  it('leaves no line when the only to-do due is the hidden one', async () => {
    const { morning } = await office((seed) => {
      for (const task of Object.values(seed.tasks)) if (task.ownerId === 'usr_003' && task.projectId !== 'prj_001') seed.tasks[task.id] = { ...task, dueDate: '2026-12-01' };
    });
    expect(titlesOf(await morning('usr_003'))).toEqual([]);
  });
});

describe('the morning summary of the people who view the project', () => {
  it('keeps the to-do for the leader, a team member, a chosen person and the Admin', async () => {
    for (const person of ['usr_002', 'usr_005', 'usr_007', 'usr_001']) {
      const { morning, hiddenTask } = await office((seed) => {
        const task = Object.values(seed.tasks).find((t) => t.projectId === 'prj_001' && t.status === 'todo')!;
        seed.tasks[task.id] = { ...task, ownerId: person, helperIds: [], title: SECRET, dueDate: TODAY };
      });
      void hiddenTask;
      expect(titlesOf(await morning(person)), person).toContain(SECRET);
    }
  });
});

describe('a role without "See every project", on an open project', () => {
  it('leaves out the to-do of a project where the person does not work', async () => {
    const { morning } = await office((seed) => {
      seed.projects.prj_001 = { ...seed.projects.prj_001, access: undefined };
      seed.settings = { ...seed.settings, roles: { ...seed.settings.roles, off: { member: ['project.seeAll'] } } };
    });
    // usr_003 leads the open control project, and does not work on the hidden one.
    expect(titlesOf(await morning('usr_003'))).toEqual([OPEN_TITLE]);
  });
});

describe('with the default settings', () => {
  it('names both to-dos of an open project, as before', async () => {
    const { morning } = await office((seed) => {
      seed.projects.prj_001 = { ...seed.projects.prj_001, access: undefined };
    });
    expect(titlesOf(await morning('usr_003')).sort()).toEqual([OPEN_TITLE, SECRET].sort());
  });
});

describe('the Postgres statements', () => {
  it('read the view rule of a project in the count and in the lines', () => {
    for (const sql of [SUMMARY_COUNTS_SQL, SUMMARY_TASKS_SQL]) {
      expect(sql).toContain("p.doc->'access'->'viewerIds' ? $1");
      expect(sql).toContain('p.leader_id = $1');
      expect(sql).toContain('from members mb where mb.project_id = p.id and mb.user_id = $1');
    }
    expect(viewSql(4, 5)).toContain('$5::boolean');
  });
});
