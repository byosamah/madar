import { describe, expect, it } from 'vitest';
import * as E from '../api/contract/entities';
import { SECOND_ENTERPRISE_EMAILS } from '../api/fakeDirectory';
import { TODAY } from '../test/factories';
import { buildSecondEnterprise } from './sampleSecondEnterprise';

describe('the small office of the second fake enterprise', () => {
  const state = buildSecondEnterprise(TODAY);

  it('has one Admin, two members, one client, one project and three to-dos', () => {
    const users = Object.values(state.users);
    expect(users).toHaveLength(3);
    expect(users.filter((user) => user.systemRole === 'admin')).toHaveLength(1);
    expect(users.map((user) => user.email)).toEqual(SECOND_ENTERPRISE_EMAILS);
    expect(Object.keys(state.clients)).toHaveLength(1);
    expect(Object.keys(state.projects)).toHaveLength(1);
    expect(Object.keys(state.tasks)).toHaveLength(3);
    expect(state.session.currentUserId).toBe('usr_001');
  });

  it('names the enterprise in its settings, with the code prefix OB', () => {
    expect(state.settings).toMatchObject({ enterpriseName: 'Oasis Builders', enterpriseNameAr: 'واحة للإنشاءات', codePrefix: 'OB' });
    expect(Object.values(state.projects)[0].code).toBe('OB-26-001');
  });

  it('takes the names from the directory for a company that the owner made', () => {
    const made = buildSecondEnterprise(TODAY, { name: 'Acme', nameAr: 'أكمي', codePrefix: 'AC' });
    expect(made.settings).toMatchObject({ enterpriseName: 'Acme', enterpriseNameAr: 'أكمي', codePrefix: 'AC' });
  });

  it('passes every entity schema', () => {
    const check = (schema: { parse: (value: unknown) => unknown }, items: Record<string, unknown>) => {
      for (const item of Object.values(items)) schema.parse(item);
    };
    check(E.User, state.users);
    check(E.Client, state.clients);
    check(E.Project, state.projects);
    check(E.ProjectMember, state.members);
    check(E.Stage, state.stages);
    check(E.Task, state.tasks);
    check(E.Event, state.events);
    E.Settings.parse(state.settings);
  });

  it('links every task to a stage of its project and to a member', () => {
    for (const task of Object.values(state.tasks)) {
      expect(state.stages[task.stageId!]?.projectId).toBe(task.projectId);
      const project = state.projects[task.projectId!];
      expect(project.leaderId === task.ownerId || Boolean(state.members[`${task.projectId}:${task.ownerId}`])).toBe(true);
    }
  });

  it('holds no VADO content', () => {
    expect(JSON.stringify(state)).not.toMatch(/vado|bunah|khobar|الخبر|فادو|بناه/i);
  });

  it('is the same every time', () => {
    expect(JSON.stringify(buildSecondEnterprise(TODAY))).toBe(JSON.stringify(state));
  });
});
