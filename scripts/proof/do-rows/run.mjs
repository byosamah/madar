// The driver of the rows probe. It needs "wrangler dev --local --ip 127.0.0.1 --port 8799" in this folder. It loads one year of data into
// three local objects (the rowid form, the without-rowid form, and the rowid form with the indexes made after the load), then
// calls each measuring route and writes every answer to results.json beside this file.
import { writeFileSync } from 'node:fs';

const BASE = process.env.PROBE_URL ?? 'http://127.0.0.1:8799';
const PART = 5_000;

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`${path}: ${body.error ?? res.status}\n${body.stack ?? ''}`);
  return body;
}

async function loadAll(o, form) {
  const sizes = await get(`/sizes?o=${o}&profile=${profile(o)}`);
  const byTable = {};
  for (const [table, count] of Object.entries(sizes)) {
    byTable[table] = { rows: 0, rowsWritten: 0, rowsRead: 0, requests: 0 };
    for (let from = 0; from < count; from += PART) {
      const part = await get(`/load?o=${o}&form=${form}&profile=${profile(o)}&table=${table}&from=${from}&to=${from + PART}`);
      byTable[table].rows += part.rows;
      byTable[table].rowsWritten += part.rowsWritten;
      byTable[table].rowsRead += part.rowsRead;
      byTable[table].requests += 1;
    }
  }
  const server = await get(`/load-server?o=${o}`);
  const sum = (obj) => Object.values(obj).reduce((s, p) => ({ rows: s.rows + p.rows, rowsWritten: s.rowsWritten + p.rowsWritten, rowsRead: s.rowsRead + p.rowsRead }), { rows: 0, rowsWritten: 0, rowsRead: 0 });
  return { records: sum(byTable), serverRows: sum(server), byTable, server };
}

const profile = (o) => (o.startsWith('sample') ? 'sample' : 'year');
const only = process.argv[2];
const results = { at: new Date().toISOString() };
if (!only) {
  results.proof = await get('/proof?o=proof');
  results.matrix = await get('/matrix?o=matrix');
  console.log('matrix done');
}

const objects = [['year-rowid', 'rowid', '1'], ['year-norowid', 'norowid', '1'], ['year-late-indexes', 'rowid', '0'], ['sample-rowid', 'rowid', '1']];
for (const [o, form, indexes] of objects.filter(([name]) => !only || name === only)) {
  const r = {};
  await get(`/reset?o=${o}`);
  r.schema = await get(`/schema?o=${o}&form=${form}&indexes=${indexes}`);
  r.import = await loadAll(o, form);
  console.log(o, 'loaded', JSON.stringify(r.import.records), JSON.stringify(r.import.serverRows));
  if (indexes === '0') {
    r.indexBuild = await get(`/indexes?o=${o}`);
    r.stats = await get(`/stats?o=${o}`);
    results[o] = r;
    continue;
  }
  r.stats = await get(`/stats?o=${o}`);
  r.cold = await get(`/cold?o=${o}&form=${form}&profile=${profile(o)}`);
  r.reads = await get(`/reads?o=${o}&form=${form}&profile=${profile(o)}`);
  r.readsJsSort = await get(`/reads?o=${o}&form=${form}&profile=${profile(o)}&jsSort=1`);
  console.log(o, 'reads done');
  const picks = r.reads.picks;
  const w = { projectId: picks.project, conversationId: `cnv_${picks.project.slice(4)}`, markAllReadUsers: ['usr_012', 'usr_014'] };
  r.writes = await get(`/writes?o=${o}&form=${form}&profile=${profile(o)}&w=${encodeURIComponent(JSON.stringify(w))}`);
  r.export = await get(`/export?o=${o}`);
  results[o] = r;
  console.log(o, 'done');
}
writeFileSync(new URL(only ? `./results-${only}.json` : './results.json', import.meta.url), JSON.stringify(results, null, 1));
console.log('wrote results.json');
