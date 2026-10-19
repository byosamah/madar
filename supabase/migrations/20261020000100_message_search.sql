-- Chat search (chat design 2026-10-19, item 16). The search finds chat messages and task comments by their words.
-- Each of the two tables gets one folded text column, as tasks and files have today. A trigram index serves the LIKE read of
-- the loader, so a key press never reads every message (server/data/loaders/sqlSource.ts, likeOf).
--
-- search_text holds the fold of the body: src/lib/searchMatch.ts, bodySearchText. The save step writes it (server/data/tables.ts).
-- A deleted message keeps search_text null, so no read finds it. The Undo of the delete writes the column again.
-- The tables are no office lists, so this file raises no office version (server/data/CLAUDE.md, "Tables").

-- pg_trgm lives in the schema extensions (free on every Supabase plan), so an index names extensions.gin_trgm_ops.
create extension if not exists pg_trgm with schema extensions;

alter table messages add column search_text text;
alter table comments add column search_text text;

-- The fold of a body, in SQL. It does the same steps as bodySearchText, in the same order:
--   1. each mention @[Name](usr_000) becomes @Name (plainText),
--   2. NFKC form, then lower case (normalizeForSearch),
--   3. no Arabic diacritics (U+064B to U+065F, U+0670) and no tatweel (U+0640),
--   4. one alef form, taa marbuta as haa, alef maqsura as yaa,
--   5. each run of white space as one space (the set of \s in JavaScript), then no space at the start or the end.
-- A change of one side needs the same change on the other side. server/it/messageSearch.it.test.ts checks that they agree.
create function search_fold(body text) returns text
language sql immutable strict
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        regexp_replace(
          lower(normalize(regexp_replace(body, '@\[([^]]{1,80})\]\((usr_[0-9]{3,})\)', '@\1', 'g'), nfkc)),
          '[ً-ٰٟـ]', '', 'g'
        ),
        'أإآٱةى', 'ااااهي'
      ),
      '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'
    ),
    ' '
  )
$$;
revoke execute on function search_fold(text) from public;

-- The rows that exist now. A deleted message (deletedAt in its doc) keeps null.
update messages set search_text = search_fold(doc->>'body') where doc->>'deletedAt' is null;
update comments set search_text = search_fold(doc->>'body');

create index messages_search on messages using gin (search_text extensions.gin_trgm_ops);
create index comments_search on comments using gin (search_text extensions.gin_trgm_ops);

analyze messages;
analyze comments;
