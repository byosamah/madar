import { z } from 'zod';
import { defineCall } from '../registry';
import type { State } from '../store';
import { buildSeed } from '../../data/seed';
import { settleFuture } from '../../data/shift';
import { todayISO } from '../../lib/dates';

/** Prototype control: puts the sample office back. The "Simulate errors" switch keeps its value. */
export const sessionResetSampleData = defineCall({
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  prototypeOnly: true,
  async prepare(_input, p): Promise<State> {
    await p.persister.clear();
    // The sample stamps of later today move to before now (audit 2026-10-03, BRW-4).
    return settleFuture(await buildSeed(todayISO(p.now), (key, blob) => p.persister.putBlob(key, blob)), p.now);
  },
  run(_input, ctx, fresh) {
    const keepErrors = ctx.state.session.simulateErrors;
    const target = ctx.state as unknown as Record<string, unknown>;
    const source = fresh as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) target[key] = source[key];
    ctx.state.session.simulateErrors = keepErrors;
    return { ok: true as const };
  },
});

export const systemCalls = {
  'session.resetSampleData': sessionResetSampleData,
};
