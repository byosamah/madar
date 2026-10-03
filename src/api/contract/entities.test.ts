import { describe, expect, it } from 'vitest';
import { Comment, Event, FileVersion, MAX_FILE_BYTES, Preferences, Project, Stamp, TRIGGERS, User, defaultPreferences, emptyReactions } from './entities';

const user = {
  id: 'usr_001', name: 'Hala Nasser', email: 'hala@madar.test', avatarUrl: null, kind: 'human',
  systemRole: 'admin', discipline: 'Architect', active: true, ownerId: null, preferences: defaultPreferences(),
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

  // The real build adds optional fields (plan, T0.3). Records saved before them must still parse, unchanged.
  describe('the real build fields', () => {
    const event = {
      id: 'evt_002', seq: 2, projectId: null, actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'cor_x',
      verb: 'task.updated', targetType: 'task', targetId: 'tsk_001', before: null, after: null, createdAt: '2026-09-30T09:00:00.000+03:00', undoneBy: null,
    };
    const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'image/png', size: 10, uploadedBy: 'usr_001', uploadedAt: '2026-09-30T09:00:00.000+03:00' };

    it('parses old records without the new fields and adds nothing', () => {
      expect(Event.parse(event)).toEqual(event);
      expect(FileVersion.parse(version)).toEqual(version);
      expect(Preferences.parse(defaultPreferences())).toEqual(defaultPreferences());
      expect('email' in defaultPreferences()).toBe(false);
      expect('morningSummary' in defaultPreferences()).toBe(false);
    });

    it('parses the undo link, the email switches, the morning summary and the thumbnail key', () => {
      expect(Event.parse({ ...event, undoes: 'evt_001' }).undoes).toBe('evt_001');
      expect(Event.safeParse({ ...event, undoes: 'cor_1' }).success).toBe(false);
      const prefs = { ...defaultPreferences(), email: { task_assigned: true, mention: false }, morningSummary: false };
      expect(Preferences.parse(prefs)).toEqual(prefs);
      expect(Preferences.safeParse({ ...defaultPreferences(), email: { not_a_trigger: true } }).success).toBe(false);
      expect(FileVersion.parse({ ...version, thumbKey: 'prj-001/fil-001/1/thumb' }).thumbKey).toBe('prj-001/fil-001/1/thumb');
    });

    it('allows files up to 250 MB, the absolute ceiling', () => {
      expect(MAX_FILE_BYTES).toBe(250 * 1024 * 1024);
      expect(FileVersion.safeParse({ ...version, size: MAX_FILE_BYTES }).success).toBe(true);
      expect(FileVersion.safeParse({ ...version, size: MAX_FILE_BYTES + 1 }).success).toBe(false);
    });
  });
});
