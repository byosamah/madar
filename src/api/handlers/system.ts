import { z } from 'zod';
import { defineCall } from '../registry';
import { ApiError } from '../errors';
import type { State } from '../store';

/** Prototype control: puts the sample office back. The "Simulate errors" switch keeps its value. */
export const sessionResetSampleData = defineCall({
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  prototypeOnly: true,
  async prepare(_input, p): Promise<State> {
    // The prototype runtime gives the sample office (src/data/sampleOffice.ts). A runtime without it has no sample office to give.
    if (!p.sampleOffice) throw new ApiError('failed', 'This build has no sample office.');
    await p.persister.clear();
    return p.sampleOffice(p.now, (key, blob) => p.persister.putBlob(key, blob));
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
