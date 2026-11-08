import { describe, expect, it } from 'vitest';
import { fixedClock } from '../test/fakes/clock';
import { ACCOUNT_BUSY, accountGate } from './accountGate';

function setup(state: { stop: boolean; writesStop: boolean } | Error) {
  const clock = fixedClock('2026-11-08T08:00:00Z');
  const asked: string[] = [];
  const gate = accountGate<object>({
    platform: () => ({ capState: async ({ day }: { day: string }) => (asked.push(day), state instanceof Error ? Promise.reject(state) : state) }),
    now: () => clock.now(),
  });
  return { clock, asked, gate, env: {} };
}

describe('the account gate of the Worker', () => {
  it('lets ENT_VADO through at the stop and asks nothing', async () => {
    const t = setup({ stop: true, writesStop: true });
    expect(await t.gate(t.env, 'ent_001', true)).toBeUndefined();
    expect(t.asked).toEqual([]);
  });

  it('refuses another enterprise at the stop, with the calm text', async () => {
    const t = setup({ stop: true, writesStop: false });
    const refused = await t.gate(t.env, 'ent_002', false);
    expect(refused?.message).toBe(ACCOUNT_BUSY.message);
    expect(refused?.message).toContain('03:00 Riyadh');
    expect(refused?.details).toEqual({ reason: 'busy' });
  });

  it('stops only a write when only the rows written are at the line', async () => {
    const t = setup({ stop: false, writesStop: true });
    expect(await t.gate(t.env, 'ent_002', false)).toBeUndefined();
    expect(await t.gate(t.env, 'ent_002', true)).toBeDefined();
  });

  it('asks the platform once in 60 seconds, and again after 60 seconds', async () => {
    const t = setup({ stop: false, writesStop: false });
    await t.gate(t.env, 'ent_002', true);
    await t.gate(t.env, 'ent_003', true);
    t.clock.advance(59_000);
    await t.gate(t.env, 'ent_002', false);
    expect(t.asked).toHaveLength(1);
    t.clock.advance(1_000);
    await t.gate(t.env, 'ent_002', false);
    expect(t.asked).toHaveLength(2);
  });

  it('asks again at a new UTC day', async () => {
    const t = setup({ stop: true, writesStop: true });
    expect(await t.gate(t.env, 'ent_002', false)).toBeDefined();
    t.clock.set('2026-11-09T00:00:10Z');
    await t.gate(t.env, 'ent_002', false);
    expect(t.asked).toEqual(['2026-11-08', '2026-11-09']);
  });

  it('lets a call through when the platform call throws (fail open)', async () => {
    const t = setup(new Error('The platform is down.'));
    expect(await t.gate(t.env, 'ent_002', true)).toBeUndefined();
  });
});
