import { describe, expect, it } from 'vitest';
import { agendaOrder } from './agenda';

type Health = 'on_track' | 'at_risk' | 'late';
const row = (id: string, health: Health = 'on_track', more: { staleDays?: number | null; client?: number; us?: number } = {}) => ({
  id,
  health,
  pause: more.staleDays === undefined ? null : { staleDays: more.staleDays },
  openLoops: { us: more.us ?? 0, client: more.client ?? 0 },
});

describe('agendaOrder', () => {
  it('puts the late projects first, then at risk, then stale or waiting for the client, then all others', () => {
    const rows = [
      row('calm'),
      row('risk-1', 'at_risk'),
      row('client', 'on_track', { client: 2 }),
      row('late-1', 'late'),
      row('stale', 'on_track', { staleDays: 40 }),
      row('risk-2', 'at_risk', { client: 1 }),
      row('ours', 'on_track', { us: 3 }),
      row('late-2', 'late', { client: 1 }),
      row('paused', 'on_track', { staleDays: null }),
    ];
    expect(agendaOrder(rows).map((r) => r.id)).toEqual(['late-1', 'late-2', 'risk-1', 'risk-2', 'client', 'stale', 'calm', 'ours', 'paused']);
  });

  it('keeps the input order inside a group, and leaves the input as it was', () => {
    const rows = [row('c', 'late'), row('a'), row('b', 'late'), row('d')];
    expect(agendaOrder(rows).map((r) => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(rows.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});
