import { describe, expect, it } from 'vitest';
import { snapshotOf } from '../../data/officeCache';
import { extendActorOf, settleActorOf } from './meetings';

/**
 * The person who settles and extends a meeting of a hidden project (hidden projects, owner 2026-10-22, wave D3). The organizer acts only
 * while the organizer views the project. Else an Admin acts (the Admin holds "See hidden projects"). prj_001 is hidden: leader usr_002,
 * team usr_003, chosen usr_007. usr_004 is an organizer who was taken off the team. usr_001 and usr_005 are Admins (usr_005 is off).
 */

const user = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: 'human', active: true, systemRole: 'member', ...over });
const office = (project: Record<string, unknown> = { hidden: true, viewerIds: ['usr_007'] }) => snapshotOf({
  users: {
    usr_001: user('usr_001', { systemRole: 'admin' }), usr_002: user('usr_002'), usr_003: user('usr_003'), usr_004: user('usr_004'), usr_005: user('usr_005', { systemRole: 'admin', active: false }),
    usr_007: user('usr_007'),
  },
  projects: { prj_001: { id: 'prj_001', leaderId: 'usr_002', status: 'active', access: project } },
  members: {
    'prj_001:usr_002': { projectId: 'prj_001', userId: 'usr_002' }, 'prj_001:usr_003': { projectId: 'prj_001', userId: 'usr_003' },
  },
  settings: {},
} as never, 1);

const row = (organizerId: string, projectId: string | null = 'prj_001') => ({ organizerId, projectId, attendeeIds: ['usr_003'] });

describe('settleActorOf for a meeting of a hidden project', () => {
  it('is the organizer while the organizer views the project: the leader, a team member, a chosen person', () => {
    for (const organizer of ['usr_002', 'usr_003', 'usr_007']) expect(settleActorOf(office(), row(organizer)), organizer).toBe(organizer);
  });

  it('is the first active Admin when the organizer no longer views the project', () => {
    expect(settleActorOf(office(), row('usr_004'))).toBe('usr_001');
  });

  it('is the organizer again when the project is open, so nothing changes with the default settings', () => {
    expect(settleActorOf(office({ hidden: false, viewerIds: [] }), row('usr_004'))).toBe('usr_004');
  });

  it('is unchanged for a meeting with no project', () => {
    expect(settleActorOf(office(), row('usr_004', null))).toBe('usr_004');
  });
});

describe('extendActorOf for a series of a hidden project', () => {
  it('is the organizer while the organizer views the project, else the Admin', () => {
    expect(extendActorOf(office(), row('usr_003'))).toBe('usr_003');
    expect(extendActorOf(office(), row('usr_004'))).toBe('usr_001');
    expect(extendActorOf(office(), row('usr_004', null))).toBe('usr_004');
  });
});
