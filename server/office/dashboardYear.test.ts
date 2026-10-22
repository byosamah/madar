import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { insightCalls } from '../../src/api/handlers/insights';
import type { State } from '../../src/api/store';
import { setNow } from '../../src/lib/dates';
import { NOW, testApi } from '../../src/test/factories';
import { yearOffice } from './test/yearOffice';

/**
 * DB-3, the CPU part (performance audit 2026-10-21): dashboard.get filtered all tasks once for each stage tag of each project.
 * The year office is the size of the real office after one year. The answers below were taken before the change, so they pin
 * that the faster handler gives the same answer for the same input.
 */
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

let office: State;
beforeAll(async () => {
  setNow(NOW);
  office = await yearOffice('2026-10-04');
}, 120_000);

describe('dashboard.get on the year office', () => {
  it('gives the same answer as before the change, for the main filters', async () => {
    setNow(NOW);
    const { api } = testApi(insightCalls, structuredClone(office));
    const leader = Object.values(office.projects).find((p) => p.leaderId)?.leaderId as string;
    const answers = {
      plain: hash(await api.call('dashboard.get', {})),
      all: hash(await api.call('dashboard.get', { status: 'all' })),
      leader: hash(await api.call('dashboard.get', { leaderId: leader })),
    };
    expect(answers).toEqual({ plain: '1686e9bb9a8f8b6e', all: '74b3a7711f33d9b0', leader: 'f91b7b1d709ed1fc' });
  }, 120_000);

  it('reads the list of all tasks only a few times, not once for each project', async () => {
    setNow(NOW);
    const state = structuredClone(office);
    let reads = 0;
    state.tasks = new Proxy(state.tasks, {
      ownKeys(target) {
        reads += 1;
        return Reflect.ownKeys(target);
      },
    });
    const { api } = testApi(insightCalls, state);
    await api.call('dashboard.get', {});
    // Before DB-3 the count was 163 (one read for each stage tag and each health of each project).
    expect(reads).toBeLessThanOrEqual(8);
  }, 120_000);
});
