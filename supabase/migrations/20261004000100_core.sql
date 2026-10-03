-- Madar core tables: one table for each State collection (plan 4.1, 4.2). server/data/tables.ts names them.
--
-- The storage form. "doc" holds the zod record exactly, so a record comes back as it went in: absent stays absent, null stays
-- null, stamps keep +03:00, numbers stay numbers. The key columns that loaders filter on are generated from "doc", so they
-- cannot disagree with it. "ord" keeps the insertion order of the prototype (loads use order by ord). An upsert keeps the
-- "ord" of an existing row; a row that comes back after a delete gets a new one.
--
-- "chg" is on the 11 office tables only: the save step sets it to the new office_meta.version (plan 4.7).
--
-- Foreign keys. Postgres 17 accepts a foreign key on a stored generated column when the key has no ON UPDATE or ON DELETE
-- action (CASCADE, SET NULL and SET DEFAULT are refused for generated columns). Checked by "supabase db reset" on the local
-- stack (Postgres 17) on 2026-10-03, and by server/it/guards.it.test.ts. So only project_id of the project child tables refers
-- to projects(id), deferrable initially deferred: the save step deletes and inserts in any order and ends with
-- "set constraints all immediate". Other references stay unchecked on purpose: the prototype keeps comments and files after
-- a task delete, and events and notices point at deleted records.
--
-- No table name carries a schema, so the test harness can apply this file into one schema for each test worker (TM 5).

create table users (
  id           text primary key,
  ord          bigserial not null,
  doc          jsonb not null,
  kind         text generated always as (doc->>'kind') stored,
  owner_id     text generated always as (doc->>'ownerId') stored,
  active       boolean generated always as ((doc->>'active')::boolean) stored,
  email        text generated always as (lower(doc->>'email')) stored,
  auth_user_id uuid unique,
  chg          bigint not null default 0,
  constraint users_id check (doc->>'id' = id)
);
create index users_chg on users (chg);

create table clients (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint clients_id check (doc->>'id' = id)
);
create index clients_chg on clients (chg);

create table teams (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint teams_id check (doc->>'id' = id)
);
create index teams_chg on teams (chg);

create table stage_templates (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint stage_templates_id check (doc->>'id' = id)
);
create index stage_templates_chg on stage_templates (chg);

create table task_templates (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint task_templates_id check (doc->>'id' = id)
);
create index task_templates_chg on task_templates (chg);

create table feedback (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  constraint feedback_id check (doc->>'id' = id)
);

-- One row: the office settings. The record has no id, so the key is fixed.
create table settings (
  id  text primary key,
  ord bigserial not null,
  doc jsonb not null,
  chg bigint not null default 0,
  constraint settings_id check (id = 'office')
);

create table projects (
  id          text primary key,
  ord         bigserial not null,
  doc         jsonb not null,
  status      text generated always as (doc->>'status') stored,
  client_id   text generated always as (doc->>'clientId') stored,
  leader_id   text generated always as (doc->>'leaderId') stored,
  code        text generated always as (doc->>'code') stored,
  search_text text,
  chg         bigint not null default 0,
  constraint projects_id check (doc->>'id' = id)
);
create index projects_status on projects (status);
create index projects_chg on projects (chg);

-- Key: projectId:userId (memberKey).
create table members (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  user_id    text generated always as (doc->>'userId') stored,
  chg        bigint not null default 0,
  constraint members_id check (id = (doc->>'projectId') || ':' || (doc->>'userId'))
);
create index members_project on members (project_id);
create index members_user on members (user_id);
create index members_chg on members (chg);

create table stages (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  chg        bigint not null default 0,
  constraint stages_id check (doc->>'id' = id)
);
create index stages_project on stages (project_id);
create index stages_chg on stages (chg);

create table deadlines (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  chg        bigint not null default 0,
  constraint deadlines_id check (doc->>'id' = id)
);
create index deadlines_project on deadlines (project_id);
create index deadlines_chg on deadlines (chg);

-- A direct chat has no project (project_id null).
create table conversations (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  kind       text generated always as (doc->>'kind') stored,
  chg        bigint not null default 0,
  constraint conversations_id check (doc->>'id' = id)
);
create index conversations_project on conversations (project_id);
create index conversations_chg on conversations (chg);

create table tasks (
  id          text primary key,
  ord         bigserial not null,
  doc         jsonb not null,
  project_id  text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  owner_id    text generated always as (doc->>'ownerId') stored,
  status      text generated always as (doc->>'status') stored,
  due_date    text generated always as (doc->>'dueDate') stored,
  stage_id    text generated always as (doc->>'stageId') stored,
  search_text text,
  constraint tasks_id check (doc->>'id' = id)
);
create index tasks_project on tasks (project_id);
create index tasks_owner on tasks (owner_id);
create index tasks_helpers on tasks using gin ((doc->'helperIds'));

create table updates (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  created_at text generated always as (doc->>'createdAt') stored,
  constraint updates_id check (doc->>'id' = id)
);
create index updates_project_created on updates (project_id, created_at desc);

-- project_id is a server column: the save step sets it from the target (a task or a post), so project loads stay simple.
create table comments (
  id          text primary key,
  ord         bigserial not null,
  doc         jsonb not null,
  target_type text generated always as (doc->>'targetType') stored,
  target_id   text generated always as (doc->>'targetId') stored,
  created_at  text generated always as (doc->>'createdAt') stored,
  project_id  text,
  constraint comments_id check (doc->>'id' = id)
);
create index comments_target on comments (target_type, target_id, created_at);
create index comments_project on comments (project_id);

create table files (
  id          text primary key,
  ord         bigserial not null,
  doc         jsonb not null,
  project_id  text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  task_id     text generated always as (doc->>'taskId') stored,
  stage_id    text generated always as (doc->>'stageId') stored,
  search_text text,
  constraint files_id check (doc->>'id' = id)
);
create index files_project on files (project_id);
create index files_task on files (task_id);
-- The data key check of a project delete: which versions still use a key (access map 7.2).
create index files_versions on files using gin ((doc->'versions') jsonb_path_ops);

-- "open": an entry that waits for someone and is not closed (an open loop).
create table tracker (
  id            text primary key,
  ord           bigserial not null,
  doc           jsonb not null,
  project_id    text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  reply_task_id text generated always as (doc->>'replyTaskId') stored,
  open          boolean generated always as ((doc->>'waiting') is not null and (doc->>'closedAt') is null) stored,
  constraint tracker_id check (doc->>'id' = id)
);
create index tracker_project on tracker (project_id);
create index tracker_open on tracker (project_id) where open;

create table payments (
  id         text primary key,
  ord        bigserial not null,
  doc        jsonb not null,
  project_id text generated always as (doc->>'projectId') stored references projects (id) deferrable initially deferred,
  constraint payments_id check (doc->>'id' = id)
);
create index payments_project on payments (project_id);

create table notifications (
  id             text primary key,
  ord            bigserial not null,
  doc            jsonb not null,
  user_id        text generated always as (doc->>'userId') stored,
  read           boolean generated always as ((doc->>'read')::boolean) stored,
  created_at     text generated always as (doc->>'createdAt') stored,
  correlation_id text generated always as (doc->>'correlationId') stored,
  target_type    text generated always as (doc->>'targetType') stored,
  target_id      text generated always as (doc->>'targetId') stored,
  dedupe_key     text generated always as (doc->>'dedupeKey') stored,
  constraint notifications_id check (doc->>'id' = id)
);
create index notifications_inbox on notifications (user_id, read, created_at desc);
create index notifications_story on notifications (correlation_id);
create index notifications_target on notifications (target_type, target_id);
-- notify() never writes a second notice with the same key (src/api/notify.ts); the key names the person.
create unique index notifications_dedupe on notifications (dedupe_key) where dedupe_key is not null;

create table messages (
  id              text primary key,
  ord             bigserial not null,
  doc             jsonb not null,
  conversation_id text generated always as (doc->>'conversationId') stored,
  created_at      text generated always as (doc->>'createdAt') stored,
  constraint messages_id check (doc->>'id' = id)
);
create index messages_conversation on messages (conversation_id, created_at);

-- Key: conversationId:userId (chatReadKey). The conversation is a chat or a task thread.
create table chat_reads (
  id              text primary key,
  ord             bigserial not null,
  doc             jsonb not null,
  conversation_id text generated always as (doc->>'conversationId') stored,
  user_id         text generated always as (doc->>'userId') stored,
  constraint chat_reads_id check (id = (doc->>'conversationId') || ':' || (doc->>'userId'))
);
create index chat_reads_user on chat_reads (user_id);

-- The History. It only grows: 20261004000102_guards.sql blocks every update and delete (plan 4.3).
-- The save step never writes undoneBy; the loader fills it from the undo events that name the event in "undoes".
create table events (
  id             text primary key,
  ord            bigserial not null,
  doc            jsonb not null,
  seq            integer generated always as ((doc->>'seq')::integer) stored,
  project_id     text generated always as (doc->>'projectId') stored,
  target_type    text generated always as (doc->>'targetType') stored,
  target_id      text generated always as (doc->>'targetId') stored,
  correlation_id text generated always as (doc->>'correlationId') stored,
  verb           text generated always as (doc->>'verb') stored,
  undoes         text generated always as (doc->>'undoes') stored,
  created_at     text generated always as (doc->>'createdAt') stored,
  constraint events_id check (doc->>'id' = id)
);
-- seq comes from counters.evt under the office lock, so it is unique and gap-free; the index makes a lock bug fail loudly.
create unique index events_seq on events (seq);
create index events_target on events (target_type, target_id, seq);
create index events_story on events (correlation_id);
create index events_project on events (project_id, seq desc);
create index events_undoes on events (undoes);

-- The office starts empty: only the settings row, with the values of emptyState() in src/api/store.ts.
insert into settings (id, doc) values (
  'office',
  '{"defaultStages": ["Concept", "Schematic Design", "Design Development", "Construction Documents", "Permits", "Tender", "Supervision"],
    "codePrefix": "KH", "workloadLimit": 10, "staleAfterDays": 30}'
);
