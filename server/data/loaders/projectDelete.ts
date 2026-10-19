import type { Event, Meeting, Task, Update } from '../../../src/api/contract/entities';
import type { Load } from './build';

/**
 * The project delete loader (plan 4.6): every row of P, the comments and notices that point at its tasks and posts (also the ones
 * deleted earlier, which a delete event names), at P, or at its chat, and the chat with its messages and read marks (AM 7.2, A2).
 * The meetings of P go with it, and the notices that point at them (fbk_022).
 */
export async function projectsDelete(L: Load, input: Record<string, unknown>): Promise<void> {
  const projectId = typeof input.id === 'string' ? input.id : '';
  const inP = [{ col: 'project_id', in: [projectId] }] as const;
  const tasks = (await L.select({ c: 'tasks', where: inP })) as Task[];
  const updates = (await L.select({ c: 'updates', where: inP })) as Update[];
  for (const c of ['files', 'payments', 'tracker'] as const) await L.select({ c, where: inP });
  const deletes = (await L.select({ c: 'events', where: [...inP, { field: 'after', null: true }, { col: 'target_type', in: ['task', 'update'] }] })) as Event[];
  const taskIds = [...tasks.map((t) => t.id), ...deletes.filter((e) => e.targetType === 'task').map((e) => e.targetId)];
  const updateIds = [...updates.map((u) => u.id), ...deletes.filter((e) => e.targetType === 'update').map((e) => e.targetId)];
  await L.select({ c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: taskIds }] });
  await L.select({ c: 'comments', where: [{ col: 'target_type', eq: 'update' }, { col: 'target_id', in: updateIds }] });
  const rooms = Object.values(L.office.conversations).filter((c) => c.kind === 'project' && c.projectId === projectId).map((c) => c.id);
  await L.select({ c: 'messages', where: [{ col: 'conversation_id', in: rooms }] });
  await L.select({ c: 'chatReads', where: [{ col: 'conversation_id', in: rooms }] });
  const meetings = (await L.select({ c: 'meetings', where: inP })) as Meeting[];
  for (const [targetType, ids] of [['project', [projectId]], ['task', taskIds], ['update', updateIds], ['chat', rooms], ['meeting', meetings.map((m) => m.id)]] as const) {
    await L.select({ c: 'notifications', where: [{ col: 'target_type', eq: targetType }, { col: 'target_id', in: [...ids] }] });
  }
}
