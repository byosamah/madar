// Counts the records of the sample office that the test copy seed writes (buildSeed, then testOffice).
import { buildSeed } from '../../../src/data/seed.ts';
const state = await buildSeed('2026-10-16', async () => undefined);
let total = 0;
const by: Record<string, number> = {};
for (const [c, v] of Object.entries(state)) {
  if (!v || typeof v !== 'object' || ['session', 'counters', 'counts'].includes(c)) continue;
  const n = c === 'settings' ? 1 : Object.keys(v).length;
  if (n > 0) by[c] = n;
  total += n;
}
console.log(JSON.stringify({ total, by }));
