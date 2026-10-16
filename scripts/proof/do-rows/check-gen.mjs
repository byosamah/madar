// Checks the generator in Node and prints the shape of the year of data.
import * as g from './src/gen.js';
const t0 = Date.now();
const L = g.layout();
const office = g.officeRows(L);
const sizes = { ...Object.fromEntries(Object.entries(office).map(([k, v]) => [k, v.length])), tasks: L.tasks.length, chat_reads: g.chatReadsAll(L).length };
for (const [k, v] of Object.entries(g.COUNTS)) if (k !== 'officeTasks') sizes[k] = v;
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
const officeTotal = Object.values(office).reduce((a, v) => a + v.length, 0);
const status = {};
for (const p of L.projects) status[p.status] = (status[p.status] ?? 0) + 1;
const active = new Set(L.projects.filter((p) => p.status === 'active').map((p) => p.id));
const tasksActive = L.tasks.filter((t) => active.has(t.projectId)).length;
const unread = {};
let bytes = 0;
for (let i = 0; i < g.COUNTS.notifications; i++) { const n = g.notificationAt(L, i); if (!n.doc.read) unread[n.doc.userId] = (unread[n.doc.userId] ?? 0) + 1; bytes += JSON.stringify(n.doc).length; }
const perTask = {};
let evBytes = 0;
for (let i = 0; i < g.COUNTS.events; i++) { const e = g.eventAt(L, i); evBytes += JSON.stringify(e.doc).length; if (e.doc.targetType === 'task') perTask[e.doc.targetId] = (perTask[e.doc.targetId] ?? 0) + 1; }
const counts = Object.values(perTask).sort((a, b) => b - a);
for (let i = 0; i < 20; i++) g.commentAt(L, i), g.messageAt(L, i), g.fileAt(L, i), g.trackerAt(L, i), g.paymentAt(L, i), g.updateAt(L, i);
console.log(JSON.stringify({ ms: Date.now() - t0, total, officeTotal, sizes, projectStatus: status, tasksOfActiveProjects: tasksActive, officeTasks: L.tasks.filter((t) => !t.projectId).length,
  unreadByUser: unread, avgNoticeBytes: Math.round(bytes / g.COUNTS.notifications), avgEventBytes: Math.round(evBytes / g.COUNTS.events),
  eventsPerTask: { tasksWithEvents: counts.length, max: counts[0], median: counts[Math.floor(counts.length / 2)] } }, null, 1));
