import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addProjectConversation } from '../chatState';
import type { OfficeRight, StoredRight } from '../contract/entities';
import { nextId } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The gates of the office track of role rights version 2 (design sections 5.1, 5.8 to 5.11, 5.13): projects, people, clients,
 * money, templates, Dashboard, Search, office settings and requests. For each gate: the switch on passes, the switch off refuses, the
 * scope (lead, team, all) opens its own projects only, and the agent of a person without the switch is refused.
 *
 * The office of the factories: usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside it, usr_005
 * is the agent of usr_003. usr_006 is the agent of the leader usr_002.
 */

type RoleSpec = { rights?: readonly StoredRight[]; off?: readonly OfficeRight[] };

/** The office. "roles" gives a custom role to a person: the held ids, plus the ids that are off (a role with an off list is a full list). */
function world(roles: Readonly<Record<string, RoleSpec>> = {}) {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Leader Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  state.counters.usr = 6;
  const custom = Object.entries(roles).map(([userId, spec], index) => {
    const id = `rol_${String(index + 1).padStart(3, '0')}`;
    state.users[userId].roleId = id;
    return { id, name: `Role ${index + 1}`, nameAr: `دور ${index + 1}`, rights: [...(spec.rights ?? [])], ...(spec.off ? { off: [...spec.off] } : {}) };
  });
  if (custom.length > 0) {
    state.settings.roles = { custom };
    state.counters.rol = custom.length;
  }
  return t;
}
type World = ReturnType<typeof world>;

const call = (t: World, name: string, input: unknown) => t.api.call(name as never, input as never) as Promise<unknown>;

/** "ok", or the error code of the refusal. */
async function attempt(t: World, userId: string, name: string, input: unknown): Promise<string> {
  t.as(userId);
  try {
    await call(t, name, input);
    return 'ok';
  } catch (error) {
    return (error as { code: string }).code;
  }
}

const LEADER = 'usr_002';
const TEAM = 'usr_003';
const OUTSIDER = 'usr_004';
const TEAM_AGENT = 'usr_005';
const LEADER_AGENT = 'usr_006';

describe('the powers of a project', () => {
  /** power: the id of the power. off: every lead and team switch of it. all: the switch for every project. input: a call that the power opens. */
  type Case = { power: string; call: string; input: unknown; off: OfficeRight[]; all: OfficeRight; teamPasses?: boolean; setup?: (t: World) => Promise<void> };
  const CASES: readonly Case[] = [
    { power: 'project.details', call: 'projects.update', input: { id: 'prj_001', patch: { description: 'A new text.' } }, off: ['project.details.lead'], all: 'project.details.all' },
    { power: 'project.team', call: 'members.add', input: { projectId: 'prj_001', userId: OUTSIDER, discipline: 'Architect' }, off: ['project.team.lead'], all: 'project.team.all' },
    {
      power: 'project.stages', call: 'stages.setDates', input: { stageId: 'stg_002', startDate: '2026-09-01', endDate: '2026-10-20' },
      off: ['project.stages.lead'], all: 'project.stages.all',
    },
    {
      power: 'project.deadlines', call: 'deadlines.create', input: { projectId: 'prj_001', name: 'Site survey', date: '2026-10-12' },
      off: ['project.deadlines.lead'], all: 'project.deadlines.all',
    },
    { power: 'project.leader', call: 'projects.setLeader', input: { id: 'prj_001', leaderId: TEAM }, off: ['project.leader.lead'], all: 'project.leader.all' },
    {
      power: 'project.health', call: 'projects.setHealthOverride', input: { id: 'prj_001', value: 'at_risk', reason: 'Client delay' },
      off: ['project.health.lead'], all: 'project.health.all',
    },
    {
      power: 'project.links', call: 'projects.addLink', input: { projectId: 'prj_001', kind: 'moodboard', label: 'Facades', url: 'https://www.pinterest.com/office/facades/' },
      off: ['project.links.team'], all: 'project.links.all', teamPasses: true,
    },
    {
      power: 'project.template', call: 'projectTemplates.matchPlan', input: { projectId: 'prj_001', templateId: 'ptp_001' }, off: ['project.template.lead'], all: 'project.template.all',
      setup: async (t) => {
        t.as('usr_001');
        await call(t, 'projectTemplates.save', {
          name: 'Short villa', roles: [], stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
          tasks: [{ id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 0, durationDays: 5, flexible: true }],
        });
      },
    },
  ];

  for (const item of CASES) {
    describe(item.power, () => {
      const prepare = async (roles: Record<string, RoleSpec> = {}) => {
        const t = world(roles);
        await item.setup?.(t);
        return t;
      };

      it('lets the leader and the agent of the leader (the switch on), refuses a person outside the project', async () => {
        const t = await prepare();
        expect(await attempt(t, OUTSIDER, item.call, item.input)).toBe('forbidden');
        const ok = await prepare();
        expect(await attempt(ok, LEADER, item.call, item.input)).toBe('ok');
        const agent = await prepare();
        expect(await attempt(agent, LEADER_AGENT, item.call, item.input)).toBe('ok');
      });

      it('refuses the leader and the agent of the leader when the switch is off', async () => {
        const leaderOff = await prepare({ [LEADER]: { off: item.off } });
        expect(await attempt(leaderOff, LEADER, item.call, item.input)).toBe('forbidden');
        const agentOff = await prepare({ [LEADER]: { off: item.off } });
        expect(await attempt(agentOff, LEADER_AGENT, item.call, item.input)).toBe('forbidden');
      });

      it(item.teamPasses ? 'opens the team scope to a team member, and the agent of that member' : 'keeps the lead scope to the leader: a team member and the agent of a member are refused', async () => {
        const member = await prepare();
        expect(await attempt(member, TEAM, item.call, item.input)).toBe(item.teamPasses ? 'ok' : 'forbidden');
        const agent = await prepare();
        expect(await attempt(agent, TEAM_AGENT, item.call, item.input)).toBe(item.teamPasses ? 'ok' : 'forbidden');
      });

      it('opens every project with the all switch, for a person who is not on the project', async () => {
        const t = await prepare({ [OUTSIDER]: { rights: [item.all] } });
        expect(await attempt(t, OUTSIDER, item.call, item.input)).toBe('ok');
      });
    });
  }

  it('lets only the all switch of the team scope reach a project, not the team switch alone, for a person outside it (links)', async () => {
    const t = world({ [OUTSIDER]: { rights: ['project.links.team'] } });
    expect(await attempt(t, OUTSIDER, 'projects.addLink', CASES.find((c) => c.power === 'project.links')!.input)).toBe('forbidden');
  });

  describe('project.code', () => {
    const input = { id: 'prj_001', patch: { code: '260902AZT-RES-Villa' } };
    it('needs its own switch: the leader without it is refused, with it passes', async () => {
      expect(await attempt(world(), LEADER, 'projects.update', input)).toBe('forbidden');
      expect(await attempt(world({ [LEADER]: { rights: ['project.code'] } }), LEADER, 'projects.update', input)).toBe('ok');
    });
    it('passes only where project.details passes: the switch alone does not open a project that the person does not lead', async () => {
      expect(await attempt(world({ [OUTSIDER]: { rights: ['project.code'] } }), OUTSIDER, 'projects.update', input)).toBe('forbidden');
      expect(await attempt(world({ [OUTSIDER]: { rights: ['project.code', 'project.details.all'] } }), OUTSIDER, 'projects.update', input)).toBe('ok');
    });
    it('refuses the leader when the details switch is off, even with the code switch', async () => {
      const t = world({ [LEADER]: { rights: ['project.code'], off: ['project.details.lead'] } });
      expect(await attempt(t, LEADER, 'projects.update', input)).toBe('forbidden');
    });
    it('refuses the agent of a person without the switch', async () => {
      expect(await attempt(world(), LEADER_AGENT, 'projects.update', input)).toBe('forbidden');
      expect(await attempt(world({ [LEADER]: { rights: ['project.code'] } }), LEADER_AGENT, 'projects.update', input)).toBe('ok');
    });
  });

  describe('project.delete', () => {
    const input = { id: 'prj_001', confirm: true };
    it('is off for the leader by default (a new power), on with the lead switch, and for every project with the all switch', async () => {
      expect(await attempt(world(), LEADER, 'projects.delete', input)).toBe('forbidden');
      expect(await attempt(world({ [LEADER]: { rights: ['project.delete.lead'] } }), LEADER, 'projects.delete', input)).toBe('ok');
      expect(await attempt(world({ [TEAM]: { rights: ['project.delete.lead'] } }), TEAM, 'projects.delete', input)).toBe('forbidden');
      expect(await attempt(world({ [OUTSIDER]: { rights: ['project.delete.all'] } }), OUTSIDER, 'projects.delete', input)).toBe('ok');
    });
    it('refuses the agent of a person without the switch, and lets the agent of a person with it', async () => {
      expect(await attempt(world(), LEADER_AGENT, 'projects.delete', input)).toBe('forbidden');
      expect(await attempt(world({ [LEADER]: { rights: ['project.delete.lead'] } }), LEADER_AGENT, 'projects.delete', input)).toBe('ok');
    });
  });

  describe('the team of a task lead (ensureOnTeam)', () => {
    const input = { projectId: 'prj_001', title: 'Check the survey', ownerId: OUTSIDER, stageId: 'stg_002' };
    it('adds a person outside the team as the lead only for a holder of project.team', async () => {
      const on = world();
      expect(await attempt(on, LEADER, 'tasks.create', input)).toBe('ok');
      expect(on.store.state.members[`prj_001:${OUTSIDER}`]).toBeDefined();
      const off = world({ [LEADER]: { off: ['project.team.lead'] } });
      expect(await attempt(off, LEADER, 'tasks.create', input)).toBe('invalid_input');
      expect(off.store.state.members[`prj_001:${OUTSIDER}`]).toBeUndefined();
    });
    it('does not use project.details: the leader without it still names a person outside the team', async () => {
      const t = world({ [LEADER]: { off: ['project.details.lead'] } });
      expect(await attempt(t, LEADER, 'tasks.create', input)).toBe('ok');
    });
  });

  describe('the pin of a location link', () => {
    const input = { projectId: 'prj_001', kind: 'location', label: 'Site', url: 'https://maps.google.com/?q=26.3,50.2', location: 'Al Khobar' };
    it('moves the map pin only for a holder of project.details; the team member adds the link alone', async () => {
      const t = world();
      expect(await attempt(t, TEAM, 'projects.addLink', input)).toBe('ok');
      expect(t.store.state.projects.prj_001.geo ?? null).toBeNull();
      const lead = world();
      expect(await attempt(lead, LEADER, 'projects.addLink', input)).toBe('ok');
      expect(lead.store.state.projects.prj_001.geo).toBeTruthy();
      const off = world({ [LEADER]: { off: ['project.details.lead'] } });
      expect(await attempt(off, LEADER, 'projects.addLink', input)).toBe('ok');
      expect(off.store.state.projects.prj_001.geo ?? null).toBeNull();
    });
  });
});

describe('people', () => {
  const PEOPLE: readonly { right: OfficeRight; call: string; input: unknown; prepare?: (t: World) => void }[] = [
    { right: 'people.invite', call: 'users.create', input: { name: 'New Person', email: 'new.person@madar.test', discipline: 'Architect' } },
    { right: 'people.change', call: 'users.update', input: { id: TEAM, patch: { name: 'Sara Renamed' } } },
    { right: 'people.teams', call: 'teams.create', input: { name: 'Design', memberIds: [TEAM] } },
    { right: 'people.turnOff', call: 'users.deactivate', input: { id: OUTSIDER } },
    { right: 'people.remove', call: 'users.remove', input: { id: OUTSIDER }, prepare: (t) => { t.store.state.users[OUTSIDER].active = false; } },
  ];
  const HOLDER = 'usr_007';
  const withHolder = (spec: RoleSpec, prepare?: (t: World) => void) => {
    const t = world();
    t.store.state.users[HOLDER] = makeUser(HOLDER, { name: 'Holder Person' });
    t.store.state.users.usr_008 = makeUser('usr_008', { name: 'Holder Agent', kind: 'agent', discipline: 'Agent', ownerId: HOLDER });
    t.store.state.counters.usr = 8;
    t.store.state.users[HOLDER].roleId = 'rol_001';
    t.store.state.settings.roles = { custom: [{ id: 'rol_001', name: 'People role', nameAr: 'دور', rights: [...(spec.rights ?? [])] }] };
    t.store.state.counters.rol = 1;
    prepare?.(t);
    return t;
  };

  for (const item of PEOPLE) {
    describe(item.right, () => {
      it('passes with the switch, for the person and for the agent of the person', async () => {
        const person = withHolder({ rights: [item.right] }, item.prepare);
        expect(await attempt(person, HOLDER, item.call, item.input)).toBe('ok');
        const agent = withHolder({ rights: [item.right] }, item.prepare);
        expect(await attempt(agent, 'usr_008', item.call, item.input)).toBe('ok');
      });
      it('refuses a Member without the switch and the agent of that Member', async () => {
        expect(await attempt(withHolder({}, item.prepare), HOLDER, item.call, item.input)).toBe('forbidden');
        expect(await attempt(withHolder({}, item.prepare), 'usr_008', item.call, item.input)).toBe('forbidden');
      });
      it('refuses a person who holds the four other people switches', async () => {
        const others = PEOPLE.map((p) => p.right).filter((right) => right !== item.right);
        expect(await attempt(withHolder({ rights: others }, item.prepare), HOLDER, item.call, item.input)).toBe('forbidden');
      });
    });
  }

  it('keeps the hard-coded Admin rules: a holder of people.change cannot change an Admin, a role or an email', async () => {
    const t = withHolder({ rights: ['people.change'] });
    expect(await attempt(t, HOLDER, 'users.update', { id: 'usr_001', patch: { name: 'Hala Renamed' } })).toBe('forbidden');
    expect(await attempt(t, HOLDER, 'users.update', { id: TEAM, patch: { email: 'other@madar.test' } })).toBe('forbidden');
    expect(await attempt(t, HOLDER, 'users.update', { id: TEAM, patch: { systemRole: 'management' } })).toBe('forbidden');
  });

  it('keeps an agent out of users.create even with people.invite (Admin only)', async () => {
    const t = withHolder({ rights: ['people.invite'] });
    expect(await attempt(t, HOLDER, 'users.create', { name: 'A bot', email: 'bot@madar.test', discipline: 'Agent', kind: 'agent', ownerId: HOLDER })).toBe('forbidden');
  });

  describe('users.invites and users.resendInvite', () => {
    it('opens the list of invitations for any one of the five people switches', async () => {
      for (const right of PEOPLE.map((p) => p.right)) {
        expect(await attempt(withHolder({ rights: [right] }), HOLDER, 'users.invites', {})).toBe('ok');
        expect(await attempt(withHolder({ rights: [right] }), 'usr_008', 'users.invites', {})).toBe('ok');
      }
    });
    it('refuses the list for a person with none of them, and for the agent of that person', async () => {
      expect(await attempt(withHolder({ rights: ['payment.view', 'client.create'] }), HOLDER, 'users.invites', {})).toBe('forbidden');
      expect(await attempt(withHolder({}), 'usr_008', 'users.invites', {})).toBe('forbidden');
    });
    it('sends an invitation again only for a holder of people.invite', async () => {
      expect(await attempt(withHolder({ rights: ['people.invite'] }), HOLDER, 'users.resendInvite', { id: TEAM })).toBe('ok');
      expect(await attempt(withHolder({ rights: ['people.change', 'people.teams', 'people.turnOff', 'people.remove'] }), HOLDER, 'users.resendInvite', { id: TEAM })).toBe('forbidden');
    });
  });

  describe('teams', () => {
    it('asks people.teams for the change and the delete of a team too', async () => {
      const t = withHolder({ rights: ['people.teams'] });
      t.as('usr_001');
      const team = (await call(t, 'teams.create', { name: 'Site' })) as { id: string };
      expect(await attempt(t, HOLDER, 'teams.update', { id: team.id, name: 'Site team' })).toBe('ok');
      expect(await attempt(t, HOLDER, 'teams.delete', { id: team.id })).toBe('ok');
      const off = withHolder({ rights: ['people.invite', 'people.change'] });
      off.as('usr_001');
      const other = (await call(off, 'teams.create', { name: 'Site' })) as { id: string };
      expect(await attempt(off, HOLDER, 'teams.update', { id: other.id, name: 'Nope' })).toBe('forbidden');
      expect(await attempt(off, HOLDER, 'teams.delete', { id: other.id })).toBe('forbidden');
    });
  });
});

describe('clients', () => {
  it('makes a client only with client.create, not with the project switch', async () => {
    const input = { name: 'Acme Trading', initials: 'ACM' };
    expect(await attempt(world(), TEAM, 'clients.create', input)).toBe('ok');
    expect(await attempt(world({ [TEAM]: { off: ['client.create'] } }), TEAM, 'clients.create', input)).toBe('forbidden');
    expect(await attempt(world({ [TEAM]: { off: ['client.create'] } }), TEAM_AGENT, 'clients.create', input)).toBe('forbidden');
  });
  it('lets a person with client.create but without project.create make a client, and the other way round', async () => {
    const input = { name: 'Acme Trading', initials: 'ACM' };
    const noProject = world({ [TEAM]: { off: ['project.create'] } });
    expect(await attempt(noProject, TEAM, 'clients.create', input)).toBe('ok');
    const noClient = world({ [TEAM]: { off: ['client.create'] } });
    expect(await attempt(noClient, TEAM, 'projects.create', { name: 'New villa' })).toBe('ok');
  });
  it('changes a client only with clients.change', async () => {
    const t = world({ [TEAM]: { rights: ['clients.change'] } });
    t.as('usr_001');
    const client = (await call(t, 'clients.create', { name: 'Acme Trading', initials: 'ACM' })) as { id: string };
    expect(await attempt(t, TEAM, 'clients.update', { id: client.id, patch: { phone: '0500000000' } })).toBe('ok');
    const off = world();
    off.as('usr_001');
    const other = (await call(off, 'clients.create', { name: 'Acme Trading', initials: 'ACM' })) as { id: string };
    expect(await attempt(off, TEAM, 'clients.update', { id: other.id, patch: { phone: '0500000000' } })).toBe('forbidden');
    expect(await attempt(off, TEAM_AGENT, 'clients.update', { id: other.id, patch: { phone: '0500000000' } })).toBe('forbidden');
  });
});

describe('money', () => {
  const NEW_PAYMENT = { projectId: 'prj_001', name: 'First payment', amount: 5000, dueDate: '2026-10-20' };
  async function withPayment(roles: Record<string, RoleSpec>) {
    const t = world(roles);
    t.as('usr_001');
    const made = (await call(t, 'payments.create', NEW_PAYMENT)) as { payment: { id: string } };
    return { t, id: made.payment.id };
  }

  it('lists payments only with payment.view', async () => {
    expect(await attempt(world({ [TEAM]: { rights: ['payment.view'] } }), TEAM, 'payments.list', { projectId: 'prj_001' })).toBe('ok');
    expect(await attempt(world(), TEAM, 'payments.list', { projectId: 'prj_001' })).toBe('forbidden');
    expect(await attempt(world(), TEAM_AGENT, 'payments.list', { projectId: 'prj_001' })).toBe('forbidden');
    expect(await attempt(world({ [TEAM]: { rights: ['payment.view'] } }), TEAM_AGENT, 'payments.list', { projectId: 'prj_001' })).toBe('ok');
  });

  it('adds a payment with payment.add (which needs payment.view) and refuses a holder of the other money switches', async () => {
    expect(await attempt(world({ [TEAM]: { rights: ['payment.add'] } }), TEAM, 'payments.create', NEW_PAYMENT)).toBe('ok');
    expect(await attempt(world({ [TEAM]: { rights: ['payment.add'] } }), TEAM_AGENT, 'payments.create', NEW_PAYMENT)).toBe('ok');
    expect(await attempt(world({ [TEAM]: { rights: ['payment.view', 'payment.change', 'payment.receive'] } }), TEAM, 'payments.create', NEW_PAYMENT)).toBe('forbidden');
    expect(await attempt(world(), TEAM_AGENT, 'payments.create', NEW_PAYMENT)).toBe('forbidden');
  });

  it('changes and deletes a payment with payment.change only', async () => {
    const on = await withPayment({ [TEAM]: { rights: ['payment.change'] } });
    expect(await attempt(on.t, TEAM, 'payments.update', { id: on.id, patch: { note: 'Moved' } })).toBe('ok');
    expect(await attempt(on.t, TEAM_AGENT, 'payments.delete', { id: on.id })).toBe('ok');
    const off = await withPayment({ [TEAM]: { rights: ['payment.view', 'payment.add', 'payment.receive'] } });
    expect(await attempt(off.t, TEAM, 'payments.update', { id: off.id, patch: { note: 'Moved' } })).toBe('forbidden');
    expect(await attempt(off.t, TEAM, 'payments.delete', { id: off.id })).toBe('forbidden');
    expect(await attempt(off.t, TEAM_AGENT, 'payments.delete', { id: off.id })).toBe('forbidden');
  });

  it('marks a payment as received with payment.receive only', async () => {
    const on = await withPayment({ [TEAM]: { rights: ['payment.receive'] } });
    expect(await attempt(on.t, TEAM_AGENT, 'payments.markReceived', { id: on.id })).toBe('ok');
    const off = await withPayment({ [TEAM]: { rights: ['payment.view', 'payment.add', 'payment.change'] } });
    expect(await attempt(off.t, TEAM, 'payments.markReceived', { id: off.id })).toBe('forbidden');
    expect(await attempt(off.t, TEAM_AGENT, 'payments.markReceived', { id: off.id })).toBe('forbidden');
  });

  it('shows the money of the Dashboard and of the office report only with payment.view', async () => {
    const view = { period: 'week', start: '2026-09-28' };
    const withView = world({ [TEAM]: { rights: ['payment.view', 'report.office'] } });
    withView.as(TEAM);
    expect(((await call(withView, 'dashboard.get', {})) as { money: unknown }).money).not.toBeNull();
    expect(((await call(withView, 'reports.office', view)) as { money: unknown }).money).not.toBeNull();
    const without = world({ [TEAM]: { rights: ['report.office'] } });
    without.as(TEAM);
    expect(((await call(without, 'dashboard.get', {})) as { money: unknown }).money).toBeNull();
    expect(((await call(without, 'reports.office', view)) as { money: unknown }).money).toBeNull();
    without.as(TEAM_AGENT);
    expect(((await call(without, 'dashboard.get', {})) as { money: unknown }).money).toBeNull();
  });
});

describe('templates', () => {
  const projectDraft = (name = 'Villa') => ({
    name, roles: [], stages: [{ id: 's1', name: 'Concept', startOffset: null, durationDays: null }],
    tasks: [{ id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 0, durationDays: 5, flexible: true }],
  });

  describe('templates.projectCreate', () => {
    it('is off for a Member by default: a new project template and a new stage template are refused', async () => {
      expect(await attempt(world(), TEAM, 'projectTemplates.save', projectDraft())).toBe('forbidden');
      expect(await attempt(world(), TEAM, 'stageTemplates.save', { name: 'Short', stages: ['Concept'] })).toBe('forbidden');
      expect(await attempt(world(), TEAM_AGENT, 'projectTemplates.save', projectDraft())).toBe('forbidden');
      expect(await attempt(world(), LEADER, 'projectTemplates.save', projectDraft())).toBe('forbidden');
    });
    it('passes with the switch, for the person and for the agent of the person, and for the Admin without it', async () => {
      const roles = { [TEAM]: { rights: ['templates.projectCreate'] as StoredRight[] } };
      expect(await attempt(world(roles), TEAM, 'projectTemplates.save', projectDraft())).toBe('ok');
      expect(await attempt(world(roles), TEAM_AGENT, 'projectTemplates.save', projectDraft())).toBe('ok');
      expect(await attempt(world(roles), TEAM, 'stageTemplates.save', { name: 'Short', stages: ['Concept'] })).toBe('ok');
      expect(await attempt(world(), 'usr_001', 'projectTemplates.save', projectDraft())).toBe('ok');
      expect(await attempt(world(), 'usr_001', 'stageTemplates.save', { name: 'Short', stages: ['Concept'] })).toBe('ok');
    });
    it('does not use the switch of a project: a Member with project.create off still needs only templates.projectCreate', async () => {
      const t = world({ [TEAM]: { rights: ['templates.projectCreate'], off: ['project.create'] } });
      expect(await attempt(t, TEAM, 'projectTemplates.save', projectDraft())).toBe('ok');
    });
  });

  describe('a template of someone else (templates.projectAny)', () => {
    async function madeBy(roles: Record<string, RoleSpec>) {
      const t = world(roles);
      t.as('usr_001');
      const project = (await call(t, 'projectTemplates.save', projectDraft())) as { id: string };
      const stage = (await call(t, 'stageTemplates.save', { name: 'Short', stages: ['Concept'] })) as { id: string };
      t.store.state.projectTemplates![project.id].createdBy = LEADER;
      t.store.state.stageTemplates![stage.id].createdBy = LEADER;
      return { t, project: project.id, stage: stage.id };
    }
    it('lets the saver change and delete their own template with no switch', async () => {
      const { t, project, stage } = await madeBy({});
      expect(await attempt(t, LEADER, 'projectTemplates.save', { ...projectDraft('Villa 2'), id: project })).toBe('ok');
      expect(await attempt(t, LEADER, 'stageTemplates.delete', { id: stage })).toBe('ok');
      expect(await attempt(t, LEADER, 'projectTemplates.delete', { id: project })).toBe('ok');
    });
    it('refuses another Member, and the agent of that Member', async () => {
      const { t, project, stage } = await madeBy({});
      expect(await attempt(t, TEAM, 'projectTemplates.save', { ...projectDraft('Villa 2'), id: project })).toBe('forbidden');
      expect(await attempt(t, TEAM, 'projectTemplates.delete', { id: project })).toBe('forbidden');
      expect(await attempt(t, TEAM_AGENT, 'stageTemplates.delete', { id: stage })).toBe('forbidden');
    });
    it('lets a holder of the switch, and the agent of the holder, change and delete both kinds', async () => {
      const { t, project, stage } = await madeBy({ [TEAM]: { rights: ['templates.projectAny'] } });
      expect(await attempt(t, TEAM, 'projectTemplates.save', { ...projectDraft('Villa 2'), id: project })).toBe('ok');
      expect(await attempt(t, TEAM_AGENT, 'stageTemplates.delete', { id: stage })).toBe('ok');
      expect(await attempt(t, TEAM, 'projectTemplates.delete', { id: project })).toBe('ok');
    });
    it('shows the Edit flag of a template by the same rule', async () => {
      const { t, project } = await madeBy({ [TEAM]: { rights: ['templates.projectAny'] } });
      t.as(TEAM);
      const rows = (await call(t, 'projectTemplates.list', {})) as { id: string; canEdit: boolean }[];
      expect(rows.find((row) => row.id === project)!.canEdit).toBe(true);
      t.as(OUTSIDER);
      const other = (await call(t, 'projectTemplates.list', {})) as { id: string; canEdit: boolean }[];
      expect(other.find((row) => row.id === project)!.canEdit).toBe(false);
    });
  });

  describe('to-do templates: templates.taskSave', () => {
    const byHand = { name: 'Check the survey', stageName: 'Concept' };
    const fromTask = { fromTaskId: 'tsk_001' };
    const withTask = (roles: Record<string, RoleSpec> = {}) => {
      const t = world(roles);
      t.store.state.tasks.tsk_001 = makeTask();
      t.store.state.counters.tsk = 1;
      return t;
    };
    it('lets the leader of a project save by hand and from a to-do of the project (the lead switch is on by default)', async () => {
      expect(await attempt(withTask(), LEADER, 'taskTemplates.save', byHand)).toBe('ok');
      expect(await attempt(withTask(), LEADER, 'taskTemplates.save', fromTask)).toBe('ok');
      expect(await attempt(withTask(), LEADER_AGENT, 'taskTemplates.save', byHand)).toBe('ok');
    });
    it('refuses a team member who leads no project, and the agent of that member', async () => {
      expect(await attempt(withTask(), TEAM, 'taskTemplates.save', byHand)).toBe('forbidden');
      expect(await attempt(withTask(), TEAM, 'taskTemplates.save', fromTask)).toBe('forbidden');
      expect(await attempt(withTask(), TEAM_AGENT, 'taskTemplates.save', byHand)).toBe('forbidden');
    });
    it('refuses the leader and the agent of the leader when the lead switch is off', async () => {
      const roles = { [LEADER]: { off: ['templates.taskSave.lead'] as OfficeRight[] } };
      expect(await attempt(withTask(roles), LEADER, 'taskTemplates.save', byHand)).toBe('forbidden');
      expect(await attempt(withTask(roles), LEADER, 'taskTemplates.save', fromTask)).toBe('forbidden');
      expect(await attempt(withTask(roles), LEADER_AGENT, 'taskTemplates.save', byHand)).toBe('forbidden');
    });
    it('needs no project with the all switch: a person who leads nothing saves by hand and from any to-do', async () => {
      const roles = { [TEAM]: { rights: ['templates.taskSave.all'] as StoredRight[] }, [OUTSIDER]: { rights: ['templates.taskSave.all'] as StoredRight[] } };
      expect(await attempt(withTask(roles), TEAM, 'taskTemplates.save', byHand)).toBe('ok');
      expect(await attempt(withTask(roles), OUTSIDER, 'taskTemplates.save', byHand)).toBe('ok');
      expect(await attempt(withTask(roles), OUTSIDER, 'taskTemplates.save', fromTask)).toBe('ok');
    });
    it('shows the Save as template flag of a to-do by the same rule', async () => {
      const t = withTask({ [LEADER]: { off: ['templates.taskSave.lead'] } });
      t.as(LEADER);
      expect(((await call(t, 'tasks.get', { id: 'tsk_001' })) as { viewerCan: { saveTemplate: boolean } }).viewerCan.saveTemplate).toBe(false);
      const on = withTask();
      on.as(LEADER);
      expect(((await call(on, 'tasks.get', { id: 'tsk_001' })) as { viewerCan: { saveTemplate: boolean } }).viewerCan.saveTemplate).toBe(true);
    });
  });

  describe('a to-do template of someone else (templates.taskAny)', () => {
    async function madeBy(roles: Record<string, RoleSpec>) {
      const t = world(roles);
      t.as('usr_001');
      const made = (await call(t, 'taskTemplates.save', { name: 'Check the survey', stageName: 'Concept' })) as { id: string };
      t.store.state.taskTemplates![made.id].createdBy = LEADER;
      return { t, id: made.id };
    }
    it('lets the saver rename and delete their own with no switch', async () => {
      const { t, id } = await madeBy({});
      expect(await attempt(t, LEADER, 'taskTemplates.rename', { id, name: 'Renamed' })).toBe('ok');
      expect(await attempt(t, LEADER, 'taskTemplates.delete', { id })).toBe('ok');
    });
    it('refuses another Member and the agent of that Member', async () => {
      const { t, id } = await madeBy({});
      expect(await attempt(t, TEAM, 'taskTemplates.rename', { id, name: 'Renamed' })).toBe('forbidden');
      expect(await attempt(t, TEAM_AGENT, 'taskTemplates.delete', { id })).toBe('forbidden');
    });
    it('lets a holder of the switch and the agent of the holder', async () => {
      const { t, id } = await madeBy({ [TEAM]: { rights: ['templates.taskAny'] } });
      expect(await attempt(t, TEAM, 'taskTemplates.rename', { id, name: 'Renamed' })).toBe('ok');
      expect(await attempt(t, TEAM_AGENT, 'taskTemplates.delete', { id })).toBe('ok');
    });
  });

  it('keeps templates.updateProjects as it was: the Admin and a holder pass, a Member is refused', async () => {
    const input = { templateId: 'ptp_001' };
    const prepare = async (roles: Record<string, RoleSpec>) => {
      const t = world(roles);
      t.as('usr_001');
      await call(t, 'projectTemplates.save', projectDraft());
      return t;
    };
    expect(await attempt(await prepare({}), 'usr_001', 'projectTemplates.usage', input)).toBe('ok');
    expect(await attempt(await prepare({ [TEAM]: { rights: ['templates.updateProjects'] } }), TEAM, 'projectTemplates.usage', input)).toBe('ok');
    expect(await attempt(await prepare({}), TEAM, 'projectTemplates.usage', input)).toBe('forbidden');
  });
});

describe('the Dashboard', () => {
  it('refuses dashboard.get without dashboard.view, for the person and for the agent of the person', async () => {
    const roles = { [TEAM]: { off: ['dashboard.view', 'workload.view'] as OfficeRight[] } };
    expect(await attempt(world(roles), TEAM, 'dashboard.get', {})).toBe('forbidden');
    expect(await attempt(world(roles), TEAM_AGENT, 'dashboard.get', {})).toBe('forbidden');
    expect(await attempt(world(), TEAM, 'dashboard.get', {})).toBe('ok');
    expect(await attempt(world(), TEAM_AGENT, 'dashboard.get', {})).toBe('ok');
  });

  it('keeps the other Dashboard numbers when only workload.view is off, and gives an empty workload object (never null)', async () => {
    const t = world({ [TEAM]: { off: ['workload.view'] } });
    t.as(TEAM);
    const view = (await call(t, 'dashboard.get', {})) as { tiles: { activeProjects: number }; workload: { weeks: string[]; limit: number; rows: unknown[]; unassigned: unknown } };
    expect(view.tiles.activeProjects).toBe(1);
    expect(view.workload).not.toBeNull();
    expect(view.workload.weeks).toHaveLength(4);
    expect(view.workload.rows).toEqual([]);
    expect(view.workload.unassigned).toBeNull();
    t.as(TEAM_AGENT);
    expect(((await call(t, 'dashboard.get', {})) as { workload: { rows: unknown[] } }).workload.rows).toEqual([]);
  });

  it('gives the rows of people and the No-lead row with workload.view', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: null, dueDate: '2026-10-02' });
    t.store.state.counters.tsk = 1;
    t.as(TEAM);
    const view = (await call(t, 'dashboard.get', {})) as { workload: { rows: unknown[]; unassigned: { overdue: number; counts: number[] } | null } };
    expect(view.workload.rows.length).toBeGreaterThan(0);
    expect(view.workload.unassigned).not.toBeNull();
  });

  it('keeps dashboard.view on while workload.view is on: a stored list never holds a dependant without its need', async () => {
    // The role sheet sends both ids off. A list that turns off only the need gets the need back from rightsOf.
    const t = world({ [TEAM]: { off: ['dashboard.view'] } });
    expect(await attempt(t, TEAM, 'dashboard.get', {})).toBe('ok');
  });
});

describe('Search', () => {
  function searchWorld(roles: Record<string, RoleSpec> = {}) {
    const t = world(roles);
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP).id;
    const id = nextId(t.store.state, 'msg');
    t.store.state.messages[id] = {
      id, conversationId: room, authorId: LEADER, actingForId: LEADER, body: 'Riser size agreed', mentions: [],
      createdAt: '2026-09-30T10:01:00.000+03:00', editedAt: null,
    };
    return t;
  }

  it('refuses search.query without search.use, for the person and for the agent of the person', async () => {
    const roles = { [TEAM]: { off: ['search.use'] as OfficeRight[] } };
    expect(await attempt(searchWorld(roles), TEAM, 'search.query', { text: 'Tower' })).toBe('forbidden');
    expect(await attempt(searchWorld(roles), TEAM_AGENT, 'search.query', { text: 'Tower' })).toBe('forbidden');
    expect(await attempt(searchWorld(), TEAM, 'search.query', { text: 'Tower' })).toBe('ok');
  });

  it('gives an agent no message hits when its person lacks ai.readChats, and keeps the hits of the person at the screen', async () => {
    const t = searchWorld({ [TEAM]: { off: ['ai.readChats'] } });
    t.as(TEAM);
    expect(((await call(t, 'search.query', { text: 'riser size' })) as { messages: unknown[] }).messages).toHaveLength(1);
    t.as(TEAM_AGENT);
    const agent = (await call(t, 'search.query', { text: 'riser size' })) as { messages: unknown[]; projects: unknown[] };
    expect(agent.messages).toEqual([]);
    expect(agent.projects.length).toBeGreaterThanOrEqual(0);
  });

  it('gives an agent the message hits when its person holds ai.readChats', async () => {
    const t = searchWorld();
    t.as(TEAM_AGENT);
    expect(((await call(t, 'search.query', { text: 'riser size' })) as { messages: unknown[] }).messages).toHaveLength(1);
  });
});

describe('office settings and requests', () => {
  it('changes the office settings only with office.settings, for the person and for the agent of the person', async () => {
    const input = { staleAfterDays: 21 };
    expect(await attempt(world(), 'usr_001', 'settings.update', input)).toBe('ok');
    expect(await attempt(world(), TEAM, 'settings.update', input)).toBe('forbidden');
    expect(await attempt(world(), TEAM_AGENT, 'settings.update', input)).toBe('forbidden');
    expect(await attempt(world({ [TEAM]: { rights: ['office.settings'] } }), TEAM, 'settings.update', input)).toBe('ok');
    expect(await attempt(world({ [TEAM]: { rights: ['office.settings'] } }), TEAM_AGENT, 'settings.update', input)).toBe('ok');
  });

  it('keeps the role section with the Admin: office.settings does not open roles', async () => {
    const t = world({ [TEAM]: { rights: ['office.settings'] } });
    expect(await attempt(t, TEAM, 'roles.create', { name: 'Nope', nameAr: 'لا', rights: [] })).toBe('forbidden');
  });

  it('sends a request only with feedback.send, for the person and for the agent of the person', async () => {
    const input = { kind: 'bug', message: 'The board does not scroll.', page: '/projects', screenshots: [] };
    expect(await attempt(world(), TEAM, 'feedback.send', input)).toBe('ok');
    expect(await attempt(world(), TEAM_AGENT, 'feedback.send', input)).toBe('ok');
    const off = { [TEAM]: { off: ['feedback.send'] as OfficeRight[] } };
    expect(await attempt(world(off), TEAM, 'feedback.send', input)).toBe('forbidden');
    expect(await attempt(world(off), TEAM_AGENT, 'feedback.send', input)).toBe('forbidden');
  });

  it('asks feedback.send for the upload link of a screenshot too', async () => {
    const input = { screenshots: [{ mimeType: 'image/png', size: 1000 }] };
    expect(await attempt(world(), TEAM, 'feedback.uploadStart', input)).toBe('ok');
    const off = { [TEAM]: { off: ['feedback.send'] as OfficeRight[] } };
    expect(await attempt(world(off), TEAM, 'feedback.uploadStart', input)).toBe('forbidden');
  });
});
