import { describe, expect, it } from 'vitest';
import { Project, Task } from '../api/contract/entities';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { memoryPersister } from '../api/persist';
import { Store } from '../api/store';
import { mayViewProject } from '../api/permissions';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';
import { addSampleInternalProject } from './sampleInternalProject';
import { sampleOffice } from './sampleOffice';
import { buildSeed } from './seed';

describe('the sample internal project (fbk_044)', () => {
  it('adds one hidden internal project with a leader, a team member, two stages and three to-dos', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const before = Object.keys(state.projects).length;
    addSampleInternalProject(state, TODAY);
    expect(Object.keys(state.projects)).toHaveLength(before + 1);
    const project = Object.values(state.projects).find((one) => one.kind === 'internal')!;
    expect(Project.safeParse(project).success).toBe(true);
    expect(project).toMatchObject({ name: 'Portfolio 2026', code: 'INT-26-001', clientId: null, areaM2: null, access: { hidden: true, viewerIds: [] } });
    expect(project.subCompanyId ?? null).toBeNull();
    expect(Object.values(state.stages).filter((stage) => stage.projectId === project.id)).toHaveLength(2);
    const tasks = Object.values(state.tasks).filter((task) => task.projectId === project.id);
    expect(tasks).toHaveLength(3);
    for (const task of tasks) expect(Task.safeParse(task).success).toBe(true);
    const members = Object.values(state.members).filter((member) => member.projectId === project.id);
    expect(members).toHaveLength(2);
    expect(members.map((member) => member.userId)).toContain(project.leaderId);
    expect(state.conversations?.[project.id] ?? Object.values(state.conversations ?? {}).find((chat) => chat.projectId === project.id)).toBeDefined();
  });

  it('shows to the Admin, the leader and the team member, and to no other person', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    addSampleInternalProject(state, TODAY);
    const project = Object.values(state.projects).find((one) => one.kind === 'internal')!;
    const members = new Set(Object.values(state.members).filter((member) => member.projectId === project.id).map((member) => member.userId));
    const humans = Object.values(state.users).filter((user) => user.kind === 'human' && user.active);
    for (const user of humans) {
      const expected = user.systemRole === 'admin' || members.has(user.id);
      expect(mayViewProject(state, project, user), user.name).toBe(expected);
    }
  });

  it('comes with the plain sample office of a reset, and the buildSeed stays without it', async () => {
    setNow(NOW);
    const plain = await buildSeed(TODAY, async () => undefined);
    expect(Object.values(plain.projects).some((project) => project.kind === 'internal')).toBe(false);
    const reset = await sampleOffice(NOW, async () => undefined);
    expect(Object.values(reset.projects).filter((project) => project.kind === 'internal')).toHaveLength(1);
    const api = createApi(calls, { store: new Store(reset, memoryPersister()), latencyMs: 0 });
    const list = await api.call('projects.list', { status: 'all' });
    expect(list.find((row) => row.project.kind === 'internal')?.project.name).toBe('Portfolio 2026');
  });
});
