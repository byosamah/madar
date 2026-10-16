// Measures three fixes on the loaded object year-rowid, one after the other: the sort in JavaScript in place of
// "order by ord", then ANALYZE, then author columns with covering indexes for the chat badge. Writes variants.json.
import { writeFileSync } from 'node:fs';
const BASE = process.env.PROBE_URL ?? 'http://127.0.0.1:8799';
const get = async (path) => {
  const body = await (await fetch(`${BASE}${path}`)).json();
  if (body.error) throw new Error(`${path}: ${body.error}`);
  return body;
};
const o = 'o=year-rowid&form=rowid';
const out = {};
out.jsSort = await get(`/reads?${o}&jsSort=1`);
out.analyzeCost = await get(`/analyze?${o}`);
out.jsSortAnalyze = await get(`/reads?${o}&jsSort=1`);
out.authorsCost = await get(`/authors?${o}`);
out.all = await get(`/reads?${o}&jsSort=1&authorCols=1`);
writeFileSync(new URL('./variants.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ analyze: out.analyzeCost, authors: out.authorsCost }));
