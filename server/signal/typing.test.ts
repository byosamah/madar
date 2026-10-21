import { describe, expect, it } from 'vitest';
import type { Db, LogFields, Logger } from '../core/ports';
import { TYPING_EVENT, type TypingSignal } from '../../src/api/remote/wire';
import { realtimeTyping } from './typing';

/**
 * The typing sender on Realtime (chat presence design B, base B5) on a recording Db. The statement is the one of the change signals
 * (server/signal/realtime.ts) with its own event name. It never throws: a failed signal is lost, and the line goes away by itself
 * 6 seconds after the last signal.
 */

const signal: TypingSignal = { v: 1, conversationId: 'cnv_013', userId: 'usr_001', typing: true, at: '2026-10-04T06:00:00.000Z' };

type Sent = { mode: string; text: string; values?: unknown[] };

function recordingDb(o: { fail?: Error } = {}) {
  const sent: Sent[] = [];
  const db = {
    async statement(mode: string, text: string, values?: unknown[]) {
      sent.push({ mode, text, values });
      if (o.fail) throw o.fail;
      return [];
    },
  } as unknown as Db;
  return { db, sent };
}

function recordingLog() {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const at = (level: string) => (message: string, fields?: LogFields) => lines.push({ level, message, fields });
  const log: Logger = { info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

describe('the typing sender', () => {
  it('sends one statement with the topics of the people', async () => {
    const { db, sent } = recordingDb();
    await realtimeTyping({ db, log: recordingLog().log }).send(['usr_002', 'usr_003'], signal);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('select realtime.send($1::jsonb, $2::text, t.topic, true) from unnest($3::text[]) as t(topic)');
    expect(TYPING_EVENT).toBe('typing');
    expect(sent[0].values).toEqual([JSON.stringify(signal), 'typing', ['person:usr_002', 'person:usr_003']]);
  });

  it('logs and resolves when the statement fails', async () => {
    const { db } = recordingDb({ fail: new Error('connection closed') });
    const { log, lines } = recordingLog();
    await expect(realtimeTyping({ db, log }).send(['usr_002', 'usr_003'], signal)).resolves.toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('error');
    expect(lines[0].fields).toMatchObject({ people: 2 });
    expect(JSON.stringify(lines[0])).not.toContain('usr_002');
  });

  it('sends nothing for no people', async () => {
    const { db, sent } = recordingDb();
    await realtimeTyping({ db, log: recordingLog().log }).send([], signal);
    expect(sent).toEqual([]);
  });
});
