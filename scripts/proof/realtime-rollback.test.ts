import { describe, expect, it } from 'vitest';
import { judge, type SpikeObservation } from './realtime-rollback.ts';

const DENIED = 'Unauthorized: You do not have permissions to read from this Channel topic: n1-spike-x';

/** A clean run: every send inserted its row before its end, the two committed marks arrive once, the two rolled-back marks never arrive and leave no row, the outsider and the stranger get an authorization refusal. */
function clean(): SpikeObservation {
  return {
    committed: ['c1', 'c2'],
    rolledBack: ['r1', 'r2'],
    received: ['c1', 'c2'],
    insertedInTransaction: { c1: 1, c2: 1, r1: 1, r2: 1 },
    storedRows: { c1: 1, c2: 1, r1: 0, r2: 0 },
    outsiderJoin: { outcome: 'refused', reason: DENIED },
    strangerJoin: { outcome: 'refused', reason: DENIED },
  };
}

describe('judge', () => {
  it('passes a clean run and prints one line for each check', () => {
    const result = judge(clean());
    expect(result.ok).toBe(true);
    expect(result.lines.every((line) => line.startsWith('ok: '))).toBe(true);
    expect(result.lines).toHaveLength(14);
  });

  it('fails when a rolled-back mark arrives on the channel', () => {
    const result = judge({ ...clean(), received: ['c1', 'r1', 'c2'] });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: rolled-back mark r1 arrived 1 time(s) on the channel; expected 0.');
  });

  it('fails when a committed mark does not arrive', () => {
    const result = judge({ ...clean(), received: ['c2'] });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: committed mark c1 arrived 0 time(s) on the channel; expected 1.');
  });

  it('fails when a committed mark arrives twice', () => {
    const result = judge({ ...clean(), received: ['c1', 'c1', 'c2'] });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: committed mark c1 arrived 2 time(s) on the channel; expected 1.');
  });

  it('fails when a rolled-back mark left a row in realtime.messages', () => {
    const result = judge({ ...clean(), storedRows: { c1: 1, c2: 1, r1: 1, r2: 0 } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: rolled-back mark r1 has 1 row(s) in realtime.messages; expected 0.');
  });

  it('fails when a committed mark has no row in realtime.messages', () => {
    const result = judge({ ...clean(), storedRows: { c1: 0, c2: 1, r1: 0, r2: 0 } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: committed mark c1 has 0 row(s) in realtime.messages; expected 1.');
  });

  it('fails when a client with no session joins the private channel', () => {
    const result = judge({ ...clean(), outsiderJoin: { outcome: 'joined' } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: a client with no session joined the private channel; expected a refusal.');
  });

  it('fails when the outsider check got no answer, so a missing refusal is visible', () => {
    const result = judge({ ...clean(), outsiderJoin: { outcome: 'timeout' } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: the join of a client with no session got no answer in time; expected a refusal.');
  });

  it('fails when a signed-in person whom the policy does not name joins, so the policy is the gate', () => {
    const result = judge({ ...clean(), strangerJoin: { outcome: 'joined' } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: a signed-in person whom the policy does not name joined the private channel; expected a refusal.');
  });

  it('fails when a rolled-back send inserted no row before its rollback, so a send that only warned never reads as a pass', () => {
    const result = judge({ ...clean(), insertedInTransaction: { c1: 1, c2: 1, r1: 0, r2: 1 } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: the send of mark r1 inserted 0 row(s) before its commit or rollback; expected 1.');
  });

  it('fails when a committed send inserted no row inside its transaction', () => {
    const result = judge({ ...clean(), insertedInTransaction: { c1: 1, c2: 0, r1: 1, r2: 1 } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: the send of mark c2 inserted 0 row(s) before its commit or rollback; expected 1.');
  });

  it('prints the reason of the server for each refusal', () => {
    const result = judge(clean());
    expect(result.lines).toContain(`ok: a client with no session could not join the private channel (server: ${DENIED}).`);
  });

  it('fails a refusal whose reason is not an authorization refusal, so a socket drop never reads as the policy', () => {
    const result = judge({ ...clean(), strangerJoin: { outcome: 'refused', reason: 'socket closed' } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      'FAIL: a signed-in person whom the policy does not name was refused for a reason that is not an authorization refusal (server: socket closed).',
    );
  });

  it('fails a refusal with no reason', () => {
    const result = judge({ ...clean(), outsiderJoin: { outcome: 'refused' } });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain(
      'FAIL: a client with no session was refused for a reason that is not an authorization refusal (server: no reason).',
    );
  });

  it('fails a run that sent nothing, so an empty run never reads as a pass', () => {
    const result = judge({ ...clean(), committed: [], rolledBack: [], received: [], insertedInTransaction: {}, storedRows: {} });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe('FAIL: the run needs at least one committed and one rolled-back mark.');
  });
});
