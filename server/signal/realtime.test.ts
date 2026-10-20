import { describe, expect, it } from 'vitest';
import type { Logger, LogFields, Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { onNotice, type DbNotice } from '../data/sql';
import { realtimeSender, SIGNAL_EVENT, type NoticeListen } from './realtime';

/**
 * The Realtime sender (plan 5.3; proof.md, Z0a item 5) on a recording query. realtime.send turns every failure into a WARNING
 * and never fails the statement, so the sender hears the notices of its statement and reports each warning as a failed signal.
 * server/it/realtime.it.test.ts runs the same sender on the local stack.
 */

const signal = (channel: ChangeSignal['channel'], seq: number): ChangeSignal => ({
  v: 1, id: 'sig_1', channel, seq, projects: ['prj_001'], office: channel === 'office', kinds: ['tasks'], people: [], storyId: 'sty_1', actorId: 'usr_001',
});

type Sent = { text: string; values?: unknown[] };

/** A query that records each statement, and a notice line that the test can fire while a statement runs. */
function recordingQuery(o: { during?: (fire: (notice: DbNotice) => void) => void; fail?: Error } = {}) {
  const sent: Sent[] = [];
  const listeners = new Set<(notice: DbNotice) => void>();
  const fire = (notice: DbNotice) => listeners.forEach((listener) => listener(notice));
  const q = (async (text: string, values?: unknown[]) => {
    sent.push({ text, values });
    o.during?.(fire);
    if (o.fail) throw o.fail;
    return [];
  }) as Query;
  const listen: NoticeListen = (query, listener) => {
    expect(query).toBe(q);
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { q, sent, listen, fire, listening: () => listeners.size };
}

function recordingLog() {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const at = (level: string) => (message: string, fields?: LogFields) => lines.push({ level, message, fields });
  const log: Logger = { info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines };
}

describe('the Realtime sender', () => {
  it('sends every signal of a save in one statement: the channel as the private topic, the signal as the payload', async () => {
    const { q, sent, listen } = recordingQuery();
    const { log } = recordingLog();
    const signals = [signal('office', 7), signal('person:usr_005', 3)];
    await realtimeSender({ log, listen }).send(q, signals);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/realtime\.send\(/);
    expect(sent[0].text).toMatch(/, true\)/);
    expect(SIGNAL_EVENT).toBe('changed');
    expect(sent[0].values).toEqual([JSON.stringify(signals.map((s) => ({ topic: s.channel, payload: s }))), 'changed']);
  });

  it('sends nothing when the save has no signal', async () => {
    const { q, sent, listen } = recordingQuery();
    await realtimeSender({ log: recordingLog().log, listen }).send(q, []);
    expect(sent).toEqual([]);
  });

  it('treats a WARNING of realtime.send as a failed signal: it logs the warning, and the save goes on', async () => {
    const { q, listen } = recordingQuery({
      during: (fire) => fire({ severity: 'WARNING', message: 'WarnSendingBroadcastMessage: permission denied for table messages' }),
    });
    const { log, lines } = recordingLog();
    await expect(realtimeSender({ log, listen }).send(q, [signal('office', 7), signal('person:usr_005', 3)])).resolves.toBeUndefined();
    expect(lines).toEqual([{
      level: 'error',
      message: 'A change signal was not sent: realtime.send gave a warning. The screens reload at the next signal, which shows the gap.',
      fields: { failed: 1, channels: ['office', 'person:usr_005'], seqs: [7, 3], warnings: ['WarnSendingBroadcastMessage: permission denied for table messages'] },
    }]);
  });

  it('counts each warning once, and ignores a notice that is not a warning', async () => {
    const { q, listen } = recordingQuery({
      during: (fire) => {
        fire({ severity: 'NOTICE', message: 'just a notice' });
        fire({ severity: 'WARNING', message: 'WarnSendingBroadcastMessage: a' });
        fire({ severity: 'WARNING', message: 'WarnSendingBroadcastMessage: b' });
      },
    });
    const { log, lines } = recordingLog();
    await realtimeSender({ log, listen }).send(q, [signal('office', 1), signal('person:usr_002', 1)]);
    expect(lines[0].fields?.warnings).toEqual(['WarnSendingBroadcastMessage: a', 'WarnSendingBroadcastMessage: b']);
  });

  it('counts the warning of realtime.send by its message, also when the server translates the severity (lc_messages)', async () => {
    const { q, listen } = recordingQuery({
      during: (fire) => fire({ severity: 'WARNUNG', code: '01000', message: 'WarnSendingBroadcastMessage: Keine Berechtigung für Tabelle messages' }),
    });
    const { log, lines } = recordingLog();
    await realtimeSender({ log, listen }).send(q, [signal('office', 1)]);
    expect(lines.map((line) => line.level)).toEqual(['error']);
  });

  it('ignores a WARNING that does not come from realtime.send', async () => {
    const { q, listen } = recordingQuery({
      during: (fire) => fire({ severity: 'WARNING', code: '01000', message: 'there is no transaction in progress' }),
    });
    const { log, lines } = recordingLog();
    await realtimeSender({ log, listen }).send(q, [signal('office', 1)]);
    expect(lines).toEqual([]);
  });

  it('reports nothing for a send with no warning, and stops listening after its statement', async () => {
    const { q, listen, fire, listening } = recordingQuery();
    const { log, lines } = recordingLog();
    await realtimeSender({ log, listen }).send(q, [signal('office', 1)]);
    expect(listening()).toBe(0);
    fire({ severity: 'WARNING', message: 'a later statement' });
    expect(lines).toEqual([]);
  });

  it('lets an error of the statement fail the save, and stops listening', async () => {
    const { q, listen, listening } = recordingQuery({ fail: new Error('function realtime.send(jsonb, text, text, boolean) does not exist') });
    await expect(realtimeSender({ log: recordingLog().log, listen }).send(q, [signal('office', 1)])).rejects.toThrow('does not exist');
    expect(listening()).toBe(0);
  });

  it('listens through onNotice of pgDb by default, which hears nothing on a query that is not of pgDb', async () => {
    expect(onNotice((async () => []) as Query, () => undefined)).toBeUndefined();
    const { q, sent } = recordingQuery();
    await realtimeSender({ log: recordingLog().log }).send(q, [signal('office', 1)]);
    expect(sent).toHaveLength(1);
  });
});
