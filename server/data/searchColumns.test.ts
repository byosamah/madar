import { describe, expect, it } from 'vitest';
import { emptyReactions, type Comment, type Message } from '../../src/api/contract/entities';
import { emptyState } from '../../src/api/store';
import { bodySearchText } from '../../src/lib/searchMatch';
import { STAMP } from '../../src/test/factories';
import { columnNames } from './loaders/query';
import { rowOf } from './rows';
import { tableOf } from './tables';

/**
 * The folded search column of messages and comments (chat design 2026-10-19, item 16): the save writes bodySearchText of the body, as
 * tasks and files do for their names. A deleted message keeps no search text, so no SQL read finds it until an Undo writes it again.
 */
const state = emptyState('2026-10-04');
const message: Message = {
  id: 'msg_001', conversationId: 'cnv_001', authorId: 'usr_002', actingForId: 'usr_002', body: 'The riser moved', mentions: [], createdAt: STAMP, editedAt: null,
};
const comment: Comment = {
  id: 'cmt_001', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_002', body: 'Riser moved', reactions: emptyReactions(), fileIds: [], createdAt: STAMP, editedAt: null,
};

describe('the search_text column of messages and comments', () => {
  it('folds the body of a message and of a comment into search_text', () => {
    expect(rowOf(tableOf('messages'), { ...message, body: 'Ask @[Reem](usr_003) about the RISER' }, state).columns.search_text).toBe('ask @reem about the riser');
    expect(rowOf(tableOf('comments'), { ...comment, body: 'أسعارُ المواد' }, state).columns.search_text).toBe('اسعار المواد');
  });

  it('keeps no search text for a deleted message, and writes it again after Undo', () => {
    expect(rowOf(tableOf('messages'), { ...message, deletedAt: STAMP }, state).columns.search_text).toBeNull();
    expect(rowOf(tableOf('messages'), { ...message }, state).columns.search_text).toBe(bodySearchText(message.body));
  });

  it('keeps the project column of a comment beside the search column', () => {
    expect(Object.keys(rowOf(tableOf('comments'), comment, state).columns)).toEqual(['project_id', 'search_text']);
  });

  it('names search_text as the last loader column of messages and comments', () => {
    expect(columnNames('messages')).toEqual(['conversation_id', 'created_at', 'search_text']);
    expect(columnNames('comments')).toEqual(['target_type', 'target_id', 'created_at', 'project_id', 'search_text']);
  });
});
