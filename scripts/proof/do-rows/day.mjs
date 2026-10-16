// The day budget from the measured rows (results.json, variants.json, results-sample-rowid.json). It prints day.json.
// Production holds one year of data (the year-rowid object); the test copy holds its sample office (sample-rowid).
import { readFileSync, writeFileSync } from 'node:fs';

const load = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const results = load('./results.json');
const variants = load('./variants.json');
const sample = load('./results-sample-rowid.json')['sample-rowid'];
const year = results['year-rowid'];

/** Who makes the calls: the Admin 20%, management 10%, a leader 30%, a member 30%, a person who never clears the bell 10%. */
const WHO = { usr_001: 0.2, usr_002: 0.1, usr_005: 0.3, usr_012: 0.3, usr_014: 0.1 };

/**
 * The call mix of a work day, for each 100 calls: 80 reads (most of them the two badges and the Home lists) and 20 writes.
 * Reads that only use the office lists (session.get, users, settings, deadlines, templates) read 0 rows.
 */
const READS = [
  ['chats.unreadCount', 15], ['notifications.count', 15], ['session.get', 8], ['office only', 6],
  ['tasks.list mine', 4], ['tasks.list review_for_me', 4], ['projects.list (Home)', 3], ['projects.list (Projects screen, active)', 3], ['dashboard.get', 2],
  ['projects.get', 3], ['tasks.get (busiest task)', 3], ['updates.list', 1], ['files.list', 1], ['comments.list (busiest thread)', 1],
  ['events.list', 3], ['notifications.list', 3], ['chats.list', 1.5], ['chats.messages (busiest chat)', 1.5],
  ['search.query common word', 1], ['search.query no match', 1],
];
const WRITES = [
  ['tasks.complete (to review)', 4], ['tasks.update (title and due date, with reason)', 4], ['comments.create (with a mention)', 5], ['chats.send', 4],
  ['projects.update (an office record)', 1], ['notifications.markAllRead (usr_012)', 2],
];

/** The rows read of one call name, weighted by WHO when the call ran for each person, else its one value. */
function perCall(calls, name, override = {}) {
  if (name === 'office only') return 0;
  if (override[name] !== undefined) return override[name];
  const runs = calls.filter((c) => c.name === name);
  if (runs.length === 0) throw new Error(`no call ${name}`);
  if (runs.length === 1) return runs[0].rowsRead;
  // dashboard.get ran only for the Admin and management: share their weights.
  const weights = runs.map((c) => WHO[c.actorId] ?? 0);
  const total = weights.reduce((a, b) => a + b, 0);
  return runs.reduce((sum, c, i) => sum + c.rowsRead * (weights[i] / total), 0);
}

function mix(calls, writes, override = {}) {
  let read = 0;
  let written = 0;
  let n = 0;
  const parts = {};
  for (const [name, share] of READS) {
    const r = perCall(calls, name, override) * share;
    parts[name] = Math.round(r / 100);
    read += r;
    n += share;
  }
  for (const [name, share] of WRITES) {
    const w = writes[name];
    read += w.total.rowsRead * share;
    written += w.total.rowsWritten * share;
    n += share;
  }
  if (Math.abs(n - 100) > 1e-9) throw new Error(`the mix holds ${n} calls, not 100`);
  return { readPerCall: read / 100, writtenPerCall: written / 100, readParts: parts };
}

/** The 15-minute job: the trigger loader, its dedupe lookup, the outbox and cleanup reads. */
const jobRead = (jobs) => jobs.loader.rowsRead + jobs.dedupe.rowsRead + jobs.outbox.rowsRead + jobs.cleanup.rowsRead;

// The fixed form: the sort in JavaScript, author columns for the chat badge, and a pinned plan for events.list since (the
// without-rowid object chose events_created_c: 653 rows).
const fixedCalls = variants.jsSort.calls;
const fixedOverride = {};
for (const name of ['chats.unreadCount', 'chats.list']) fixedOverride[name] = perCall(variants.all.calls, name);

const LIMIT = { read: 5_000_000, written: 100_000 };
const WAKES = 60; // one cold wake every 10 minutes in 10 work hours
const JOBS = 96;

function copy(label, m, o) {
  const callsRead = m.readPerCall * o.calls;
  const callsWritten = m.writtenPerCall * o.calls;
  const wakeRead = WAKES * o.wake;
  const jobsRead = JOBS * o.job;
  // Each request adds 1 row to usage_month (server/usage/meter.ts); each write later loses its story, key and outbox rows in the
  // cleanup (1 row written for each delete, about 4 for each write); the job writes the reminder notices of the day.
  const requests = o.calls / o.callsPerRequest;
  const cleanup = 4 * o.calls * 0.2;
  const reminders = o.reminders * 40;
  const read = callsRead + wakeRead + jobsRead + o.export;
  const written = callsWritten + requests + cleanup + reminders;
  return {
    label, calls: o.calls, readPerCall: Math.round(m.readPerCall), writtenPerCall: Math.round(m.writtenPerCall * 10) / 10,
    rowsRead: { calls: Math.round(callsRead), wakes: wakeRead, jobs: jobsRead, export: o.export, total: Math.round(read) },
    rowsWritten: { calls: Math.round(callsWritten), usage: Math.round(requests), cleanup: Math.round(cleanup), reminders, total: Math.round(written) },
  };
}

const prodPorted = mix(year.reads.calls, year.writes.changedColumns);
const prodFixed = mix(fixedCalls, year.writes.changedColumns, fixedOverride);
const testPorted = mix(sample.reads.calls, sample.writes.changedColumns);
const testFixed = mix(sample.readsJsSort.calls, sample.writes.changedColumns);

const prodBase = { wake: year.cold.fromTables.rowsRead, job: jobRead(year.reads.jobs), export: year.export.rowsRead, reminders: 20 };
const testBase = { wake: sample.cold.fromTables.rowsRead, job: jobRead(sample.reads.jobs), export: sample.export.rowsRead, reminders: 5 };
const snap = (b) => ({ ...b, wake: 1 });

function day(label, prodMix, testMix, o) {
  const prod = copy('production (one year of data)', prodMix, { ...o.prod, calls: 422 * o.factor, callsPerRequest: o.factor });
  const test = copy('test copy (sample office)', testMix, { ...o.test, calls: 2000 * o.factor, callsPerRequest: o.factor });
  const read = prod.rowsRead.total + test.rowsRead.total;
  const written = prod.rowsWritten.total + test.rowsWritten.total;
  return { label, prod, test, rowsRead: read, rowsWritten: written, readShare: Math.round((read / LIMIT.read) * 1000) / 10, writtenShare: Math.round((written / LIMIT.written) * 1000) / 10 };
}

const out = {
  mixPerCall: {
    production: { ported: prodPorted, fixed: prodFixed },
    testCopy: { ported: testPorted, fixed: testFixed },
  },
  days: [
    day('A. as ported, 422 and 2,000 are calls, cold wakes read the tables', prodPorted, testPorted, { factor: 1, prod: prodBase, test: testBase }),
    day('B. as ported, with the snapshot (a wake reads 1 row)', prodPorted, testPorted, { factor: 1, prod: snap(prodBase), test: snap(testBase) }),
    day('C. as ported, snapshot, 422 and 2,000 are requests of 2.5 calls each', prodPorted, testPorted, { factor: 2.5, prod: snap(prodBase), test: snap(testBase) }),
    day('D. fixed reads, snapshot, 422 and 2,000 are calls', prodFixed, testFixed, { factor: 1, prod: snap(prodBase), test: snap(testBase) }),
    day('E. fixed reads, snapshot, 2.5 calls a request', prodFixed, testFixed, { factor: 2.5, prod: snap(prodBase), test: snap(testBase) }),
  ],
};

// The deploy suite day on the test copy: about 1,700 calls, 35 in 100 of them writes, and one seed before it.
const suiteCalls = 1700;
const seedWritten = sample.import.records.rowsWritten + sample.import.records.rows + 3 * 300; // the inserts, a delete of each old row, office_deletes rows
out.deploySuiteDay = {
  calls: suiteCalls,
  rowsRead: Math.round(suiteCalls * 0.65 * (testPorted.readPerCall) + suiteCalls * 0.35 * 80),
  rowsWritten: Math.round(suiteCalls * 0.35 * 38 + suiteCalls / 2.5 + suiteCalls * 0.35 * 4 + seedWritten),
  seedRowsWritten: seedWritten,
};
out.import = {
  yearRecords: year.import.records.rows,
  rowsWrittenRowid: year.import.records.rowsWritten + year.import.serverRows.rowsWritten,
  rowsWrittenNoRowid: results['year-norowid'].import.records.rowsWritten + results['year-norowid'].import.serverRows.rowsWritten,
  rowsWrittenLateIndexes: results['year-late-indexes'].import.records.rowsWritten + results['year-late-indexes'].import.serverRows.rowsWritten + results['year-late-indexes'].indexBuild.total.rowsWritten,
  perRecord: Math.round((year.import.records.rowsWritten / year.import.records.rows) * 100) / 100,
  freeDays: Math.round(((year.import.records.rowsWritten + year.import.serverRows.rowsWritten) / LIMIT.written) * 10) / 10,
};
writeFileSync(new URL('./day.json', import.meta.url), JSON.stringify(out, null, 1));
for (const d of out.days) {
  console.log(`${d.label}\n  read ${d.rowsRead.toLocaleString()} (${d.readShare}% of 5M), written ${d.rowsWritten.toLocaleString()} (${d.writtenShare}% of 100k)`);
  console.log(`  production: ${JSON.stringify(d.prod.rowsRead)} ${JSON.stringify(d.prod.rowsWritten)} per call ${d.prod.readPerCall}/${d.prod.writtenPerCall}`);
  console.log(`  test copy:  ${JSON.stringify(d.test.rowsRead)} ${JSON.stringify(d.test.rowsWritten)} per call ${d.test.readPerCall}/${d.test.writtenPerCall}`);
}
console.log('mix parts production ported', JSON.stringify(prodPorted.readParts));
console.log('mix parts production fixed', JSON.stringify(prodFixed.readParts));
console.log('deploy suite day', JSON.stringify(out.deploySuiteDay));
console.log('import', JSON.stringify(out.import));
