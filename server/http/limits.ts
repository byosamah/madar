import { z } from 'zod';
import { BATCH_BUDGET, callCost, MAX_BATCH, MAX_BODY_BYTES, type WireRequest } from '../../src/api/remote/wire';
import { refuse } from './errors';

/**
 * The checks of a batch before any sign-in or call (plan 4.10): the screen build, the body size, the wire shape,
 * at most 12 entries, and calls whose cost (callCost) adds up to BATCH_BUDGET at most. Each refusal names its reason for the screen.
 */

/** True when the screen build is older than the oldest build the server accepts. Builds compare number by number ("2026.10.4"). */
export function buildOlder(build: string | undefined, min: string): boolean {
  const parts = (text: string) => text.split(/\D+/).filter(Boolean).map(Number);
  const wanted = parts(min);
  if (wanted.every((n) => n === 0)) return false;
  const have = build === undefined ? [] : parts(build);
  if (have.length === 0) return true;
  for (let n = 0; n < Math.max(have.length, wanted.length); n += 1) {
    const a = have[n] ?? 0;
    const b = wanted[n] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

export function checkBuild(build: string | undefined, min: string): void {
  if (buildOlder(build, min)) throw refuse('failed', 'Madar has a new version. Reload the page.', { reason: 'client_outdated' });
}

const tooLarge = () => refuse('invalid_input', 'The request is too large.', { reason: 'too_large' });

/** The body as text, read up to MAX_BODY_BYTES. A longer body stops the read at once. */
export async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const StoryRefSchema = z.union([z.strictObject({ id: z.string().min(1).max(80) }), z.strictObject({ ref: z.string().min(1).max(80) })]);
const WireCallSchema = z.object({
  i: z.number().int().nonnegative(),
  name: z.string().min(1).max(80),
  input: z.unknown(),
  story: StoryRefSchema.optional(),
  key: z.string().min(1).max(128).optional(),
});
const WireRequestSchema = z.object({ v: z.literal(1), calls: z.array(WireCallSchema) });

const notABatch = () => refuse('invalid_input', 'The request is not a batch.', { reason: 'bad_request' });

/** The batch of a body, with the entry and cost limits. Returns the number of overview calls (the calls that have a cost). */
export function parseBatch(text: string): { request: WireRequest; overviewCalls: number } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw notABatch();
  }
  const calls = (json as { calls?: unknown } | null)?.calls;
  if (Array.isArray(calls) && calls.length > MAX_BATCH) {
    throw refuse('invalid_input', `A request holds at most ${MAX_BATCH} calls.`, { reason: 'too_many_calls' });
  }
  const parsed = WireRequestSchema.safeParse(json);
  if (!parsed.success) throw notABatch();
  const request = parsed.data as WireRequest;
  if (new Set(request.calls.map((c) => c.i)).size !== request.calls.length) throw notABatch();
  // The CPU limit of the server covers the whole request. A call that scans a list of the office has a cost (wire.ts, callCost).
  const costs = request.calls.map((c) => callCost(c.name, c.input));
  if (costs.reduce((sum, cost) => sum + cost, 0) > BATCH_BUDGET) {
    throw refuse('invalid_input', 'A request holds too many overview calls.', { reason: 'too_many_overviews' });
  }
  return { request, overviewCalls: costs.filter((cost) => cost > 0).length };
}
