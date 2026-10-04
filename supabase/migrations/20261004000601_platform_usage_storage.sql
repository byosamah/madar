-- The bucket total for the file storage meter (plan 5.8; task M1). While the files are on Supabase Storage, the bucket holds more
-- than the versions in the file records: the data of deleted files (kept for Undo, section 10 decision 2), the thumbnails, the
-- feedback screenshots and the staging objects. Storage refuses uploads at the 1 GB limit, so usage.get and the 80% warning read
-- the real total here. server/usage/meters.ts checks that the function exists first.
-- The test harness skips this file (*_platform_*.sql): it needs the Supabase schema storage. Same pattern as
-- 20261004000104_platform_private.sql. security definer: madar_server has no right on storage.objects.

create or replace function madar_private.storage_bytes() returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((metadata->>'size')::bigint), 0)::bigint from storage.objects where bucket_id = 'madar-files'
$$;
revoke execute on function madar_private.storage_bytes() from public, anon, authenticated;
grant execute on function madar_private.storage_bytes() to madar_server;
