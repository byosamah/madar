import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { httpOf, NODE_TODAY, nodeWorld } from '../office/test/nodeWorld';

// A 1x1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function world() {
  const t = await nodeWorld({ ents: ['ent_001', 'ent_002'], seeds: { ent_001: await buildSeed(NODE_TODAY, async () => undefined), ent_002: await buildSeed(NODE_TODAY, async () => undefined) } });
  await t.ents.get('ent_002')!.stub.setIdentity({ ent: 'ent_002', name: 'Acme', nameAr: 'أكمي', logo: PNG });
  return t;
}
const get = (t: Awaited<ReturnType<typeof world>>, ent: string) => t.route(httpOf('GET', `/api/enterprise-logo/${ent}`));

describe('GET /api/enterprise-logo/:ent', () => {
  it('gives the picture of a listed enterprise with its type, the cache line and nosniff', async () => {
    const t = await world();
    const request = new Request('https://madar.test/api/enterprise-logo/ent_002');
    void request;
    const answer = await get(t, 'ent_002');
    expect(answer.status).toBe(200);
    const header = (name: string) => answer.headers.find(([key]) => key.toLowerCase() === name)?.[1];
    expect(header('content-type')).toBe('image/png');
    expect(header('cache-control')).toBe('public, max-age=3600');
    expect(header('x-content-type-options')).toBe('nosniff');
  });

  it('gives the same 404 for an unlisted id, a malformed id and a listed enterprise with no logo', async () => {
    const t = await world();
    const missing = await get(t, 'ent_999');
    const bad = await get(t, 'bad');
    const none = await get(t, 'ent_001');
    for (const one of [missing, bad, none]) expect(one.status).toBe(404);
    expect(bad.body).toBe(missing.body);
    expect(none.body).toBe(missing.body);
  });

  it('gives 404 for a paused enterprise, and makes no object for an unlisted id', async () => {
    const t = await world();
    await t.ents.get('ent_002')!.stub.setState({ ent: 'ent_002', state: 'paused' });
    expect((await get(t, 'ent_002')).status).toBe(404);
    const before = t.created.length;
    await get(t, 'ent_999');
    expect(t.created.slice(before)).not.toContain('ent_999');
  });

  it('never sends a stored picture of another type as a page: a logo that is not picture data gives 404', async () => {
    const t = await world();
    const one = t.ents.get('ent_002')!;
    one.raw.exec(`update settings set doc = json_set(doc, '$.enterpriseLogo', 'data:text/html;base64,PGI+') where id = 'office'`);
    one.raw.exec('update office_meta set version = version + 1');
    one.raw.exec('delete from office_snapshot');
    expect((await get(t, 'ent_002')).status).toBe(404);
  });
});
