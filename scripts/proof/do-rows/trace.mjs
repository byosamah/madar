// Prints the statements of the heavy calls, grouped by their first words, with the rows each group read.
const BASE = process.env.PROBE_URL ?? 'http://127.0.0.1:8799';
const o = process.argv[2] ?? 'year-rowid';
const form = process.argv[3] ?? 'rowid';
const specs = [
  ['chats.unreadCount', 'usr_001', {}], ['chats.unreadCount', 'usr_012', {}], ['tasks.list', 'usr_005', { filter: 'mine' }], ['tasks.list', 'usr_005', { filter: 'review_for_me' }],
  ['projects.list', 'usr_001', { filter: 'all' }], ['dashboard.get', 'usr_001', {}], ['notifications.list', 'usr_005', {}], ['search.query', 'usr_012', { text: 'zzqx' }],
  ['notifications.count', 'usr_014', {}], ['events.list', 'usr_012', { since: '2026-10-16T14:00:00.000+03:00', limit: 500 }], ['events.list', 'usr_012', {}],
];
for (const [name, actor, input] of specs) {
  const url = `${BASE}/trace?o=${o}&form=${form}&name=${name}&actor=${actor}&min=150&input=${encodeURIComponent(JSON.stringify(input))}`;
  const d = await (await fetch(url)).json();
  if (d.error) { console.log(name, d.error); continue; }
  const groups = new Map();
  for (const s of d.big) {
    const k = s.text.replace(/\s+/g, ' ').slice(0, 90);
    const g = groups.get(k) ?? { n: 0, read: 0, rows: 0 };
    g.n += 1; g.read += s.read; g.rows += s.rows;
    groups.set(k, g);
  }
  console.log(`== ${name} ${actor} ${JSON.stringify(input)}: ${d.rowsRead} rows read in ${d.statements} statements (${d.small} small statements read ${d.smallRead})`);
  for (const [k, g] of [...groups].sort((a, b) => b[1].read - a[1].read)) console.log(`   ${String(g.read).padStart(7)} read, ${String(g.rows).padStart(5)} rows out, ${g.n} x ${k}`);
}
