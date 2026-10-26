import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { call, world, type World } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { keepStageDates } from './keepDates';

/**
 * stages.replace keeps the dates for an agent (owner, 2026-10-26). The call sets a date that the input leaves out to null, so an agent that only
 * renames stages would clear their dates. The MCP layer fills a missing date of a stage that keeps its id from the current stage. A null that the
 * agent sends stays null. In the sample office usr_002 leads prj_001 (seven stages); usr_003 leads prj_002.
 */

const PROJECT = 'prj_001';
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const stagesOf = (w: World, projectId = PROJECT) => Object.values(w.mem.tables.state.stages).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
const datesOf = (w: World) => stagesOf(w).map((s) => ({ id: s.id, startDate: s.startDate, endDate: s.endDate }));

describe('stages.replace keeps the dates that the agent leaves out', () => {
  it('a rename with no dates keeps every date', async () => {
    const w = world(seed, 'usr_002');
    const before = datesOf(w);
    expect(before.every((s) => s.startDate && s.endDate)).toBe(true);
    const names = stagesOf(w).map((s) => s.name);
    const stages = stagesOf(w).map((s) => ({ id: s.id, name: `${s.name} (new)` }));
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(stagesOf(w).map((s) => s.name)).toEqual(names.map((name) => `${name} (new)`));
    expect(datesOf(w)).toEqual(before);
    // The answer, as the screen gets it, holds the same dates.
    const answered = result.structuredContent.output.stages as { id: string; startDate: string | null; endDate: string | null }[];
    expect(answered.map((s) => ({ id: s.id, startDate: s.startDate, endDate: s.endDate }))).toEqual(before);
  });

  it('a date that the agent sends is the new date, and the date it leaves out stays', async () => {
    const w = world(seed, 'usr_002');
    const before = datesOf(w);
    const [first, second, ...rest] = stagesOf(w);
    const stages = [
      { id: first.id, name: first.name, startDate: '2020-01-01' },
      { id: second.id, name: second.name, endDate: '2030-12-01' },
      ...rest.map((s) => ({ id: s.id, name: s.name })),
    ];
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const after = datesOf(w);
    expect(after[0]).toEqual({ ...before[0], startDate: '2020-01-01' });
    expect(after[1]).toEqual({ ...before[1], endDate: '2030-12-01' });
    expect(after.slice(2)).toEqual(before.slice(2));
  });

  it('a null that the agent sends clears the date, and only that date', async () => {
    const w = world(seed, 'usr_002');
    const before = datesOf(w);
    const stages = stagesOf(w).map((s) => (s.id === 'stg_003' ? { id: s.id, name: s.name, startDate: null } : { id: s.id, name: s.name }));
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const after = datesOf(w);
    expect(after.find((s) => s.id === 'stg_003')).toEqual({ id: 'stg_003', startDate: null, endDate: before.find((s) => s.id === 'stg_003')!.endDate });
    expect(after.filter((s) => s.id !== 'stg_003')).toEqual(before.filter((s) => s.id !== 'stg_003'));
  });

  it('a new stage with no id gets no date, and the dates of the others stay', async () => {
    const w = world(seed, 'usr_002');
    const before = datesOf(w);
    const stages = [...stagesOf(w).map((s) => ({ id: s.id, name: s.name })), { name: 'Handover' }];
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const after = stagesOf(w);
    expect(after.at(-1)).toMatchObject({ name: 'Handover', startDate: null, endDate: null });
    expect(datesOf(w).slice(0, -1)).toEqual(before);
  });

  it('an id of another project copies no date: the call refuses it, and nothing changes', async () => {
    const w = world(seed, 'usr_002');
    const other = stagesOf(w, 'prj_002')[0];
    expect(other.startDate).toBeTruthy();
    const before = datesOf(w);
    const stages = [...stagesOf(w).map((s) => ({ id: s.id, name: s.name })), { id: other.id, name: 'Stolen' }];
    const result = await call(w, 'stages.replace', { projectId: PROJECT, stages });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe('invalid_input');
    expect(datesOf(w)).toEqual(before);
  });

  it('is a pure step: keepStageDates fills the missing dates only, and leaves the arguments it was given untouched', async () => {
    const w = world(seed, 'usr_002');
    const snapshot = await w.mem.data().office();
    const first = stagesOf(w)[0];
    const args = { projectId: PROJECT, stages: [{ id: first.id, name: 'X' }, { id: first.id, name: 'Y', startDate: null }, { name: 'Z' }] };
    const frozen = JSON.stringify(args);
    const kept = keepStageDates(args, snapshot) as { stages: Record<string, unknown>[] };
    expect(kept.stages[0]).toEqual({ id: first.id, name: 'X', startDate: first.startDate, endDate: first.endDate });
    expect(kept.stages[1]).toEqual({ id: first.id, name: 'Y', startDate: null, endDate: first.endDate });
    expect(kept.stages[2]).toEqual({ name: 'Z' });
    expect(JSON.stringify(args)).toBe(frozen);
    // Other arguments pass as they are.
    expect(keepStageDates({ projectId: PROJECT }, snapshot)).toEqual({ projectId: PROJECT });
  });

  it('tells the agent the new rule in TOOL_DOCS and INSTRUCTIONS, in 600 characters or less', () => {
    const doc = TOOL_DOCS['stages.replace'].description;
    expect(doc.length).toBeLessThanOrEqual(600);
    expect(doc).toContain('stays as it is');
    expect(doc).toContain('send null to clear it');
    expect(doc).not.toContain('is cleared');
    const line = INSTRUCTIONS.split('\n').find((text) => text.startsWith('Stages: '))!;
    expect(line).toContain('stays as it is');
    expect(line).not.toContain('A date you leave out is cleared');
    expect(`${doc}${line}`).not.toMatch(/[–—]/);
  });
});
