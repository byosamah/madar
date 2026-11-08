import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { daftraAccountsOf, daftraOf } from './client';
import { fakeDaftra } from './fakeDaftra';
import { daftraOffice, okOf } from './testOffice';
import { fakeDeps } from '../test/fakes/deps';

/**
 * Madar enterprises, plan D task 5 (design D6): the Daftra accounts belong to VADOs' Companies. Every other enterprise has no account,
 * so the sheet, the calls and the job step find none. The Daftra pairs sit in the config of the Worker, which has no per-enterprise key.
 */

const SERVER = join(__dirname, '..');
/** The files that may read config.daftra: the gate itself, and the Worker entry that hands the pairs to WorkerNet (which gates them by ent). */
const MAY_READ = new Set(['daftra/client.ts', 'entries/officeEntry.ts', 'daftra/fakeDaftra.ts', 'daftra/testOffice.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

function fakes() {
  const mazj = fakeDaftra({
    account: 'MAZJ',
    clients: [{ id: '842', name: 'Gulf Crest Holding', number: '12' }],
    invoices: [{ id: '1830', no: '1521945', clientId: '842', total: 320_000, date: '2026-10-10', created: '2026-10-10 09:00:00' }],
  });
  const vado = fakeDaftra({
    account: 'VADO',
    clients: [{ id: '55', name: 'Dune Line Developments' }],
    invoices: [{ id: '7', no: 'V-0001', clientId: '55', total: 120_000, date: '2026-10-20', created: '2026-10-20 09:00:00' }],
  });
  return { mazj, vado };
}

describe('every read of config.daftra', () => {
  it('goes through daftraOf and daftraAccountsOf: no other server file reads it', () => {
    const readers = sourceFiles(SERVER)
      .filter((file) => /config\??\.daftra\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SERVER, file));
    expect(readers.filter((file) => !MAY_READ.has(file))).toEqual([]);
    // The two files that must read it do.
    expect(readers).toEqual(expect.arrayContaining(['daftra/client.ts', 'entries/officeEntry.ts']));
  });
});

describe('the Daftra accounts of an enterprise', () => {
  it('daftraOf and daftraAccountsOf answer for ENT_VADO (also with no ent) and nothing for another enterprise', () => {
    const { mazj, vado } = fakes();
    const wired = { daftra: { MAZJ: mazj.config, VADO: vado.config } };
    for (const ent of [undefined, 'ent_001']) {
      const deps = fakeDeps({ config: { ...wired, ...(ent ? { ent } : {}) } });
      expect(daftraAccountsOf(deps)).toEqual(['MAZJ', 'VADO']);
      expect(daftraOf(deps, 'MAZJ')).toBeDefined();
    }
    for (const ent of ['ent_002', 'ent_010']) {
      const deps = fakeDeps({ config: { ...wired, ent } });
      expect(daftraAccountsOf(deps)).toEqual([]);
      expect(daftraOf(deps, 'MAZJ')).toBeUndefined();
      expect(daftraOf(deps, 'VADO')).toBeUndefined();
    }
  });

  it('daftra.status answers no accounts for ent_002', async () => {
    const { mazj, vado } = fakes();
    const t = await daftraOffice({ ent: 'ent_002', fakes: [mazj, vado] });
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toEqual({ ready: false, accounts: [] });
  });

  it('daftra.paymentLink for a project of the sub-company Vado refuses with daftra_not_ready (a copy with no account at all), and the Daftra fakes get no request', async () => {
    const { mazj, vado } = fakes();
    const t = await daftraOffice({ ent: 'ent_002', fakes: [mazj, vado] });
    expect(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_006' })).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'daftra_not_ready' } } });
    expect(mazj.requests).toEqual([]);
    expect(vado.requests).toEqual([]);
  });

  it('payments.linkInvoice, daftra.findClients and daftra.matchClient refuse with daftra_not_ready, and the fakes get no request', async () => {
    const { mazj, vado } = fakes();
    const t = await daftraOffice({ ent: 'ent_002', fakes: [mazj, vado] });
    const calls: [string, unknown][] = [
      ['payments.linkInvoice', { id: 'pay_003', invoiceId: '1830' }],
      ['daftra.findClients', { paymentId: 'pay_003', query: 'gulf' }],
      ['daftra.matchClient', { paymentId: 'pay_003', daftraClientId: '842' }],
    ];
    for (const [name, input] of calls) {
      const result = await t.call('usr_011', name, input);
      expect(result, name).toMatchObject({ ok: false, error: { code: 'invalid_input', details: { reason: 'daftra_not_ready' } } });
    }
    expect(mazj.requests).toEqual([]);
    expect(vado.requests).toEqual([]);
  });

  it('the job step returns skipped no_config and sends no request', async () => {
    const { mazj, vado } = fakes();
    const t = await daftraOffice({ ent: 'ent_002', fakes: [mazj, vado] });
    expect(await t.step()).toEqual({ skipped: 'no_config' });
    expect(mazj.requests).toEqual([]);
    expect(vado.requests).toEqual([]);
  });

  it('ent_001 still reads its accounts (regression, the same fakes)', async () => {
    const { mazj, vado } = fakes();
    const t = await daftraOffice({ ent: 'ent_001', fakes: [mazj, vado] });
    expect(okOf(await t.call('usr_011', 'daftra.status', {}))).toMatchObject({ ready: true, accounts: [{ name: 'MAZJ' }, { name: 'VADO' }] });
    expect(okOf(await t.call('usr_011', 'daftra.paymentLink', { paymentId: 'pay_006' }))).toMatchObject({ account: 'VADO' });
  });
});
