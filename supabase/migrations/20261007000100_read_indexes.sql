-- The read indexes of the performance audit (2026-10-07). An index or a statistics object changes no answer: the loaders send
-- the same statements, and Postgres finds the same rows with less work. Each one names the finding it serves.

-- DB-1: events.list for a person who is not the Admin keeps the events of the office tasks that the person sees
-- (doc->'officeTaskId'). Without statistics on that expression, Postgres guesses few matches, reads every event and sorts them on
-- disk. The text index on created_at serves the time bound of a read with "since" (sqlSource.ts, atOrAfter).
create statistics events_office_task on (doc->'officeTaskId') from events;
create index events_created_c on events (created_at collate "C");

-- DB-2: the newest feed events of each project, and the newest message of each chat, in the order of the loaders.
create index events_project_created on events (project_id, created_at collate "C" desc);
create index messages_conversation_newest on messages (conversation_id, created_at collate "C" desc, id collate "C" desc);

-- DB-3: the comment counts and the delete events of gone targets look up target_id alone.
create index comments_target_id on comments (target_id);
create index events_target_id on events (target_id);

analyze events;
analyze messages;
analyze comments;
