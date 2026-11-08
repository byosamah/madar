import { emptyState, memberKey } from '../../src/api/store';
import { makeProject, makeStage, makeTask, makeUser } from '../../src/test/factories';
import { hashPassword, PASSWORD_MIN } from '../../server/auth/own/password';
import { ENT_VADO, VADO_ADDRESS } from '../../server/enterprise/ids';
import type { EnterpriseRow } from '../../server/enterprise/types';
import { OPS_SECRET_HEADER } from '../../server/entries/officeWorker';
import { DEPLOY_ACCOUNTS } from '../../tests/e2e-deploy/accounts';
import { stateSource, type OfficeSource } from './source';

/**
 * Two enterprises on the local stack (Madar enterprises, plan B Task 15): the sample office as ent_001 (VADOs' Companies) and one small fake
 * enterprise as ent_002. The fake one has the same record ids as the sample office (usr_001, prj_001, tsk_001) with other names and other
 * emails, so a mix-up of two enterprises shows at once in a deploy suite or in a screen.
 */

const CREATED = '2026-11-08T08:00:00.000Z';
const NO_LIMITS = { people: null, storageBytes: null } as const;

export const SAMPLE_ENTERPRISE: EnterpriseRow = {
  id: ENT_VADO, address: VADO_ADDRESS, name: "VADOs' Companies", nameAr: 'شركات فادو', state: 'active', limits: { ...NO_LIMITS }, createdAt: CREATED,
  firstAdmin: { name: 'Admin', email: DEPLOY_ACCOUNTS.admin.email },
};

export const FAKE_ENTERPRISE: EnterpriseRow = {
  id: 'ent_002', address: 'globex', name: 'Globex Test Company', nameAr: 'شركة جلوبكس للاختبار', state: 'active', limits: { ...NO_LIMITS }, createdAt: CREATED,
  firstAdmin: { name: 'Dana Globex', email: 'admin@globex.test' },
};

/** The fixed sign-in ids of the fake enterprise, so each seed gives the same ids. */
const GLOBEX_AUTH_IDS = { admin: '7d0c0000-0000-4000-8000-000000000101', member: '7d0c0000-0000-4000-8000-000000000102' } as const;
const GLOBEX_EMAILS = { admin: 'admin@globex.test', member: 'member@globex.test' } as const;

/**
 * The small office of the fake enterprise: two people, one project and one task, with names that the sample office does not use. The
 * sign-in rows follow the rules of seedSource: a password of at least PASSWORD_MIN characters, hashed with PBKDF2 before any request. The
 * admin takes the password of the admin account of the deploy suite, and the member takes the one of the member account.
 */
export async function fakeEnterpriseSource(o: { now: Date; passwords: Readonly<Record<string, string | undefined>> }): Promise<OfficeSource> {
  const state = emptyState(o.now.toISOString().slice(0, 10));
  state.users.usr_001 = makeUser('usr_001', { name: 'Dana Globex', email: GLOBEX_EMAILS.admin, systemRole: 'admin' });
  state.users.usr_002 = makeUser('usr_002', { name: 'Omar Globex', email: GLOBEX_EMAILS.member, systemRole: 'member' });
  state.projects.prj_001 = makeProject({ name: 'Globex Tower', code: 'GL-26-001', leaderId: 'usr_002', currentStageId: 'stg_001', createdBy: 'usr_001' });
  state.stages.stg_001 = makeStage({ name: 'Concept' });
  state.members[memberKey('prj_001', 'usr_002')] = { projectId: 'prj_001', userId: 'usr_002', discipline: 'Architect' };
  state.tasks.tsk_001 = makeTask({ title: 'Globex ground floor plan', ownerId: 'usr_002', stageId: 'stg_001', createdBy: 'usr_001' });
  state.counters = { usr: 2, prj: 1, stg: 1, tsk: 1 };
  state.session.currentUserId = 'usr_001';
  const rows = [
    { role: 'admin' as const, userId: 'usr_001', secret: DEPLOY_ACCOUNTS.admin.passwordSecret },
    { role: 'member' as const, userId: 'usr_002', secret: DEPLOY_ACCOUNTS.member.passwordSecret },
  ];
  for (const row of rows) {
    const password = o.passwords[row.secret];
    if (!password || password.length < PASSWORD_MIN) throw new Error(`${row.secret} must hold at least ${PASSWORD_MIN} characters. Nothing changed.`);
  }
  const signin = await Promise.all(rows.map(async (row) => ({
    id: GLOBEX_AUTH_IDS[row.role], email: GLOBEX_EMAILS[row.role], password_hash: await hashPassword(o.passwords[row.secret]!),
    email_confirmed: true, banned: false, password_set: true, user_id: row.userId,
  })));
  return stateSource(state, { signin });
}

/**
 * The op platform-register of the Worker: writes the row of an enterprise and its emails into the platform object. The secret goes into the
 * header only, never into a log line or an error text. It takes no ?office= and makes no object.
 */
export async function registerEnterprise(
  base: string, secret: string, input: { row: EnterpriseRow; emails: string[] }, send: typeof fetch = fetch,
): Promise<void> {
  const response = await send(new URL('/api/office/platform-register', base).toString(), {
    method: 'POST', headers: { 'content-type': 'application/json', [OPS_SECRET_HEADER]: secret }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`The op platform-register answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
}
