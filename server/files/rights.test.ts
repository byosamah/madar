import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { memberKey } from '../../src/api/rowKeys';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from './fakeFilesDb';
import { assertMayPost, assertMayReadReports, assertMayView, authorityOf, loadAuthority } from './rights';

/** The rights check before any signed link (plan 2b, point 7; task F2). */

const user = (id: string, o: Partial<User> = {}): User =>
  ({ id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member', discipline: 'Architect', active: true, ownerId: null, ...o }) as User;

const USERS: Record<string, User> = {
  usr_001: user('usr_001', { systemRole: 'admin' }),
  usr_002: user('usr_002'),
  usr_003: user('usr_003', { active: false }),
  usr_004: user('usr_004'),
  usr_009: user('usr_009', { kind: 'agent', ownerId: 'usr_001' }),
  usr_010: user('usr_010', { kind: 'agent', ownerId: 'usr_003' }),
  usr_011: user('usr_011', { kind: 'agent', ownerId: 'usr_002', active: false }),
  usr_012: user('usr_012', { kind: 'agent', ownerId: 'usr_004' }),
};

const office = snapshotOf({
  users: USERS, teams: {}, settings: {} as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: {}, stages: {}, deadlines: {}, conversations: {},
}, 1);

const codeOf = (work: () => unknown) => {
  try {
    work();
    return 'ok';
  } catch (error) {
    const e = error as { code?: string; details?: { reason?: string; action?: string } };
    return [e.code, e.details?.reason ?? e.details?.action].filter(Boolean).join(':');
  }
};

/** An office where usr_004 is on the team of prj_001 and the roles come from the office settings (role rights version 2). */
const officeWith = (roles?: unknown) => snapshotOf({
  users: USERS, teams: {}, settings: (roles ? { roles } : {}) as never, clients: {}, stageTemplates: {}, taskTemplates: {},
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002' } as never }, members: { [memberKey('prj_001', 'usr_004')]: { projectId: 'prj_001', userId: 'usr_004', discipline: 'Architect' } },
  stages: {}, deadlines: {}, conversations: {},
}, 1);

describe('a Member keeps the upload (fail closed, role rights version 2)', () => {
  it('lets a team member start an upload with the default switches, and refuses a person outside the team', () => {
    expect(assertMayPost(officeWith(), 'usr_004', 'prj_001').id).toBe('usr_004');
    expect(codeOf(() => assertMayPost(officeWith(), 'usr_002', 'prj_001'))).toBe('ok');
  });

  it('follows the upload switch of the office', () => {
    const closed = officeWith({ off: { member: ['file.upload.team'] } });
    expect(codeOf(() => assertMayPost(closed, 'usr_004', 'prj_001'))).toBe('forbidden:file.upload');
    const open = officeWith({ rights: { member: ['file.upload.all'] } });
    expect(assertMayPost(open, 'usr_004', 'prj_001').id).toBe('usr_004');
  });

  it('holds the agent of a team member to the same switch as the person (role rights version 2)', () => {
    expect(assertMayPost(officeWith(), 'usr_012', 'prj_001').id).toBe('usr_004');
    const closed = officeWith({ off: { member: ['file.upload.team'] } });
    expect(codeOf(() => assertMayPost(closed, 'usr_012', 'prj_001'))).toBe('forbidden:file.upload');
  });

  it('keeps the leader scope: the leader uploads with the team switch, and not with only the all switch of another role', () => {
    const closed = officeWith({ off: { member: ['file.upload.team'] } });
    expect(codeOf(() => assertMayPost(closed, 'usr_002', 'prj_001'))).toBe('forbidden:file.upload');
    expect(codeOf(() => assertMayPost(officeWith(), 'usr_002', 'prj_001'))).toBe('ok');
  });
});

describe('the authority behind a signed link', () => {
  it('is the person, or the person an agent acts for', () => {
    const lookup = (id: string) => USERS[id];
    expect(authorityOf(lookup, 'usr_002').id).toBe('usr_002');
    expect(authorityOf(lookup, 'usr_009').id).toBe('usr_001');
  });

  it('refuses an inactive person, an agent whose person is off, a turned-off agent and an unknown id, all with account_off', () => {
    const lookup = (id: string) => USERS[id];
    for (const id of ['usr_003', 'usr_010', 'usr_011', 'usr_404']) expect(codeOf(() => authorityOf(lookup, id)), id).toBe('unauthenticated:account_off');
  });

  it('lets every active person view a project, and checks the view right with can()', () => {
    expect(assertMayView(office, 'usr_004', 'prj_001').id).toBe('usr_004');
    expect(assertMayView(office, 'usr_009', 'prj_001').id).toBe('usr_001');
    expect(codeOf(() => assertMayView(office, 'usr_003', 'prj_001'))).toBe('unauthenticated:account_off');
    expect(codeOf(() => assertMayView(office, 'usr_010', 'prj_001'))).toBe('unauthenticated:account_off');
  });

  it('lets only a person who may post in the project start an upload there', () => {
    expect(assertMayPost(office, 'usr_002', 'prj_001').id).toBe('usr_002');
    expect(codeOf(() => assertMayPost(office, 'usr_004', 'prj_001'))).toBe('forbidden:file.upload');
    expect(codeOf(() => assertMayPost(office, 'usr_003', 'prj_001'))).toBe('unauthenticated:account_off');
  });

  it('reads the person and the agent\'s person with SQL in a hook', async () => {
    const db = fakeFilesDb({ users: USERS });
    expect((await loadAuthority(db, 'usr_009')).id).toBe('usr_001');
    await expect(loadAuthority(db, 'usr_010')).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
    await expect(loadAuthority(db, 'usr_003')).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
  });

  // role-rights (owner, 2026-10-23): the reports follow feedback.manage, which the Admin holds and a role can hold. A hook reads the
  // roles from the settings row, because it has no office snapshot.
  describe('assertMayReadReports: the right to read the reports of people, before a screenshot link is signed', () => {
    const roles = { custom: [{ id: 'rol_001', name: 'Reports', nameAr: 'بلاغات', rights: ['feedback.manage'] }] };
    const staff = { ...USERS, usr_005: user('usr_005', { roleId: 'rol_001' }), usr_006: user('usr_006', { kind: 'agent', ownerId: 'usr_005' }) };
    const answer = async (db: ReturnType<typeof fakeFilesDb>, id: string) => {
      try {
        await assertMayReadReports(db, id);
        return 'ok';
      } catch (error) {
        const e = error as { code?: string; details?: { reason?: string; action?: string } };
        return [e.code, e.details?.reason ?? e.details?.action].filter(Boolean).join(':');
      }
    };

    it('lets the Admin and the agent of the Admin through, with no roles in the settings', async () => {
      const db = fakeFilesDb({ users: staff });
      expect(await answer(db, 'usr_001')).toBe('ok');
      expect(await answer(db, 'usr_009')).toBe('ok');
    });

    it('refuses a Member, and a role that does not hold the right, with the action feedback.manage', async () => {
      expect(await answer(fakeFilesDb({ users: staff }), 'usr_002')).toBe('forbidden:feedback.manage');
      expect(await answer(fakeFilesDb({ users: staff }), 'usr_005')).toBe('forbidden:feedback.manage');
      const other = { custom: [{ id: 'rol_001', name: 'Pay', nameAr: 'دفع', rights: ['payment.manage'] }] };
      expect(await answer(fakeFilesDb({ users: staff, settings: { roles: other } }), 'usr_005')).toBe('forbidden:feedback.manage');
    });

    it('lets a person of a role with the right through, and the agent of that person', async () => {
      const db = fakeFilesDb({ users: staff, settings: { roles } });
      expect(await answer(db, 'usr_005')).toBe('ok');
      expect(await answer(db, 'usr_006')).toBe('ok');
      expect(await answer(db, 'usr_002')).toBe('forbidden:feedback.manage');
    });

    it('keeps the account-off answer before the right', async () => {
      const db = fakeFilesDb({ users: staff, settings: { roles } });
      expect(await answer(db, 'usr_003')).toBe('unauthenticated:account_off');
      expect(await answer(db, 'usr_010')).toBe('unauthenticated:account_off');
    });
  });
});
