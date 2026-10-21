-- The seen information of a chat (chat presence design C4, base B2): the chat view reads every read mark of one chat, by conversation_id.
-- Until now the marks were read by user_id only (chat_reads_user). This index keeps that read short when the office has many chats.
-- It writes no row and needs no version step of the stored record: the seen time (seenAt) is an optional field of the doc.
-- The SQLite copy has the same index in LITE_STEPS[10] (server/data/lite/schema.ts).

create index if not exists chat_reads_conversation on chat_reads (conversation_id);
