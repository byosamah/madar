import { describe, expect, it } from 'vitest';
import { judge, type SpikeObservation } from './realtime-rollback.ts';

/** A clean run: the two committed marks arrive once, the two rolled-back marks never arrive and leave no row, the outsider cannot join. */
function clean(): SpikeObservation {
  return {
    committed: ['c1', 'c2'],
    rolledBack: ['r1', 'r2'],
    received: ['c1', 'c2'],
    storedRows: { c1: 1, c2: 1, r1: 0, r2: 0 },
    outsiderJoin: 'refused',
  };
}

describe('judge', () => {
  it('passes a clean run and prints one line for each check', () => {
    const result = judge(clean());
    expect(result.ok).toBe(true);
    expect(result.lines.every((line) => line.startsWith('ok: '))).toBe(true);
    expect(result.lines).toHaveLength(9);
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
    const result = judge({ ...clean(), outsiderJoin: 'joined' });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: a client with no session joined the private channel; expected a refusal.');
  });

  it('fails when the outsider check got no answer, so a missing refusal is visible', () => {
    const result = judge({ ...clean(), outsiderJoin: 'timeout' });
    expect(result.ok).toBe(false);
    expect(result.lines).toContain('FAIL: the join of a client with no session got no answer in time; expected a refusal.');
  });

  it('fails a run that sent nothing, so an empty run never reads as a pass', () => {
    const result = judge({ committed: [], rolledBack: [], received: [], storedRows: {}, outsiderJoin: 'refused' });
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toBe('FAIL: the run needs at least one committed and one rolled-back mark.');
  });
});
