import type { Kind } from '../api/remote/wire';
import { COLLECTION_KINDS } from './readMap';

/**
 * The kinds of change that each write of the screens can name for the screen of its actor (performance audit FET-3). The real
 * build reloads, in the request of the write and right after it, the reads on screen that these kinds touch (signals.ts,
 * readsAfterWrite), so the result of a save shows one round trip sooner. A personal kind (chatReads, notifications,
 * preferences) is here only when the write changes a record of its actor.
 *
 * server/core/writeKinds.test.ts runs every write of server/core/everyCall.ts and of the write sweep in memory, and fails when
 * a write names a kind that its line does not hold. A missing kind never leaves an old list: the change signals still reload
 * that read, one round trip later, as before. An extra kind costs one server read in the same request.
 * A write with no line (a server-only call, a call that a new track adds) reloads only on its signals, as before.
 */

/** An Undo can take back any change. */
const EVERY_KIND: readonly Kind[] = [...COLLECTION_KINDS, 'projectTouched', 'preferences'];

export const WRITE_KINDS: Readonly<Record<string, readonly Kind[]>> = {
  'users.create': ['events', 'users'],
  'users.update': ['events', 'users'],
  'users.deactivate': ['events', 'users'],
  'users.remove': ['events', 'users'],
  'users.reactivate': ['events', 'users'],
  'me.updateProfile': ['events', 'users'],
  'me.updatePreferences': ['preferences'],
  'clients.create': ['clients', 'events'],
  'clients.update': ['clients', 'events'],
  'settings.update': ['events', 'settings'],
  'projects.create': ['clients', 'conversations', 'events', 'members', 'projects', 'stages', 'tasks'],
  'projects.update': ['clients', 'events', 'projects'],
  'projects.setLeader': ['events', 'members', 'projects'],
  'projects.setStatus': ['events', 'projects', 'tracker'],
  'projects.pause': ['events', 'projects', 'tracker'],
  'projects.resume': ['events', 'projects', 'tracker'],
  'projects.setRestart': ['events', 'projects'],
  'projects.setAccess': ['events', 'projects'],
  'roles.create': ['events', 'settings'],
  'roles.update': ['events', 'settings'],
  'roles.delete': ['events', 'settings', 'users'],
  'projects.addLink': ['events', 'projects'],
  'projects.updateLink': ['events', 'projects'],
  'projects.removeLink': ['events', 'projects'],
  'projects.setHealthOverride': ['events', 'projects'],
  'projects.clearHealthOverride': ['events', 'projects'],
  'projects.delete': [
    'chatReads', 'comments', 'conversations', 'deadlines', 'events', 'files', 'meetings', 'members', 'messages', 'notifications', 'payments',
    'projects', 'stages', 'tasks', 'tracker', 'updates',
  ],
  'members.add': ['events', 'members'],
  'members.addTeam': ['events', 'members'],
  'members.update': ['events', 'members'],
  'members.remove': ['events', 'members'],
  'stages.replace': ['events', 'projects', 'stages', 'tasks'],
  'stages.setDates': ['events', 'stages'],
  'stages.setPrerequisites': ['events', 'stages'],
  'deadlines.create': ['deadlines', 'events'],
  'deadlines.update': ['deadlines', 'events'],
  'deadlines.delete': ['deadlines', 'events'],
  'tasks.create': ['events', 'notifications', 'tasks'],
  'tasks.createFromTemplate': ['events', 'tasks'],
  'tasks.update': ['events', 'notifications', 'tasks'],
  'tasks.take': ['events', 'notifications', 'tasks'],
  // An Admin outside the team who joins a task as a helper joins the team too.
  'tasks.help': ['events', 'members', 'notifications', 'tasks'],
  'tasks.arrange': ['events', 'tasks'],
  'tasks.newVersion': ['comments', 'events', 'projects', 'tasks', 'tracker'],
  'tasks.complete': ['comments', 'events', 'notifications', 'tasks', 'tracker'],
  'tasks.move': ['events', 'tasks', 'tracker'],
  'tasks.approve': ['events', 'notifications', 'tasks', 'tracker'],
  'tasks.sendBack': ['comments', 'events', 'notifications', 'tasks'],
  'tasks.delete': ['events', 'tasks'],
  'updates.create': ['events', 'updates'],
  'updates.update': ['events', 'updates'],
  'updates.delete': ['events', 'updates'],
  'comments.create': ['comments', 'events', 'notifications'],
  'comments.update': ['comments', 'events'],
  'comments.delete': ['comments', 'events'],
  'reactions.toggle': ['comments', 'events', 'messages'],
  'files.upload': ['events', 'files', 'projects', 'tasks'],
  'files.markDelivered': ['events', 'files', 'tracker'],
  'files.share': ['chatReads', 'comments', 'events', 'messages'],
  'files.delete': ['events', 'files', 'projects'],
  // Folders live in the project (fbk_066). A delete puts the files of the folder back at the root of their stage.
  'files.move': ['events', 'files', 'projects'],
  'folders.create': ['events', 'projects'],
  'folders.rename': ['events', 'projects'],
  'folders.delete': ['events', 'files', 'projects'],
  'events.undo': EVERY_KIND,
  'events.undoStory': EVERY_KIND,
  'notifications.markRead': ['notifications'],
  'notifications.markAllRead': ['notifications'],
  'notifications.markUnread': ['notifications'],
  'notifications.updateSettings': ['preferences'],
  'chats.send': ['chatReads', 'messages'],
  'chats.editMessage': ['messages', 'notifications'],
  'chats.deleteMessage': ['messages', 'notifications'],
  'chats.markRead': ['chatReads', 'notifications'],
  'chats.archive': ['chatReads', 'notifications'],
  'chats.markUnread': ['chatReads'],
  'chats.setNotify': ['chatReads'],
  'chats.openDirect': ['chatReads', 'conversations'],
  'chats.createGroup': ['conversations'],
  'chats.updateGroup': ['conversations'],
  'chats.leaveGroup': ['conversations'],
  'stageTemplates.save': ['events', 'stageTemplates'],
  'stageTemplates.delete': ['events', 'stageTemplates'],
  'projectTemplates.save': ['events', 'projectTemplates'],
  'projectTemplates.delete': ['events', 'projectTemplates'],
  'projectTemplates.link': ['events', 'projects', 'stages', 'tasks'],
  'projectTemplates.syncApply': ['comments', 'events', 'members', 'notifications', 'projects', 'stages', 'tasks'],
  'taskTemplates.save': ['events', 'taskTemplates'],
  'taskTemplates.rename': ['events', 'taskTemplates'],
  'taskTemplates.delete': ['events', 'taskTemplates'],
  'feedback.send': ['events', 'feedback'],
  'feedback.setStatus': ['events', 'feedback'],
  'tracker.log': ['events', 'tasks', 'tracker'],
  'tracker.close': ['events', 'tasks', 'tracker'],
  'tracker.update': ['events', 'tasks', 'tracker'],
  'tracker.delete': ['events', 'tasks', 'tracker'],
  'tracker.assignReply': ['events', 'tasks', 'tracker'],
  'payments.create': ['events', 'payments'],
  'payments.update': ['events', 'payments'],
  'payments.markReceived': ['events', 'payments'],
  'payments.delete': ['events', 'payments'],
  'teams.create': ['events', 'teams'],
  'teams.update': ['events', 'teams'],
  'teams.delete': ['events', 'teams'],
  'subCompanies.save': ['events', 'subCompanies'],
  'subCompanies.delete': ['events', 'subCompanies', 'projects'],
  // A meeting writes its event, its row and the notices of its attendees. The person signal of a meeting with no project carries every kind
  // of the save, so the screen of the organizer also reloads the notices (fbk_022).
  'meetings.create': ['events', 'meetings', 'notifications'],
  'meetings.update': ['events', 'meetings', 'notifications'],
  'meetings.cancel': ['events', 'meetings', 'notifications'],
  // A delete writes the events and removes the rows. It sends no notice, but a notice of the meeting then reads as gone.
  'meetings.delete': ['events', 'meetings', 'notifications'],
  // The settle writes the mark of the meeting, its event, and the Tracker line of a project meeting (fbk_022, wave 2). It sends no notice.
  'meetings.settle': ['events', 'meetings', 'tracker'],
  // The extension of a series (wave 3) writes the mark, the new meetings and their events. It sends no notice.
  'meetings.extend': ['events', 'meetings'],
  // The minutes write the event and the Tracker line (or the meeting), and the call settles a meeting first when the job did not (wave 2).
  'meetings.saveMinutes': ['events', 'meetings', 'tracker'],
  // A push device is private and sends no change signal (server/data/save.ts), so no list reloads for it (owner, 2026-10-08).
  'push.register': [],
  'push.remove': [],
  // A story holds no record of its own: nothing to reload.
  'story.start': [],
  // The Google Calendar connect (fbk_022) changes no record of the office and sends no signal.
  'google.connect': [],
  'google.disconnect': [],
};
