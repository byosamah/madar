import { sharedCalls, type SharedCallName } from '../../src/api/sharedCalls';
import type { State } from '../../src/api/store';
import { readSweep, writeSweep } from '../data/loaders/sweep';

/**
 * One input for every call that the server runs, on the sample office (task C3, "done when"): runCall must run each of them once
 * with no thrown error other than an ApiError. The reads and writes of the loader sweep (task C2) come first; the table below
 * gives the calls that the sweep does not name. Every call that removes a record runs after all the other calls, so no call
 * refuses only because an earlier entry removed its record. tasks.delete and then projects.delete run last of all, after the
 * calls that remove a record inside them (a comment, a file, an update).
 *
 * A few calls still refuse by a rule of the sample office after the calls before them. EXPECTED_REFUSALS names each one with its
 * code, and the tests assert that no other call refuses. runCall.test.ts runs the list in memory, server/it/runCall.it.test.ts
 * on the database.
 */

const ADMIN = 'usr_001';

export type EveryCall = { name: SharedCallName | 'story.start'; input: unknown; actorId: string };

/** The calls that refuse on this list, with their code. Every other call must answer ok. */
export const EXPECTED_REFUSALS: Readonly<Record<string, string>> = {
  // The file hooks of track F: the sweep's upload ID names no upload intent, and the report that feedback.send makes on the
  // list has no screenshot.
  'files.upload': 'not_found',
  'feedback.screenshot': 'not_found',
  // Rules of the office after the earlier entries of the list (the sweep inputs of task C2). tasks.update is ok: projects.setLeader
  // gives prj_001 a new leader first, but the old leader made the task and stays on the team, so he still changes it (owner, 2026-10-07).
  'tasks.sendBack': 'invalid_input',
  // Every task of the sample office has a lead, so taking one is refused (has_lead). loaders.test.ts takes a task with no lead.
  'tasks.take': 'invalid_input',
  'events.undoStory': 'forbidden',
  'payments.markReceived': 'invalid_input',
  // The sample office has no group, and cnv_001 is a project chat: a group change of it is refused as not a group.
  'chats.updateGroup': 'invalid_input',
  'chats.leaveGroup': 'invalid_input',
};

/** A call that removes a record: it runs after every other call. */
const REMOVES = /\.(delete|remove|removeLink|deactivate)$/;

function rest(office: State): Record<string, [unknown, string?]> {
  const task = Object.values(office.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
  const review = Object.values(office.tasks).find((t) => t.status === 'in_review');
  const otherStage = Object.values(office.stages).find((s) => s.projectId === task.projectId && s.id !== task.stageId);
  const stages = Object.values(office.stages).filter((s) => s.projectId === 'prj_001');
  const waiting = Object.values(office.tracker ?? {}).find((e) => e.closedAt === null && e.waiting === 'us');
  const ownEvent = Object.values(office.events).filter((e) => e.actingForId === ADMIN && e.undoneBy === null).at(-1);
  const plan = Object.values(office.projectTemplates ?? {}).find((t) => t.tasks.length > 0)!;
  return {
    'users.list': [{}],
    'users.get': [{ id: 'usr_002' }],
    'users.create': [{ name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' }],
    'users.update': [{ id: 'usr_003', patch: { discipline: 'Design' } }],
    'users.deactivate': [{ id: 'usr_007' }],
    'users.reactivate': [{ id: 'usr_007' }],
    // A remover, so it runs after users.deactivate: usr_007 is off then, and only a turned-off person can be removed (owner, 2026-10-12).
    'users.remove': [{ id: 'usr_007' }],
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
    // members.add puts usr_011 on prj_001 first; that member has no open task, so the rule lets them go.
    'members.remove': [{ projectId: 'prj_001', userId: 'usr_011' }],
    'members.update': [{ projectId: 'prj_001', userId: 'usr_005', discipline: 'Interiors' }],
    'stages.replace': [{ projectId: 'prj_001', stages: stages.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate ?? null, endDate: s.endDate ?? null })) }],
    'stages.setPrerequisites': [{ stageId: task.stageId, prerequisiteIds: [] }],
    'deadlines.create': [{ projectId: 'prj_001', name: 'Submit', date: '2026-11-01' }],
    'deadlines.delete': [{ id: Object.keys(office.deadlines)[1] }],
    'tasks.move': [{ id: task.id, status: 'in_progress', stageId: otherStage?.id ?? task.stageId }],
    'tasks.approve': [{ id: review?.id ?? task.id }],
    'tasks.take': [{ taskId: task.id }],
    'tasks.arrange': [{ ids: [task.id] }],
    'events.undo': [{ eventId: ownEvent?.id ?? 'evt_001' }],
    'notifications.updateSettings': [{ channel: 'email', trigger: 'mention', on: false }],
    'chats.openDirect': [{ userId: 'usr_002' }],
    'chats.createGroup': [{ name: 'Design review', memberIds: ['usr_002', 'usr_003'] }],
    'chats.updateGroup': [{ conversationId: 'cnv_001', name: 'Renamed' }],
    'chats.leaveGroup': [{ conversationId: 'cnv_001' }],
    'chats.archive': [{ conversationId: 'cnv_001', archived: true }],
    'stageTemplates.list': [{}],
    'stageTemplates.save': [{ name: 'Short', stages: ['Concept', 'Design'] }],
    'stageTemplates.delete': [{ id: 'stt_002' }],
    'projectTemplates.list': [{}],
    'projectTemplates.save': [{
      name: 'Short villa', roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
      stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
      tasks: [{ id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 5, flexible: true }],
    }],
    'projectTemplates.delete': [{ id: 'ptp_002' }],
    // The link of prj_001 (fbk_008 item 4): no pick, so every part of the template is dropped. It runs before the removers.
    'projectTemplates.matchPlan': [{ projectId: 'prj_001', templateId: plan.id }],
    'projectTemplates.link': [{ projectId: 'prj_001', templateId: plan.id, stageMatches: {}, taskMatches: {}, rolePeople: {} }],
    // The update of prj_001 (fbk_008 item 4), after its link: the link dropped every part, so the Admin brings them back.
    'projectTemplates.usage': [{ templateId: plan.id }],
    'projectTemplates.syncPlan': [{ templateId: plan.id, projectIds: ['prj_001'] }],
    'projectTemplates.syncApply': [{
      templateId: plan.id, projectId: 'prj_001',
      choices: { add: false, bringBack: true, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false },
    }],
    'push.mine': [{}],
    'push.register': [{ endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token', label: 'Chrome on Mac' }],
    'push.remove': [{ endpoint: 'https://fcm.googleapis.com/fcm/send/sample-token' }],
    'feedback.screenshot': [{ id: 'fbk_001', index: 0 }],
    'feedback.setStatus': [{ id: 'fbk_001', status: 'done' }],
    'taskTemplates.list': [{}],
    'taskTemplates.rename': [{ id: 'ttp_001', name: 'Renamed' }],
    'taskTemplates.delete': [{ id: 'ttp_002' }],
    'tracker.assignReply': [{ id: waiting?.id ?? 'trk_001', userId: 'usr_002', dueDate: '2026-10-20' }],
    'payments.create': [{ projectId: 'prj_001', name: 'Second payment', amount: 1000, dueDate: '2026-11-01' }],
    'payments.update': [{ id: 'pay_002', patch: { name: 'Changed' } }],
    'teams.list': [{}],
    'teams.create': [{ name: 'Night team' }],
    'teams.update': [{ id: 'tm_001', patch: { name: 'Day team' } }],
    'teams.delete': [{ id: 'tm_004' }],
    // The save runs before the delete (a remove runs last), so it makes sub_001 for the delete.
    'subCompanies.list': [{}],
    'subCompanies.save': [{ name: 'Sample company', nameAr: 'شركة تجريبية', logo: null }],
    'subCompanies.delete': [{ id: 'sub_001' }],
  };
}

/** Every shared call once, then story.start, then the calls that remove a record (tasks.delete and projects.delete last). The first item of the sweep for a name wins. */
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
  const parents = ['tasks.delete', 'projects.delete'];
  const removes = calls.filter((c) => REMOVES.test(c.name) && !parents.includes(c.name));
  const last = parents.flatMap((name) => calls.filter((c) => c.name === name));
  return [...calls.filter((c) => !REMOVES.test(c.name)), { name: 'story.start', input: {}, actorId: ADMIN }, ...removes, ...last];
}
