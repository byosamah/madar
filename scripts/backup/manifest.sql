-- The manifest of a database backup (plan 5.7; task O2): the rows of every table in the Madar schemas, as "schema.table".
-- scripts/backup/dump.ts runs it while it holds the office lock, right before the data dump, so no office write lands between
-- the two. scripts/restore-check.ts compares the restored tables with it. One row, one json column "manifest".
-- The schema list is BACKUP_SCHEMAS of scripts/backup/check.ts (check.test.ts keeps the two equal).
select coalesce(json_object_agg(t.name, t.n order by t.name), '{}'::json) as manifest
from (
  select
    format('%s.%s', n.nspname, c.relname) as name,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'madar_private') and c.relkind = 'r'
) t;
