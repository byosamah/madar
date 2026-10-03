import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { feedbackAdapter } from './feedback';
import { uploadAdapter } from './upload';

describe('the upload adapters (stubs until track F)', () => {
  it('keep their final signatures and refuse with failed', async () => {
    const ctx = { call: async () => undefined, meta: {} };
    for (const adapter of [uploadAdapter({ makeThumb: async () => null }), feedbackAdapter()]) {
      const error = await adapter({}, ctx).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('failed');
    }
  });
});
