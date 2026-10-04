import { describe, expect, it } from 'vitest';
import { MAX_SHOT_BYTES } from '../contract/server';
import { ApiError } from '../errors';
import { feedbackAdapter } from './feedback';
import type { PutResult, PutSender } from './upload';
import type { AdapterCtx } from './wire';

const put = (n: number) => ({ url: `https://store.test/feedback/upl_${n}/file`, headers: { 'Content-Type': 'image/png' }, expiresAt: '2026-10-04T12:00:00+03:00' });

function wire() {
  const steps: string[] = [];
  const inputs: Record<string, unknown> = {};
  const ctx: AdapterCtx = {
    meta: {},
    call: async (name, input) => {
      steps.push(name);
      inputs[name] = input;
      if (name === 'feedback.uploadStart') {
        const shots = (input as { screenshots: unknown[] }).screenshots;
        return { uploads: shots.map((_, i) => ({ uploadId: `upl_${i + 1}`, put: put(i + 1) })) };
      }
      if (name === 'feedback.send') return { id: 'fbk_001' };
      throw new Error(`unexpected ${name}`);
    },
  };
  return { ctx, steps, inputs };
}

function sender(steps: string[], answer: (url: string) => PutResult = () => ({ status: 200, body: '' })): { put: PutSender; bodies: Blob[] } {
  const bodies: Blob[] = [];
  return {
    bodies,
    put: async (signed, body) => {
      steps.push(`PUT ${signed.url}`);
      bodies.push(body);
      return answer(signed.url);
    },
  };
}

const REPORT = { kind: 'bug', message: 'The button does nothing.', page: '/projects' };

describe('the feedback adapter (plan 5.2)', () => {
  it('sends a report with no screenshots in one call, with no uploads', async () => {
    const { ctx, steps, inputs } = wire();
    const output = await feedbackAdapter({ put: sender(steps).put })({ ...REPORT, screenshots: [] }, ctx);
    expect(steps).toEqual(['feedback.send']);
    expect(inputs['feedback.send']).toEqual({ ...REPORT, uploadIds: [] });
    expect(output).toEqual({ id: 'fbk_001' });
    const bare = wire();
    await feedbackAdapter({ put: sender(bare.steps).put })({ ...REPORT }, bare.ctx);
    expect(bare.inputs['feedback.send']).toEqual({ ...REPORT, uploadIds: [] });
  });

  it('starts the uploads, sends each screenshot, then sends the report with the upload IDs, in order', async () => {
    const { ctx, steps, inputs } = wire();
    const shots = [new Blob(['a'], { type: 'image/png' }), new Blob(['bb'], { type: 'image/jpeg' })];
    const { put: send, bodies } = sender(steps);
    await feedbackAdapter({ put: send })({ ...REPORT, screenshots: shots }, ctx);
    expect(steps).toEqual(['feedback.uploadStart', `PUT ${put(1).url}`, `PUT ${put(2).url}`, 'feedback.send']);
    expect(inputs['feedback.uploadStart']).toEqual({ screenshots: [{ size: 1, mimeType: 'image/png' }, { size: 2, mimeType: 'image/jpeg' }] });
    expect(bodies).toEqual(shots);
    expect(inputs['feedback.send']).toEqual({ ...REPORT, uploadIds: ['upl_1', 'upl_2'] });
  });

  it('stops before feedback.send when a screenshot fails to upload, with failed for a Retry', async () => {
    const { ctx, steps } = wire();
    const shots = [new Blob(['a'], { type: 'image/png' }), new Blob(['b'], { type: 'image/png' })];
    const error = await feedbackAdapter({ put: sender(steps, (url) => (url === put(2).url ? { status: 0, body: '' } : { status: 200, body: '' })).put })({ ...REPORT, screenshots: shots }, ctx)
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'failed', details: { reason: 'upload_failed' } });
    expect(steps).not.toContain('feedback.send');
  });

  it('names the screenshot limit when the store refuses the size', async () => {
    const { ctx, steps } = wire();
    const error = await feedbackAdapter({ put: sender(steps, () => ({ status: 400, body: '{"statusCode":"413"}' })).put })({ ...REPORT, screenshots: [new Blob(['a'], { type: 'image/png' })] }, ctx)
      .then(() => null, (e: unknown) => e);
    expect(error).toMatchObject({ code: 'invalid_input', details: { fields: ['screenshots'], reason: 'file_too_large', limit: MAX_SHOT_BYTES } });
  });
});
