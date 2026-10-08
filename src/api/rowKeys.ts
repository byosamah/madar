/**
 * The keys of the rows that join two records: a project member, and the last read of a chat. They sit outside store.ts, so
 * permissions.ts loads no store and no schema in the first load of the real build (performance audit BND-6).
 */
export function memberKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export function chatReadKey(conversationId: string, userId: string): string {
  return `${conversationId}:${userId}`;
}
