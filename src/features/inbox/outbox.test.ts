import { describe, expect, it } from 'vitest';
import { readDraft, writeDraft } from '../../app/drafts';
import { keepAsDraft, matchOutbox, type Outgoing, type SavedItem } from './outbox';

/** Instant send (chat design 2026-10-19, item 13; track msg B14): the faded copy and the saved message meet here. */
const entry = (key: string, body: string, seen: string[] = [], over: Partial<Outgoing<unknown>> = {}): Outgoing<unknown> => ({
  key, input: { body }, body, replyTo: null, at: '2026-09-30T09:00:00.000+03:00', seen: new Set(seen), failed: false, ...over,
});
const saved = (id: string, body: string, mine = true): SavedItem => ({ id, mine, body });

describe('matchOutbox', () => {
  it('drops the faded copy when the saved message comes before the answer', () => {
    expect(matchOutbox([entry('k1', 'Hi', ['msg_1'])], [saved('msg_1', 'Hi'), saved('msg_2', 'Hi')])).toEqual({ unsent: [], claimed: ['msg_2'] });
  });

  it('drops the faded copy by the id of the answer', () => {
    const waiting = entry('k1', 'Hi', ['msg_1'], { savedId: 'msg_2' });
    expect(matchOutbox([waiting], [saved('msg_1', 'Hi'), saved('msg_2', 'Hi')])).toEqual({ unsent: [], claimed: ['msg_2'] });
    // The answer came and the message did not show yet: the copy stays, and takes no other message with the same words.
    expect(matchOutbox([waiting], [saved('msg_1', 'Hi'), saved('msg_3', 'Hi')])).toEqual({ unsent: [waiting], claimed: [] });
  });

  it('matches two same words one to one, oldest first', () => {
    expect(matchOutbox([entry('k1', 'ok'), entry('k2', 'ok')], [saved('msg_7', 'ok')]).unsent.map((e) => e.key)).toEqual(['k2']);
    expect(matchOutbox([entry('k1', 'ok'), entry('k2', 'ok')], [saved('msg_7', 'ok'), saved('msg_8', 'ok')])).toMatchObject({ unsent: [], claimed: ['msg_7', 'msg_8'] });
  });

  it('takes no message of another person and no message that was there before', () => {
    const waiting = entry('k1', 'Hi', ['msg_1']);
    expect(matchOutbox([waiting], [saved('msg_1', 'Hi'), saved('msg_2', 'Hi', false)])).toEqual({ unsent: [waiting], claimed: [] });
    expect(matchOutbox([waiting], [saved('msg_1', 'Hi')])).toEqual({ unsent: [waiting], claimed: [] });
  });

  it('keeps an entry whose words differ from every saved message', () => {
    const waiting = entry('k1', 'Hello there');
    expect(matchOutbox([waiting], [saved('msg_2', 'Hello'), saved('msg_3', 'Hello there!')])).toEqual({ unsent: [waiting], claimed: [] });
  });

  it('keeps a failed entry in the list until a message takes it', () => {
    const lost = entry('k1', 'Lost', [], { failed: true });
    expect(matchOutbox([lost], [])).toEqual({ unsent: [lost], claimed: [] });
  });
});

describe('keepAsDraft', () => {
  const owner = 'usr_001';
  const key = 'chat:cnv_001';

  it('does nothing for an empty body', () => {
    keepAsDraft(owner, key, '   ');
    expect(readDraft(owner, key)).toBe('');
  });

  it('writes the words as plain text when the chat has no draft', () => {
    keepAsDraft(owner, key, 'Ok then');
    expect(readDraft(owner, key)).toBe('Ok then');
  });

  it('puts the words before a draft that exists', () => {
    writeDraft(owner, key, 'Newer words');
    keepAsDraft(owner, key, 'Ok then');
    expect(readDraft(owner, key)).toBe('Ok then\nNewer words');
  });
});
