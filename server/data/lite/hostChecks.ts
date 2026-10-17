import { MAX_VALUES, NESTED_TRANSACTION, type SqlHost } from './host';

/**
 * The behaviour that both hosts must share. server/data/lite/host.test.ts runs it on node:sqlite, and
 * server/office/doHost.wd.test.ts runs it inside the office object on workerd. Both must give EXPECTED_CHECKS.
 */
export async function hostChecks(host: SqlHost): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const check = async (name: string, work: () => unknown): Promise<void> => {
    try {
      await work();
      out[name] = 'ok';
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      out[name] = text === NESTED_TRANSACTION ? 'nested' : text.startsWith('The SQLite host refuses') ? 'refused' : 'error';
    }
  };
  const list = (n: number) => Array.from({ length: n }, () => '?').join(', ');
  host.exec('create table if not exists checks (id text primary key, n integer)', []);
  await check('begin', () => host.exec('begin', []));
  await check('savepoint', () => host.exec('savepoint a', []));
  await check('attach', () => host.exec("attach database ':memory:' as x", []));
  await check('vacuum', () => host.exec('vacuum', []));
  await check('analyze', () => host.exec('analyze', []));
  await check('pragma', () => host.exec('pragma optimize', []));
  await check('version', () => host.exec('select sqlite_version() as v', []));
  await check('dollar', () => host.exec('select $1 as v', ['a']));
  await check('cast', () => host.exec("select '1'::integer as v", []));
  await check('values100', () => host.exec(`select ${list(MAX_VALUES)}`, Array(MAX_VALUES).fill(1)));
  await check('values101', () => host.exec(`select ${list(MAX_VALUES + 1)}`, Array(MAX_VALUES + 1).fill(1)));
  await check('rollback', async () => {
    await host
      .transaction(async () => {
        host.exec("insert into checks values ('a', 1)", []);
        await Promise.resolve();
        throw new Error('stop');
      })
      .catch(() => undefined);
    if (host.exec("select id from checks where id = 'a'", []).rows.length !== 0) throw new Error('The rollback kept a row.');
  });
  await check('commit', async () => {
    await host.transaction(async () => {
      host.exec("insert into checks values ('b', 2)", []);
      await Promise.resolve();
    });
    if (host.exec("select id from checks where id = 'b'", []).rows.length !== 1) throw new Error('The commit lost a row.');
  });
  await check('nested', () => host.transaction(() => host.transaction(async () => 1)));
  await check('numbered', () => {
    const [row] = host.exec('select ?2 as a, ?1 as b', ['one', 'two']).rows;
    if (row.a !== 'two' || row.b !== 'one') throw new Error('The numbered values went to the wrong places.');
  });
  await check('arrow', () => {
    const [row] = host.exec(`select '{"f":true}' ->> '$.f' as f`, []).rows;
    if (row.f !== 1) throw new Error(`->> gave ${String(row.f)} for JSON true.`);
  });
  // The office object binds a JS true as the text 'true', and node:sqlite refuses it (Task 1 of the exit plan). Both hosts
  // must bind true and false as 1 and 0, so a stored flag and a compare with it are the same on both. (node:sqlite binds every
  // JS number as a real, so typeof(?) is 'real' there; an integer column stores the value as an integer.)
  await check('boolean', () => {
    const [pair] = host.exec('select ? as t, ? as f', [true, false]).rows;
    if (pair.t !== 1 || pair.f !== 0) throw new Error(`A boolean bound as ${String(pair.t)} and ${String(pair.f)}.`);
    host.exec("insert into checks values ('flag', ?)", [true]);
    const [row] = host.exec("select n, typeof(n) as kind from checks where id = 'flag' and n = ?", [true]).rows;
    if (row?.n !== 1 || row.kind !== 'integer') throw new Error('A stored true is not the integer 1.');
  });
  return out;
}

export const EXPECTED_CHECKS: Readonly<Record<string, string>> = {
  begin: 'refused', savepoint: 'refused', attach: 'refused', vacuum: 'refused', analyze: 'refused', pragma: 'refused',
  version: 'refused', dollar: 'refused', cast: 'refused', values100: 'ok', values101: 'refused', rollback: 'ok', commit: 'ok',
  nested: 'nested', numbered: 'ok', arrow: 'ok', boolean: 'ok',
};
