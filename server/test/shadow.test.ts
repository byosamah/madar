import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { makeWorld, NOW } from '../../src/test/factories';
import type { RunResult } from '../core/types';
import { runOn } from '../data/loaders/compare';
import { shadowProblems } from './shadow';

const INPUT = { workloadLimit: 20 };

/** The answer of a database that does the same as the memory: the call on a copy of the office. */
function honest(office: State): { result: RunResult; after: State } {
  const after = structuredClone(office);
  const outcome = runOn(after, 'settings.update', INPUT, 'usr_001', { now: NOW, correlationId: 'sty_real' });
  return { result: { ok: true, output: outcome.output, storyId: 'sty_real', changed: true }, after };
}

describe('the shadow run (TM 3.5, check 1)', () => {
  it('passes when the database gives the same output and the same office as the whole office in memory', async () => {
    const office = makeWorld();
    const { result, after } = honest(office);
    expect(await shadowProblems({ name: 'settings.update', input: INPUT, actorId: 'usr_001', now: NOW, office, result, after })).toEqual([]);
  });

  it('names a change that the database did not save', async () => {
    const office = makeWorld();
    const { result } = honest(office);
    const problems = await shadowProblems({ name: 'settings.update', input: INPUT, actorId: 'usr_001', now: NOW, office, result, after: office });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^settings\.update: the database saved another change than the whole office in memory/);
    expect(problems[0]).toMatch(/settings/);
    // The event the database did not write leaves its counter behind too.
    expect(problems[1]).toMatch(/^settings\.update: the database counted other numbers .*evt/);
  });

  it('names another output, and another refusal', async () => {
    const office = makeWorld();
    const { result, after } = honest(office);
    const other = { ...result, output: { ...(result as { output: object }).output, workloadLimit: 99 } } as RunResult;
    const [problem] = await shadowProblems({ name: 'settings.update', input: INPUT, actorId: 'usr_001', now: NOW, office, result: other, after });
    expect(problem).toMatch(/gave another output.*workloadLimit/);

    const refused: RunResult = { ok: false, error: { code: 'forbidden', message: 'No.' } };
    const [refusal] = await shadowProblems({ name: 'settings.update', input: INPUT, actorId: 'usr_001', now: NOW, office, result: refused, after: office });
    expect(refusal).toMatch(/the database refused with forbidden, the whole office in memory answered/);
  });

  it('says whether the memory loader agrees with the whole office, to point at the loader or the save step', async () => {
    const office = makeWorld();
    const { result } = honest(office);
    const [problem] = await shadowProblems({ name: 'settings.update', input: INPUT, actorId: 'usr_001', now: NOW, office, result, after: office });
    expect(problem).toMatch(/The scoped load in memory gives the same answer as the whole office/);
  });

  it('accepts invalid input only as invalid_input', async () => {
    const office = makeWorld();
    const bad = { workloadLimit: 'many' };
    const refused: RunResult = { ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.' } };
    expect(await shadowProblems({ name: 'settings.update', input: bad, actorId: 'usr_001', now: NOW, office, result: refused, after: office })).toEqual([]);
    const ran: RunResult = { ok: true, output: {}, changed: false };
    expect(await shadowProblems({ name: 'settings.update', input: bad, actorId: 'usr_001', now: NOW, office, result: ran, after: office })).toEqual([
      'settings.update: the input does not parse, and the database still answered.',
    ]);
  });

  it('ignores the server limits in the output of session.get', async () => {
    const office = makeWorld();
    const out = runOn(structuredClone(office), 'session.get', {}, 'usr_001', { now: NOW });
    const result: RunResult = { ok: true, output: { ...(out.output as object), limits: { maxFileBytes: 1 } }, changed: false };
    expect(await shadowProblems({ name: 'session.get', input: {}, actorId: 'usr_001', now: NOW, office, result, after: office })).toEqual([]);
  });
});
