import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { NODE_TODAY, nodeOffice } from '../../server/office/test/nodeOffice';
import { exportOffice } from '../backup/officeExport';
import { compareImport, sourceDigests } from './compare';
import { importOffice } from './import';
import { partsOps } from './ops';
import { stateSource } from './source';

async function imported() {
  const seed = await buildSeed(NODE_TODAY, async () => undefined);
  const source = stateSource(seed, {
    signin: [{ id: 'a1', email: 'hala@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: false, user_id: 'usr_001' },
      { id: 'a2', email: 'gone@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: false, user_id: 'usr_999' }],
    server: { personSeq: [{ user_id: 'usr_001', seq: 3 }], jobRuns: [{ key: 'heartbeat', done_at: '2026-10-04T05:45:00.000Z' }] },
  });
  const t = await nodeOffice({ seed: false });
  await importOffice(partsOps(t.parts), source, { mode: 'empty' });
  const folder = mkdtempSync(join(tmpdir(), 'madar-compare-test-'));
  await exportOffice(partsOps(t.parts), { copy: 'local', folder });
  return { source, folder };
}

describe('the check of an import (scripts/office/compare.ts)', () => {
  it('finds no difference after a good import, with the sign-in link of a person who is not in the office left out', async () => {
    const { source, folder } = await imported();
    const out = compareImport(source, folder);
    expect(out.problems).toEqual([]);
    // The finish no longer adds the meters of the import to usage_month (owner, 2026-10-23): no note.
    expect(out.notes).toEqual([]);
    expect(Object.keys(sourceDigests(source))).toEqual(expect.arrayContaining(['tasks', 'events', 'counters', 'person_seq', 'office_seq', 'auth_users', 'job_runs']));
  });

  it('compares the Google and Daftra rows of the source with the object, and names the table of a lost or changed row', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const server = {
      googleConnections: [{ id: 'gcn_001', user_id: 'usr_002', sealed_token: 'v1.sealed', calendar_id: 'cal', state: 'ok' as const, connected_at: '2026-10-21T08:00:00.000Z', last_error: null, last_error_at: null, changed_at: '2026-10-22T09:30:00.000Z' }],
      googleEvents: [{ user_id: 'usr_002', meeting_id: 'mtg_001', event_id: 'e1', synced_rev: 4, synced_at: '2026-10-25T07:00:00.000Z' }],
      googleCalendars: [{ user_id: 'usr_002', calendar_id: 'cal', changed_at: '2026-10-21T08:00:00.000Z' }],
      daftraClients: [{ account: 'vado', client_id: 'cli_001', daftra_id: '5521', daftra_name: 'Al Noor', matched_by: 'usr_004', matched_at: '2026-10-27T11:00:00.000Z' }],
      daftraInvoices: [{ account: 'vado', id: '9001', daftra_client_id: '5521', no: '000412', total_halalas: 1_250_000, issued_on: '2026-10-20', created_at: '2026-10-20T06:00:00.000Z', payment_status: 2, paid_on: null, draft: true, seen_at: '2026-10-29T05:00:00.000Z' }],
    };
    const source = stateSource(seed, { server });
    const t = await nodeOffice({ seed: false });
    await importOffice(partsOps(t.parts), source, { mode: 'empty' });
    const folder = mkdtempSync(join(tmpdir(), 'madar-compare-test-'));
    await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    expect(compareImport(source, folder).problems).toEqual([]);
    expect(Object.keys(sourceDigests(source))).toEqual(expect.arrayContaining(['google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']));
    const changed = stateSource(seed, { server: { ...server, googleConnections: [{ ...server.googleConnections[0], sealed_token: 'v1.other' }], daftraClients: [] } });
    const problems = compareImport(changed, folder).problems.join(' ');
    expect(problems).toMatch(/google_connections: /);
    expect(problems).toMatch(/daftra_clients: /);
  });

  it('names the table when the office lost a record', async () => {
    const { source, folder } = await imported();
    const file = join(folder, 'tables', 'comments.ndjson');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').slice(1).join('\n'));
    expect(compareImport(source, folder).problems.join(' ')).toMatch(/^comments: /);
  });

  it('names office_seq when the number of the last office signal would not go on from the source', async () => {
    const { source, folder } = await imported();
    const shifted = { ...source, server: { ...source.server, officeSeq: source.server.officeSeq + 1 } };
    expect(compareImport(shifted, folder).problems.join(' ')).toContain('office_seq');
  });

  it('names auth_users when a sign-in row of the source is not in the office', async () => {
    const { source, folder } = await imported();
    const more = { ...source, signin: [...source.signin, { id: 'a3', email: 'new@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: false, user_id: null }] };
    expect(compareImport(more, folder).problems.join(' ')).toMatch(/^auth_users: /);
  });
});
