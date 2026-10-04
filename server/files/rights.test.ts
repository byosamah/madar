import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { snapshotOf } from '../data/officeCache';
import { fakeFilesDb } from './fakeFilesDb';
import { assertAdmin, assertMayPost, assertMayView, authorityOf, loadAuthority } from './rights';

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
    expect(codeOf(() => assertMayPost(office, 'usr_004', 'prj_001'))).toBe('forbidden:content.post');
    expect(codeOf(() => assertMayPost(office, 'usr_003', 'prj_001'))).toBe('unauthenticated:account_off');
  });

  it('reads the person and the agent\'s person with SQL in a hook, and lets only the Admin through assertAdmin', async () => {
    const db = fakeFilesDb({ users: USERS });
    expect((await loadAuthority(db, 'usr_009')).id).toBe('usr_001');
    expect(codeOf(() => assertAdmin(USERS.usr_001))).toBe('ok');
    expect(codeOf(() => assertAdmin(USERS.usr_002))).toBe('forbidden:admin.manage');
    await expect(loadAuthority(db, 'usr_010')).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
    await expect(loadAuthority(db, 'usr_003')).rejects.toMatchObject({ code: 'unauthenticated', details: { reason: 'account_off' } });
  });
});
