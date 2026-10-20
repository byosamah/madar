import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../test/fakes/deps';
import { JOB_STEPS, runJob, type JobStep } from './run';

/**
 * The 15-minute job (plan 5.5; task N3.1): the steps in the plan order, each on its own, so a step that fails never stops the
 * steps after it. server/it/jobs.it.test.ts runs the real steps on the local database.
 */

const AT = new Date('2026-10-04T06:00:00Z');

describe('runJob (plan 5.5)', () => {
  it('runs the heartbeat, the triggers, the meetings settle, the summary, the outbox retry, the cleanup, the uploads and the usage check, in that order', () => {
    expect(JOB_STEPS.map((step) => step.name)).toEqual(['heartbeat', 'triggers', 'meetings', 'summary', 'outbox', 'cleanup', 'uploads', 'usage']);
  });

  it('gives every step the same time and reports each result', async () => {
    const deps = fakeDeps();
    const seen: [string, string][] = [];
    const steps: JobStep[] = ['a', 'b'].map((name) => ({
      name,
      run: async (_deps, at) => {
        seen.push([name, at.toISOString()]);
        return { name };
      },
    }));
    const report = await runJob(deps, AT, steps);
    expect(seen).toEqual([['a', AT.toISOString()], ['b', AT.toISOString()]]);
    expect(report).toEqual({ ok: true, at: AT.toISOString(), steps: [{ name: 'a', ok: true, result: { name: 'a' } }, { name: 'b', ok: true, result: { name: 'b' } }] });
  });

  it('runs the later steps when one step fails, logs the failure with the step name, and reports the run as not ok', async () => {
    const deps = fakeDeps();
    const ran: string[] = [];
    const steps: JobStep[] = [
      { name: 'first', run: async () => (ran.push('first'), {}) },
      { name: 'broken', run: async () => { ran.push('broken'); throw new Error('The store is down.'); } },
      { name: 'last', run: async () => (ran.push('last'), {}) },
    ];
    const report = await runJob(deps, AT, steps);
    expect(ran).toEqual(['first', 'broken', 'last']);
    expect(report.ok).toBe(false);
    expect(report.steps.map((s) => [s.name, s.ok])).toEqual([['first', true], ['broken', false], ['last', true]]);
    expect(report.steps[1]).toEqual({ name: 'broken', ok: false, error: 'The store is down.' });
    expect(deps.logs).toContainEqual({ level: 'error', message: 'A job step failed. The next run tries it again.', fields: { step: 'broken', error: 'The store is down.' } });
  });
});
