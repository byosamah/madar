/**
 * The CPU table behind the cost of an overview call (perf2 savetrip, 2026-10-22; src/api/remote/wire.ts, callCost and BATCH_BUDGET).
 * It builds the one-year office in memory (server/office/test/yearOffice.ts) and times, for an Admin and a Member, the scoped load
 * (the loader of the call on the memory source) and the handler of each overview call, then the heaviest requests that the budget
 * allows. Run it: node --import tsx scripts/proof/overview-cost.ts. The numbers are process CPU time in ms (median of 5 runs after
 * a warm-up). The database time of the real loaders is not in them. Run it alone: a busy Mac gives larger numbers.
 */
import { sharedCalls } from '../../src/api/sharedCalls';
import { loadFor, memorySource } from '../../server/data/loaders/index';
import { runOn } from '../../server/data/loaders/compare';
import { snapshotOf } from '../../server/data/officeCache';
import { setNow } from '../../src/lib/dates';
import { NOW } from '../../src/test/factories';
import { yearOffice } from '../../server/office/test/yearOffice';

setNow(NOW);
const office = await yearOffice('2026-10-04');
const users = Object.values(office.users) as any[];
const admin = users.find((u) => u.systemRole === 'admin' && u.kind === 'human');
const member = users.find((u) => u.systemRole === 'member' && u.kind === 'human' && u.active);
console.log('tasks', Object.keys(office.tasks).length, 'projects', Object.keys(office.projects).length, 'admin', admin?.id, 'member', member?.id);
const project = Object.keys(office.projects)[0];
const shapes: [string, string, unknown][] = [
  ['projects.list', 'default(active)', {}],
  ['projects.list', 'all', { status: 'all' }],
  ['projects.list', 'mine', { filter: 'mine' }],
  ['tasks.list', 'all (default)', {}],
  ['tasks.list', 'mine', { filter: 'mine' }],
  ['tasks.list', 'review_for_me', { filter: 'review_for_me' }],
  ['tasks.list', 'overdue', { filter: 'overdue' }],
  ['tasks.list', 'open all projects', { includeDone: false, activeProjectsOnly: false }],
  ['tasks.list', 'MINE_OPEN', { filter: 'mine', includeDone: false }],
  ['tasks.list', 'workOf', { workOf: member.id }],
  ['tasks.list', 'ownerId', { ownerId: member.id, includeDone: false, activeProjectsOnly: false }],
  ['tasks.list', 'no_lead', { filter: 'no_lead' }],
  ['events.list', 'projectId', { projectId: project, limit: 50 }],
  ['tasks.list', 'projectId (ref)', { projectId: project, activeProjectsOnly: false }],
  ['dashboard.get', 'default', {}],
  ['dashboard.get', 'all', { status: 'all' }],
  ['search.query', 'text', { text: 'plan' }],
  ['events.list', 'default', {}],
  ['events.list', 'limit 500', { limit: 500 }],
];

const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const mem = memorySource(office);
const snap = snapshotOf(office, 1);
const MODE = process.env.MODE ?? 'scoped';
for (const [who, user] of [['admin', admin], ['member', member]] as const) {
  for (const [name, label, input] of shapes) {
    const def = (sharedCalls as any)[name];
    const parsed = def.input.parse(input);
    const loads: number[] = []; const runs: number[] = [];
    let rows = 0;
    for (let i = 0; i < 6; i++) {
      const t0 = cpu();
      const loaded = await loadFor(name, parsed, { src: mem, office: snap, actorId: user.id, write: false, now: NOW } as any);
      const t1 = cpu();
      const out = runOn(loaded, name as any, parsed, user.id, { now: NOW });
      const t2 = cpu();
      if (i > 0) { loads.push(t1 - t0); runs.push(t2 - t1); }
      rows = Array.isArray((out as any).output) ? (out as any).output.length : ((out as any).error ? -1 : 0);
    }
    const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    console.log(who.padEnd(7), name.padEnd(14), label.padEnd(20), 'load', med(loads).toFixed(1).padStart(7), 'run', med(runs).toFixed(1).padStart(7), 'total', (med(loads) + med(runs)).toFixed(1).padStart(7), 'ms rows', rows);
  }
}

console.log('--- worst requests the budget allows (sum of load + run, sequential)');
const combos: [string, [string, unknown][]][] = [
  ['projects.list(all)+dashboard.get', [['projects.list', { status: 'all' }], ['dashboard.get', {}]]],
  ['events.list(500)+dashboard.get+5 cheap lists', [['events.list', { limit: 500 }], ['dashboard.get', {}], ...[0, 1, 2, 3, 4].map((): [string, unknown] => ['tasks.list', { filter: 'mine' }])]],
  ['search.query x3', [['search.query', { text: 'plan' }], ['search.query', { text: 'villa' }], ['search.query', { text: 'ali' }]]],
  ['7 x tasks.list(all)', [0, 1, 2, 3, 4, 5, 6].map((): [string, unknown] => ['tasks.list', {}])],
  ['Home save: projects.list+mine+review', [['projects.list', {}], ['tasks.list', { filter: 'mine' }], ['tasks.list', { filter: 'review_for_me' }]]],
];
for (const [who, user] of [['admin', admin], ['member', member]] as const) {
  for (const [label, list] of combos) {
    const totals: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t0 = cpu();
      for (const [name, input] of list) {
        const def = (sharedCalls as any)[name];
        const parsed = def.input.parse(input);
        const loaded = await loadFor(name, parsed, { src: mem, office: snap, actorId: user.id, write: false, now: NOW } as any);
        runOn(loaded, name as any, parsed, user.id, { now: NOW });
      }
      if (i > 0) totals.push(cpu() - t0);
    }
    totals.sort((a, b) => a - b);
    console.log(who.padEnd(7), label.padEnd(46), 'median', totals[1].toFixed(0).padStart(5), 'ms');
  }
}
