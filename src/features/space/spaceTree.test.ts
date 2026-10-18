import { describe, expect, it } from 'vitest';
import type { Project, Stage, Task } from '../../api/contract/entities';
import type { ProjectSummary, TaskRow, UserCard } from '../../api/contract/views';
import { makeProject, makeStage, makeTask, STAMP } from '../../test/factories';
import { buildSpaceTree, type SpaceNode } from './spaceTree';

const person = (id: string): UserCard => ({ id, name: id, avatarUrl: null, kind: 'human', discipline: 'Architect' });

function summary(project: Project, stages: Stage[]): ProjectSummary {
  const current = stages.find((stage) => stage.id === project.currentStageId) ?? stages[0]!;
  return {
    project, client: null, health: null, healthSetBy: null, pausedBy: null, staleDays: null, coverLetter: null, stages,
    currentStage: current, latest: [], nextDeadline: null, stageEnd: null, leader: null, team: [], openTasks: 0,
    lastActivityAt: STAMP, viewerRole: 'other',
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
