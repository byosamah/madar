import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import * as E from '../api/contract/entities';
import { addDays, dayOfWeek, weekStartOf } from '../lib/dates';
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
    expect(users.filter((u) => u.kind === 'human')).toHaveLength(8);
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
    check(E.TimeEntry, state.time);
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

  it('logs hours on Sunday to Thursday only, 24 hours a day at most', async () => {
    const { state } = await seed();
    const perDay = new Map<string, number>();
    for (const entry of Object.values(state.time)) {
      expect(dayOfWeek(entry.date)).toBeLessThanOrEqual(4);
      expect(entry.date <= TODAY).toBe(true);
      const key = `${entry.userId}:${entry.date}`;
      perDay.set(key, (perDay.get(key) ?? 0) + entry.hours);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(24);
  });

  it('leaves two people under target last week', async () => {
    const { state } = await seed();
    const lastWeek = addDays(weekStartOf(TODAY), -7);
    const totals = new Map<string, number>();
    for (const entry of Object.values(state.time)) {
      if (entry.date >= lastWeek && entry.date <= addDays(lastWeek, 6)) totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.hours);
    }
    const under = [...totals.entries()].filter(([, hours]) => hours < 40).map(([userId]) => state.users[userId].name).sort();
    expect(under).toEqual(['Lina Mansour', 'Sara Al-Qahtani']);
  });
});

it('writes agent summaries with relative days, so the date shift keeps them true', async () => {
  const state = await buildSeed(TODAY, async () => undefined);
  const bodies = Object.values(state.updates).filter((u) => state.users[u.authorId].kind === 'agent').map((u) => u.body);
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toMatch(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
  expect(bodies.some((body) => /in \d+ days|today|tomorrow/.test(body))).toBe(true);
});
