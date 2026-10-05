/**
 * The written instructions for AI agents (plan 5.6; spec 1, section 17, rule 7). INSTRUCTIONS goes in the answer of
 * server/discover and starts the answer of madar.readFirst (readFirstAnswer adds who the agent acts for). TOOL_DOCS gives each of the 37 tools its title and description.
 * The reader is a model that acts for one person, so the texts are short, exact, and in plain English.
 * tools.test.ts checks that each description is 40 to 600 characters.
 */

import type { SystemRole, User } from '../../src/api/contract/entities';

export const INSTRUCTIONS = [
  'Madar is the project tool of an architecture office: projects, stages, tasks, updates, comments, the client tracker, payments and deadlines.',
  '',
  'Call madar.readFirst once before your first change. It returns this text.',
  '',
  'Rules:',
  '1. You act for one person, with that person\'s rights and never more. You have no role of your own. A call that the person may not make fails for you too.',
  '2. Every change records two names: yours (the agent) and the person you act for. The History shows both.',
  '3. A story ties together the changes of one request. Call story.start once, then pass its storyId to each write of that request.',
  '4. The person you act for gets no notification for your changes. Tell the person what you changed.',
  '5. The person can undo your changes, like their own.',
  '',
  'Stories and Undo: events.undo takes back one change by its event ID (from events.list). events.undoStory takes back every change of one story by its storyId. Use the same storyId for changes that belong together, so one Undo takes them all back.',
  '',
  'Reasons: some changes need a reason in words. A task change that moves the project back to an earlier stage needs "reason". A change of a task date that was already set needs "dateReason". When a call needs one, the server asks for it, or the call fails with a message that names the field. Ask your person for the reason, then call again with the same arguments plus that field. Never invent a reason.',
  '',
  'Files: you can list files and refer to them by ID. To upload a file, the person uses the Madar screens.',
  '',
  'Leads: a task can have no lead (ownerId null). A new task has no lead unless you name one. A task with no lead cannot be completed or sent to review: the call fails with reason needs_lead. tasks.take makes your person the lead of a task with no lead.',
  '',
  'IDs have a prefix and a number, for example prj_001, tsk_014, usr_003. Dates are YYYY-MM-DD in Riyadh time. Read before you write: find IDs with the list and get tools.',
  '',
  'Project codes: a new code reads YYMMSSINI-CLS-Type, for example 260902AZT-RES-Villa: the month of registration (YYMM), the series of that month (SS), the client initials (INI), the class (RES, COM, IND, INS, REC, AGR, UTL or MIX) and the building type. The first part, 260902AZT, is the project key; people write #260902AZT in posts. Older projects keep codes like KH-26-014. Two projects of one contract share one code. The code is fixed after create: only the Admin corrects it, with projects.update.',
].join('\n');

/** The role names that the Madar screens show. */
const ROLE_NAMES: Record<SystemRole, string> = { admin: 'Admin', management: 'Management', accounting: 'Accounting', member: 'Member' };

/**
 * The answer of madar.readFirst: INSTRUCTIONS plus one line that names the person the agent acts for and that person's role
 * (spec 1, section 17, rule 7). run.ts (G3) passes the users row of the agent principal's owner.
 */
export function readFirstAnswer(person: Pick<User, 'name' | 'systemRole'>): string {
  return `${INSTRUCTIONS}\n\nYou act for ${person.name}, whose role in Madar is ${ROLE_NAMES[person.systemRole]}.`;
}

export const TOOL_DOCS: Record<string, { title: string; description: string }> = {
  'madar.readFirst': {
    title: 'Read this first',
    description: 'Returns the rules for agents in Madar: who you act for, how stories and Undo work, when a change needs a reason, and what only the screens can do. Call it once before your first change.',
  },
  'story.start': {
    title: 'Start a story',
    description: 'Starts a story and returns its storyId. Pass the storyId to each write of one request, so the History groups those changes and events.undoStory takes them all back together. One story belongs to you only.',
  },
  'dashboard.get': {
    title: 'Office dashboard',
    description: 'Returns the office overview: number tiles, project health (on track, at risk, late), charts, the workload of each person, the schedule, and what needs attention. Filters: status (default active), leaderId, clientId, teamId. Use it for a summary, then the list tools for detail.',
  },
  'deadlines.create': {
    title: 'Add a deadline',
    description: 'Adds a deadline to a project: a name and a date (YYYY-MM-DD), and optionally the stage it belongs to (stageId). The project leader and the Admin may add deadlines.',
  },
  'deadlines.list': {
    title: 'List deadlines',
    description: 'Lists the deadlines of all projects that you may see, in date order. Filters: from and to (YYYY-MM-DD), project status, teamId. Each line names its project and stage.',
  },
  'deadlines.update': {
    title: 'Change a deadline',
    description: 'Changes the name, the date or the stage of one deadline (id from deadlines.list). Send only the fields that change, in "patch". The project leader and the Admin may change deadlines.',
  },
  'events.list': {
    title: 'Read the History',
    description: 'Lists the changes in the History, newest first: who made each change, for whom, and what changed. Filters: projectId, targetType and targetId, correlationId (a storyId), since, limit (1 to 500, default 50). Use it to find the event ID for events.undo.',
  },
  'events.undo': {
    title: 'Undo one change',
    description: 'Takes back one change by its event ID (from events.list), under the rules of the original action. An undo of a create removes the record. You may undo your own changes and those of the person you act for. The undo is a new change in the History.',
  },
  'events.undoStory': {
    title: 'Undo a story',
    description: 'Takes back every change of one story, given its storyId as correlationId. The changes come back together, newest first. Use it to take back the whole of one request.',
  },
  'files.list': {
    title: 'List files',
    description: 'Lists the files of one project (projectId), optionally of one stage (stageId) or one task (taskId). Each file has its versions and their letters. You cannot read file contents or upload here: the person does that in the Madar screens.',
  },
  'payments.create': {
    title: 'Add a payment',
    description: 'Adds a planned payment to a project: a name, an amount in Saudi riyals, a due date (YYYY-MM-DD), and optionally the day it came in (receivedOn) and a note. Only the Admin, Management and Accounting may do this.',
  },
  'payments.list': {
    title: 'List payments',
    description: 'Lists the payments of one project (projectId): name, amount in Saudi riyals, due date, and the day each came in. Only the Admin, Management and Accounting may see payments.',
  },
  'payments.markReceived': {
    title: 'Mark a payment received',
    description: 'Marks one payment (id from payments.list) as received, on receivedOn (YYYY-MM-DD) or today when you leave it out. Only the Admin, Management and Accounting may do this.',
  },
  'payments.update': {
    title: 'Change a payment',
    description: 'Changes the name, amount, due date, received day or note of one payment (id from payments.list). Send only the fields that change, in "patch". Only the Admin, Management and Accounting may do this.',
  },
  'projects.get': {
    title: 'Get a project',
    description: 'Returns one project by id (for example prj_001): its code, stages and the current stage, its team, leader, client, dates, health, deadlines and links. The code is 260902AZT-RES-Villa (new form) or KH-26-014 (old form).',
  },
  'projects.list': {
    title: 'List projects',
    description: 'Lists the projects, with their code, stage, health and leader. A code is 260902AZT-RES-Villa (new form, key 260902AZT) or KH-26-014 (old form). Filters: status, filter (all, mine, at_risk), stageName, health, leaderId, clientId, teamId; sort by updated, deadline or name.',
  },
  'projects.setStatus': {
    title: 'Set the project status',
    description: 'Sets the status of one project: active, completed or archived. The project leader and the Admin may do this. Ask your person before you complete or archive a project. A pause (on_hold) needs a reason: the person pauses a project in the Madar screens.',
  },
  'projects.update': {
    title: 'Change project details',
    description: 'Changes the details of one project: name, client, location, area in square metres, dates, model folder path, description, cover file. Send only the fields that change, in "patch". The project leader and the Admin may do this. "code" corrects the project code (for example 260902AZT-RES-Villa): only the Admin may do that, and the History records it.',
  },
  'search.query': {
    title: 'Search',
    description: 'Searches projects, tasks of active projects, people and files by words in "text". Returns the matches of each kind, with their IDs. Use it when you know a name but not the ID.',
  },
  'tasks.approve': {
    title: 'Approve a task',
    description: 'Approves a task that waits in review (status in_review), so it becomes done. Only a reviewer (the project leader or the Admin) may approve. The task owner gets a notification.',
  },
  'tasks.complete': {
    title: 'Complete a task',
    description: 'Ticks one task as finished. A task that needs review goes to in_review, unless you act for a reviewer; then it is done. It fails while a prerequisite task is open.',
  },
  'tasks.create': {
    title: 'Add a task',
    description: 'Adds a task to a project: a title, and optionally the stage, owner (the lead), helpers, prerequisites, start and due dates, description, flag and review need. Without ownerId the task has no lead. A new open task in an earlier stage moves the project back, and then the call needs "reason".',
  },
  'tasks.get': {
    title: 'Get a task',
    description: 'Returns one task by id (for example tsk_014): title, status, owner (the lead, or null for a task with no lead) and helpers, stage, dates, checklist, prerequisites, review need and versions. viewerCan.take is true when your person may take the lead.',
  },
  'tasks.list': {
    title: 'List tasks',
    description: 'Lists tasks. Filters: projectId, ownerId, filter (all, mine, overdue, flagged, review_for_me, no_lead), status, due, created and done date ranges, includeDone, activeProjectsOnly, teamId. Without includeDone, done tasks are left out. owner is null for a task with no lead.',
  },
  'tasks.move': {
    title: 'Move a task',
    description: 'Sets the status of one task: todo, in_progress, in_review or done. Done by a non-reviewer on a task that needs review lands on in_review. A move that opens a task in an earlier stage moves the project back, and then the call needs "reason".',
  },
  'tasks.sendBack': {
    title: 'Send a task back',
    description: 'Sends a task in review back to in_progress, with a note that says what to change. Only a reviewer (the project leader or the Admin) may do this. The note becomes a comment on the task, and the owner and helpers get a notification.',
  },
  'tasks.take': {
    title: 'Take a task',
    description: 'Makes your person the lead of one task that has no lead (taskId, for example tsk_014). Your person must be on the project team; an Admin joins it. It fails with reason has_lead when the task has a lead already.',
  },
  'tasks.update': {
    title: 'Change a task',
    description: 'Changes one task: title, description, dates, schedule, stage, owner, helpers, prerequisites, flag, review need or checklist. Send only the fields that change, in "patch". ownerId null takes the lead off an open task. A change of a date that was already set needs "dateReason". A stage move back needs "reason".',
  },
  'tracker.close': {
    title: 'Close a tracker wait',
    description: 'Closes the wait of one tracker entry (id from tracker.list): the reply came or is no longer needed. The entry stays in the tracker.',
  },
  'tracker.list': {
    title: 'List the client tracker',
    description: 'Lists the tracker of one project (projectId): meetings, messages, files and Balady steps with the client and third parties, newest first. Filters: type, direction, openOnly (only entries that wait for a reply).',
  },
  'tracker.log': {
    title: 'Log in the tracker',
    description: 'Logs one contact in the client tracker of a project: type (meeting, message, file, balady, other), direction, title, and optionally note, date, who waits (us or client), files, people, and a reply task (replyBy: who and by when).',
  },
  'tracker.update': {
    title: 'Change a tracker entry',
    description: 'Changes one tracker entry (id from tracker.list): type, direction, title, note, date, who waits, files or people. Send only the fields that change.',
  },
  'updates.create': {
    title: 'Post an update',
    description: 'Posts an update on the feed of one project: a body in words, optionally files (fileIds) and the decision mark. The project team sees it. Write it as your person would.',
  },
  'updates.list': {
    title: 'List project updates',
    description: 'Lists the feed of one project (projectId), newest first: posts, decisions, task changes and files. Filter: all, posts, decisions, tasks or files; limit sets how many.',
  },
  'users.list': {
    title: 'List people',
    description: 'Lists the people of the office: the English name (name), the Arabic name (nameAr, when the person has one), discipline, role and whether each is active. Use the name that fits the language of your person. Set includeInactive to see people who are turned off. Agents are in the list too, with their owner. Profile pictures are left out.',
  },
  'comments.create': {
    title: 'Add a comment',
    description: 'Adds a comment to a task or an update (targetType and targetId): a body in words, and optionally files (fileIds). Only the project team may comment. People named with @ get a notification.',
  },
  'comments.list': {
    title: 'List comments',
    description: 'Lists the comments on one task or one update (targetType and targetId), oldest first, with their authors and reactions.',
  },
};
