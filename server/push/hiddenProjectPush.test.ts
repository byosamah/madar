import { describe, expect, it } from 'vitest';
import { chatReadKey } from '../../src/api/rowKeys';
import { mentionMarkup } from '../../src/lib/text';
import { planPushes, type CommentFact, type MessageFact, type ProjectFact, type PushFacts, type PushPerson } from './chatRule';

/**
 * The push of a hidden project (hidden projects, owner 2026-10-22, wave D3). A person who does not view the project of a message or a
 * comment gets no push, whatever the mention or the lead says. A chosen person is no team member: a project chat pushes the person only
 * when a message names the person. People: usr_001 is the Admin, usr_002 leads the project, usr_003 is on the team, usr_004 is a chosen
 * person, usr_005 is a Member outside the project, usr_006 is a Member of a role without "See every project", usr_007 holds
 * "See hidden projects" (Management with the switch).
 */
const person = (id: string, over: Partial<PushPerson> = {}): PushPerson => ({ id, kind: 'human', active: true, admin: false, ownerId: null, device: true, seesAll: true, ...over });
const PEOPLE: PushPerson[] = [
  person('usr_001', { admin: true, seesHidden: true }), person('usr_002'), person('usr_003'), person('usr_004'), person('usr_005'),
  person('usr_006', { seesAll: false }), person('usr_007', { seesHidden: true }),
];

const hidden: ProjectFact = { hidden: true, teamIds: ['usr_002', 'usr_003'], viewerIds: ['usr_004'] };
const open: ProjectFact = { hidden: false, teamIds: ['usr_002', 'usr_003'], viewerIds: [] };

const msg = (project: ProjectFact | undefined, over: Partial<MessageFact> = {}): MessageFact => ({
  kind: 'message', id: 'msg_1', chatId: 'cnv_p', chatKind: 'project', memberIds: [], teamIds: ['usr_002', 'usr_003'], authorId: 'usr_002', actingForId: 'usr_002',
  mentions: [], isNew: true, ...(project ? { project } : {}), ...over,
});
const cmt = (project: ProjectFact | null | undefined, over: Partial<CommentFact> = {}): CommentFact => ({
  kind: 'comment', id: 'cmt_1', taskId: 'tsk_1', office: false, leadId: 'usr_003', makerId: 'usr_001', helperIds: [], authorId: 'usr_002', body: 'Done.',
  replyAuthorId: null, line: false, isNew: true, ...(project === undefined ? {} : { project }), ...over,
});
const facts = (over: Partial<PushFacts> = {}): PushFacts => ({ people: PEOPLE, items: [], levels: {}, notices: [], undo: false, ...over });
const to = (plan: ReturnType<typeof planPushes>) => plan.waited.map((w) => w.userId);

describe('a comment on a to-do of a hidden project', () => {
  it('pushes a person who views the project: the lead, the people it names, the chosen person and the holder of "See hidden projects"', () => {
    const body = `${mentionMarkup('Four', 'usr_004')} ${mentionMarkup('Seven', 'usr_007')}`;
    expect(to(planPushes(facts({ items: [cmt(hidden, { body })] })))).toEqual(['usr_003', 'usr_004', 'usr_007']);
  });

  it('pushes nobody who does not view the project, though the comment names the person or the person leads the to-do', () => {
    const body = `${mentionMarkup('Five', 'usr_005')} ${mentionMarkup('Six', 'usr_006')}`;
    expect(to(planPushes(facts({ items: [cmt(hidden, { body })] })))).toEqual(['usr_003']);
    // The lead left the team: the lead is no viewer, so the lead gets no push.
    expect(to(planPushes(facts({ items: [cmt(hidden, { leadId: 'usr_005' })] })))).toEqual([]);
    // A reply to the comment of an outsider pushes the outsider no more.
    expect(to(planPushes(facts({ items: [cmt(hidden, { leadId: null, replyAuthorId: 'usr_005' })] })))).toEqual([]);
  });

  it('does not push a notice of the item to a person who does not view the project', () => {
    const item = cmt(hidden, { body: mentionMarkup('Five', 'usr_005') });
    const notices = [{ userId: 'usr_005', targetType: 'task', targetId: 'tsk_1', messageId: 'cmt_1' }, { userId: 'usr_004', targetType: 'task', targetId: 'tsk_1', messageId: 'cmt_1' }];
    expect(to(planPushes(facts({ items: [item], notices })))).toEqual(['usr_003', 'usr_004']);
  });
});

describe('a message in the chat of a hidden project', () => {
  it('pushes the team and the Admin as before, and a chosen person only when the message names the person', () => {
    const levels = { [chatReadKey('cnv_p', 'usr_003')]: 'all' as const, [chatReadKey('cnv_p', 'usr_004')]: 'all' as const, [chatReadKey('cnv_p', 'usr_001')]: 'all' as const };
    // The chosen person is no team member: no plain push, even with "All messages".
    expect(to(planPushes(facts({ items: [msg(hidden)], levels })))).toEqual(['usr_001', 'usr_003']);
    const named = msg(hidden, { mentions: ['usr_004'] });
    const notices = [{ userId: 'usr_004', targetType: 'chat', targetId: 'cnv_p', messageId: 'msg_1' }];
    expect(to(planPushes(facts({ items: [named], levels, notices })))).toEqual(['usr_001', 'usr_003', 'usr_004']);
  });

  it('pushes nobody who does not view the project, though a notice names the person', () => {
    const named = msg(hidden, { mentions: ['usr_005', 'usr_006'] });
    const notices = ['usr_005', 'usr_006'].map((userId) => ({ userId, targetType: 'chat', targetId: 'cnv_p', messageId: 'msg_1' }));
    expect(to(planPushes(facts({ items: [named], notices })))).toEqual([]);
  });
});

describe('a role without "See every project", on an open project', () => {
  it('pushes the people of the project and the Admin, and not a Member of that role who does not work there', () => {
    const body = `${mentionMarkup('Five', 'usr_005')} ${mentionMarkup('Six', 'usr_006')}`;
    expect(to(planPushes(facts({ items: [cmt(open, { body })] })))).toEqual(['usr_003', 'usr_005']);
  });
});

describe('with no project facts', () => {
  it('pushes as before: a facts reader that knows no project gives the old rule', () => {
    const body = mentionMarkup('Five', 'usr_005');
    expect(to(planPushes(facts({ items: [cmt(undefined, { body })] })))).toEqual(['usr_003', 'usr_005']);
    expect(to(planPushes(facts({ items: [cmt(null, { body })] })))).toEqual(['usr_003', 'usr_005']);
  });
});

describe('the fact readers (SQLite, and the text of the Postgres statement)', () => {
  it('give the project facts of a message and of a comment, and the viewing rights of each person', async () => {
    const { buildSeed } = await import('../../src/data/seed');
    const { freshLite } = await import('../data/lite/testDb');
    const { liteWriteState } = await import('../data/lite/whole');
    const { readPushFacts } = await import('./chatFacts');
    const lite = await freshLite();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    seed.projects.prj_001 = { ...seed.projects.prj_001, access: { hidden: true, viewerIds: ['usr_007'] } };
    seed.settings = { ...seed.settings, roles: { ...seed.settings.roles, off: { member: ['project.seeAll'] } } };
    const chat = Object.values(seed.conversations).find((c) => c.projectId === 'prj_001')!;
    const message = Object.values(seed.messages).find((m) => m.conversationId === chat.id)!;
    const comment = Object.values(seed.comments).find((c) => c.targetType === 'task' && seed.tasks[c.targetId]?.projectId === 'prj_001')!;
    await lite.db.tx('write', (q) => liteWriteState(q, seed));
    const read = await lite.db.tx('write', (q) => readPushFacts(q, { kinds: new Set(['messages', 'comments']), people: new Set(), messageIds: [message.id], commentIds: [comment.id] }, { undo: false }));
    const item = read!.items.find((one) => one.kind === 'message') as MessageFact;
    expect(item.project).toEqual({ hidden: true, teamIds: ['usr_002', 'usr_005', 'usr_006', 'usr_008'], viewerIds: ['usr_007'] });
    const note = read!.items.find((one) => one.kind === 'comment') as CommentFact;
    expect(note.project).toEqual(item.project);
    const byId = new Map(read!.people.map((one) => [one.id, one]));
    // The Admin views everything. A Member of the role that turned "See every project" off does not. Management keeps it.
    expect(byId.get('usr_001')).toMatchObject({ seesAll: true, seesHidden: true });
    expect(byId.get('usr_003')).toMatchObject({ seesAll: false, seesHidden: false });
    expect(byId.get('usr_010')).toMatchObject({ seesAll: true, seesHidden: false });
  });

  it('read the access of the project and the team of a comment in the statement', async () => {
    const { PUSH_ITEMS_SQL } = await import('./chatFacts');
    expect(PUSH_ITEMS_SQL).toContain("p.doc->'access'");
    expect(PUSH_ITEMS_SQL.match(/from members mb where mb\.project_id = /g)).toHaveLength(2);
  });
});
