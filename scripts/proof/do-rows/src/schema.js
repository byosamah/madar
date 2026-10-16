// SQLite forms of the Madar tables (supabase/migrations 20261004000100_core.sql, 20261004000101_server_tables.sql,
// 20261005000100_project_templates.sql, 20261007000100_read_indexes.sql, 20261008000100_push_devices.sql).
// Each entity table keeps id, doc (the JSON record) and the key columns that the loaders filter or sort on, as plain columns that
// the save step writes. Two forms:
//   rowid    "id text primary key": SQLite keeps a hidden rowid (used as "ord") plus a hidden unique index on id.
//   norowid  "without rowid": the table is the b-tree of id, and "ord" is a plain column.
// A GIN index (tasks helperIds, files versions) has no SQLite form, so those two are left out.

const OFFICE = ['users', 'clients', 'teams', 'stage_templates', 'task_templates', 'project_templates', 'settings', 'projects', 'members', 'stages', 'deadlines', 'conversations'];

/** name: [key columns, indexes as [name, columns, extra]] */
export const ENTITY = {
  users: [['kind', 'owner_id', 'active', 'email', 'auth_user_id'], [['users_auth', 'auth_user_id', 'unique']]],
  clients: [[], []],
  teams: [[], []],
  stage_templates: [[], []],
  task_templates: [[], []],
  project_templates: [[], []],
  feedback: [[], []],
  push_devices: [['user_id', 'endpoint'], [['push_devices_endpoint', 'endpoint', 'unique'], ['push_devices_user', 'user_id']]],
  settings: [[], []],
  projects: [['status', 'client_id', 'leader_id', 'code', 'search_text'], [['projects_status', 'status']]],
  members: [['project_id', 'user_id'], [['members_project', 'project_id'], ['members_user', 'user_id']]],
  stages: [['project_id'], [['stages_project', 'project_id']]],
  deadlines: [['project_id'], [['deadlines_project', 'project_id']]],
  conversations: [['project_id', 'kind'], [['conversations_project', 'project_id']]],
  tasks: [['project_id', 'owner_id', 'status', 'due_date', 'stage_id', 'search_text'], [['tasks_project', 'project_id'], ['tasks_owner', 'owner_id']]],
  updates: [['project_id', 'created_at'], [['updates_project_created', 'project_id, created_at desc']]],
  comments: [['target_type', 'target_id', 'created_at', 'project_id'], [['comments_target', 'target_type, target_id, created_at'], ['comments_project', 'project_id'], ['comments_target_id', 'target_id']]],
  files: [['project_id', 'task_id', 'stage_id', 'search_text'], [['files_project', 'project_id'], ['files_task', 'task_id']]],
  tracker: [['project_id', 'reply_task_id', 'open'], [['tracker_project', 'project_id'], ['tracker_open', 'project_id', 'where open = 1']]],
  payments: [['project_id'], [['payments_project', 'project_id']]],
  notifications: [['user_id', 'read', 'created_at', 'correlation_id', 'target_type', 'target_id', 'dedupe_key'], [
    ['notifications_inbox', 'user_id, read, created_at desc'], ['notifications_story', 'correlation_id'], ['notifications_target', 'target_type, target_id'],
    ['notifications_dedupe', 'dedupe_key', 'unique where dedupe_key is not null'],
  ]],
  messages: [['conversation_id', 'created_at'], [['messages_conversation', 'conversation_id, created_at'], ['messages_conversation_newest', 'conversation_id, created_at desc, id desc']]],
  chat_reads: [['conversation_id', 'user_id'], [['chat_reads_user', 'user_id']]],
  events: [['seq', 'project_id', 'target_type', 'target_id', 'correlation_id', 'verb', 'undoes', 'created_at'], [
    ['events_seq', 'seq', 'unique'], ['events_target', 'target_type, target_id, seq'], ['events_story', 'correlation_id'], ['events_project', 'project_id, seq desc'],
    ['events_undoes', 'undoes'], ['events_created_c', 'created_at'], ['events_project_created', 'project_id, created_at desc'], ['events_target_id', 'target_id'],
  ]],
};
for (const t of OFFICE) ENTITY[t][1].push([`${t}_chg`, 'chg']);

/** The server tables with their own keys and indexes. */
export const SERVER = {
  counters: ['prefix text primary key, n integer not null', []],
  office_meta: ['id integer primary key, version integer not null, office_seq integer not null', []],
  office_deletes: ['id integer primary key, tbl text, row_id text, chg integer, created_at text', [['office_deletes_chg', 'chg'], ['office_deletes_created', 'created_at']]],
  person_seq: ['user_id text primary key, seq integer not null', []],
  platform_config: ['key text primary key, value text', []],
  stories: ['id text primary key, actor_id text, created_at text', [['stories_created', 'created_at']]],
  idempotency: ['actor_id text, key text, name text, digest text, result text, created_at text, primary key (actor_id, key)', [['idempotency_created', 'created_at']]],
  outbox: ['id text primary key, kind text, payload text, created_at text, done_at text, attempts integer, claimed_until text, error text', [['outbox_open', 'created_at', 'where done_at is null']]],
  upload_intents: ['id text primary key, actor_id text, expires_at text, used_at text', [['upload_intents_open', 'expires_at', 'where used_at is null']]],
  agent_links: ['id text primary key, owner_user_id text, agent_user_id text', [['agent_links_owner', 'owner_user_id'], ['agent_links_agent', 'agent_user_id']]],
  mail_log: ['id text primary key, ref text, to_email text, kind text, resend_id text, created_at text', []],
  usage_month: ['month text primary key, calls integer, bytes_read integer, signals_failed integer', []],
  job_runs: ['key text primary key, done_at text', []],
  rate_limits: ['key text primary key, window_start text, count integer', []],
};

export const ENTITY_TABLES = Object.keys(ENTITY);
export const OFFICE_TABLES = OFFICE;
export const isOffice = (t) => OFFICE.includes(t);

/** The column list of an entity table, in insert order. */
export function columnsOf(table, form) {
  const [cols] = ENTITY[table];
  return ['id', ...(form === 'norowid' ? ['ord'] : []), 'doc', ...cols, ...(isOffice(table) ? ['chg'] : [])];
}

function indexSql(table, [name, cols, extra = '']) {
  const unique = extra.startsWith('unique');
  const where = extra.replace(/^unique\s*/, '');
  return `create ${unique ? 'unique ' : ''}index if not exists ${name} on ${table} (${cols}) ${where}`.trim();
}

/** The statements that make every table. indexes: false makes only the tables and their keys (the import test). */
export function ddl(form, indexes = true) {
  const out = [];
  for (const [table, [cols]] of Object.entries(ENTITY)) {
    const extra = cols.map((c) => `${c} ${['active', 'read', 'open', 'seq'].includes(c) ? 'integer' : 'text'}`);
    const all = [form === 'norowid' ? 'id text primary key not null' : 'id text primary key', ...(form === 'norowid' ? ['ord integer not null'] : []), 'doc text not null', ...extra, ...(isOffice(table) ? ['chg integer not null default 0'] : [])];
    out.push(`create table if not exists ${table} (${all.join(', ')})${form === 'norowid' ? ' without rowid' : ''}`);
  }
  for (const [table, [cols]] of Object.entries(SERVER)) out.push(`create table if not exists ${table} (${cols})`);
  // The one-row snapshot of the office lists (the plan's idea): the lists as JSON, in parts of at most 1.5 MB.
  out.push('create table if not exists office_snapshot (part integer primary key, version integer not null, body text not null)');
  if (indexes) out.push(...indexDdl());
  return out;
}

export function indexDdl() {
  const out = [];
  for (const [table, [, idx]] of Object.entries(ENTITY)) for (const i of idx) out.push(indexSql(table, i));
  for (const [table, [, idx]] of Object.entries(SERVER)) for (const i of idx) out.push(indexSql(table, i));
  return out;
}

export function dropAll(sql) {
  const tables = sql.exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'").toArray();
  for (const { name } of tables) sql.exec(`drop table if exists "${name}"`);
}
