import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { giveRole, roleWithout } from './aiRoles.testing';
import { aiSwitchOf } from './aiSwitches';
import { call, world, type World } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { MCP_ALLOW, MCP_BY_RIGHT, MCP_DENY, mcpTools } from './tools';

/**
 * stages.replace over MCP (owner, 2026-10-26): an agent renames, adds, removes and orders the stages of one project in one call. The leader
 * and the Admin may (project.stages); a team member and an outsider may not. In the sample office usr_002 leads prj_001, usr_005 is on its
 * team, and stg_007 (Supervision) holds no to-do while stg_004 holds several.
 */

const PROJECT = 'prj_001';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const stagesOf = (w: World) => Object.values(w.mem.tables.state.stages).filter((s) => s.projectId === PROJECT).sort((a, b) => a.order - b.order);
/** The stages as the agent sends them back: the id, the name and both dates of each. */
const asSent = (w: World) => stagesOf(w).map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate }));

describe('stages.replace is a tool (owner, 2026-10-26)', () => {
  it('sits in exactly one list, with the AI switch of stages.setDates', () => {
    expect(MCP_ALLOW).toContain('stages.replace');
    expect(MCP_DENY as readonly string[]).not.toContain('stages.replace');
    expect(Object.keys(MCP_BY_RIGHT)).not.toContain('stages.replace');
    expect(aiSwitchOf('stages.replace')).toBe('ai.projects');
    expect(aiSwitchOf('stages.replace')).toBe(aiSwitchOf('stages.setDates'));
    const tool = mcpTools().find((t) => t.name === 'stages.replace')!;
    expect(tool.readOnly).toBe(false);
    expect(tool.takesStory).toBe(true);
    expect(tool.annotations.destructiveHint).toBe(true);
    // stages.setPrerequisites stays screen work.
    expect(MCP_DENY).toContain('stages.setPrerequisites');
  });

  it('tells the agent the whole rule: the whole list, the ids, the removal, the dates, the switch, no Undo and to ask first', () => {
    const doc = TOOL_DOCS['stages.replace'].description;
    for (const word of ['whole list', 'id', 'stage_has_tasks', 'project.stages', 'by default', 'Ask your person', 'No Undo', 'projectId']) expect(doc, word).toContain(word);
    expect(doc.length).toBeLessThanOrEqual(600);
    expect(doc).not.toMatch(/[–—]/);
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Stages: '))!;
    expect(line).toContain('stages.replace');
    expect(line).toContain('stage_has_tasks');
    expect(line).not.toContain('Adding, removing and renaming stages is screen work.');
    expect(line).not.toMatch(/[–—]/);
  });
});

describe('stages.replace over MCP', () => {
  it('renames, adds and orders the stages of one project in one call, and the History names the agent and its person', async () => {
    const w = world(seed, 'usr_002');
    const list = asSent(w);
    expect(list.map((s) => s.id)).toEqual(['stg_001', 'stg_002', 'stg_003', 'stg_004', 'stg_005', 'stg_006', 'stg_007']);
    // Rename Tender, swap it with Permits' place after it, and add a new last stage with no id.
    const [first, second, third, fourth, permits, tender, supervision] = list;
    const next = [first, second, third, fourth, { ...tender, name: 'Tender and award' }, permits, supervision, { name: 'Handover', startDate: '2027-01-15', endDate: '2027-02-15' }];
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages: next });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const stages = stagesOf(w);
    expect(stages.map((s) => s.name)).toEqual(['Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Tender and award', 'Permits', 'Supervision', 'Handover']);
    expect(stages.map((s) => s.id).slice(0, 7)).toEqual(['stg_001', 'stg_002', 'stg_003', 'stg_004', 'stg_006', 'stg_005', 'stg_007']);
    expect(stages[7].id).toMatch(/^stg_/);
    expect(stages[7]).toMatchObject({ name: 'Handover', startDate: '2027-01-15', endDate: '2027-02-15', order: 7 });
    // The answer is the project as the screen gets it.
    expect((result.structuredContent.output.stages as { name: string }[]).map((s) => s.name)).toContain('Handover');
    const event = Object.values(w.mem.tables.state.events).find((e) => e.verb === 'project.stages_changed')!;
    expect(event).toMatchObject({ actorId: 'usr_950', actorKind: 'agent', actingForId: 'usr_002', projectId: PROJECT });
  });

  it('has no Undo (project.stages_changed is not undoable): events.undoStory fails for a story that holds it, and the stages stay', async () => {
    const w = world(seed, 'usr_002');
    const story = (await call(w, 'story.start', {})).structuredContent.output.storyId as string;
    const renamed = asSent(w).map((s) => (s.id === 'stg_007' ? { ...s, name: 'Site supervision' } : s));
    expect((await call(w, 'stages.replace', { projectId: PROJECT, stages: renamed, storyId: story })).isError).toBeUndefined();
    const undone = await call(w, 'events.undoStory', { correlationId: story });
    expect(undone.isError).toBe(true);
    expect(stagesOf(w).find((s) => s.id === 'stg_007')!.name).toBe('Site supervision');
  });

  it('removes a stage that holds no to-do', async () => {
    const w = world(seed, 'usr_002');
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages: asSent(w).filter((s) => s.id !== 'stg_007') });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(stagesOf(w).map((s) => s.id)).not.toContain('stg_007');
  });

  it('refuses to remove a stage that still holds to-dos (stage_has_tasks), and changes nothing', async () => {
    const w = world(seed, 'usr_002');
    const before = asSent(w);
    const events = Object.keys(w.mem.tables.state.events).length;
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages: before.filter((s) => s.id !== 'stg_004') });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('invalid_input');
    expect(result.structuredContent.error.details.reason).toBe('stage_has_tasks');
    expect(asSent(w)).toEqual(before);
    expect(Object.keys(w.mem.tables.state.events)).toHaveLength(events);
  });

  it('refuses a person without the switch project.stages: a team member and an outsider get forbidden', async () => {
    for (const person of ['usr_005', 'usr_003']) {
      const w = world(seed, person);
      const before = asSent(w);
      const result = await call(w, 'stages.replace', { projectId: PROJECT, stages: before.map((s) => ({ ...s, name: `${s.name} x` })) });
      expect(result.isError, person).toBe(true);
      expect(result.structuredContent.error.code, person).toBe('forbidden');
      expect(asSent(w), person).toEqual(before);
    }
  });

  it('is closed by the AI switch ai.projects, like stages.setDates: the call fails with ai_off', async () => {
    const w = world(seed, 'usr_002', (state) => void giveRole(state, 'usr_002', roleWithout(['ai.projects'])));
    const before = asSent(w);
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages: before.map((s) => ({ ...s, name: `${s.name} x` })) });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.projects' } });
    expect(asSent(w)).toEqual(before);
  });
});
