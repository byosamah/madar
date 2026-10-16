// Runs typical writes on the real handlers in memory and counts the records each one saves, by collection.
// It changes no repository file. Run: node --import tsx scripts/proof/do-rows/writes-diff.ts (from the repository folder).
import { makeWorld, makeTask, makeUser, testApi, NOW } from '../../../src/test/factories.ts';
import { taskCalls } from '../../../src/api/handlers/tasks.ts';
import { contentCalls } from '../../../src/api/handlers/content.ts';
import { chatCalls } from '../../../src/api/handlers/chats.ts';
import { notificationCalls } from '../../../src/api/handlers/notifications.ts';
import { memberKey } from '../../../src/api/store.ts';
import { setNow } from '../../../src/lib/dates.ts';

setNow(NOW);
const state = makeWorld();
state.users.usr_006 = makeUser('usr_006', { name: 'Huda Helper' });
state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
state.members[memberKey('prj_001', 'usr_004')] = { projectId: 'prj_001', userId: 'usr_004', discipline: 'Architect' };
state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', helperIds: ['usr_006'], needsReview: true, dueDate: '2026-10-05' });
state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Roof plan', ownerId: 'usr_006', helperIds: ['usr_003'], needsReview: false });
state.conversations.cnv_001 = { id: 'cnv_001', kind: 'project', projectId: 'prj_001', memberIds: [], createdAt: '2026-09-01T09:00:00.000+03:00' } as never;
const t = testApi({ ...taskCalls, ...contentCalls, ...chatCalls, ...notificationCalls }, state);

function snap() {
  return JSON.parse(JSON.stringify(t.store.state));
}
function diff(before: any, after: any) {
  const out: Record<string, { ins: number; upd: number; del: number }> = {};
  for (const c of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (['session', 'version', 'seededOn', 'counts'].includes(c)) continue;
    const a = before[c] ?? {}; const b = after[c] ?? {};
    if (c === 'counters' || c === 'settings') {
      const changed = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      if (changed.length) out[c] = { ins: 0, upd: changed.length, del: 0, keys: changed } as never;
      continue;
    }
    let ins = 0, upd = 0, del = 0;
    for (const k of Object.keys(b)) if (!(k in a)) ins++; else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) upd++;
    for (const k of Object.keys(a)) if (!(k in b)) del++;
    if (ins || upd || del) out[c] = { ins, upd, del };
  }
  return out;
}
async function measure(label: string, as: string, name: string, input: unknown) {
  t.as(as);
  const before = snap();
  try { await (t.api as any).call(name, input); } catch (e) { console.log(label, 'FAILED', (e as Error).message); return; }
  console.log(JSON.stringify({ label, call: name, saved: diff(before, snap()) }));
}
await measure('update title and due date', 'usr_002', 'tasks.update', { id: 'tsk_001', patch: { title: 'Ground floor plan v2', dueDate: '2026-10-08' }, dateReason: 'Client asked' });
await measure('complete (to review)', 'usr_003', 'tasks.complete', { id: 'tsk_001' });
await measure('approve', 'usr_002', 'tasks.approve', { id: 'tsk_001' });
await measure('complete (no review)', 'usr_006', 'tasks.complete', { id: 'tsk_002' });
await measure('comment with mention', 'usr_003', 'comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Please check @[Faisal Leader](usr_002)' });
await measure('chat message', 'usr_003', 'chats.send', { conversationId: 'cnv_001', body: 'Site visit at 10' });
await measure('notifications.markAllRead', 'usr_002', 'notifications.markAllRead', {});
