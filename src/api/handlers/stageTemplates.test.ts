import { beforeEach, describe, expect, it } from 'vitest';
import { stageTemplateCalls } from './stageTemplates';
import { historyCalls } from './history';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Making a stage or project template is a switch (templates.projectCreate, off for a Member by default, owner 2026-10-21). The people of
 * these tests make templates, so the Member role holds the switch here. The tests of the switch itself are in rr2Office.test.ts.
 */
const world = () => {
  const t = testApi({ ...stageTemplateCalls, ...historyCalls });
  t.store.state.settings.roles = { rights: { member: ['templates.projectCreate'] } };
  return t;
};
const STAGES = ['Brief', 'Concept', 'Presentation'];

describe('stage templates', () => {
  it('lists nothing in an old office that has no template collection', async () => {
    const t = world();
    delete t.store.state.stageTemplates;
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
  });

  it('saves a template and lists it for everyone', async () => {
    const t = world();
    t.as('usr_003');
    const saved = await t.api.call('stageTemplates.save', { name: '  Villa  ', stages: STAGES });
    expect(saved).toMatchObject({ id: 'stt_001', name: 'Villa', stages: STAGES, createdBy: 'usr_003', createdByName: 'Sara Team', canDelete: true });
    t.as('usr_004');
    const rows = await t.api.call('stageTemplates.list', {});
    expect(rows.map((r) => [r.name, r.canDelete])).toEqual([['Villa', false]]);
  });

  it('refuses a name that exists, ignoring case', async () => {
    const t = world();
    await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    await expect(t.api.call('stageTemplates.save', { name: 'vILLA', stages: ['A'] })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses an empty list, a blank name, a repeated stage and more than 20 stages', async () => {
    const t = world();
    await expect(t.api.call('stageTemplates.save', { name: 'X', stages: [] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('stageTemplates.save', { name: '   ', stages: ['A'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('stageTemplates.save', { name: 'X', stages: ['A', ' a '] })).rejects.toMatchObject({ code: 'invalid_input' });
    const many = Array.from({ length: 21 }, (_, i) => `S${i}`);
    await expect(t.api.call('stageTemplates.save', { name: 'X', stages: many })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lets the person who saved it delete it', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    await t.api.call('stageTemplates.delete', { id });
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
  });

  it('lets the Admin delete a template of someone else', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    t.as('usr_001');
    await t.api.call('stageTemplates.delete', { id });
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
  });

  it('refuses delete from someone else', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    t.as('usr_004');
    await expect(t.api.call('stageTemplates.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await t.api.call('stageTemplates.list', {})).toHaveLength(1);
  });

  it('answers not found for an unknown template', async () => {
    const t = world();
    await expect(t.api.call('stageTemplates.delete', { id: 'stt_099' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets only the creator or the Admin undo a save, even when the event names someone else', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'stageTemplate.created')!;
    // The undo-right check passes for this person, so only the stage template rule can refuse.
    created.actingForId = 'usr_004';
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: created.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await t.api.call('stageTemplates.list', {})).toHaveLength(1);
    // A refused call puts the saved copy of the state back, so the event is read again.
    t.store.state.events[created.id].actingForId = 'usr_001';
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: created.id });
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
  });

  it('lets the creator undo their own save', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'stageTemplate.created')!;
    await t.api.call('events.undo', { eventId: created.id });
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
  });

  it('records an event, so Undo takes a save back and a delete back', async () => {
    const t = world();
    await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    const created = Object.values(t.store.state.events).find((e) => e.verb === 'stageTemplate.created')!;
    await t.api.call('events.undo', { eventId: created.id });
    expect(await t.api.call('stageTemplates.list', {})).toEqual([]);
    const again = await t.api.call('stageTemplates.save', { name: 'Villa', stages: STAGES });
    await t.api.call('stageTemplates.delete', { id: again.id });
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'stageTemplate.deleted')!;
    await t.api.call('events.undo', { eventId: deleted.id });
    expect((await t.api.call('stageTemplates.list', {})).map((r) => r.id)).toEqual([again.id]);
  });
});
