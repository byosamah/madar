import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import * as E from '../api/contract/entities';
import { TODAY } from '../test/factories';
import { healthCounts } from '../test/seed-helpers';
import { stageTag } from '../api/flow';
import { stageOverlaps } from '../lib/stageFlow';

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
    expect(healthCounts(state, TODAY)).toEqual({ on_track: 4, at_risk: 3, late: 2 });
    const statuses = Object.values(state.projects).map((p) => p.status);
    expect(statuses.filter((s) => s === 'on_hold')).toHaveLength(2);
    expect(statuses.filter((s) => s === 'completed')).toHaveLength(1);
  });

  it('keeps the same mix on another day', async () => {
    const other = '2027-03-14';
    expect(healthCounts((await seed(other)).state, other)).toEqual({ on_track: 4, at_risk: 3, late: 2 });
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
      expect(state.stages[task.stageId!]?.projectId!).toBe(task.projectId!);
      const project = state.projects[task.projectId!];
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

it('has a client record on four projects, with one question waiting on us and one item waiting on the client', async () => {
  const { state } = await seed();
  const entries = Object.values(state.tracker ?? {});
  expect(new Set(entries.map((e) => e.projectId)).size).toBe(4);
  for (const entry of entries) expect(E.TrackerEntry.safeParse(entry).success).toBe(true);
  const open = entries.filter((e) => e.waiting !== null && e.closedAt === null);
  expect(open.map((e) => e.waiting).sort()).toEqual(['client', 'client', 'client', 'us', 'us']);
  // A closed loop names who closed it. Every file chip points at a file of the same project.
  expect(entries.filter((e) => e.closedAt !== null).every((e) => e.closedBy !== null)).toBe(true);
  for (const entry of entries) for (const id of entry.fileIds) expect(state.files[id].projectId).toBe(entry.projectId);
  expect(entries.some((e) => e.auto === 'upload') && entries.some((e) => e.auto === 'delivered')).toBe(true);
});

describe('the sample dependencies, overlap and stage tag (owner, 2026-10-02)', () => {
  type Built = Awaited<ReturnType<typeof seed>>['state'];
  const byTitle = (state: Built, code: string, title: string) => {
    const project = Object.values(state.projects).find((p) => p.code === code)!;
    return Object.values(state.tasks).find((t) => t.projectId === project.id && t.title === title)!;
  };

  it('keeps the stage tag of every project the same as the stage the sample plans', async () => {
    const { state } = await seed();
    for (const project of Object.values(state.projects)) expect(stageTag(state, project.id)?.id).toBe(project.currentStageId);
  });

  it('has a chain in Construction Documents, ending in a dynamic task that needs a task already past due', async () => {
    const { state } = await seed();
    const ceiling = byTitle(state, 'KH-26-001', 'Reflected ceiling plans');
    const stairs = byTitle(state, 'KH-26-001', 'Stair details');
    const check = byTitle(state, 'KH-26-001', 'Structural drawings check');
    const specs = byTitle(state, 'KH-26-001', 'Specifications draft');
    expect(stairs.prerequisiteIds).toEqual([ceiling.id]);
    expect(check.prerequisiteIds).toEqual([stairs.id]);
    expect(specs.prerequisiteIds).toEqual([stairs.id]);
    expect(specs.schedule).toBe('dynamic');
    // "Stair details" keeps its due word: five days past due on the sample day.
    expect(stairs.dueDate).toBe('2026-09-25');
    expect(stairs.status).toBe('in_progress');
    // A task that is done, or in review, never waits for an open one.
    for (const task of Object.values(state.tasks)) {
      if (task.status === 'done' || task.status === 'in_review') expect((task.prerequisiteIds ?? []).every((id) => state.tasks[id].status === 'done')).toBe(true);
    }
  });

  it('has Permits needing Construction Documents, and one pair of stages that overlap', async () => {
    const { state } = await seed();
    const needing = Object.values(state.stages).filter((s) => s.name === 'Permits' && (s.prerequisiteIds ?? []).length > 0);
    expect(needing).toHaveLength(2);
    for (const stage of needing) expect(state.stages[(stage.prerequisiteIds as string[])[0]].name).toBe('Construction Documents');
    const overlapping = Object.values(state.projects).filter((p) => stageOverlaps(Object.values(state.stages).filter((s) => s.projectId === p.id)).length > 0);
    expect(overlapping.map((p) => p.code)).toEqual(['KH-26-003']);
  });
});

describe('the sample pictures (SeedPicture, 2026-10-06)', () => {
  it('draws SVG pictures by default, and the given maker for the test office of madar-test, with the same names in .png', async () => {
    const { state: plain } = await seed();
    const blobs = new Map<string, Blob>();
    const made: [number, number][] = [];
    const picture = {
      extension: 'png' as const, type: 'image/png' as const,
      render: (hue: number, variant: number) => {
        made.push([hue, variant]);
        return new Uint8Array([137, 80, 78, 71, variant]);
      },
    };
    const state = await buildSeed(TODAY, async (key, blob) => void blobs.set(key, blob), picture);
    const names = (s: typeof state) => Object.values(s.files).map((f) => f.name);
    const pictures = Object.values(state.files).filter((f) => f.name.endsWith('.png'));
    expect(names(plain).filter((n) => n.endsWith('.svg'))).toHaveLength(pictures.length);
    expect(names(state).filter((n) => n.endsWith('.svg'))).toEqual([]);
    expect(names(state)).toEqual(names(plain).map((n) => n.replace(/\.svg$/, '.png')));
    expect(made).toHaveLength(pictures.length);
    for (const file of pictures) {
      const version = file.versions[0];
      expect(version.mimeType).toBe('image/png');
      expect(version.size).toBe(5);
      expect(blobs.get(version.blobKey)?.type).toBe('image/png');
    }
    // The cover picture stays the first file of its project, now a PNG.
    const cover = Object.values(state.projects).find((p) => p.coverFileId);
    expect(state.files[cover!.coverFileId!].name).toBe('Cover render.png');
    // The PDF drawings do not change.
    expect(Object.values(state.files).filter((f) => f.name.endsWith('.pdf')).every((f) => f.versions.every((v) => v.mimeType === 'application/pdf'))).toBe(true);
  });
});
