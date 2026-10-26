/**
 * The catalog of role rights version 2 (owner approved the list on 2026-10-21): 13 sections, 91 powers, 120 switches. It is a plain copy of
 * docs/superpowers/specs/2026-10-21-madar-role-rights-v2-catalog.json, without the words (the labels and the hints are word keys of the
 * screens). A test (rightsCatalog.test.ts) checks that this file and the JSON agree. permissions.ts is in the first load of the real
 * build, so this file takes no value from zod or from the schema files.
 *
 * A switch id is `<power>.<scope>` for a power with scopes, and the power name for a power with one switch:
 *   lead   the projects where the person is the leader
 *   team   the projects where the person is on the team (the leader counts as on the team)
 *   all    every project
 *   office the to-dos with no project
 *   none   the meetings with no project
 */

export type RightScope = 'lead' | 'team' | 'all' | 'office' | 'none';

export type CatalogSwitch = {
  readonly id: CatalogRightId;
  /** Null for a power with one switch. */
  readonly scope: RightScope | null;
  /** True when a Member holds the switch by default (BASIC_ON). */
  readonly basic: boolean;
  /** True for a power that no role holds today. It is off by default. */
  readonly newPower?: true;
  /** The switches that this one needs. The sheet turns them on with it. */
  readonly needs: readonly CatalogRightId[];
};

export type CatalogPower = {
  readonly power: string;
  readonly switches: readonly CatalogSwitch[];
  /** The MCP tools that an AI switch opens. */
  readonly mcpTools?: readonly string[];
};

export type CatalogSection = { readonly key: string; readonly powers: readonly CatalogPower[] };

/** The 120 switch ids, in the order of the sections of the role sheet. */
export const CATALOG_RIGHT_IDS = [
  'project.create', 'client.create', 'project.details.lead', 'project.details.all', 'project.team.lead', 'project.team.all',
  'project.stages.lead', 'project.stages.all', 'project.deadlines.lead', 'project.deadlines.all', 'project.template.lead',
  'project.template.all', 'project.archive.lead', 'project.archive.all', 'project.leader.lead', 'project.leader.all',
  'project.health.lead', 'project.health.all', 'project.code', 'project.delete.lead', 'project.delete.all', 'project.seeAll', 'project.access.lead', 'project.access.all', 'project.hidden',
  'task.add.office',
  'task.add.team', 'task.add.all', 'task.assign', 'task.take', 'task.help', 'task.work', 'task.details', 'task.dates',
  'task.deleteOwn', 'task.any.lead', 'task.any.all', 'task.review.lead', 'task.review.all', 'task.officeAll',
  'meeting.plan.none', 'meeting.plan.team', 'meeting.plan.all', 'meeting.editOwn', 'meeting.minutesOwn', 'meeting.any.lead',
  'meeting.any.all', 'meeting.minutesAny.lead', 'meeting.minutesAny.all', 'post.create.team', 'post.create.all',
  'comment.create.team', 'comment.create.all', 'post.editOwn', 'project.links.team', 'project.links.all', 'file.upload.team',
  'file.upload.all', 'file.deliver.team', 'file.deliver.all', 'file.share', 'file.deleteOwn', 'file.deleteAny.lead',
  'file.deleteAny.all', 'chat.direct', 'chat.groupCreate', 'chat.groupChange', 'chat.project.team', 'chat.project.all',
  'chat.mentionEveryone', 'tracker.log.team', 'tracker.log.all', 'tracker.reply', 'tracker.export', 'tracker.deleteOwn', 'tracker.deleteAny.lead',
  'tracker.deleteAny.all', 'people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove',
  'clients.change', 'subCompanies.manage', 'payment.view', 'payment.add', 'payment.change', 'payment.receive',
  'templates.projectCreate', 'templates.projectAny', 'templates.taskSave.lead', 'templates.taskSave.all', 'templates.taskAny',
  'templates.updateProjects', 'dashboard.view', 'workload.view', 'search.use', 'gaps.view', 'report.office', 'ai.connect',
  'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts', 'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects',
  'ai.projectSetup', 'ai.payments', 'ai.feedback', 'ai.report', 'ai.admin', 'ai.myState', 'ai.undo', 'ai.undoOthers.lead', 'ai.undoOthers.all', 'feedback.send',
  'feedback.manage', 'office.settings',
] as const;
export type CatalogRightId = (typeof CATALOG_RIGHT_IDS)[number];

/** The sections, the powers and the switches of each power. */
export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  {
    key: 'projects',
    powers: [
      {
        power: 'project.create',
        switches: [
          { id: 'project.create', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'client.create',
        switches: [
          { id: 'client.create', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'project.details',
        switches: [
          { id: 'project.details.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.details.all', scope: 'all', basic: false, needs: ['project.details.lead'] },
        ],
      },
      {
        power: 'project.team',
        switches: [
          { id: 'project.team.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.team.all', scope: 'all', basic: false, needs: ['project.team.lead'] },
        ],
      },
      {
        power: 'project.stages',
        switches: [
          { id: 'project.stages.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.stages.all', scope: 'all', basic: false, needs: ['project.stages.lead'] },
        ],
      },
      {
        power: 'project.deadlines',
        switches: [
          { id: 'project.deadlines.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.deadlines.all', scope: 'all', basic: false, needs: ['project.deadlines.lead'] },
        ],
      },
      {
        power: 'project.template',
        switches: [
          { id: 'project.template.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.template.all', scope: 'all', basic: false, needs: ['project.template.lead'] },
        ],
      },
      {
        power: 'project.archive',
        switches: [
          { id: 'project.archive.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.archive.all', scope: 'all', basic: false, needs: ['project.archive.lead'] },
        ],
      },
      {
        power: 'project.leader',
        switches: [
          { id: 'project.leader.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.leader.all', scope: 'all', basic: false, needs: ['project.leader.lead'] },
        ],
      },
      {
        power: 'project.health',
        switches: [
          { id: 'project.health.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.health.all', scope: 'all', basic: false, needs: ['project.health.lead'] },
        ],
      },
      {
        power: 'project.code',
        switches: [
          { id: 'project.code', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'project.delete',
        switches: [
          { id: 'project.delete.lead', scope: 'lead', basic: false, newPower: true, needs: [] },
          { id: 'project.delete.all', scope: 'all', basic: false, newPower: true, needs: ['project.delete.lead'] },
        ],
      },
      {
        power: 'project.seeAll',
        switches: [
          { id: 'project.seeAll', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'project.access',
        switches: [
          { id: 'project.access.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'project.access.all', scope: 'all', basic: false, newPower: true, needs: ['project.access.lead'] },
        ],
      },
      {
        power: 'project.hidden',
        switches: [
          { id: 'project.hidden', scope: null, basic: false, newPower: true, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'todos',
    powers: [
      {
        power: 'task.add',
        switches: [
          { id: 'task.add.office', scope: 'office', basic: true, needs: [] },
          { id: 'task.add.team', scope: 'team', basic: true, needs: [] },
          { id: 'task.add.all', scope: 'all', basic: false, needs: ['task.add.team'] },
        ],
      },
      {
        power: 'task.assign',
        switches: [
          { id: 'task.assign', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.take',
        switches: [
          { id: 'task.take', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.help',
        switches: [
          { id: 'task.help', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.work',
        switches: [
          { id: 'task.work', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.details',
        switches: [
          { id: 'task.details', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.dates',
        switches: [
          { id: 'task.dates', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.deleteOwn',
        switches: [
          { id: 'task.deleteOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'task.any',
        switches: [
          { id: 'task.any.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'task.any.all', scope: 'all', basic: false, needs: ['task.any.lead'] },
        ],
      },
      {
        power: 'task.review',
        switches: [
          { id: 'task.review.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'task.review.all', scope: 'all', basic: false, needs: ['task.review.lead'] },
        ],
      },
      {
        power: 'task.officeAll',
        switches: [
          { id: 'task.officeAll', scope: null, basic: false, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'meetings',
    powers: [
      {
        power: 'meeting.plan',
        switches: [
          { id: 'meeting.plan.none', scope: 'none', basic: true, needs: [] },
          { id: 'meeting.plan.team', scope: 'team', basic: true, needs: [] },
          { id: 'meeting.plan.all', scope: 'all', basic: false, needs: ['meeting.plan.team'] },
        ],
      },
      {
        power: 'meeting.editOwn',
        switches: [
          { id: 'meeting.editOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'meeting.minutesOwn',
        switches: [
          { id: 'meeting.minutesOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'meeting.any',
        switches: [
          { id: 'meeting.any.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'meeting.any.all', scope: 'all', basic: false, needs: ['meeting.any.lead'] },
        ],
      },
      {
        power: 'meeting.minutesAny',
        switches: [
          { id: 'meeting.minutesAny.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'meeting.minutesAny.all', scope: 'all', basic: false, needs: ['meeting.minutesAny.lead'] },
        ],
      },
    ],
  },
  {
    key: 'posts',
    powers: [
      {
        power: 'post.create',
        switches: [
          { id: 'post.create.team', scope: 'team', basic: true, needs: [] },
          { id: 'post.create.all', scope: 'all', basic: false, needs: ['post.create.team'] },
        ],
      },
      {
        power: 'comment.create',
        switches: [
          { id: 'comment.create.team', scope: 'team', basic: true, needs: [] },
          { id: 'comment.create.all', scope: 'all', basic: false, needs: ['comment.create.team'] },
        ],
      },
      {
        power: 'post.editOwn',
        switches: [
          { id: 'post.editOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'project.links',
        switches: [
          { id: 'project.links.team', scope: 'team', basic: true, needs: [] },
          { id: 'project.links.all', scope: 'all', basic: false, needs: ['project.links.team'] },
        ],
      },
    ],
  },
  {
    key: 'files',
    powers: [
      {
        power: 'file.upload',
        switches: [
          { id: 'file.upload.team', scope: 'team', basic: true, needs: [] },
          { id: 'file.upload.all', scope: 'all', basic: false, needs: ['file.upload.team'] },
        ],
      },
      {
        power: 'file.deliver',
        switches: [
          { id: 'file.deliver.team', scope: 'team', basic: true, needs: [] },
          { id: 'file.deliver.all', scope: 'all', basic: false, needs: ['file.deliver.team'] },
        ],
      },
      {
        power: 'file.share',
        switches: [
          { id: 'file.share', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'file.deleteOwn',
        switches: [
          { id: 'file.deleteOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'file.deleteAny',
        switches: [
          { id: 'file.deleteAny.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'file.deleteAny.all', scope: 'all', basic: false, needs: ['file.deleteAny.lead'] },
        ],
      },
    ],
  },
  {
    key: 'chat',
    powers: [
      {
        power: 'chat.direct',
        switches: [
          { id: 'chat.direct', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'chat.groupCreate',
        switches: [
          { id: 'chat.groupCreate', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'chat.groupChange',
        switches: [
          { id: 'chat.groupChange', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'chat.project',
        switches: [
          { id: 'chat.project.team', scope: 'team', basic: true, needs: [] },
          { id: 'chat.project.all', scope: 'all', basic: false, needs: ['chat.project.team'] },
        ],
      },
      {
        power: 'chat.mentionEveryone',
        switches: [
          { id: 'chat.mentionEveryone', scope: null, basic: true, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'tracker',
    powers: [
      {
        power: 'tracker.log',
        switches: [
          { id: 'tracker.log.team', scope: 'team', basic: true, needs: [] },
          { id: 'tracker.log.all', scope: 'all', basic: false, needs: ['tracker.log.team'] },
        ],
      },
      {
        power: 'tracker.reply',
        switches: [
          { id: 'tracker.reply', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'tracker.export',
        switches: [
          { id: 'tracker.export', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'tracker.deleteOwn',
        switches: [
          { id: 'tracker.deleteOwn', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'tracker.deleteAny',
        switches: [
          { id: 'tracker.deleteAny.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'tracker.deleteAny.all', scope: 'all', basic: false, needs: ['tracker.deleteAny.lead'] },
        ],
      },
    ],
  },
  {
    key: 'people',
    powers: [
      {
        power: 'people.invite',
        switches: [
          { id: 'people.invite', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'people.change',
        switches: [
          { id: 'people.change', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'people.teams',
        switches: [
          { id: 'people.teams', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'people.turnOff',
        switches: [
          { id: 'people.turnOff', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'people.remove',
        switches: [
          { id: 'people.remove', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'clients.change',
        switches: [
          { id: 'clients.change', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'subCompanies.manage',
        switches: [
          { id: 'subCompanies.manage', scope: null, basic: false, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'money',
    powers: [
      {
        power: 'payment.view',
        switches: [
          { id: 'payment.view', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'payment.add',
        switches: [
          { id: 'payment.add', scope: null, basic: false, needs: ['payment.view'] },
        ],
      },
      {
        power: 'payment.change',
        switches: [
          { id: 'payment.change', scope: null, basic: false, needs: ['payment.view'] },
        ],
      },
      {
        power: 'payment.receive',
        switches: [
          { id: 'payment.receive', scope: null, basic: false, needs: ['payment.view'] },
        ],
      },
    ],
  },
  {
    key: 'templates',
    powers: [
      {
        power: 'templates.projectCreate',
        switches: [
          { id: 'templates.projectCreate', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'templates.projectAny',
        switches: [
          { id: 'templates.projectAny', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'templates.taskSave',
        switches: [
          { id: 'templates.taskSave.lead', scope: 'lead', basic: true, needs: [] },
          { id: 'templates.taskSave.all', scope: 'all', basic: false, needs: ['templates.taskSave.lead'] },
        ],
      },
      {
        power: 'templates.taskAny',
        switches: [
          { id: 'templates.taskAny', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'templates.updateProjects',
        switches: [
          { id: 'templates.updateProjects', scope: null, basic: false, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'dashboard',
    powers: [
      {
        power: 'dashboard.view',
        switches: [
          { id: 'dashboard.view', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'workload.view',
        switches: [
          { id: 'workload.view', scope: null, basic: true, needs: ['dashboard.view'] },
        ],
      },
      {
        power: 'search.use',
        switches: [
          { id: 'search.use', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'gaps.view',
        switches: [
          { id: 'gaps.view', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'report.office',
        switches: [
          { id: 'report.office', scope: null, basic: false, needs: [] },
        ],
      },
    ],
  },
  {
    key: 'ai',
    powers: [
      {
        power: 'ai.connect',
        switches: [
          { id: 'ai.connect', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'ai.readWork', mcpTools: ['projects.list', 'projects.get', 'tasks.list', 'tasks.get', 'comments.list', 'updates.list', 'meetings.list', 'meetings.get', 'tracker.list', 'deadlines.list', 'files.list', 'users.list', 'subCompanies.list', 'pictures.get', 'dashboard.get', 'events.list', 'search.query', 'notifications.list', 'notifications.count', 'users.get', 'teams.list', 'settings.get'],
        switches: [
          { id: 'ai.readWork', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.readChats', mcpTools: ['chats.list', 'chats.messages', 'chats.waiting', 'chats.unreadCount'],
        switches: [
          { id: 'ai.readChats', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.todos', mcpTools: ['tasks.create', 'tasks.update', 'tasks.createMany', 'tasks.updateMany', 'tasks.complete', 'tasks.move', 'tasks.arrange', 'tasks.take', 'tasks.help', 'tasks.approve', 'tasks.sendBack', 'tasks.createFromTemplate', 'tasks.newVersion', 'tasks.delete', 'taskTemplates.list', 'taskTemplates.save', 'taskTemplates.rename', 'taskTemplates.delete'],
        switches: [
          { id: 'ai.todos', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.posts', mcpTools: ['updates.create', 'comments.create', 'updates.update', 'updates.delete', 'comments.update', 'comments.delete', 'reactions.toggle'],
        switches: [
          { id: 'ai.posts', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.messages', mcpTools: ['chats.send', 'chats.openDirect', 'chats.editMessage', 'chats.deleteMessage', 'chats.createGroup', 'chats.updateGroup', 'chats.leaveGroup'],
        switches: [
          { id: 'ai.messages', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.meetings', mcpTools: ['meetings.create', 'meetings.update', 'meetings.cancel', 'meetings.saveMinutes', 'meetings.delete'],
        switches: [
          { id: 'ai.meetings', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.tracker', mcpTools: ['tracker.log', 'tracker.update', 'tracker.close', 'tracker.delete', 'tracker.assignReply', 'tracker.export'],
        switches: [
          { id: 'ai.tracker', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.projects', mcpTools: ['projects.update', 'projects.setStatus', 'stages.setDates', 'stages.replace', 'deadlines.create', 'deadlines.update', 'folders.create', 'folders.rename', 'folders.delete', 'files.move', 'projects.setLeader', 'projects.pause', 'projects.resume', 'projects.setRestart', 'projects.setAccess', 'projects.addLink', 'projects.updateLink', 'projects.removeLink', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'members.add', 'members.addTeam', 'members.remove', 'members.update', 'stages.setPrerequisites', 'deadlines.delete', 'files.link', 'files.delete', 'files.markDelivered', 'files.share', 'files.uploadContent'],
        switches: [
          { id: 'ai.projects', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.projectSetup', mcpTools: ['projects.create', 'clients.create', 'clients.list', 'projectTemplates.list', 'stageTemplates.list', 'stageTemplates.save', 'stageTemplates.delete', 'projectTemplates.save', 'projectTemplates.delete', 'projectTemplates.matchPlan', 'projectTemplates.link', 'projectTemplates.usage', 'projectTemplates.syncPlan', 'projectTemplates.syncApply'],
        switches: [
          { id: 'ai.projectSetup', scope: null, basic: false, newPower: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.payments', mcpTools: ['payments.list', 'payments.create', 'payments.update', 'payments.markReceived', 'payments.delete'],
        switches: [
          { id: 'ai.payments', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.feedback', mcpTools: ['feedback.list', 'feedback.screenshot', 'feedback.setStatus', 'feedback.send', 'feedback.sendWithScreenshots'],
        switches: [
          { id: 'ai.feedback', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.report', mcpTools: ['reports.office'],
        switches: [
          { id: 'ai.report', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.admin', mcpTools: ['users.create', 'users.update', 'users.deactivate', 'users.reactivate', 'users.remove', 'users.invites', 'users.resendInvite', 'clients.update', 'teams.create', 'teams.update', 'teams.delete', 'subCompanies.save', 'subCompanies.delete', 'settings.update', 'roles.create', 'roles.update', 'roles.delete'],
        switches: [
          { id: 'ai.admin', scope: null, basic: false, newPower: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.myState', mcpTools: ['notifications.markRead', 'notifications.markAllRead', 'notifications.markUnread', 'notifications.updateSettings', 'chats.markRead', 'chats.markUnread', 'chats.archive', 'chats.setNotify', 'me.updateProfile', 'me.updatePreferences', 'agents.list', 'agents.remove'],
        switches: [
          { id: 'ai.myState', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.undo', mcpTools: ['events.undo', 'events.undoStory'],
        switches: [
          { id: 'ai.undo', scope: null, basic: true, needs: ['ai.connect'] },
        ],
      },
      {
        power: 'ai.undoOthers',
        switches: [
          { id: 'ai.undoOthers.lead', scope: 'lead', basic: true, needs: ['ai.connect'] },
          { id: 'ai.undoOthers.all', scope: 'all', basic: false, needs: ['ai.connect', 'ai.undoOthers.lead'] },
        ],
      },
    ],
  },
  {
    key: 'office',
    powers: [
      {
        power: 'feedback.send',
        switches: [
          { id: 'feedback.send', scope: null, basic: true, needs: [] },
        ],
      },
      {
        power: 'feedback.manage',
        switches: [
          { id: 'feedback.manage', scope: null, basic: false, needs: [] },
        ],
      },
      {
        power: 'office.settings',
        switches: [
          { id: 'office.settings', scope: null, basic: false, needs: [] },
        ],
      },
    ],
  },
];

/** The 68 switches that a Member holds by default: every scope of today's powers except `all`, and the two new view switches. */
export const BASIC_ON: readonly CatalogRightId[] = [
  'project.create', 'client.create', 'project.details.lead', 'project.team.lead', 'project.stages.lead',
  'project.deadlines.lead', 'project.template.lead', 'project.archive.lead', 'project.leader.lead', 'project.health.lead',
  'project.seeAll', 'project.access.lead', 'task.add.office', 'task.add.team', 'task.assign', 'task.take', 'task.help', 'task.work', 'task.details', 'task.dates',
  'task.deleteOwn', 'task.any.lead', 'task.review.lead', 'meeting.plan.none', 'meeting.plan.team', 'meeting.editOwn',
  'meeting.minutesOwn', 'meeting.any.lead', 'meeting.minutesAny.lead', 'post.create.team', 'comment.create.team',
  'post.editOwn', 'project.links.team', 'file.upload.team', 'file.deliver.team', 'file.share', 'file.deleteOwn',
  'file.deleteAny.lead', 'chat.direct', 'chat.groupCreate', 'chat.groupChange', 'chat.project.team', 'chat.mentionEveryone', 'tracker.log.team',
  'tracker.reply', 'tracker.export', 'tracker.deleteOwn', 'tracker.deleteAny.lead', 'templates.taskSave.lead',
  'dashboard.view', 'workload.view', 'search.use', 'ai.connect', 'ai.readWork', 'ai.readChats', 'ai.todos', 'ai.posts',
  'ai.messages', 'ai.meetings', 'ai.tracker', 'ai.projects', 'ai.payments', 'ai.feedback', 'ai.report', 'ai.myState', 'ai.undo',
  'ai.undoOthers.lead', 'feedback.send',
];

/**
 * The switches that a built-in role holds beyond BASIC_ON when the office settings give it none. A Member holds none.
 * Management: the five people switches, the four payment switches and the office report. Accounting: the four payment switches.
 */
export const DEFAULT_EXTRA: Readonly<Record<'management' | 'accounting' | 'member', readonly CatalogRightId[]>> = {
  management: ['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'payment.view', 'payment.add', 'payment.change', 'payment.receive', 'report.office'],
  accounting: ['payment.view', 'payment.add', 'payment.change', 'payment.receive'],
  member: [],
};

/** The 17 old rights of 2026-10-23 and the switches that each one stands for. A stored list may still hold an old right (expandRights). */
export const LEGACY_RIGHTS: Readonly<Record<string, readonly CatalogRightId[]>> = {
  'project.editAny': ['project.details.all', 'project.team.all', 'project.stages.all', 'project.deadlines.all', 'project.template.all', 'project.health.all', 'templates.taskSave.all'],
  'project.changeLeaderAny': ['project.leader.all'],
  'project.archiveAny': ['project.archive.all'],
  'project.delete': ['project.delete.all'],
  'project.editCode': ['project.code'],
  'task.reviewAny': ['task.review.all'],
  'task.changeAny': ['task.any.all'],
  'people.manage': ['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove'],
  'clients.manage': ['clients.change'],
  'payment.manage': ['payment.view', 'payment.add', 'payment.change', 'payment.receive'],
  'templates.manageAll': ['templates.projectAny', 'templates.taskAny', 'templates.taskSave.all'],
  'agents.undoAny': ['ai.undoOthers.all'],
  'subCompanies.manage': ['subCompanies.manage'],
  'templates.updateProjects': ['templates.updateProjects'],
  'report.office': ['report.office'],
  'feedback.manage': ['feedback.manage'],
  'gaps.view': ['gaps.view'],
};

/** The 17 old rights, in their old order. */
export const LEGACY_RIGHT_IDS = ['project.editAny', 'project.changeLeaderAny', 'project.archiveAny', 'project.delete', 'project.editCode', 'task.reviewAny', 'task.changeAny', 'people.manage', 'clients.manage', 'payment.manage', 'templates.manageAll', 'agents.undoAny', 'subCompanies.manage', 'templates.updateProjects', 'report.office', 'feedback.manage', 'gaps.view'] as const;
export type LegacyRightId = (typeof LEGACY_RIGHT_IDS)[number];

/** The facts of one switch, found by its id. */
export type RightInfo = {
  readonly id: CatalogRightId; readonly power: string; readonly section: string; readonly scope: RightScope | null; readonly basic: boolean;
  readonly newPower: boolean; readonly needs: readonly CatalogRightId[];
};

/** Every switch with its power, section, scope and needs. */
export const RIGHT_INFO: Readonly<Record<CatalogRightId, RightInfo>> = Object.fromEntries(
  CATALOG_SECTIONS.flatMap((section) => section.powers.flatMap((power) => power.switches.map((item) => [item.id, {
    id: item.id, power: power.power, section: section.key, scope: item.scope, basic: item.basic, newPower: item.newPower === true, needs: item.needs,
  } satisfies RightInfo] as const))),
) as Record<CatalogRightId, RightInfo>;

/** The scope of each switch id (null for a power with one switch). */
export const RIGHT_SCOPE: Readonly<Record<CatalogRightId, RightScope | null>> = Object.fromEntries(
  CATALOG_RIGHT_IDS.map((id) => [id, RIGHT_INFO[id].scope]),
) as Record<CatalogRightId, RightScope | null>;

/** The switches that each switch needs (the sheet turns them on with it, and rightsOf adds them). */
export const RIGHT_NEEDS: Readonly<Record<CatalogRightId, readonly CatalogRightId[]>> = Object.fromEntries(
  CATALOG_RIGHT_IDS.map((id) => [id, RIGHT_INFO[id].needs]),
) as Record<CatalogRightId, readonly CatalogRightId[]>;

/** The MCP tools that each AI switch opens. A switch of another section opens none. */
export const MCP_TOOLS_BY_SWITCH: Readonly<Partial<Record<CatalogRightId, readonly string[]>>> = Object.fromEntries(
  CATALOG_SECTIONS.flatMap((section) => section.powers.flatMap((power) => (power.mcpTools ? [[power.switches[0].id, power.mcpTools] as const] : []))),
);

/** The switches of one power, in order. A power that has no switch gives an empty list. */
export function switchesOfPower(power: string): readonly CatalogRightId[] {
  return CATALOG_RIGHT_IDS.filter((id) => RIGHT_INFO[id].power === power);
}

const OLD_IDS: ReadonlySet<string> = new Set(LEGACY_RIGHT_IDS);

/** True when the text is one of the 17 old right names (an old id may also be a new id: subCompanies.manage). */
export const isLegacyRight = (id: string): id is LegacyRightId => OLD_IDS.has(id);

/** The 113 ids plus the old names that are not among them: the form of a stored list (StoredRight). */
export const STORED_RIGHT_IDS = [...CATALOG_RIGHT_IDS, ...LEGACY_RIGHT_IDS.filter((id) => !(CATALOG_RIGHT_IDS as readonly string[]).includes(id))] as [
  CatalogRightId, ...(CatalogRightId | LegacyRightId)[],
];

/**
 * The new ids of a stored list: an old right becomes the switches it stands for, a new id stays. Each id once, in the order of the
 * catalog. Needs are not added here (rightsOf adds them).
 */
export function expandRights(stored: readonly string[]): CatalogRightId[] {
  const out = new Set<string>();
  for (const id of stored) for (const next of LEGACY_RIGHTS[id] ?? [id]) out.add(next);
  return CATALOG_RIGHT_IDS.filter((id) => out.has(id));
}

/** The ids with the switches they need added, transitively. Each id once, in the order of the catalog. */
/**
 * The switches that stay when a stored list is read: a switch whose need on ANOTHER power is not in the list counts as off, again and again
 * until no switch drops (fail closed). Example: "Connect AI assistants" off turns every AI switch off. A need between two scopes of one power
 * ("Every project" needs "Projects I lead") does not drop: "Every project" covers the projects the person leads, and an old role with the
 * right to delete any project holds only "Every project". The role sheet uses withNeeds when a person turns a switch on.
 */
function crossNeed(id: CatalogRightId, need: CatalogRightId): boolean {
  return RIGHT_INFO[id].power !== RIGHT_INFO[need].power;
}

export function dropUnmetNeeds(ids: readonly CatalogRightId[]): CatalogRightId[] {
  const out = new Set<CatalogRightId>(ids);
  for (let again = true; again; ) {
    again = false;
    for (const id of [...out]) if (RIGHT_NEEDS[id].some((need) => crossNeed(id, need) && !out.has(need))) { out.delete(id); again = true; }
  }
  return CATALOG_RIGHT_IDS.filter((id) => out.has(id));
}

export function withNeeds(ids: readonly CatalogRightId[]): CatalogRightId[] {
  const out = new Set<CatalogRightId>(ids);
  for (let again = true; again; ) {
    again = false;
    for (const id of [...out]) for (const need of RIGHT_NEEDS[id]) if (!out.has(need)) { out.add(need); again = true; }
  }
  return CATALOG_RIGHT_IDS.filter((id) => out.has(id));
}
