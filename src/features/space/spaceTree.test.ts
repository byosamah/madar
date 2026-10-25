import { describe, expect, it } from 'vitest';
import type { Project, Stage, Task } from '../../api/contract/entities';
import type { DeadlineRow, ProjectSummary, TaskRow, UserCard } from '../../api/contract/views';
import { makeProject, makeStage, makeTask, STAMP } from '../../test/factories';
import {
  buildSpaceTree, CARD_HEIGHT, CHECK_CAP, checkNodeId, focusPlan, levelsFor, moreNodeId, NO_SUB_ID, openedForLevel, peopleWithOpenTasks, ROW_AIR,
  type SpaceNode,
} from './spaceTree';

const person = (id: string): UserCard => ({ id, name: id, avatarUrl: null, kind: 'human', discipline: 'Architect' });

function summary(project: Project, stages: Stage[]): ProjectSummary {
  const current = stages.find((stage) => stage.id === project.currentStageId) ?? stages[0]!;
  return {
    project, client: null, health: null, healthSetBy: null, pausedBy: null, staleDays: null, coverLetter: null, stages,
    currentStage: current, latest: [], nextDeadline: null, stageEnd: null, leader: null, team: [], openTasks: 0,
    lastActivityAt: STAMP, viewerRole: 'other', subCompanyId: null, geo: null, templateId: null,
    viewerCan: {
      edit: false, changeLeader: false, archive: false, delete: false, healthOverride: false, createTaskForAnyone: false,
      createTaskForSelf: false, post: false, review: false, payments: false,
    },
  };
}

function row(task: Task, owner: UserCard | null = null, helpers: UserCard[] = []): TaskRow {
  return {
    task, owner, helpers, project: null, stage: null, commentCount: 0, fileCount: 0, overdue: false, canMove: false,
    waitingFor: { tasks: [], stages: [] },
  };
}

// Alpha is active, with a Design stage that starts after its Concept stage. Beta is paused. Gamma is completed.
const alphaStages = [
  makeStage({ id: 'stg_a1', projectId: 'prj_a', name: 'Design', order: 0, startDate: '2026-10-10' }),
  makeStage({ id: 'stg_a2', projectId: 'prj_a', name: 'Concept', order: 1, startDate: '2026-09-01' }),
];
const projects = [
  summary(makeProject({ id: 'prj_a', code: 'KH-26-001', name: 'Alpha', currentStageId: 'stg_a1' }), alphaStages),
  summary(makeProject({ id: 'prj_b', code: 'KH-26-002', name: 'Beta', status: 'on_hold', currentStageId: 'stg_b1' }), [
    makeStage({ id: 'stg_b1', projectId: 'prj_b', name: 'Concept', order: 0 }),
  ]),
  summary(makeProject({ id: 'prj_c', code: 'KH-26-003', name: 'Gamma', status: 'completed', currentStageId: 'stg_c1' }), [
    makeStage({ id: 'stg_c1', projectId: 'prj_c', name: 'Done', order: 0 }),
  ]),
];
const tasks = [
  row(makeTask({ id: 'tsk_a1', projectId: 'prj_a', stageId: 'stg_a1', title: 'Plan', ownerId: 'usr_1', dueDate: '2026-10-20' }), person('usr_1')),
  row(makeTask({ id: 'tsk_a2', projectId: 'prj_a', stageId: 'stg_a1', title: 'Old plan', status: 'done', ownerId: 'usr_1' }), person('usr_1')),
  row(makeTask({ id: 'tsk_a3', projectId: 'prj_a', stageId: 'stg_a2', title: 'Survey', status: 'in_progress', ownerId: 'usr_2' }), person('usr_2'), [person('usr_3')]),
  row(makeTask({ id: 'tsk_b1', projectId: 'prj_b', stageId: 'stg_b1', title: 'Hold task', ownerId: 'usr_9' }), person('usr_9')),
  row(makeTask({ id: 'tsk_c1', projectId: 'prj_c', stageId: 'stg_c1', title: 'Finished work', ownerId: 'usr_1' }), person('usr_1')),
  row(makeTask({ id: 'tsk_office', projectId: null, stageId: null, title: 'Office errand', ownerId: 'usr_1' }), person('usr_1')),
];

const build = (opened: string[], focusPersonId: string | null = null, dir: 'ltr' | 'rtl' = 'ltr') =>
  buildSpaceTree({ projects, tasks, opened: new Set(opened), focusPersonId, dir });

const idsOf = (nodes: SpaceNode[], kind: SpaceNode['kind']) => nodes.filter((node) => node.kind === kind).map((node) => node.id);
const node = (nodes: SpaceNode[], id: string) => nodes.find((item) => item.id === id);

describe('buildSpaceTree', () => {
  it('shows the office and one node for each open project when nothing is opened', () => {
    const { nodes } = build([]);
    expect(nodes.find((item) => item.kind === 'office')?.id).toBe('office');
    expect(node(nodes, 'office')?.open).toBe(true);
    expect(idsOf(nodes, 'project')).toEqual(['prj_a', 'prj_b']);
    expect(idsOf(nodes, 'stage')).toEqual([]);
    expect(idsOf(nodes, 'task')).toEqual([]);
    expect(nodes.every((item) => item.depth <= 1)).toBe(true);
  });

  it('adds the stages of an opened project in time order, the earliest start first', () => {
    const { nodes } = build(['prj_a']);
    const stages = idsOf(nodes, 'stage').map((id) => node(nodes, id)!);
    expect(stages.map((item) => item.id)).toEqual(['stg_a2', 'stg_a1']);
    expect(stages.map((item) => item.y)).toEqual([...stages.map((item) => item.y)].sort((a, b) => a - b));
    expect(stages.every((item) => item.depth === 2 && item.open === false)).toBe(true);
    expect(node(nodes, 'prj_a')?.open).toBe(true);
  });

  it('adds the open tasks of an opened stage, and a done task never shows', () => {
    const closed = build(['prj_a']).nodes;
    expect(idsOf(closed, 'task')).toEqual([]);
    const { nodes } = build(['prj_a', 'stg_a1', 'stg_a2']);
    expect(idsOf(nodes, 'task').sort()).toEqual(['tsk_a1', 'tsk_a3']);
    expect(node(nodes, 'tsk_a2')).toBeUndefined();
    expect(node(nodes, 'tsk_office')).toBeUndefined();
    expect(node(nodes, 'tsk_c1')).toBeUndefined();
  });

  it('never shows a project that is completed, or an office task', () => {
    const { nodes } = build(['prj_a', 'prj_c', 'stg_c1']);
    expect(node(nodes, 'prj_c')).toBeUndefined();
    expect(node(nodes, 'stg_c1')).toBeUndefined();
  });

  it('fades the tasks that the focused person neither leads nor helps', () => {
    const opened = ['prj_a', 'stg_a1', 'stg_a2'];
    const focusHelper = build(opened, 'usr_3').nodes;
    expect(node(focusHelper, 'tsk_a3')?.faded).toBe(false);
    expect(node(focusHelper, 'tsk_a1')?.faded).toBe(true);
    const focusLead = build(opened, 'usr_2').nodes;
    expect(node(focusLead, 'tsk_a3')?.faded).toBe(false);
    expect(node(focusLead, 'tsk_a1')?.faded).toBe(true);
    const none = build(opened).nodes;
    expect(idsOf(none, 'task').every((id) => node(none, id)?.faded === false)).toBe(true);
  });

  it('puts the office node at the largest x in a right to left layout, and at the smallest in a left to right one', () => {
    const ltr = build(['prj_a', 'stg_a1']).nodes;
    const rtl = build(['prj_a', 'stg_a1'], null, 'rtl').nodes;
    const xs = (nodes: SpaceNode[]) => nodes.map((item) => item.x);
    expect(node(ltr, 'office')?.x).toBe(Math.min(...xs(ltr)));
    expect(node(rtl, 'office')?.x).toBe(Math.max(...xs(rtl)));
    expect(node(rtl, 'prj_a')!.x).toBeLessThan(node(rtl, 'office')!.x);
    expect(node(rtl, 'stg_a1')!.x).toBeLessThan(node(rtl, 'prj_a')!.x);
  });

  it('keeps every shown card where it is when a level opens or closes, in both layouts', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const closed = build([], null, dir).nodes;
      const open = build(['prj_a', 'stg_a1'], null, dir).nodes;
      expect(node(open, 'office')!.x).toBe(node(closed, 'office')!.x);
      expect(node(open, 'prj_a')!.x).toBe(node(closed, 'prj_a')!.x);
    }
  });

  it('joins each shown node to its parent with one edge', () => {
    const { edges } = build(['prj_a', 'stg_a1']);
    expect(edges).toEqual(expect.arrayContaining([
      { from: 'office', to: 'prj_a' },
      { from: 'office', to: 'prj_b' },
      { from: 'prj_a', to: 'stg_a1' },
      { from: 'prj_a', to: 'stg_a2' },
      { from: 'stg_a1', to: 'tsk_a1' },
    ]));
    expect(edges.some((edge) => edge.to === 'tsk_a3')).toBe(false);
  });
});

// PRJ-06 (2026-10-19): the focus on a person acts on projects and stages too, so the closed first view already shows where the person works.
describe('the focus on a person', () => {
  it('fades a project and a stage that the person has no open task in', () => {
    const { nodes } = build(['prj_a', 'stg_a1', 'stg_a2'], 'usr_3');
    expect(node(nodes, 'prj_a')?.faded).toBe(false);
    expect(node(nodes, 'stg_a2')?.faded).toBe(false);
    expect(node(nodes, 'stg_a1')?.faded).toBe(true);
    expect(node(nodes, 'prj_b')?.faded).toBe(true);
  });

  it('fades nothing without a focus', () => {
    expect(build(['prj_a', 'stg_a1']).nodes.every((item) => !item.faded)).toBe(true);
  });

  it('opens the projects and the stages where the person leads or helps an open task, and counts them', () => {
    const lead = focusPlan({ projects, tasks, personId: 'usr_1' });
    // Faisal leads Plan (Alpha, Design). Old plan is done, Finished work sits in a completed project, and the errand is an office task.
    expect([...lead.opened].sort()).toEqual(['prj_a', 'stg_a1']);
    expect(lead).toMatchObject({ tasks: 1, projects: 1 });
    expect(lead.bright).toEqual(['prj_a', 'stg_a1', 'tsk_a1']);
    const helper = focusPlan({ projects, tasks, personId: 'usr_3' });
    expect([...helper.opened].sort()).toEqual(['prj_a', 'stg_a2']);
    const paused = focusPlan({ projects, tasks, personId: 'usr_9' });
    expect([...paused.opened].sort()).toEqual(['prj_b', 'stg_b1']);
  });

  it('plans nothing for a person with no open task', () => {
    expect(focusPlan({ projects, tasks, personId: 'usr_404' })).toEqual({ opened: new Set(), tasks: 0, projects: 0, bright: [] });
  });

  it('lists the people who lead or help an open task of an open project', () => {
    expect([...peopleWithOpenTasks(projects, tasks)].sort()).toEqual(['usr_1', 'usr_2', 'usr_3', 'usr_9']);
  });
});

// PRJ-07: a card never covers the next one. Each row is as tall as its card, with air between.
describe('the rows of the map', () => {
  it('keeps the tops of two project cards one card height plus air apart', () => {
    const tops = build([]).nodes.filter((item) => item.kind === 'project').map((item) => item.y).sort((a, b) => a - b);
    expect(tops.length).toBeGreaterThan(1);
    expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(CARD_HEIGHT.project + ROW_AIR);
  });

  it('keeps the tops of two stage cards, and of two task cards, one card height plus air apart', () => {
    const open = build(['prj_a', 'stg_a1', 'stg_a2']).nodes;
    const stages = open.filter((item) => item.kind === 'stage').map((item) => item.y).sort((a, b) => a - b);
    expect(stages[1]! - stages[0]!).toBeGreaterThanOrEqual(CARD_HEIGHT.stage + ROW_AIR);
    const tasksOfBoth = open.filter((item) => item.kind === 'task').map((item) => item.y).sort((a, b) => a - b);
    expect(tasksOfBoth[1]! - tasksOfBoth[0]!).toBeGreaterThanOrEqual(CARD_HEIGHT.task + ROW_AIR);
  });

  it('puts the middle of a parent card level with the middle of its children, whatever the card heights', () => {
    const open = build(['prj_a', 'stg_a1', 'stg_a2']).nodes;
    const middle = (item: SpaceNode) => item.y + CARD_HEIGHT[item.kind] / 2;
    const stages = open.filter((item) => item.kind === 'stage').map(middle);
    expect(middle(node(open, 'prj_a')!)).toBeCloseTo((Math.min(...stages) + Math.max(...stages)) / 2, 5);
  });

  it('puts the office level with the first project, so the first view shows both', () => {
    const { nodes } = build(['prj_a', 'stg_a1', 'stg_a2']);
    const middle = (item: SpaceNode) => item.y + CARD_HEIGHT[item.kind] / 2;
    const first = nodes.filter((item) => item.kind === 'project').sort((a, b) => a.y - b.y)[0]!;
    expect(middle(node(nodes, 'office')!)).toBeCloseTo(middle(first), 5);
  });
});

// fbk_055 (2026-10-25): the levels of the map. A sub-company column, deadline cards and checklist cards.
const deadlineRow = (id: string, projectId: string, stageId: string | null, name: string, date: string): DeadlineRow => ({
  deadline: { id, projectId, stageId, name, date },
  project: { id: projectId, code: projectId, name: projectId, mark: null } as unknown as DeadlineRow['project'],
  daysLeft: 0,
});

describe('the sub-company column', () => {
  const delta = summary(makeProject({ id: 'prj_d', code: 'KH-26-004', name: 'Delta', currentStageId: 'stg_d1' }), [
    makeStage({ id: 'stg_d1', projectId: 'prj_d', name: 'Concept', order: 0 }),
  ]);
  const grouped = [{ ...projects[0]!, subCompanyId: 'sub_1' }, { ...projects[1]!, subCompanyId: 'sub_2' }, delta, projects[2]!];
  const subs = [{ id: 'sub_1', name: 'Vado' }, { id: 'sub_2', name: 'Alfa' }, { id: 'sub_3', name: 'Empty Co' }];
  const withColumn = (opened: string[], dir: 'ltr' | 'rtl' = 'ltr') =>
    buildSpaceTree({ projects: grouped, tasks, opened: new Set(opened), focusPersonId: null, dir, subCompanies: subs });

  it('puts one card for each sub-company with an open project between the office and the projects, and "No sub-company" last', () => {
    const { nodes, edges } = withColumn(['sub_1', 'sub_2', NO_SUB_ID]);
    expect(idsOf(nodes, 'subcompany')).toEqual(['sub_2', 'sub_1', NO_SUB_ID]);
    expect(node(nodes, 'sub_3')).toBeUndefined();
    expect(nodes.filter((item) => item.kind === 'subcompany').every((item) => item.depth === 1)).toBe(true);
    expect(nodes.filter((item) => item.kind === 'project').every((item) => item.depth === 2)).toBe(true);
    expect(edges).toEqual(expect.arrayContaining([{ from: 'office', to: 'sub_1' }, { from: 'sub_1', to: 'prj_a' }, { from: NO_SUB_ID, to: 'prj_d' }]));
    expect(idsOf(nodes, 'project')).toEqual(['prj_b', 'prj_a', 'prj_d']);
  });

  it('shows the projects of a sub-company only when its card is open', () => {
    const closed = withColumn([]).nodes;
    expect(idsOf(closed, 'subcompany')).toHaveLength(3);
    expect(idsOf(closed, 'project')).toEqual([]);
    expect(node(closed, 'sub_1')?.open).toBe(false);
    const one = withColumn(['sub_1']).nodes;
    expect(idsOf(one, 'project')).toEqual(['prj_a']);
    expect(node(one, 'sub_1')?.open).toBe(true);
  });

  it('adds no column when the office has no sub-company, and none for an empty list', () => {
    expect(idsOf(build([]).nodes, 'subcompany')).toEqual([]);
    const empty = buildSpaceTree({ projects: grouped, tasks, opened: new Set(), focusPersonId: null, dir: 'ltr', subCompanies: [] });
    expect(idsOf(empty.nodes, 'subcompany')).toEqual([]);
    expect(idsOf(empty.nodes, 'project')).toHaveLength(3);
  });

  it('gives each kind of card its own column, mirrored in a right to left layout, and moves no card when a level opens', () => {
    const open = ['sub_1', 'sub_2', NO_SUB_ID, 'prj_a', 'stg_a1'];
    for (const dir of ['ltr', 'rtl'] as const) {
      const sign = dir === 'rtl' ? -1 : 1;
      const { nodes } = withColumn(open, dir);
      expect(node(nodes, 'office')!.x + 0).toBe(0);
      expect(node(nodes, 'sub_1')!.x).toBe(sign * 340);
      expect(node(nodes, 'prj_a')!.x).toBe(sign * 680);
      expect(node(nodes, 'stg_a1')!.x).toBe(sign * 1020);
      expect(node(nodes, 'tsk_a1')?.x).toBe(sign * 1360);
      const closed = withColumn(['sub_1'], dir).nodes;
      for (const id of ['office', 'sub_1', 'prj_a']) expect(node(nodes, id)!.x).toBe(node(closed, id)!.x);
    }
  });

  it('keeps the office level with the first card of the next column, so the first view shows both', () => {
    const { nodes } = withColumn(['sub_1', 'sub_2', NO_SUB_ID]);
    const middle = (item: SpaceNode) => item.y + CARD_HEIGHT[item.kind] / 2;
    const first = nodes.filter((item) => item.kind === 'subcompany').sort((a, b) => a.y - b.y)[0]!;
    expect(middle(node(nodes, 'office')!)).toBeCloseTo(middle(first), 5);
  });

  it('fades a sub-company card when the focused person has no open task in its projects', () => {
    const { nodes } = buildSpaceTree({ projects: grouped, tasks, opened: new Set(['sub_1', 'sub_2']), focusPersonId: 'usr_3', dir: 'ltr', subCompanies: subs });
    expect(node(nodes, 'sub_1')?.faded).toBe(false);
    expect(node(nodes, 'sub_2')?.faded).toBe(true);
  });

  it('puts a project of an unknown sub-company under "No sub-company"', () => {
    const odd = [{ ...projects[0]!, subCompanyId: 'sub_gone' }];
    const { nodes, edges } = buildSpaceTree({ projects: odd, tasks, opened: new Set([NO_SUB_ID]), focusPersonId: null, dir: 'ltr', subCompanies: subs });
    expect(idsOf(nodes, 'subcompany')).toEqual([NO_SUB_ID]);
    expect(edges).toContainEqual({ from: NO_SUB_ID, to: 'prj_a' });
  });
});

describe('the deadline cards', () => {
  const deadlines = [
    deadlineRow('ddl_1', 'prj_a', 'stg_a1', 'Client review', '2026-10-15'),
    deadlineRow('ddl_2', 'prj_a', null, 'Balady submission', '2026-11-01'),
    deadlineRow('ddl_3', 'prj_a', 'stg_gone', 'Stage was removed', '2026-11-05'),
    deadlineRow('ddl_4', 'prj_c', null, 'Completed project', '2026-11-02'),
    deadlineRow('ddl_5', 'prj_hidden', null, 'Secret handover', '2026-11-03'),
    deadlineRow('ddl_6', 'prj_b', 'stg_b1', 'Paused stage', '2026-11-04'),
  ];
  const withDeadlines = (opened: string[], dir: 'ltr' | 'rtl' = 'ltr', focusPersonId: string | null = null) =>
    buildSpaceTree({ projects, tasks, opened: new Set(opened), focusPersonId, dir, deadlines });

  it('shows a deadline beside the to-dos of its stage, in date order with them', () => {
    const { nodes, edges } = withDeadlines(['prj_a', 'stg_a1']);
    expect(edges).toContainEqual({ from: 'stg_a1', to: 'ddl_1' });
    const column = nodes.filter((item) => item.depth === 3).sort((a, b) => a.y - b.y).map((item) => item.id);
    expect(column).toEqual(['ddl_1', 'tsk_a1']);
    expect(node(nodes, 'ddl_1')).toMatchObject({ kind: 'deadline', depth: 3, x: 1020, open: false });
    expect(node(nodes, 'ddl_1')!.x).toBe(node(nodes, 'tsk_a1')!.x);
  });

  it('shows a deadline of a project with no stage under the project, after its stages', () => {
    const { nodes, edges } = withDeadlines(['prj_a']);
    expect(edges).toEqual(expect.arrayContaining([{ from: 'prj_a', to: 'ddl_2' }, { from: 'prj_a', to: 'ddl_3' }]));
    const column = nodes.filter((item) => item.depth === 2).sort((a, b) => a.y - b.y).map((item) => item.id);
    expect(column).toEqual(['stg_a2', 'stg_a1', 'ddl_2', 'ddl_3']);
    expect(node(nodes, 'ddl_1')).toBeUndefined();
  });

  it('shows nothing before its parent opens', () => {
    expect(idsOf(withDeadlines([]).nodes, 'deadline')).toEqual([]);
    expect(idsOf(withDeadlines(['prj_a']).nodes, 'deadline').sort()).toEqual(['ddl_2', 'ddl_3']);
  });

  it('never shows the deadline of a project that is not on the map (a hidden or a completed project)', () => {
    const all = withDeadlines(['prj_a', 'prj_b', 'prj_c', 'prj_hidden', 'stg_a1', 'stg_b1']).nodes;
    const ids = idsOf(all, 'deadline');
    expect(ids).not.toContain('ddl_4');
    expect(ids).not.toContain('ddl_5');
    expect(JSON.stringify(all)).not.toContain('Secret');
  });

  it('fades a deadline while a person is in focus, and mirrors its column in a right to left layout', () => {
    expect(node(withDeadlines(['prj_a', 'stg_a1'], 'ltr', 'usr_1').nodes, 'ddl_1')?.faded).toBe(true);
    expect(node(withDeadlines(['prj_a', 'stg_a1']).nodes, 'ddl_1')?.faded).toBe(false);
    expect(node(withDeadlines(['prj_a', 'stg_a1'], 'rtl').nodes, 'ddl_1')?.x).toBe(-1020);
  });

  it('keeps the rows of the deadline cards clear of each other', () => {
    const column = withDeadlines(['prj_a', 'stg_a1']).nodes.filter((item) => item.depth === 3).sort((a, b) => a.y - b.y);
    expect(column[1]!.y - column[0]!.y).toBeGreaterThanOrEqual(CARD_HEIGHT.deadline + ROW_AIR);
  });
});

describe('the checklist cards', () => {
  const items = (count: number, doneFrom = count) => Array.from({ length: count }, (_, index) => ({ id: `ci_${index + 1}`, text: `Item ${index + 1}`, done: index >= doneFrom }));
  const listed = [
    row(makeTask({ id: 'tsk_a1', projectId: 'prj_a', stageId: 'stg_a1', title: 'Plan', ownerId: 'usr_1', checklist: items(3, 2) }), person('usr_1')),
    row(makeTask({ id: 'tsk_a2', projectId: 'prj_a', stageId: 'stg_a1', title: 'Old plan', status: 'done', checklist: items(2) }), person('usr_1')),
    row(makeTask({ id: 'tsk_a3', projectId: 'prj_a', stageId: 'stg_a2', title: 'Survey', ownerId: 'usr_2', checklist: items(CHECK_CAP + 1) }), person('usr_2')),
    row(makeTask({ id: 'tsk_a4', projectId: 'prj_a', stageId: 'stg_a2', title: 'Exact', ownerId: 'usr_2', checklist: items(CHECK_CAP) }), person('usr_2')),
    row(makeTask({ id: 'tsk_a5', projectId: 'prj_a', stageId: 'stg_a2', title: 'Bare', ownerId: 'usr_2', checklist: [] }), person('usr_2')),
  ];
  const withChecks = (opened: string[], dir: 'ltr' | 'rtl' = 'ltr') =>
    buildSpaceTree({ projects, tasks: listed, opened: new Set(opened), focusPersonId: null, dir });
  const everything = ['prj_a', 'stg_a1', 'stg_a2', 'tsk_a1', 'tsk_a2', 'tsk_a3', 'tsk_a4', 'tsk_a5'];

  it('shows the items of an open to-do only when that to-do is open, and never the items of a done to-do', () => {
    expect(idsOf(withChecks(['prj_a', 'stg_a1']).nodes, 'check')).toEqual([]);
    const { nodes, edges } = withChecks(everything);
    expect(idsOf(nodes, 'check').filter((id) => id.startsWith('tsk_a1#'))).toEqual([checkNodeId('tsk_a1', 'ci_1'), checkNodeId('tsk_a1', 'ci_2'), checkNodeId('tsk_a1', 'ci_3')]);
    expect(idsOf(nodes, 'check').some((id) => id.startsWith('tsk_a2#'))).toBe(false);
    expect(edges).toContainEqual({ from: 'tsk_a1', to: checkNodeId('tsk_a1', 'ci_2') });
    expect(node(nodes, 'tsk_a1')?.open).toBe(true);
  });

  it('shows at most 12 items of one to-do, then one "more" card for the rest', () => {
    const { nodes } = withChecks(everything);
    const of = (taskId: string) => nodes.filter((item) => item.id.startsWith(`${taskId}#`));
    expect(of('tsk_a3').filter((item) => item.kind === 'check')).toHaveLength(CHECK_CAP);
    expect(of('tsk_a3').filter((item) => item.kind === 'more').map((item) => item.id)).toEqual([moreNodeId('tsk_a3')]);
    expect(of('tsk_a4').filter((item) => item.kind === 'check')).toHaveLength(CHECK_CAP);
    expect(of('tsk_a4').some((item) => item.kind === 'more')).toBe(false);
    expect(of('tsk_a5')).toEqual([]);
  });

  it('puts the checklist column after the to-do column, in both layouts, with no overlap in a row', () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const sign = dir === 'rtl' ? -1 : 1;
      const { nodes } = withChecks(everything, dir);
      expect(node(nodes, 'tsk_a1')!.x).toBe(sign * 3 * 340);
      expect(node(nodes, checkNodeId('tsk_a1', 'ci_1'))!.x).toBe(sign * 4 * 340);
      expect(node(nodes, moreNodeId('tsk_a3'))!.x).toBe(sign * 4 * 340);
    }
    const column = withChecks(everything).nodes.filter((item) => item.depth === 4).sort((a, b) => a.y - b.y);
    for (let index = 1; index < column.length; index += 1) {
      expect(column[index]!.y - column[index - 1]!.y).toBeGreaterThanOrEqual(CARD_HEIGHT.check + ROW_AIR - 1e-6);
    }
  });

  it('fades the items of a to-do that the focused person has no part in', () => {
    const faded = buildSpaceTree({ projects, tasks: listed, opened: new Set(everything), focusPersonId: 'usr_2', dir: 'ltr' }).nodes;
    expect(node(faded, checkNodeId('tsk_a1', 'ci_1'))?.faded).toBe(true);
    expect(node(faded, checkNodeId('tsk_a3', 'ci_1'))?.faded).toBe(false);
  });
});

describe('the steps of the Detail control', () => {
  const grouped = [{ ...projects[0]!, subCompanyId: 'sub_1' }, projects[1]!, projects[2]!];
  const listed = [
    ...tasks,
    row(makeTask({ id: 'tsk_a9', projectId: 'prj_a', stageId: 'stg_a1', title: 'With list', ownerId: 'usr_1', checklist: [{ id: 'ci_1', text: 'One', done: false }] }), person('usr_1')),
  ];
  const input = { projects: grouped, tasks: listed, subCompanies: [{ id: 'sub_1', name: 'Vado' }] };
  const at = (level: Parameters<typeof openedForLevel>[0], more: Partial<Parameters<typeof openedForLevel>[1]> = {}) => [...openedForLevel(level, { ...input, ...more })].sort();
  const sorted = (ids: string[]) => [...ids].sort();

  it('lists five steps with a sub-company column, and four without it', () => {
    expect(levelsFor(true)).toEqual(['subcompanies', 'projects', 'stages', 'todos', 'checklists']);
    expect(levelsFor(false)).toEqual(['projects', 'stages', 'todos', 'checklists']);
  });

  it('opens nothing at the Sub-companies step and the Projects step of an office with no sub-company', () => {
    expect(at('subcompanies')).toEqual([]);
    expect(at('projects', { subCompanies: [] })).toEqual([]);
  });

  it('opens each sub-company card, and "No sub-company" for a project with none, at the Projects step', () => {
    expect(at('projects')).toEqual(sorted([NO_SUB_ID, 'sub_1']));
  });

  it('opens every project of the map at the Stages step, and never a completed project', () => {
    expect(at('stages')).toEqual(sorted([NO_SUB_ID, 'prj_a', 'prj_b', 'sub_1']));
    expect(at('stages', { subCompanies: [] })).toEqual(['prj_a', 'prj_b']);
  });

  it('opens every stage at the To-dos step, and every to-do that has a list at the Checklists step', () => {
    expect(at('todos', { subCompanies: [] })).toEqual(['prj_a', 'prj_b', 'stg_a1', 'stg_a2', 'stg_b1']);
    expect(at('checklists', { subCompanies: [] })).toEqual(['prj_a', 'prj_b', 'stg_a1', 'stg_a2', 'stg_b1', 'tsk_a9']);
  });

  it('adds what the focus on a person opens, whatever the step', () => {
    expect(at('projects', { subCompanies: [], focusPersonId: 'usr_3' })).toEqual(['prj_a', 'stg_a2']);
    expect(at('stages', { subCompanies: [], focusPersonId: 'usr_3' })).toEqual(['prj_a', 'prj_b', 'stg_a2']);
    expect(at('todos', { subCompanies: [], focusPersonId: 'usr_3' })).toEqual(at('todos', { subCompanies: [] }));
  });
});
