import type { z } from 'zod';
import type { SharedCallName, SharedCalls } from '../../../src/api/sharedCalls';
import type { State } from '../../../src/api/store';
import { Load, type LoadCtx } from './build';
import { chatsAll, chatsArchive, chatsMarkRead, chatsMessages, chatsUnread, chatsWaiting } from './chat';
import { inboxCount, inboxList } from './inbox';
import { meetingCall, meetingsList } from './meetings';
import { dashboardGet, eventsList, projectsList, searchQuery, tasksList, templateSyncTasks } from './overview';
import {
  fileCall, filesList, filesUpload, paymentCall, paymentsOfProject, projectCall, projectsCreate, stagesReplace, trackerCall, trackerExport,
  trackerList, trackerLog, updatesList,
} from './project';
import { projectsDelete } from './projectDelete';
import { pushMine, pushRegister, pushRemove } from './push';
import { reportsOffice } from './report';
import { storyCall } from './story';
import {
  chatsSend, commentCall, commentsCreate, commentsList, filesShare, taskCall, tasksArrange, tasksCreate, tasksCreateFromTemplate, tasksTake, taskTemplatesSave,
  updateCall, updatesCreate,
} from './task';

/**
 * The loader of each call that the server runs (plan 4.6; task C2). runCall (C3) calls loadFor() inside the call's transaction,
 * after the office lock for a write, and runs the handler on the State it returns. The table of plan 4.6 names the loaders:
 *
 *   office         the office lists only (people, clients, settings, teams, templates, deadlines.list, session.get, chats.openDirect).
 *                  projects.create reads its project template from them too. The group calls (chats.createGroup,
 *                  chats.updateGroup, chats.leaveGroup) read the chat rooms there too.
 *   feedback       the office and every feedback row
 *   project        one project P: its view, and its files, Tracker entries or payments when the call scans them
 *   task           one task T: every task of its project, and its events, comments, files and Tracker entry
 *   content        one comment or post, its target, and the comments and files the views count and name
 *   story          events.undo and events.undoStory (story.ts)
 *   inbox          the notices of one person
 *   chat           the chats and task threads of one person
 *   overview       the calls across projects: projects.list, dashboard.get, tasks.list, search.query, events.list
 *   projectDelete  every row of P and what points at it
 *   push           the push devices of the person of the call (push.register also reads the row of its endpoint)
 *   report         reports.office: the tasks, Tracker entries and payments of the projects, and the events of the period as counts
 *   meetings       the meetings of one window (meetings.list), or one meeting by id with the records it names (meetings.get, update, cancel)
 *
 * The 9 server calls of plan 4.11 run their own code on the office snapshot and have no loader.
 */

export type LoaderName = 'office' | 'feedback' | 'project' | 'task' | 'content' | 'story' | 'inbox' | 'chat' | 'overview' | 'projectDelete' | 'push' | 'report' | 'meetings';
type InputOf<N extends SharedCallName> = z.output<SharedCalls[N]['input']>;
export type LoaderSpec<I> = { loader: LoaderName; load(L: Load, input: I): Promise<unknown> };

const nothing = async () => undefined;
const office: LoaderSpec<unknown> = { loader: 'office', load: nothing };
const feedback: LoaderSpec<unknown> = { loader: 'feedback', load: (L) => L.allFeedback() };
const project = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'project', load });
const task = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'task', load });
const content = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'content', load });
const inbox = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'inbox', load });
const chat = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'chat', load });
const push = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'push', load });
const overview = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'overview', load });
const report = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'report', load });
const meetings = <I>(load: (L: Load, input: I) => Promise<unknown>): LoaderSpec<I> => ({ loader: 'meetings', load });

/** The project of a stage or a deadline, from the office. */
const projectOfStage = (L: Load, stageId: string) => L.office.stages[stageId]?.projectId;
const projectOfDeadline = (L: Load, id: string) => L.office.deadlines[id]?.projectId;

/** A mapped type, so a call that the server runs without a loader fails the type check (and loaders.test.ts at run time). */
export const LOADER_OF: { [N in SharedCallName]: LoaderSpec<InputOf<N>> } = {
  'session.get': office,
  'users.list': office,
  'users.get': office,
  'users.create': office,
  'users.update': office,
  'users.deactivate': office,
  'users.reactivate': office,
  'users.remove': office,
  'me.updateProfile': office,
  'me.updatePreferences': office,
  'clients.list': office,
  'clients.create': office,
  'clients.update': office,
  'settings.get': office,
  'settings.update': office,
  'roles.create': office,
  'roles.update': office,
  'roles.delete': office,

  'projects.list': overview(projectsList),
  'projects.get': project((L, i) => projectCall(L, i.id)),
  'projects.create': project(projectsCreate),
  'projects.update': project((L, i) => projectCall(L, i.id, i)),
  'projects.setLeader': project((L, i) => projectCall(L, i.id)),
  'projects.setStatus': project((L, i) => projectCall(L, i.id)),
  'projects.pause': project((L, i) => projectCall(L, i.id)),
  'projects.resume': project((L, i) => projectCall(L, i.id)),
  'projects.setRestart': project((L, i) => projectCall(L, i.id)),
  'projects.addLink': project((L, i) => projectCall(L, i.projectId)),
  'projects.updateLink': project((L, i) => projectCall(L, i.projectId)),
  'projects.removeLink': project((L, i) => projectCall(L, i.projectId)),
  'projects.setHealthOverride': project((L, i) => projectCall(L, i.id)),
  'projects.clearHealthOverride': project((L, i) => projectCall(L, i.id)),
  'projects.delete': { loader: 'projectDelete', load: projectsDelete },
  'members.add': project((L, i) => projectCall(L, i.projectId)),
  'members.addTeam': project((L, i) => projectCall(L, i.projectId)),
  'members.remove': project((L, i) => projectCall(L, i.projectId)),
  'members.update': project((L, i) => projectCall(L, i.projectId)),
  'stages.replace': project(stagesReplace),
  'stages.setDates': project((L, i) => projectCall(L, projectOfStage(L, i.stageId))),
  'stages.setPrerequisites': project((L, i) => projectCall(L, projectOfStage(L, i.stageId))),
  'deadlines.create': project((L, i) => projectCall(L, i.projectId)),
  'deadlines.update': project((L, i) => projectCall(L, projectOfDeadline(L, i.id))),
  'deadlines.delete': project((L, i) => projectCall(L, projectOfDeadline(L, i.id))),
  'deadlines.list': office,

  'tasks.list': overview(tasksList),
  'tasks.get': task(taskCall),
  'tasks.create': project(tasksCreate),
  'tasks.createFromTemplate': project(tasksCreateFromTemplate),
  'tasks.update': task(taskCall),
  'tasks.arrange': task(tasksArrange),
  'tasks.take': task(tasksTake),
  'tasks.newVersion': task(taskCall),
  'tasks.complete': task(taskCall),
  'tasks.move': task(taskCall),
  'tasks.approve': task(taskCall),
  'tasks.sendBack': task(taskCall),
  'tasks.delete': task(taskCall),

  'updates.list': project(updatesList),
  'updates.create': content(updatesCreate),
  'updates.update': content(updateCall),
  'updates.delete': content(updateCall),
  'comments.list': content(commentsList),
  'comments.create': content(commentsCreate),
  'comments.update': content(commentCall),
  'comments.delete': content(commentCall),
  'reactions.toggle': content(commentCall),

  'files.list': project(filesList),
  'files.upload': project(filesUpload),
  'files.delete': project(fileCall),
  'files.markDelivered': project(fileCall),
  'files.share': chat(filesShare),

  'events.list': overview(eventsList),
  'events.undo': { loader: 'story', load: storyCall },
  'events.undoStory': { loader: 'story', load: storyCall },

  'notifications.list': inbox(inboxList),
  'notifications.count': inbox(inboxCount),
  'notifications.markRead': inbox(inboxCount),
  'notifications.markAllRead': inbox(inboxCount),
  'notifications.markUnread': inbox(inboxCount),
  'notifications.updateSettings': office,

  'chats.list': chat(chatsAll),
  'chats.messages': chat(chatsMessages),
  'chats.send': chat(chatsSend),
  'chats.markRead': chat(chatsMarkRead),
  'chats.archive': chat(chatsArchive),
  'chats.openDirect': office,
  'chats.createGroup': office,
  'chats.updateGroup': office,
  'chats.leaveGroup': office,
  'chats.unreadCount': chat(chatsUnread),
  'chats.waiting': chat(chatsWaiting),

  'dashboard.get': overview(dashboardGet),
  'reports.office': report(reportsOffice),
  'search.query': overview(searchQuery),

  'stageTemplates.list': office,
  'stageTemplates.save': office,
  'stageTemplates.delete': office,

  'feedback.send': feedback,
  'feedback.list': feedback,
  'feedback.screenshot': feedback,
  'feedback.setStatus': feedback,

  'taskTemplates.list': office,
  'taskTemplates.save': task(taskTemplatesSave),
  'taskTemplates.rename': office,
  'taskTemplates.delete': office,

  'projectTemplates.list': office,
  'projectTemplates.save': office,
  'projectTemplates.delete': office,
  // The link reads the stages and tasks of its project, and writes them (fbk_008 item 4).
  'projectTemplates.matchPlan': project((L, i) => projectCall(L, i.projectId)),
  'projectTemplates.link': project((L, i) => projectCall(L, i.projectId)),
  // The update of a template (fbk_008 item 4): the reads list projects and read their tasks; the apply loads its one project.
  'projectTemplates.usage': overview(templateSyncTasks),
  'projectTemplates.syncPlan': overview(templateSyncTasks),
  'projectTemplates.syncApply': project((L, i) => projectCall(L, i.projectId)),

  'push.mine': push(pushMine),
  'push.register': push(pushRegister),
  'push.remove': push(pushRemove),

  'tracker.list': project(trackerList),
  'tracker.log': project(trackerLog),
  'tracker.close': task(trackerCall),
  'tracker.update': task(trackerCall),
  'tracker.delete': task(trackerCall),
  'tracker.assignReply': task(trackerCall),
  'tracker.export': project(trackerExport),

  'payments.list': project(paymentsOfProject),
  'payments.create': project(paymentsOfProject),
  'payments.update': project(paymentCall),
  'payments.markReceived': project(paymentCall),
  'payments.delete': project(paymentCall),

  'teams.list': office,
  'teams.create': office,
  'teams.update': office,
  'teams.delete': office,

  // Projects are an office list, so the office of a delete already holds every project that names a sub-company.
  'subCompanies.list': office,
  'subCompanies.save': office,
  'subCompanies.delete': office,

  // A new meeting reads the office only (its project, its team and its people). A change reads the meeting by id (fbk_022).
  'meetings.list': meetings(meetingsList),
  'meetings.get': meetings(meetingCall),
  'meetings.create': office,
  'meetings.update': meetings(meetingCall),
  'meetings.cancel': meetings(meetingCall),
};

/**
 * The State that one call runs on: the office from the snapshot and the rows its loader reads, as deep copies. "input" is the
 * parsed input of the call. A name without a loader throws: runCall finds every name in serverCallMap first.
 */
export async function loadFor(name: string, input: unknown, lx: LoadCtx): Promise<State> {
  const spec = (LOADER_OF as Record<string, LoaderSpec<unknown> | undefined>)[name];
  if (!spec) throw new Error(`The call ${name} has no loader.`);
  const L = new Load(lx);
  await spec.load(L, input);
  return L.state();
}

export { Load, type LoadCtx } from './build';
export { loadJobs } from './jobs';
export { memorySource } from './memorySource';
export { sqlSource } from './sqlSource';
export type { Source } from './source';
