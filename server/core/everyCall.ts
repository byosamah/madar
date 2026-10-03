import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import type { State } from '../../src/api/store';
import { readSweep, writeSweep } from '../data/loaders/sweep';

/**
 * One input for every call that the server runs, on the sample office (task C3, "done when"): runCall must run each of them once
 * with no thrown error other than an ApiError. The reads and writes of the loader sweep (task C2) come first; the table below
 * gives the calls that the sweep does not name. A call may still refuse (a rule, a record that an earlier call removed): that
 * is an ApiError and counts as a clean run. runCall.test.ts runs the list in memory, server/it/runCall.it.test.ts on the database.
 */

const ADMIN = 'usr_001';

export type EveryCall = { name: SharedCallName | 'story.start'; input: unknown; actorId: string };

function rest(office: State): Record<string, [unknown, string?]> {
  const task = Object.values(office.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  const review = Object.values(office.tasks).find((t) => t.status === 'in_review');
  const entry = Object.values(office.tracker ?? {}).find((e) => e.closedAt === null);
  const lastEvent = Object.values(office.events).at(-1)!;
  const otherStage = Object.values(office.stages).find((s) => s.projectId === task.projectId && s.id !== task.stageId);
  return {
    'users.list': [{}],
    'users.get': [{ id: 'usr_002' }],
    'users.create': [{ name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' }],
    'users.update': [{ id: 'usr_003', patch: { discipline: 'Design' } }],
    'users.deactivate': [{ id: 'usr_007' }],
    'users.reactivate': [{ id: 'usr_007' }],
    'me.updateProfile': [{ name: 'Hala N.' }],
    'me.updatePreferences': [{ patch: { theme: 'dark' } }],
    'clients.list': [{}],
    'clients.create': [{ name: 'Acme Trading' }],
    'clients.update': [{ id: 'cli_001', patch: { name: 'Gulf Crest Co' } }],
    'settings.get': [{}],
    'settings.update': [{ patch: {} }],
    'deadlines.list': [{}],
    'projects.create': [{ name: 'A new villa', clientId: 'cli_001', leaderId: 'usr_002', stageTemplateId: 'stt_001' }],
    'projects.setLeader': [{ id: 'prj_001', leaderId: 'usr_005' }],
    'projects.addLink': [{ projectId: 'prj_001', kind: 'moodboard', label: 'Board', url: 'https://example.com/board' }],
    'projects.updateLink': [{ projectId: 'prj_001', linkId: 'lnk_001', patch: { label: 'Drawings' } }],
    'projects.removeLink': [{ projectId: 'prj_001', linkId: 'lnk_001' }],
    'projects.clearHealthOverride': [{ id: 'prj_001' }],
    'members.add': [{ projectId: 'prj_001', userId: 'usr_011' }],
    'members.addTeam': [{ projectId: 'prj_001', teamId: 'tm_001' }],
    'members.remove': [{ projectId: 'prj_001', userId: 'usr_008' }],
    'members.update': [{ projectId: 'prj_001', userId: 'usr_005', discipline: 'Interiors' }],
    'stages.replace': [{ projectId: 'prj_001', stages: [] }],
    'stages.setPrerequisites': [{ stageId: task.stageId, prerequisiteIds: [] }],
    'deadlines.create': [{ projectId: 'prj_001', name: 'Submit', date: '2026-11-01' }],
    'deadlines.delete': [{ id: Object.keys(office.deadlines)[1] }],
    'tasks.move': [{ id: task.id, status: 'in_progress', stageId: otherStage?.id ?? task.stageId }],
    'tasks.approve': [{ id: review?.id ?? task.id }],
    'events.undo': [{ eventId: lastEvent.id }],
    'notifications.updateSettings': [{ channel: 'email', trigger: 'mention', on: false }],
    'chats.openDirect': [{ userId: 'usr_002' }],
    'stageTemplates.list': [{}],
    'stageTemplates.save': [{ name: 'Short', stages: ['Concept', 'Design'] }],
    'stageTemplates.delete': [{ id: 'stt_002' }],
    'feedback.screenshot': [{ id: 'fbk_001', index: 0 }],
    'feedback.setStatus': [{ id: 'fbk_001', status: 'done' }],
    'taskTemplates.list': [{}],
    'taskTemplates.rename': [{ id: 'ttp_001', name: 'Renamed' }],
    'taskTemplates.delete': [{ id: 'ttp_002' }],
    'tracker.assignReply': [{ id: entry?.id ?? 'trk_001', userId: 'usr_002', dueDate: '2026-10-20' }],
    'payments.create': [{ projectId: 'prj_001', name: 'Second payment', amount: 1000, dueDate: '2026-11-01' }],
    'payments.update': [{ id: 'pay_002', patch: { name: 'Changed' } }],
    'teams.list': [{}],
    'teams.create': [{ name: 'Night team' }],
    'teams.update': [{ id: 'tm_001', patch: { name: 'Day team' } }],
    'teams.delete': [{ id: 'tm_004' }],
  };
}

/** Every shared call once, then story.start. The first item of the sweep for a name wins. */
export function everyCall(office: State): EveryCall[] {
  const first = new Map<string, EveryCall>();
  for (const [name, input, actorId] of [...readSweep(office), ...writeSweep(office)]) {
    if (!first.has(name)) first.set(name, { name, input, actorId });
  }
  const table = rest(office);
  const calls = (Object.keys(sharedCalls) as SharedCallName[]).map((name) => {
    const known = first.get(name);
    if (known) return known;
    const [input, actorId] = table[name] ?? [{}];
    return { name, input, actorId: actorId ?? ADMIN };
  });
  return [...calls, { name: 'story.start', input: {}, actorId: ADMIN }];
}
