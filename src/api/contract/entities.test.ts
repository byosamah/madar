import { describe, expect, it } from 'vitest';
import { Comment, Project, Stamp, TRIGGERS, TimeEntry, User, defaultPreferences, emptyReactions } from './entities';

const user = {
  id: 'usr_001', name: 'Hala Nasser', email: 'hala@madar.test', avatarUrl: null, kind: 'human',
  systemRole: 'admin', discipline: 'Architect', weeklyHourTarget: 40, active: true, ownerId: null, preferences: defaultPreferences(),
};

const project = {
  id: 'prj_001', code: 'KH-26-014', name: 'Corniche Office Tower', clientId: null, status: 'active',
  leaderId: 'usr_002', currentStageId: 'stg_001', location: 'Al Khobar', areaM2: 24500, startDate: '2026-01-01',
  targetEndDate: '2027-06-30', coverFileId: null, modelFolderPath: '', description: '', healthOverride: null,
  createdBy: 'usr_001', createdAt: '2026-01-01T09:00:00.000+03:00', updatedAt: '2026-01-01T09:00:00.000+03:00',
};

describe('entity schemas', () => {
  it('accepts a valid user', () => {
    expect(User.parse(user)).toEqual(user);
  });

  it('checks id prefixes and digits', () => {
    expect(User.safeParse({ ...user, id: 'user_001' }).success).toBe(false);
    expect(User.safeParse({ ...user, id: 'usr_01' }).success).toBe(false);
    expect(User.safeParse({ ...user, id: 'usr_1234' }).success).toBe(true);
  });

  it('accepts office stamps in ISO form only', () => {
    expect(Stamp.safeParse('2026-09-30T08:00:00.000+03:00').success).toBe(true);
    expect(Stamp.safeParse('2026-09-30 08:00').success).toBe(false);
  });

  it('takes hours in half-hour steps', () => {
    const entry = { id: 'tim_001', userId: 'usr_001', projectId: 'prj_001', stageId: 'stg_001', taskId: null, date: '2026-09-30' };
    expect(TimeEntry.safeParse({ ...entry, hours: 7.5 }).success).toBe(true);
    expect(TimeEntry.safeParse({ ...entry, hours: 0.3 }).success).toBe(false);
    expect(TimeEntry.safeParse({ ...entry, hours: 0 }).success).toBe(false);
  });

  it('turns on every notification trigger by default', () => {
    const prefs = defaultPreferences();
    expect(Object.keys(prefs.notifications).sort()).toEqual([...TRIGGERS].sort());
    expect(Object.values(prefs.notifications).every(Boolean)).toBe(true);
    expect(prefs.glass).toBe('frosted');
  });

  it('needs all three reaction lists on a comment', () => {
    const comment = {
      id: 'cmt_001', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_001', body: 'Looks good',
      reactions: emptyReactions(), createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
    };
    expect(Comment.safeParse(comment).success).toBe(true);
    expect(Comment.safeParse({ ...comment, reactions: { '👍': [] } }).success).toBe(false);
  });

  it('checks project codes', () => {
    expect(Project.safeParse(project).success).toBe(true);
    expect(Project.safeParse({ ...project, code: 'kh-26-014' }).success).toBe(false);
  });
});
