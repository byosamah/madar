import { beforeEach, describe, expect, it } from 'vitest';
import type { RoleSettings } from '../contract/entities';
import { calls } from '../calls';
import { activeAdmins, feedbackNoticeHidden, visibleTriggers } from '../notify';
import { withRights } from '../rights';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The leak tests of the four rights that take the place of admin.manage (role-rights, owner 2026-10-23): feedback.manage, gaps.view,
 * subCompanies.manage and templates.updateProjects. A person without the right is refused or gets null on every call, every notice
 * path and every change path. A person with the right gets them, and an agent acts with the rights of its person.
 *
 * usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside and sends the report.
 * usr_006 is Management. usr_011 holds feedback.manage, usr_012 gaps.view, usr_013 subCompanies.manage, usr_014 templates.updateProjects,
 * usr_016 holds report.office and gaps.view. usr_015 is the agent of usr_011, usr_017 the agent of usr_013, usr_018 the agent of usr_003.
 */
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Reports reader', nameAr: 'قارئ البلاغات', rights: ['feedback.manage'] },
    { id: 'rol_002', name: 'Gap reader', nameAr: 'قارئ النواقص', rights: ['gaps.view'] },
    { id: 'rol_003', name: 'Companies', nameAr: 'الشركات', rights: ['subCompanies.manage'] },
    { id: 'rol_004', name: 'Updater', nameAr: 'محدّث القوالب', rights: ['templates.updateProjects'] },
    { id: 'rol_005', name: 'Office reader', nameAr: 'قارئ المكتب', rights: ['report.office', 'gaps.view'] },
  ],
};
const ADMIN = 'usr_001';
const MEMBER = 'usr_003';
const SENDER = 'usr_004';
const MANAGEMENT = 'usr_006';
const FEEDBACK = 'usr_011';
const GAPS = 'usr_012';
const COMPANIES = 'usr_013';
const UPDATER = 'usr_014';
const OFFICE = 'usr_016';
const MESSAGE = 'The fee screen shows the wrong total for the Rashid villa.';

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = structuredClone(ROLES);
  const people = [
    makeUser(MANAGEMENT, { name: 'Turki Management', systemRole: 'management' }),
    makeUser(FEEDBACK, { name: 'Reports Person', roleId: 'rol_001' }),
    makeUser(GAPS, { name: 'Gaps Person', roleId: 'rol_002' }),
    makeUser(COMPANIES, { name: 'Companies Person', roleId: 'rol_003' }),
    makeUser(UPDATER, { name: 'Updater Person', roleId: 'rol_004' }),
    makeUser('usr_015', { name: 'Reports Agent', kind: 'agent', discipline: 'Agent', ownerId: FEEDBACK }),
    makeUser(OFFICE, { name: 'Office Person', roleId: 'rol_005' }),
    makeUser('usr_017', { name: 'Companies Agent', kind: 'agent', discipline: 'Agent', ownerId: COMPANIES }),
    makeUser('usr_018', { name: 'Member Agent', kind: 'agent', discipline: 'Agent', ownerId: MEMBER }),
  ];
  for (const user of people) state.users[user.id] = user;
  state.counters.usr = 18;
  state.counters.rol = 5;
  return t;
}
type World = ReturnType<typeof world>;

const error = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: Record<string, unknown> };
    return { code, message, details };
  }
};

/** A report from the outsider, with one screenshot. */
async function sent(t: World) {
  t.as(SENDER);
  return t.api.call('feedback.send', { kind: 'bug', message: MESSAGE, page: '/projects', screenshots: [new Blob(['shot'], { type: 'image/png' })] }, { correlationId: 'cor_send' });
}

const FORBIDDEN = (action: string) => ({ code: 'forbidden', message: 'You cannot do this.', details: { action } });
const NO_FEEDBACK_RIGHT = [MEMBER, MANAGEMENT, GAPS, COMPANIES, UPDATER, OFFICE, 'usr_017', 'usr_018', SENDER];

describe('feedback.manage: the reports of people', () => {
  it('refuses every report call to a person without the right, with the same answer for a real and a fake report', async () => {
    const t = world();
    const report = await sent(t);
    const counts = () => ({ events: Object.keys(t.store.state.events).length, notices: Object.keys(t.store.state.notifications).length });
    const before = counts();
    for (const userId of NO_FEEDBACK_RIGHT) {
      t.as(userId);
      expect(await error(() => t.api.call('feedback.list', {})), userId).toEqual(FORBIDDEN('feedback.manage'));
      for (const id of [report.id, 'fbk_999']) {
        expect(await error(() => t.api.call('feedback.screenshot', { id, index: 0 })), `${userId} ${id}`).toEqual(FORBIDDEN('feedback.manage'));
        for (const status of ['new', 'done'] as const) {
          expect(await error(() => t.api.call('feedback.setStatus', { id, status })), `${userId} ${id} ${status}`).toEqual(FORBIDDEN('feedback.manage'));
        }
      }
    }
    expect(counts()).toEqual(before);
    expect(t.store.state.feedback?.[report.id]?.status).toBe('new');
  });

  it('gives the right to read, open a screenshot and mark done, for the person and for its agent', async () => {
    const t = world();
    const report = await sent(t);
    for (const userId of [FEEDBACK, 'usr_015', ADMIN]) {
      t.as(userId);
      const list = await t.api.call('feedback.list', {});
      expect(list.map((row) => row.item.id), userId).toEqual([report.id]);
      expect(await t.api.call('feedback.screenshot', { id: report.id, index: 0 })).toHaveProperty('blob');
    }
    t.as(FEEDBACK);
    const done = await t.api.call('feedback.setStatus', { id: report.id, status: 'done' });
    expect(done).toMatchObject({ status: 'done', doneBy: FEEDBACK });
    // The sender hears of it, as when the Admin marks it.
    expect(Object.values(t.store.state.notifications).filter((n) => n.trigger === 'feedback_done').map((n) => n.userId)).toEqual([SENDER]);
    // The agent of the holder acts with the right of its person.
    t.as('usr_015');
    expect(await t.api.call('feedback.setStatus', { id: report.id, status: 'new' })).toMatchObject({ status: 'new' });
  });

  it('sends the new-report notice to the Admin and to the holders, and to nobody else', async () => {
    const t = world();
    await sent(t);
    const ids = Object.values(t.store.state.notifications).filter((n) => n.trigger === 'feedback_sent').map((n) => n.userId).sort();
    expect(ids).toEqual([ADMIN, FEEDBACK].sort());
    expect(activeAdmins(t.store.state).sort()).toEqual([ADMIN, FEEDBACK].sort());
  });

  it('shows the notice to the holder, and hides it as gone from a person who lost the right', async () => {
    const t = world();
    const report = await sent(t);
    t.as(FEEDBACK);
    const live = (await t.api.call('notifications.list', {})).filter((view) => view.notification.trigger === 'feedback_sent');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ gone: false });
    expect(live[0].link).toBe('/admin/feedback');
    // The Admin takes the right away: the notice reads as gone and names nothing.
    t.as(ADMIN);
    t.store.state.users[FEEDBACK].roleId = undefined;
    t.as(FEEDBACK);
    const list = await t.api.call('notifications.list', {});
    const hidden = list.filter((view) => view.notification.trigger === 'feedback_sent');
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({ gone: true, target: '', actor: null, link: '' });
    const json = JSON.stringify(list);
    expect(json).not.toContain(MESSAGE.slice(0, 20));
    expect(json).not.toContain(report.id);
  });

  it('shows the switch of the new-report notice only to a person who holds the right', () => {
    const t = world();
    const state = t.store.state;
    const holder = withRights(state, state.users[FEEDBACK]);
    expect(visibleTriggers(holder)).toContain('feedback_sent');
    for (const userId of [MEMBER, MANAGEMENT, GAPS, COMPANIES]) expect(visibleTriggers(withRights(state, state.users[userId])), userId).not.toContain('feedback_sent');
    // A person with no rights attached holds none: the switch fails closed.
    expect(visibleTriggers(state.users[FEEDBACK])).not.toContain('feedback_sent');
    expect(visibleTriggers(state.users[ADMIN])).toContain('feedback_sent');
  });

  it('hides the new-report notice from a person without the right, by the one rule feedbackNoticeHidden', () => {
    const t = world();
    const state = t.store.state;
    const notice = { targetType: 'feedback' as const, trigger: 'feedback_sent' as const };
    expect(feedbackNoticeHidden(notice, withRights(state, state.users[FEEDBACK]))).toBe(false);
    expect(feedbackNoticeHidden(notice, withRights(state, state.users[ADMIN]))).toBe(false);
    for (const userId of [MEMBER, MANAGEMENT, GAPS, COMPANIES]) expect(feedbackNoticeHidden(notice, withRights(state, state.users[userId])), userId).toBe(true);
    // The done notice always shows to its owner.
    expect(feedbackNoticeHidden({ targetType: 'feedback', trigger: 'feedback_done' }, withRights(state, state.users[SENDER]))).toBe(false);
  });

  it('gives the History of a report to a holder, and nothing of it to a person without the right', async () => {
    const t = world();
    const report = await sent(t);
    t.as(FEEDBACK);
    await t.api.call('feedback.setStatus', { id: report.id, status: 'done' }, { correlationId: 'cor_done' });
    expect((await t.api.call('events.list', { targetType: 'feedback' })).length).toBe(2);
    for (const userId of NO_FEEDBACK_RIGHT) {
      t.as(userId);
      expect(await t.api.call('events.list', { targetType: 'feedback' }), userId).toEqual([]);
      expect(await t.api.call('events.list', { targetId: report.id }), userId).toEqual([]);
      expect(JSON.stringify(await t.api.call('events.list', { limit: 500 })), userId).not.toContain(MESSAGE);
    }
  });

  it('lets the holder take back a change of a report, and refuses the Undo to a person without the right, with no report data', async () => {
    const t = world();
    const report = await sent(t);
    t.as(FEEDBACK);
    await t.api.call('feedback.setStatus', { id: report.id, status: 'done' }, { correlationId: 'cor_done' });
    const change = Object.values(t.store.state.events).find((e) => e.verb === 'feedback.status_changed')!;
    for (const userId of NO_FEEDBACK_RIGHT) {
      t.as(userId);
      for (const run of [() => t.api.call('events.undo', { eventId: change.id }), () => t.api.call('events.undoStory', { correlationId: 'cor_done' })]) {
        const answer = await error(run);
        expect(answer?.code, userId).toMatch(/forbidden|not_found/);
        expect(JSON.stringify(answer)).not.toContain(MESSAGE);
      }
    }
    expect(t.store.state.feedback?.[report.id]?.status).toBe('done');
    t.as(FEEDBACK);
    await t.api.call('events.undo', { eventId: change.id });
    expect(t.store.state.feedback?.[report.id]?.status).toBe('new');
  });
});

describe('gaps.view: the data gaps of the Dashboard and of the office report', () => {
  it('gives the Dashboard gaps to the Admin and to a holder, and null to every other person', async () => {
    const t = world();
    for (const userId of [ADMIN, GAPS, OFFICE]) {
      t.as(userId);
      expect((await t.api.call('dashboard.get', {})).gaps, userId).not.toBeNull();
    }
    for (const userId of [MEMBER, MANAGEMENT, FEEDBACK, COMPANIES, UPDATER, 'usr_018']) {
      t.as(userId);
      expect((await t.api.call('dashboard.get', {})).gaps, userId).toBeNull();
    }
  });

  it('gives an agent the gaps of its person: yes for the agent of a holder, no for the agent of a Member', async () => {
    const t = world();
    t.store.state.users.usr_018.ownerId = GAPS;
    t.as('usr_018');
    expect((await t.api.call('dashboard.get', {})).gaps).not.toBeNull();
    t.store.state.users.usr_018.ownerId = MEMBER;
    expect((await t.api.call('dashboard.get', {})).gaps).toBeNull();
  });

  it('keeps the gap lines of the office report from a person who holds the report right but not the gaps right', async () => {
    const t = world();
    // Management holds report.office by default; it does not hold gaps.view.
    t.as(MANAGEMENT);
    expect((await t.api.call('reports.office', { period: 'month' })).gaps).toBeNull();
    t.as(OFFICE);
    expect((await t.api.call('reports.office', { period: 'month' })).gaps).not.toBeNull();
    t.as(ADMIN);
    expect((await t.api.call('reports.office', { period: 'month' })).gaps).not.toBeNull();
  });

  it('does not open the office report to a person who holds only the gaps right', async () => {
    const t = world();
    t.as(GAPS);
    expect(await error(() => t.api.call('reports.office', { period: 'month' }))).toMatchObject({ code: 'forbidden' });
  });
});

describe('subCompanies.manage: the sub-companies of the office group', () => {
  const SUB = { name: 'Vado', nameAr: 'فادو', logo: null };

  it('refuses the save and the delete to a person without the right, and writes nothing', async () => {
    const t = world();
    t.as(ADMIN);
    const vado = await t.api.call('subCompanies.save', SUB);
    const before = Object.keys(t.store.state.events).length;
    for (const userId of [MEMBER, MANAGEMENT, FEEDBACK, GAPS, UPDATER, OFFICE, 'usr_018']) {
      t.as(userId);
      expect(await error(() => t.api.call('subCompanies.save', { name: 'Other', nameAr: 'آخر', logo: null })), userId).toEqual(FORBIDDEN('subCompanies.manage'));
      expect(await error(() => t.api.call('subCompanies.save', { id: vado.id, ...SUB })), userId).toEqual(FORBIDDEN('subCompanies.manage'));
      expect(await error(() => t.api.call('subCompanies.delete', { id: vado.id })), userId).toEqual(FORBIDDEN('subCompanies.manage'));
    }
    expect(Object.keys(t.store.state.events).length).toBe(before);
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual([vado.id]);
  });

  it('lets the holder, and the agent of the holder, save and delete', async () => {
    const t = world();
    t.as(COMPANIES);
    const vado = await t.api.call('subCompanies.save', SUB);
    expect(vado).toMatchObject({ name: 'Vado', createdBy: COMPANIES });
    t.as('usr_017');
    expect(await t.api.call('subCompanies.save', { id: vado.id, name: 'Vado Group', nameAr: 'مجموعة فادو', logo: null })).toMatchObject({ name: 'Vado Group' });
    t.as(COMPANIES);
    await t.api.call('subCompanies.delete', { id: vado.id });
    expect(Object.keys(t.store.state.subCompanies ?? {})).toEqual([]);
  });

  it('lets the holder take back a sub-company change, but never an agent, and never a person without the right', async () => {
    const t = world();
    t.as(COMPANIES);
    const vado = await t.api.call('subCompanies.save', SUB, { correlationId: 'cor_sub' });
    const made = Object.values(t.store.state.events).find((e) => e.targetType === 'subCompany')!;
    // The agent of the holder never undoes a sub-company event (the agent rule stays).
    t.as('usr_017');
    expect(await error(() => t.api.call('events.undo', { eventId: made.id }))).toMatchObject({ code: 'forbidden' });
    expect(await error(() => t.api.call('events.undoStory', { correlationId: 'cor_sub' }))).toMatchObject({ code: 'forbidden' });
    expect(t.store.state.subCompanies?.[vado.id]).toBeDefined();
    t.as(MEMBER);
    expect(await error(() => t.api.call('events.undo', { eventId: made.id }))).toMatchObject({ code: 'forbidden' });
    t.as(COMPANIES);
    await t.api.call('events.undo', { eventId: made.id });
    expect(t.store.state.subCompanies?.[vado.id]).toBeUndefined();
  });

  it('still lists the sub-companies for everyone', async () => {
    const t = world();
    t.as(COMPANIES);
    await t.api.call('subCompanies.save', SUB);
    t.as(MEMBER);
    expect((await t.api.call('subCompanies.list', {})).map((item) => item.name)).toEqual(['Vado']);
  });
});

describe('templates.updateProjects: the update of the projects that follow a template', () => {
  const TEMPLATE = {
    name: 'Villa',
    roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
    stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
    tasks: [{ id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true }],
  };
  const CHOICES = { add: true, bringBack: false, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false, edited: 'keep' } as const;

  /** A template and a project that follows it, made by the Admin. */
  async function linked(t: World) {
    t.as(ADMIN);
    const template = await t.api.call('projectTemplates.save', TEMPLATE as never);
    const { project } = await t.api.call('projects.create', { name: 'Rashid villa', template: { templateId: template.id, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    return { templateId: template.id, projectId: project.id };
  }

  it('refuses usage, the update plan and the full update to a person without the right, the project leader too', async () => {
    const t = world();
    const { templateId, projectId } = await linked(t);
    const tasks = Object.keys(t.store.state.tasks).length;
    // usr_002 leads prj_001 and is the lead of the role. usr_003 is on its team.
    for (const userId of [MEMBER, 'usr_002', MANAGEMENT, FEEDBACK, GAPS, COMPANIES, OFFICE, 'usr_018']) {
      t.as(userId);
      expect(await error(() => t.api.call('projectTemplates.usage', { templateId })), userId).toEqual(FORBIDDEN('templates.updateProjects'));
      expect(await error(() => t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [projectId] })), userId).toEqual(FORBIDDEN('templates.updateProjects'));
      expect(await error(() => t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: CHOICES })), userId).toEqual(FORBIDDEN('templates.updateProjects'));
    }
    expect(Object.keys(t.store.state.tasks).length).toBe(tasks);
  });

  it('lets the holder, and nobody else, read the usage and the plan, and send the full update', async () => {
    const t = world();
    const { templateId, projectId } = await linked(t);
    t.as(UPDATER);
    expect((await t.api.call('projectTemplates.usage', { templateId })).linked.map((row) => row.project.id)).toEqual([projectId]);
    expect((await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [projectId] })).map((row) => row.project.id)).toEqual([projectId]);
    expect(await t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: CHOICES })).toBeDefined();
  });

  it('gives the number of followers only to the Admin and the holder', async () => {
    const t = world();
    const { templateId } = await linked(t);
    for (const userId of [ADMIN, UPDATER]) {
      t.as(userId);
      expect((await t.api.call('projectTemplates.list', {})).find((row) => row.id === templateId)?.followers, userId).toBe(1);
    }
    for (const userId of [MEMBER, 'usr_002', MANAGEMENT, FEEDBACK]) {
      t.as(userId);
      const row = (await t.api.call('projectTemplates.list', {})).find((one) => one.id === templateId)!;
      expect('followers' in row, userId).toBe(false);
    }
  });

  it('does not give the right to change or delete a template that another person made', async () => {
    const t = world();
    const { templateId } = await linked(t);
    t.as(UPDATER);
    expect(await error(() => t.api.call('projectTemplates.save', { ...TEMPLATE, id: templateId, name: 'Villa 2' } as never))).toMatchObject({ code: 'forbidden' });
    expect(await error(() => t.api.call('projectTemplates.delete', { id: templateId }))).toMatchObject({ code: 'forbidden' });
  });
});
