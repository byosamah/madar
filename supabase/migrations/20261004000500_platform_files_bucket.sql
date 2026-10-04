-- The private bucket of the files on Supabase Storage (plan 2b, point 1; proof.md, Z0a item 6). The server signs every link
-- with the secret key, so the bucket needs no Storage policy: the browser roles get no right on storage.objects here.
-- file_size_limit 52428800 (50 MB) is the per-file ceiling of the free plan. Storage refuses a bigger upload with 413.
-- The test harness skips this file (*_platform_*.sql): it needs the Supabase schema storage.
-- When the bucket exists (from supabase/config.toml or from the dashboard), it only makes the bucket private again: the keys
-- are sequential ids, so a public bucket would show every file without a signed link. A size limit set there stays.

insert into storage.buckets (id, name, public, file_size_limit)
values ('madar-files', 'madar-files', false, 52428800)
on conflict (id) do update set public = false;
