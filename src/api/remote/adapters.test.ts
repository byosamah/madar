import { describe, expect, it } from 'vitest';
import { createRemoteApi } from './remoteApi';
import { feedbackAdapter } from './feedback';
import { uploadAdapter } from './upload';
import type { WireRequest } from './wire';

describe('the upload adapters inside RemoteApi (track F)', () => {
  it('turn one files.upload of the screen into three wire calls of one story, with no blob on the wire', async () => {
    const bodies: WireRequest[] = [];
    const fetch = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as WireRequest;
      bodies.push(body);
      const results = body.calls.map((call) => ({
        i: call.i,
        ok: true,
        storyId: 'sty_UP',
        changed: call.name === 'files.upload',
        output: call.name === 'files.uploadStart'
          ? { uploadId: 'upl_1', put: { url: 'https://store.test/up/upl_1', headers: { 'Content-Type': 'application/pdf' }, expiresAt: 'x' } }
          : { file: { id: 'fil_9' } },
      }));
      return new Response(JSON.stringify({ v: 1, serverTime: 'x', results }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const puts: string[] = [];
    const api = createRemoteApi({
      url: 'https://api.test/functions/v1/api',
      build: 'b1',
      token: async () => 'token',
      fetch,
      adapters: {
        'files.upload': uploadAdapter({ makeThumb: async () => null, put: async (put) => { puts.push(put.url); return { status: 200, body: '' }; } }),
        'feedback.send': feedbackAdapter(),
      },
    });
    const result = await api.run('files.upload', { projectId: 'prj_001', name: 'Plan.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }) });
    expect(bodies.map((b) => b.calls.map((c) => c.name))).toEqual([['files.uploadStart'], ['files.upload']]);
    expect(puts).toEqual(['https://store.test/up/upl_1']);
    expect(JSON.stringify(bodies)).not.toContain('blob');
    expect(bodies[1].calls[0].story).toEqual({ id: 'sty_UP' });
    expect(result).toEqual({ output: { file: { id: 'fil_9' } }, storyId: 'sty_UP', changed: true });
  });
});
