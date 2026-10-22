/**
 * The kinds of the filter of the chat list (owner, 2026-10-20): Projects holds the project chats, To-dos the threads of to-dos, and
 * People the direct chats and the groups. The desk shows them in a menu and a phone shows them as chips (Direction D).
 */
export const KINDS = ['all', 'projects', 'todos', 'people'] as const;
export type ChatKind = (typeof KINDS)[number];
