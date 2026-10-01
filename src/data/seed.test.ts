import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import * as E from '../api/contract/entities';
import { TODAY } from '../test/factories';
import { healthCounts } from '../test/seed-helpers';

async function seed(today = TODAY) {
  const blobs = new Map<string, Blob>();
  const state = await buildSeed(today, async (key, blob) => {
    blobs.set(key, blob);
  });
  return { state, blobs };
}

describe('sample data', () => {
  it('has the sizes from the spec', async () => {
    const { state } = await seed();
    const users = Object.values(state.users);
    expect(Object.keys(state.projects)).toHaveLength(12);
    // Eight office people, then the Management and Accounting people of colleague comments 6 and 13.
    expect(users.filter((u) => u.kind === 'human')).toHaveLength(10);
    expect(users.filter((u) => u.kind === 'agent')).toHaveLength(1);
    expect(users.filter((u) => u.systemRole === 'admin').map((u) => u.name)).toEqual(['Hala Nasser']);
    expect(users.find((u) => u.kind === 'agent')?.ownerId).toBe('usr_001');
    expect(Object.values(state.members).some((m) => m.userId === 'usr_009')).toBe(false);
    expect(Object.keys(state.tasks)).toHaveLength(144);
    expect(Object.keys(state.files)).toHaveLength(60);
    expect(state.session.currentUserId).toBe('usr_001');
  });

  it('has the health mix from the spec', async () => {
    const { state } = await seed();
    expect(healthCounts(state, TODAY)).toEqual({ on_track: 5, at_risk: 3, late: 2 });
    const statuses = Object.values(state.projects).map((p) => p.status);
    expect(statuses.filter((s) => s === 'on_hold')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'completed')).toHaveLength(1);
  });

  it('keeps the same mix on another day', async () => {
    const other = '2027-03-14';
    expect(healthCounts((await seed(other)).state, other)).toEqual({ on_track: 5, at_risk: 3, late: 2 });
  });

  it('passes every entity schema', async () => {
    const { state } = await seed();
    const check = (schema: { parse: (value: unknown) => unknown }, items: Record<string, unknown>) => {
      for (const item of Object.values(items)) schema.parse(item);
    };
    check(E.User, state.users);
    check(E.Client, state.clients);
    check(E.Project, state.projects);
    check(E.ProjectMember, state.members);
    check(E.Stage, state.stages);
    check(E.Deadline, state.deadlines);
    check(E.Task, state.tasks);
    check(E.Update, state.updates);
    check(E.Comment, state.comments);
    check(E.FileRec, state.files);
    check(E.Notification, state.notifications);
    check(E.Event, state.events);
    E.Settings.parse(state.settings);
  });

  it('links every task to its project stage and team', async () => {
    const { state } = await seed();
    for (const task of Object.values(state.tasks)) {
      expect(state.stages[task.stageId]?.projectId).toBe(task.projectId);
      const project = state.projects[task.projectId];
      expect(project.leaderId === task.ownerId || Boolean(state.members[`${task.projectId}:${task.ownerId}`])).toBe(true);
    }
  });

  it('stores data for every file version', async () => {
    const { state, blobs } = await seed();
    const versions = Object.values(state.files).flatMap((f) => f.versions);
    expect(versions).toHaveLength(72);
    for (const version of versions) expect(blobs.get(version.blobKey)?.size).toBe(version.size);
  });

  it('is the same every time', async () => {
    expect(JSON.stringify((await seed()).state)).toBe(JSON.stringify((await seed()).state));
  });

  it('has agent summaries on every active project', async () => {
    const { state } = await seed();
    for (const project of Object.values(state.projects).filter((p) => p.status === 'active')) {
      const summaries = Object.values(state.updates).filter((u) => u.projectId === project.id && u.authorId === 'usr_009');
      expect(summaries.length).toBe(4);
    }
  });
});

it('writes agent summaries with relative days, so the date shift keeps them true', async () => {
  const state = await buildSeed(TODAY, async () => undefined);
  const bodies = Object.values(state.updates).filter((u) => state.users[u.authorId].kind === 'agent').map((u) => u.body);
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toMatch(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
  expect(bodies.some((body) => /in \d+ days|today|tomorrow/.test(body))).toBe(true);
});

it('has a client record on three projects, with one question waiting on us and one item waiting on the client', async () => {
  const { state } = await seed();
  const entries = Object.values(state.tracker ?? {});
  expect(new Set(entries.map((e) => e.projectId)).size).toBe(3);
  for (const entry of entries) expect(E.TrackerEntry.safeParse(entry).success).toBe(true);
  const open = entries.filter((e) => e.waiting !== null && e.closedAt === null);
  expect(open.map((e) => e.waiting).sort()).toEqual(['client', 'client', 'us', 'us']);
  // A closed loop names who closed it. Every file chip points at a file of the same project.
  expect(entries.filter((e) => e.closedAt !== null).every((e) => e.closedBy !== null)).toBe(true);
  for (const entry of entries) for (const id of entry.fileIds) expect(state.files[id].projectId).toBe(entry.projectId);
  expect(entries.some((e) => e.auto === 'upload') && entries.some((e) => e.auto === 'delivered')).toBe(true);
});
