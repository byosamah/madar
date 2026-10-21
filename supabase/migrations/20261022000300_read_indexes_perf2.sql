-- The read indexes of the speed release perf2 (performance audit 2026-10-21). An index changes no answer: the loaders send the same
-- rows, and Postgres finds them with less work. Each one names the finding it serves.

-- DB-6: the task threads statement (chats.list, chats.unreadCount, chats.markRead, chats.waiting) finds the comments of the person
-- by author, in place of a scan of every comment.
create index comments_author_task on comments (target_type, (doc->>'authorId'), target_id);

-- DB-9: the Inbox reads the unread notices of a person (equality on the first two columns) and the newest 100 read ones in the order
-- of the loader, created_at then id in text order (collate "C"). The old index had the default collation, so Postgres sorted every
-- read notice. The new index serves both reads, so the old one goes.
create index notifications_inbox_c on notifications (user_id, read, created_at collate "C" desc, id collate "C" desc);
drop index notifications_inbox;

-- DB-10: the Reports screen counts the five report verbs of a period. The index holds only their rows, so a year of events is not read.
create index events_report_verbs on events (verb, created_at collate "C")
  where verb in ('project.stage_changed', 'project.status_changed', 'project.paused', 'task.approved', 'task.sent_back');

analyze comments;
analyze notifications;
analyze events;
