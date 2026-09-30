import { describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { buildSeed } from '../../data/seed';
import { NOW, TODAY, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

describe('session.resetSampleData', () => {
  it('puts the sample data back and keeps the error switch', async () => {
    setNow(NOW);
    const t = testApi(calls, await buildSeed(TODAY, async () => undefined));
    t.store.state.projects.prj_001.name = 'Changed';
    t.store.state.session.simulateErrors = true;
    t.as('usr_004');
    await t.api.call('session.resetSampleData', {});
    expect(t.store.state.projects.prj_001.name).toBe('Corniche Office Tower');
    expect(t.store.state.session.simulateErrors).toBe(true);
    expect(t.store.state.session.currentUserId).toBe('usr_001');
  });
});
