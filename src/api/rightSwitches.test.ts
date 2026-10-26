import { describe, expect, it } from 'vitest';
import type { OfficeRight } from './contract/entities';
import { type Action, type Actor, can, type ProjectRole, type Resource } from './permissions';
import { BASIC_ON, CATALOG_RIGHT_IDS, RIGHT_INFO, withNeeds } from './rightsCatalog';
import { mayAssignTask, mayChangeTask, mayDeleteTask, mayTickChecklist, type TaskKind } from './taskGates';
import { makeUser } from '../test/factories';

/**
 * One test group for each of the 121 switches of role rights version 2 (design section 8): the switch on passes, the switch off
 * refuses, and the switch opens its own scope only. A lead switch does not open a project the person only works on. A team switch
 * does not open a project the person is not on. The person in each case holds the switch (with the switches it needs) and nothing else.
 */

const ME = 'usr_050';
const OTHER = 'usr_051';
const person = (rights: readonly OfficeRight[]): Actor => ({ ...makeUser(ME), officeRights: rights });

/** Every switch that is off for a person without `id`: all the other switches, minus the ones that need `id` (a dependant never stands alone). */
function allWithout(id: OfficeRight): OfficeRight[] {
  const dependants = new Set<string>([id]);
  for (let again = true; again; ) {
    again = false;
    for (const other of CATALOG_RIGHT_IDS) {
      if (!dependants.has(other) && RIGHT_INFO[other].needs.some((need) => dependants.has(need))) { dependants.add(other); again = true; }
    }
  }
  // See hidden projects also opens an open project, so a person without See every project must not hold it.
  if (id === 'project.seeAll') dependants.add('project.hidden');
  return CATALOG_RIGHT_IDS.filter((other) => !dependants.has(other));
}

type Where = 'leader' | 'team' | 'other';
/** The facts of an open project and of a hidden one, for a person who is not chosen. */
const OPEN = { hidden: false, chosen: false };
const HIDDEN = { hidden: true, chosen: false };

/** The action of a power, and the resource where the person's own rule is met. `where` is the place of the person in the project. */
type Spec = { action: Action; resource: (where: Where) => Resource; extra?: readonly OfficeRight[] };

const project = (action: Action): Spec => ({ action, resource: (where) => ({ projectRole: where }) });
const plain = (action: Action): Spec => ({ action, resource: () => ({}) });
/** A to-do that the person leads and made, in the project where they are `where`. */
const ownTask = (action: Action): Spec => ({ action, resource: (where) => ({ projectRole: where, ownerId: ME, makerId: ME }) });
const authored = (action: Action): Spec => ({ action, resource: (where) => ({ projectRole: where, authorId: ME }) });
const meeting = (action: Action, organizer: string, attendees: string[] = []): Spec => ({
  action, resource: (where) => ({ projectRole: where, meeting: { organizerId: organizer, attendeeIds: attendees, noProject: false } }),
});

/** The spec of each power: the action that its switches answer. */
const SPECS: Readonly<Record<string, Spec>> = {
  'project.create': plain('project.create'),
  'client.create': plain('client.create'),
  'project.details': project('project.details'),
  'project.team': project('project.team'),
  'project.stages': project('project.stages'),
  'project.deadlines': project('project.deadlines'),
  'project.template': project('project.template'),
  'project.archive': project('project.archive'),
  'project.leader': project('project.leader'),
  'project.health': project('project.health'),
  // The code passes only where the details pass: the person holds project.details.lead too.
  'project.code': { ...project('project.code'), extra: ['project.details.lead'] },
  'project.delete': project('project.delete'),
  // Hidden projects (owner, 2026-10-22): the three powers answer the view of a project, the choice of who sees it, and the hidden ones.
  'project.seeAll': project('project.view'),
  'project.access': project('project.access'),
  'project.hidden': project('project.view'),
  'task.add': project('task.add'),
  'task.assign': plain('task.assign'),
  'task.take': project('task.take'),
  'task.help': project('task.help'),
  'task.work': ownTask('task.work'),
  'task.details': ownTask('task.details'),
  'task.dates': ownTask('task.dates'),
  'task.deleteOwn': ownTask('task.deleteOwn'),
  'task.any': project('task.any'),
  'task.review': project('task.review'),
  'task.officeAll': plain('task.officeAll'),
  'meeting.plan': meeting('meeting.plan', OTHER),
  'meeting.editOwn': meeting('meeting.editOwn', ME),
  'meeting.minutesOwn': meeting('meeting.minutesOwn', OTHER, [ME]),
  'meeting.any': meeting('meeting.any', OTHER),
  'meeting.minutesAny': meeting('meeting.minutesAny', OTHER),
  'post.create': project('post.create'),
  'comment.create': project('comment.create'),
  'post.editOwn': authored('post.editOwn'),
  'project.links': project('project.links'),
  'file.upload': project('file.upload'),
  'file.deliver': project('file.deliver'),
  'file.share': plain('file.share'),
  'file.deleteOwn': authored('file.deleteOwn'),
  'file.deleteAny': project('file.deleteAny'),
  'chat.direct': plain('chat.direct'),
  'chat.groupCreate': plain('chat.groupCreate'),
  'chat.groupChange': plain('chat.groupChange'),
  'chat.mentionEveryone': plain('chat.mentionEveryone'),
  'chat.project': project('chat.project'),
  'tracker.log': project('tracker.log'),
  'tracker.reply': plain('tracker.reply'),
  'tracker.export': plain('tracker.export'),
  'tracker.deleteOwn': authored('tracker.deleteOwn'),
  'tracker.deleteAny': project('tracker.deleteAny'),
  'people.invite': plain('people.invite'),
  'people.change': plain('people.change'),
  'people.teams': plain('people.teams'),
  'people.turnOff': plain('people.turnOff'),
  'people.remove': plain('people.remove'),
  'clients.change': plain('clients.change'),
  'subCompanies.manage': plain('subCompanies.manage'),
  'payment.view': plain('payment.view'),
  'payment.add': plain('payment.add'),
  'payment.change': plain('payment.change'),
  'payment.receive': plain('payment.receive'),
  'payment.daftraLink': plain('payment.daftraLink'),
  'templates.projectCreate': plain('templates.projectCreate'),
  'templates.projectAny': plain('templates.projectAny'),
  'templates.taskSave': project('templates.taskSave'),
  'templates.taskAny': plain('templates.taskAny'),
  'templates.updateProjects': plain('templates.updateProjects'),
  'dashboard.view': plain('dashboard.view'),
  'workload.view': plain('workload.view'),
  'search.use': plain('search.use'),
  'gaps.view': plain('gaps.view'),
  'report.office': plain('report.office'),
  'ai.connect': plain('ai.connect'),
  'ai.readWork': plain('ai.readWork'),
  'ai.readChats': plain('ai.readChats'),
  'ai.todos': plain('ai.todos'),
  'ai.posts': plain('ai.posts'),
  'ai.messages': plain('ai.messages'),
  'ai.meetings': plain('ai.meetings'),
  'ai.tracker': plain('ai.tracker'),
  'ai.projects': plain('ai.projects'),
  'ai.projectSetup': plain('ai.projectSetup'),
  'ai.admin': plain('ai.admin'),
  'ai.myState': plain('ai.myState'),
  'ai.payments': plain('ai.payments'),
  'ai.feedback': plain('ai.feedback'),
  'ai.report': plain('ai.report'),
  'ai.undo': plain('ai.undo'),
  'ai.undoOthers': project('ai.undoOthers'),
  'feedback.send': plain('feedback.send'),
  'feedback.manage': plain('feedback.manage'),
  'office.settings': plain('office.settings'),
};

/** A meeting with no project: the person is the organizer or an attendee, as the power needs. */
function noProjectMeeting(power: string): Resource {
  return { meeting: { organizerId: power === 'meeting.editOwn' ? ME : OTHER, attendeeIds: power === 'meeting.minutesOwn' ? [ME] : [], noProject: true } };
}

/** The resource where the switch should pass, for the scope of the switch, and the resources where it should refuse. */
function casesOf(id: OfficeRight): { pass: Resource[]; refuse: Resource[] } {
  const { power, scope } = RIGHT_INFO[id];
  const spec = SPECS[power];
  const at = (where: Where) => spec.resource(where);
  if (power === 'task.add' && scope === 'office') return { pass: [{ office: true }], refuse: [at('team'), at('leader'), at('other')] };
  if (power === 'meeting.plan' && scope === 'none') {
    return { pass: [{ meeting: { organizerId: OTHER, attendeeIds: [], noProject: true } }], refuse: [at('team'), at('leader'), at('other')] };
  }
  if (power === 'project.seeAll') return { pass: [{ projectRole: 'other', access: OPEN }], refuse: [{ projectRole: 'other', access: HIDDEN }] };
  if (power === 'project.hidden') return { pass: [{ projectRole: 'other', access: HIDDEN }], refuse: [] };
  if (power === 'meeting.editOwn' || power === 'meeting.minutesOwn') {
    // Own powers: the people rule must hold too. A meeting of another organizer refuses.
    const other: Resource = { ...at('team'), meeting: { organizerId: OTHER, attendeeIds: [], noProject: false } };
    return { pass: [at('team'), at('other'), noProjectMeeting(power)], refuse: [other] };
  }
  if (power === 'task.work' || power === 'task.details' || power === 'task.dates' || power === 'task.deleteOwn') {
    // The person leads and made the to-do. A to-do of other people refuses.
    return { pass: [at('team'), at('leader')], refuse: [{ projectRole: 'team', ownerId: OTHER, makerId: OTHER }, at('other')] };
  }
  if (power === 'post.editOwn' || power === 'file.deleteOwn' || power === 'tracker.deleteOwn') {
    return { pass: [at('team'), at('leader')], refuse: [{ projectRole: 'team', authorId: OTHER }, at('other')] };
  }
  // The code passes where the details pass: for the leader of the project, when the person holds the lead switch of the details.
  if (power === 'project.code') return { pass: [at('leader')], refuse: [at('team'), at('other')] };
  if (scope === 'lead') return { pass: [at('leader')], refuse: [at('team'), at('other')] };
  if (scope === 'team') return { pass: [at('leader'), at('team')], refuse: [at('other')] };
  if (scope === 'all') return { pass: [at('other'), at('team'), at('leader')], refuse: [] };
  // A power with one switch.
  if (power === 'task.take' || power === 'task.help') return { pass: [at('team'), at('leader')], refuse: [at('other')] };
  if (power === 'task.officeAll') return { pass: [{ office: true, makerId: OTHER, ownerId: null }], refuse: [] };
  return { pass: [at('team')], refuse: [] };
}

/** The action to ask for a case. The office-all switch is read through the view of an office to-do of other people. */
function actionOf(id: OfficeRight): Action {
  return RIGHT_INFO[id].power === 'task.officeAll' ? 'task.view' : SPECS[RIGHT_INFO[id].power].action;
}

describe('the 121 switches of role rights version 2', () => {
  it('has a spec for each power of the catalog', () => {
    for (const id of CATALOG_RIGHT_IDS) expect(SPECS[RIGHT_INFO[id].power], id).toBeDefined();
  });

  describe.each(CATALOG_RIGHT_IDS.map((id) => [id]))('%s', (id) => {
    const extra = SPECS[RIGHT_INFO[id].power].extra ?? [];
    const { pass, refuse } = casesOf(id);
    const action = actionOf(id);

    it('passes with the switch on, in the scope of the switch', () => {
      const holder = person(withNeeds([id, ...extra]));
      for (const resource of pass) expect(can(holder, action, resource), JSON.stringify(resource)).toBe(true);
    });

    it('refuses with the switch off, also for a person who holds every other switch', () => {
      const holder = person(allWithout(id));
      // The all switch is the only way in to a project the person does not work on: the lead and team switches still open the others.
      const places = RIGHT_INFO[id].scope === 'all' ? pass.slice(0, 1) : pass;
      for (const resource of places) expect(can(holder, action, resource), JSON.stringify(resource)).toBe(false);
    });

    it('opens its own scope only, and nothing for a person who holds no switch', () => {
      const holder = person(withNeeds([id, ...extra]));
      for (const resource of refuse) expect(can(holder, action, resource), JSON.stringify(resource)).toBe(false);
      const empty = person([]);
      for (const resource of pass) expect(can(empty, action, resource), `no switch ${JSON.stringify(resource)}`).toBe(false);
    });
  });
});

describe('what a switch opens besides its own power', () => {
  it('opens nothing of the neighbour powers: each switch alone answers its own action only', () => {
    // A person who holds only one switch of a plain power passes no other plain power.
    const plains = Object.entries(SPECS).filter(([, spec]) => spec.resource('team') && Object.keys(spec.resource('team')).length === 0 && spec.action !== 'task.officeAll');
    for (const [power, spec] of plains) {
      const id = CATALOG_RIGHT_IDS.find((item) => RIGHT_INFO[item].power === power)!;
      const holder = person(withNeeds([id]));
      const passed = plains.filter(([, other]) => can(holder, other.action, {})).map(([, other]) => other.action);
      const allowed = new Set<Action>([spec.action, ...withNeeds([id]).filter((need) => SPECS[RIGHT_INFO[need].power]?.action).map((need) => SPECS[RIGHT_INFO[need].power].action)]);
      expect(passed.filter((name) => !allowed.has(name)), id).toEqual([]);
    }
  });

  it('gives the code only where the details pass: project.code alone opens nothing', () => {
    const codeOnly = person(['project.code']);
    for (const where of ['leader', 'team', 'other'] as ProjectRole[]) expect(can(codeOnly, 'project.code', { projectRole: where }), where).toBe(false);
    const both = person(['project.code', 'project.details.lead']);
    expect(can(both, 'project.code', { projectRole: 'leader' })).toBe(true);
    expect(can(both, 'project.code', { projectRole: 'team' })).toBe(false);
    const all = person(['project.code', 'project.details.lead', 'project.details.all']);
    expect(can(all, 'project.code', { projectRole: 'other' })).toBe(true);
  });

  it('keeps an office to-do private without task.officeAll, and gives it the view and the place of the maker with the switch', () => {
    const office: Resource = { office: true, makerId: OTHER, ownerId: null, helperIds: [] };
    const without = person(allWithout('task.officeAll'));
    for (const action of ['task.view', 'comment.read', 'task.take', 'task.review', 'task.deleteOwn', 'task.work', 'task.details', 'task.dates'] as Action[]) {
      expect(can(without, action, office), action).toBe(false);
    }
    const holder = person(['task.officeAll']);
    for (const action of ['task.view', 'comment.read', 'task.review'] as Action[]) expect(can(holder, action, office), action).toBe(true);
  });

  it('lets a leader without the review switch review nothing, and gives the review to the all switch', () => {
    const noReview = person(allWithout('task.review.lead'));
    expect(can(noReview, 'task.review', { projectRole: 'leader' })).toBe(false);
    expect(can(person(['task.review.lead']), 'task.review', { projectRole: 'leader' })).toBe(true);
    expect(can(person(['task.review.lead', 'task.review.all']), 'task.review', { projectRole: 'other' })).toBe(true);
  });

  it('lets the change of any to-do pass every kind of change on a project, and never an office to-do', () => {
    const holder = person(['task.any.lead']);
    const kinds: TaskKind[] = ['details', 'dates', 'work'];
    const led = { projectRole: 'leader' as const, makerId: OTHER, ownerId: OTHER };
    const team = { projectRole: 'team' as const, makerId: OTHER, ownerId: OTHER };
    const office = { office: true, makerId: OTHER, ownerId: OTHER };
    expect(can(holder, 'task.any', led)).toBe(true);
    expect(can(holder, 'task.any', team)).toBe(false);
    expect(can(holder, 'task.any', office)).toBe(false);
    for (const kind of kinds) {
      expect(mayChangeTask(holder, kind, led), kind).toBe(true);
      expect(mayChangeTask(holder, kind, team), `team ${kind}`).toBe(false);
      expect(mayChangeTask(holder, kind, office), `office ${kind}`).toBe(false);
    }
    expect(mayAssignTask(holder, led)).toBe(true);
    expect(mayDeleteTask(holder, led)).toBe(true);
    expect(mayTickChecklist(holder, led)).toBe(true);
  });

  it('keeps the people rule of an own power: a switch does not open the to-do of another person', () => {
    const holder = person(['task.work', 'task.details', 'task.dates', 'task.deleteOwn']);
    for (const action of ['task.work', 'task.details', 'task.dates', 'task.deleteOwn'] as Action[]) {
      expect(can(holder, action, { projectRole: 'team', makerId: OTHER, ownerId: OTHER }), action).toBe(false);
      expect(can(holder, action, { projectRole: 'team', makerId: OTHER, ownerId: ME }), `lead ${action}`).toBe(true);
      expect(can(holder, action, { projectRole: 'team', makerId: ME, ownerId: OTHER }), `maker ${action}`).toBe(true);
    }
  });

  it('lets a helper tick with the work switch, and refuses the tick without it', () => {
    const resource: Resource = { projectRole: 'team', makerId: OTHER, ownerId: OTHER, helperIds: [ME] };
    expect(mayTickChecklist(person(['task.work']), resource)).toBe(true);
    // A Member with every basic switch but the work switch: no all switch opens the project.
    expect(mayTickChecklist(person(BASIC_ON.filter((id) => id !== 'task.work')), resource)).toBe(false);
  });

  it('asks the assign switch for a to-do made for another person', () => {
    const forAnyone = (holder: Actor, resource: Resource) => can(holder, 'task.add', resource) && can(holder, 'task.assign');
    expect(forAnyone(person(['task.add.team', 'task.assign']), { projectRole: 'team' })).toBe(true);
    expect(forAnyone(person(['task.add.team']), { projectRole: 'team' })).toBe(false);
    expect(can(person(['task.add.team']), 'task.add', { projectRole: 'team' })).toBe(true);
    expect(forAnyone(person(['task.add.office', 'task.assign']), { office: true })).toBe(true);
  });

  it('gives the Admin every power on every spec, whatever is attached', () => {
    const admin: Actor = { ...makeUser('usr_001', { systemRole: 'admin' }), officeRights: [] };
    for (const id of CATALOG_RIGHT_IDS) {
      const { pass } = casesOf(id);
      // An own power passes for the Admin on a to-do that the Admin leads or made, as the people rule says.
      const resources = pass.map((resource) => ({ ...resource, ...(resource.ownerId === ME ? { ownerId: admin.id, makerId: admin.id } : {}), ...(resource.authorId === ME ? { authorId: admin.id } : {}) }));
      for (const resource of resources) {
        if (resource.meeting) continue;
        expect(can(admin, actionOf(id), resource), `${id} ${JSON.stringify(resource)}`).toBe(true);
      }
    }
  });
});
