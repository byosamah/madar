# Madar enterprises: design

Date: 2026-11-08. Status: approved by the Opus lead on 2026-11-08, on the owner's order "let opus 5.5 approve the plan".
Production steps (section 6) still need the owner's OK, step by step. Branch: `rb/enterprises` (`~/dev/madar-rb/enterprises`).
Sources: the owner's request and answers of 2026-11-08 (section 4), and a read-only map of the code by 5 readers (143 places
that assume one office). Where this document and the code differ later, the code wins, as in the rest of the repo.

## 1. Intent

The owner wants to sell Madar to other enterprises. "Madar enterprises" is the new part that makes this possible:

- A platform owner creates a new enterprise with one first Admin.
- That Admin invites the other people of the enterprise, as an Admin does today.
- Every enterprise gets the same features: all features of today, and every feature that the team adds later.
- Today's office becomes one enterprise in the same system, with the name **VADOs' Companies** (the owner's exact spelling).

Why: Madar works well for the office, and the owner sees a product in it. The code today assumes one office in every layer
(one lock, one office copy, one set of counters, one sign-in key, one object named `office`). So a second office cannot run
next to the first one. This design adds the enterprise as a level above the office.

## 2. Cost first

These limits apply before any step. The owner's rule (2026-11-08): "we still use free versions, but once we start selling we
will upgrade them". So the build runs on the free plans now, and every limit below comes from a setting, never from a fixed
number in code, so that a paid plan needs no code change.

| Service | Free limit (whole account) | What one VADO-size office uses | Effect |
| --- | --- | --- | --- |
| Cloudflare Workers and Durable Objects | 100,000 requests, 5 million rows read, 100,000 rows written a day | 40% to 86% of the rows read, 20% to 46% of the rows written (proof.md, "A day of rows") | VADO plus one small trial fits. A second real enterprise needs Workers Paid ($5 a month for the account; owner answer 1). |
| Resend | 100 mails a day, 3,000 a month | up to about 15 morning summaries a day, plus notices and invitations | About 6 enterprises of 15 people fill it. Paid Resend when selling starts. |
| R2 | 10 GB stored for both buckets | not measured for VADO | The storage limit of each enterprise (G6) shares these 10 GB. |
| GitHub Actions | 2,000 minutes a month | one nightly export | One export for each enterprise each night. |
| Cron Triggers | 5 for the account, 1 in use | 1 | One trigger serves all enterprises (5.13). |

Supabase leaves the stack: VADO moves to its own office object (section 6), so the Supabase egress problem of October ends.
Supabase production stays only as the way back for a short time after the move.

Before the first sale (not build items, but they block a sale): a trademark check of the name "Madar" (temporary today), a new
privacy page and terms for a service sold to other companies (`public/privacy.html` says "internal tool" today), and a product
domain such as madar.sa.

## 3. Goals, non-goals, anti-goals

### Goals (version 1)
- **G1. Create.** A platform owner creates an enterprise: name, Arabic name, short address name, logo (optional), first Admin
  name and email, people limit, storage limit. The first Admin gets the invitation mail and continues as today.
- **G2. Full isolation.** No record, change signal, socket message, file, file link, mail, push, search result, token, backup,
  log line or error record of one enterprise reaches another enterprise.
- **G3. VADO moves whole.** VADOs' Companies keeps every record, id, file, History line and setting. Its people sign in with
  the same email and password.
- **G4. Same features for all.** One code base and one deploy for all enterprises. No feature switch for each enterprise.
- **G5. Name and logo.** Each enterprise shows its own name and logo in the app header, in the mails, in the push line and in
  the report header. The Admin of the enterprise can change them.
- **G6. Limits.** Each enterprise has a people limit and a storage limit. The platform owner sets them.
- **G7. Pause.** A platform owner can pause an enterprise (nobody can sign in, the data stays) and resume it.
- **G8. Free-plan meter.** The platform page shows how much of each day limit of the account the enterprises used today. (My
  call: the day cap of section 5.14 needs this count anyway, and the owner decides the paid plan from it.)
- **G9. Prototype parity.** The prototype shows two fake enterprises and the platform page, so the rule "every shared call
  works in the prototype fake and on the server" stays true.

### Non-goals (version 1)
- One email in two enterprises, and a switch between enterprises (owner answer 2).
- An own address for each enterprise. It comes later with a product domain such as madar.sa (owner answer 2). Version 1
  keeps a short address name for each enterprise, so that the later change is small.
- Payment inside the app, plans and invoices, and sign-up by an enterprise alone.
- A view of the data inside an enterprise for the platform owner, also for support (owner answer 3).
- Delete or export of a whole enterprise. A later version adds both, each with the owner's OK.
- A Daftra link for enterprises other than VADOs' Companies (owner answer 4 did not choose it; decision D6 in section 11).
- Other time zones, work weeks, currencies or languages. Every enterprise is Saudi: Asia/Riyadh, Sunday to Thursday, SAR,
  Arabic and English.
- A white label of the product. The product name stays "Madar" on the sign-in screens, the install icon and the page title.
- Many enterprises on the Postgres path. Postgres serves only VADOs' Companies, and only as the way back (section 6).

### Anti-goals (a failure even if the rest works)
- Enterprise A sees anything of enterprise B (G2), through any path.
- An Admin of an enterprise gets a platform power, or an AI agent creates, pauses or changes an enterprise.
- VADOs' Companies loses a feature, a record, a file or a History line, or the team loses a work day in the move.
- A wrong or old address, link or token creates a new empty enterprise object.
- One busy enterprise uses up a free day limit and stops all the others, and nobody sees it coming.

## 4. Decided by the owner (2026-11-08)

1. **Data:** each enterprise gets its own office object: one SQLite Durable Object on Cloudflare, as built in October for the
   Supabase exit. VADO moves off Supabase. Free plans for VADO plus one small trial; Workers Paid when the second real
   enterprise starts.
2. **Sign-in:** one address for all enterprises for now (madar.vado.sa). The email decides the enterprise, and one email
   belongs to one enterprise. Later a product domain gives each enterprise its own address.
3. **Platform:** a platform page for platform owners only. It shows people count, storage and last activity, never projects,
   chats or files.
4. **Per enterprise in version 1:** name and logo, people and storage limits, pause.
5. **Name:** the new part is called "Madar enterprises".
6. **Plans:** free plans now; paid plans when selling starts.
7. **Models of the build:** Sonnet 5.5 for every subagent, Opus 5.5 for the lead.

## 5. The design

### 5.1 The parts

```
 browser ──> Pages /api, /mcp ──> Worker ──┬──> enterprise object "ent_001" (VADOs' Companies)
                                           ├──> enterprise object "ent_002" ...
                                           └──> platform object "platform"
```

- **Enterprise object.** One SQLite Durable Object for each enterprise. It holds everything that the office object holds today:
  the records, counters, History, outbox, sign-in rows, agent rows, sockets, meters and the snapshot. Its name is the
  enterprise id. It stores its own id in a row at creation and refuses every call that names another id.
- **Platform object.** One Durable Object named `platform`. It holds the list of enterprises, the email directory (which
  email belongs to which enterprise), the platform owners, the account meter, the mail pool and one small status row for each
  enterprise. It never holds a record of an enterprise.
- **Worker.** It finds the enterprise of each request (5.2) and sends the request to that object. It never creates an object
  for a name that the platform object does not list.

Ids: an enterprise id has the form `ent_NNN` (the same form as the other ids). VADOs' Companies is `ent_001`. Record ids stay
counters inside each enterprise, so two enterprises both have `usr_001` and `prj_001`. Therefore no shared store, key, topic
or log may use a bare record id (5.11, 5.12, 5.16).

Each enterprise also has a short address name (`vados` for VADOs' Companies): lower case letters, digits and hyphens, unique,
fixed after creation. Version 1 uses it in the MCP address (5.5). The later own addresses use it as the subdomain.

### 5.2 How a request finds its enterprise

| Request | Where the enterprise comes from |
| --- | --- |
| Password sign-in, forgot | The email, through the directory of the platform object. |
| Link open (invitation, reset), renew | A tag in the link or key (`<enterprise id>.<secret>`). The secret check stays a sha256 lookup inside the object. |
| Every call after sign-in | The signed claim `ent` in the token. |
| Live socket | A tag in the socket ticket. |
| MCP and its OAuth steps | The MCP address (5.5), then the claim in the agent token. |
| Google Calendar callback | The enterprise id inside the signed state. |

Rules:
- The enterprise never comes from a header, a query value or a body field that the browser sets.
- An unknown or malformed enterprise gives the same answer and the same answer time as wrong credentials. The Worker never calls `idFromName` for a name that the platform object does not list.
- The object checks the claim again: a token, ticket or link of `ent_002` that reaches `ent_001` fails, also when its
  signature is good.

What a person sees at sign-in (no change on screen):
1. The person opens madar.vado.sa and types the email and the password, as today.
2. The Worker asks the platform object for the enterprise of that email.
3. The Worker sends the password step to that enterprise object. A wrong email or password gives the same answer as today.
4. The token now carries `ent`. Every later request goes straight to that object, with no stop at the platform object.

### 5.3 Tokens and keys
- One signing key for all enterprises in version 1 (`MADAR_AUTH_PRIVATE_JWK`). Every browser and agent token carries `ent`.
  (My call: one key is simpler, and the claim check in the object gives the wall. A key for each enterprise can come later.)
- The access token life stays 15 minutes.

### 5.4 Email directory
- The platform object keeps one row for each email of each enterprise: a normalized email and the enterprise id.
- An email can be in one enterprise only. `users.create`, an email change and the create step of an enterprise reserve the
  email in the directory first. A taken email gives a calm refusal that never names the other enterprise.
- A removed person frees the email. A turned-off person keeps it.
- The object does no network work itself, so it reaches the platform object through its Worker callback (`WorkerNet`), outside
  a transaction, before the write (a preflight step).

### 5.5 AI agents (MCP)
- VADOs' Companies keeps `https://madar.vado.sa/mcp`.
- Every other enterprise gets `https://madar.vado.sa/mcp/<address name>`. The issuer, the audience, the resource metadata and
  the discovery paths come from that address. (My call: OAuth client registration runs before sign-in, so it needs the
  enterprise in the address. The later own addresses then become `https://<address name>.<domain>/mcp`.)
- Every `platform.*` call is on the MCP deny list. No agent sees the platform part.
- The MCP words (`server/mcp/docs.ts`) lose the real names of VADO's sub-companies ("Vado and Bunah") and use neutral
  examples. `INSTRUCTIONS` says that an agent acts for one person of one enterprise.

### 5.6 Platform owners and the platform page
- A platform owner is a person of an enterprise (the owner: VADOs' Companies) whose pair (enterprise id, person id) is in the
  owner list of the platform object. Only a Mac script with the ops secret writes that list. (My call: the owner signs in
  once, as today, and needs no second account.)
- A platform owner holds no new right in `can()` and no line in the rights catalog. The counts of
  `src/api/rightsCatalog.test.ts` stay the same. An Admin of any enterprise holds no platform power.
- The `platform.*` calls run in the Worker and the platform object, after the token check and the owner check. They never run
  inside an enterprise object.
- Every `platform.*` call checks again that the owner is an active person of the enterprise (one call to that object; these
  calls are rare). A turned-off or removed owner loses the page at once, also with a token that is still valid (decision D4).
- The platform refuses to pause an enterprise that holds a platform owner, so the owner can never lock himself out.
- The calls: `platform.me`, `platform.enterprises.list`, `platform.enterprises.create`, `platform.enterprises.update` (name,
  Arabic name, logo, limits), `platform.enterprises.pause`, `platform.enterprises.resume`,
  `platform.enterprises.resendInvite`, `platform.meter.get`.
- The page "Madar enterprises" («منشآت مدار») opens from the person menu, only for a platform owner. It is one list and one
  button "New enterprise". The top of the page shows today's share of each free day limit. A row opens a sheet with the
  name, Arabic name, logo, address name, state, people count, storage used, last activity, the two limits, and the buttons
  Pause or Resume and "Send the invitation again". Pause asks the owner to type the name of the enterprise first.
- The page never shows a project, task, chat, file, person name or email of an enterprise, except the first Admin of an
  enterprise that the owner created (name and email, for "Send the invitation again").
- The status row of each enterprise (people count, storage bytes, last write time, today's meter) comes from the enterprise
  object, which sends it to the platform object on each Cron run. The platform object never reads into an enterprise.

### 5.7 Create an enterprise
One platform call in this order. Each step can run again with no harm:
1. The platform object writes the enterprise row with state `creating`, and reserves the address name and the first Admin email.
2. The Worker starts the new object. The object writes its id, the default settings, the name and logo, the limits, and the
   first Admin as `usr_001` with the Admin role, and queues the invitation mail (the current `auth.invite` effect).
3. The platform object sets the state to `active`.
A step that fails leaves the row in state `creating`, and the page shows "Not finished" with a "Try again" button.

What a new enterprise holds on day one (decision D1, section 11):
- The code defaults only: `DEFAULT_SETTINGS` (`server/data/lite/schema.ts`), the system roles, and no stage, task or project
  templates, no clients, no sub-companies, no Resources folders and no sample content.
- Never a copy of any content of VADOs' Companies.
- The project code prefix: today's default `KH` belongs to VADO. A new enterprise gets the first two letters of its address
  name in capitals, and the Admin can change it in the Office settings.
- What's new: no change. A person with no seen mark sees no old entry as new (`src/whatsNew/seen.ts`, `isNewer`).

### 5.8 Pause and resume
- Pause writes `paused` in the platform object and in the enterprise object.
- A paused object refuses every call, sign-in step, token refresh, MCP request and socket. It closes its sockets. The Cron skips
  its steps, so no mail and no push goes out. The outbox rows wait.
- A person of a paused enterprise sees a calm screen after a correct password: «توقّف مدار في منشأتك مؤقتاً. تواصل مع مدير
  النظام لديكم.» / "Madar is paused for your company. Ask your Admin." Before a correct password the answer stays the usual
  one, so the screen does not tell a stranger that an email exists.
- Resume reverses each step. The outbox sends the rest.

### 5.9 Limits
- **People limit:** active people plus invited people count. Turned-off people do not count. `users.create` and
  `users.reactivate` refuse above the limit with a calm reason for the Admin.
- **Storage limit:** the bytes of all files of the enterprise, with every version. The upload start refuses a file that goes
  above the limit. The object keeps a running total, because the full count (`FILES_BYTES_LITE`) reads one row for each file
  and each version (13,200 rows on the year office, proof.md).
- The Admin sees both limits and the use in the Office settings, read only. Only the platform owner changes them. The limits
  live in a server row of the object, not in the Settings record, so `settings.update` cannot change them.
- VADOs' Companies starts with no limits.

### 5.10 Name and logo
- The Settings record gets `enterpriseName`, `enterpriseNameAr` and `enterpriseLogo` (picture data, the same form as
  `SubCompany.logo`), all optional, so an old row parses (an additive contract change).
- The Admin changes them in the Office settings, under the current right of that page (no new power).
- `session.get` gives `enterprise: { id, name, nameAr, logo }` (additive). The Home cache fingerprint holds the enterprise id.
- They show in: the app header, the mail header (name and logo), the push line ("You have something new in <name>." /
  «لديك جديد في <name>.»; the push still holds no record data), the report header (in place of the constant
  `OFFICE_NAME = 'Madar'` in `src/api/handlers/reports.ts`), the invitation, reset and agent-code mails, and the consent
  screen of an AI app.
- The platform object keeps a copy of the name and Arabic name for its list.
- VADOs' Companies: name "VADOs' Companies", Arabic name «شركات فادو» (my call; the owner can change it in Office settings).

### 5.11 Files
- Every file key of a new enterprise starts with `e/<enterprise id>/`. VADOs' Companies keeps its current keys, because each
  record stores its full key. A key with no prefix belongs to VADOs' Companies only.
- The Worker file port refuses a sign, head, copy or delete for a key outside the prefix of the calling enterprise. This guard
  sits behind the current record check.

### 5.12 Mail
- The sender stays `Madar <madar@vado.sa>` for all enterprises. The mail names the enterprise and shows its logo.
- Every mail idempotency key and every `mail_log` ref starts with the enterprise id, because ids such as `usr_001` repeat.
- The platform object keeps one mail pool for the account. Each object reserves a place before a send. Sign-in mail keeps its
  places ahead of notices and summaries, as the current quota does. The pool limit comes from a setting (Free: 100 a day).

### 5.13 The Cron
- One Cron Trigger stays. The Worker reads the list of active enterprises and runs the job steps in each enterprise object.
- A Free Worker invocation allows 50 outside calls, and each object call has a network budget of 45. So the job of each
  enterprise needs its own invocation (for example a call of the Worker to itself for each enterprise). Spike S1 measures this
  on the deployed test Worker before the build relies on it.
- The daily sign-in cleanup runs in each enterprise.
- After its steps, each object sends its status row and today's meter to the platform object.

### 5.14 Meter and day cap
- Each object adds its day counts (requests, rows read, rows written, mails) to the account meter of the platform object.
- The day cap compares the account total with the plan limits from a setting (Free now, paid later). Rule (decision D2,
  section 11):
  - The cap never refuses VADOs' Companies. Production has no cap today, and the real office must not stop.
  - Every other enterprise gets a share of each day limit from a setting (start: 10% each on Free). Above its share, the
    enterprise gets the calm `busy` answer, but its sign-in steps keep working.
  - When the account total reaches 90% of a limit, every enterprise except VADOs' Companies gets `busy` for the rest of
    the UTC day.
  - On a paid plan the owner raises the setting. No code change.
- The platform page shows the totals (G8) and warns the owner at 70% of any limit.

### 5.15 Backups
- The nightly export runs once for each enterprise and makes one encrypted file for each, with the enterprise id in the file
  name. A restore of one enterprise needs no other file.
- The owner's age key encrypts every file in version 1.
- The GitHub minutes and the 1,000 releases of `gh release list` limit the count of enterprises. The builder records the
  numbers in proof.md.

### 5.16 Logs and PostHog
- Every server log line and every error record carries the enterprise id. The PostHog `distinct_id` is the enterprise id plus
  the person id.
- Screen usage events and screen replays go to PostHog for VADOs' Companies only. Other enterprises send error records with no
  person names. (My call: a customer has not agreed to usage data; the owner's PostHog project must not hold their names.)

### 5.17 Outside services
- **Daftra:** the keys stay server secrets of VADOs' Companies only, bound to `ent_001`. The lookup never uses a sub-company name
  alone, because another enterprise can have a sub-company with the same name. For every other enterprise, `daftra.status`
  answers "no accounts", so the current screens hide the Daftra parts, and the job step returns at once (decision D6).
- **Google Calendar:** one Google OAuth client for all enterprises. The seal key and the state key come from the master key plus
  the enterprise id, and the signed state carries the enterprise id.
- **Push:** one VAPID pair for all. Push devices are rows of the enterprise object, so an endpoint can belong to one enterprise
  per object without a conflict.
- **Satellite map:** the token check of the satellite route also takes the own key (a gap of the office path today).

### 5.18 Screens
- Sign-in, Forgot, Welcome and Reset stay the same (the email decides).
- The header shows the enterprise logo and name.
- The Office settings get the name, Arabic name and logo rows, and the read-only limits.
- The new page "Madar enterprises" (5.6) and the paused screen (5.8).
- The consent screen names the enterprise.
- Every new word has an English and an Arabic key, in the Thmanyah style, in the track's own word files.
- Screenshots: English and Arabic, light and dark, 390 px, for each changed screen.
- What's new: one entry that every person sees ("Madar now shows the name and logo of your company."), and one that the Admin
  sees (the name and logo rows in Office settings). Platform words never go into What's new.

### 5.19 The prototype
- A fake directory with two fake enterprises: "VADOs' Companies" (the current sample office with Vado and Bunah) and a second
  small fake enterprise.
- The prototype store keys each State by enterprise (`state:<enterprise id>`, and the file blobs too). State itself does not
  change, so the current handler and screen tests stay as they are.
- "Preview as" picks an enterprise first, then a person, or "Platform owner".
- Each `platform.*` call has a fake that touches only the fake directory.

### 5.20 The Postgres path
- Postgres serves only VADOs' Companies, and only as the way back after the move (section 6). There `session.get` gives the
  constant enterprise `ent_001`.
- The `platform.*` calls answer `not_found` on the Postgres path.
- The decision to delete the Postgres path is a later owner decision, after the way-back window. Until then every change keeps
  `test:lite`, `test:office` and the Postgres suites green.

## 6. The move of VADOs' Companies

VADO moves once, straight into `ent_001`, with the directory in place. No second production move.

Before the move:
1. Google Calendar and the Daftra step must work on the office path. Today the Google callback answers "not ready" there
   (`server/entries/officeSignin.ts`), and the Daftra step skips (`server/jobs/steps/daftra.ts`, TASKS.md line 236). VADO uses
   both in production.
2. The rest of the exit runbook: R7 to R14 of Part 2 of `docs/superpowers/plans/2026-10-17-madar-exit-wave4-ops-plan.md`, with
   the enterprise layer in place. The deploy suite runs on the local stack (`npm run dev:office`), never on the test copy.
3. The test copy runs two enterprises (the sample office as `ent_001`, and one fake enterprise) for one week of use, as R10.

The move itself (after office hours, with the owner present, as R11, and each production step with the owner's OK):
1. Tell the team in Arabic one day before: everybody signs in again once with the same password, and each AI agent connects
   again once.
2. Import the production office from Supabase into `ent_001`, with its sign-in rows (the imported password hashes work once,
   then the object keeps PBKDF2 hashes).
3. Write the directory rows of all VADO emails and the owner row of the platform owner.
4. Switch production to the office path (`config/server-host.json`).
5. Check the release with the quick checks and one check by hand.
6. Supabase production stays deployed and unchanged as the way back for 14 days. A way back after new writes needs the
   reverse export of the exit (R6), and the owner's yes.
7. During those 14 days, `platform.enterprises.create` stays closed in production (a setting that the lead opens after the
   window, with the owner's OK). Reason: a way back to Postgres can host only `ent_001`, so a customer enterprise made in the
   window would become unreachable (decision D5).

Items that the old system issued before the move (decision D5):
- The move drops every untagged link, reset link, renew key and Google connect state. There is no fallback to `ent_001`, so
  the fail-closed rule of 5.2 has no exception.
- Before the switch, the lead lists the people in state Invited. After the switch, a new invitation goes to each of them
  (an email to real people: the owner's OK first).
- Push devices and Google Calendar connections are records, not tokens: the import copies them into `ent_001`.
- AI agents connect again once (step 1).

## 7. Order of work

| Phase | What | Gate |
| --- | --- | --- |
| P0 | Spikes: S1 Cron fan-out and outside-call budget on the deployed test Worker; S2 rows read and written of one sign-in through the platform object; S3 how an object knows its own name | Numbers in proof.md |
| P1 | Office path parity: Google Calendar and the Daftra step on the office path | `test:office`, `test:lite`, the Google and Daftra suites |
| P2 | Enterprise core: object id and check, routing (5.2), tokens, link and ticket tags, the platform object, the directory, the MCP address, fail-closed rules | Leak tests (section 8) |
| P3 | Platform calls and page, create, pause, limits, name and logo, meter | Leak tests, screenshots |
| P4 | Mail pool, file prefix, logs, PostHog rule, per-enterprise backups, Cron fan-out | Leak tests, backup and restore check |
| P5 | Prototype parity, What's new, MCP words, the guides of each part | `npm test`, `npm run smoke` |
| P6 | The move of VADOs' Companies (section 6) | Owner OK at each production step |

The plan (writing-plans, next step after the owner's OK) splits each phase into tasks with files and tests. The build follows the
repo's build process: one builder for each track in its own worktree, no separate checker, the full suites once at the end.

## 8. Tests that must exist

The builders write these leak tests themselves (root rule for a feature that hides records):
- Two enterprises with the same ids (`usr_001`, `prj_001`, `fil_001`): every read path, the search, the History, the change
  signals, the sockets, the file links, the mail keys, the push, the MCP tools and the error texts give nothing of the other.
- A good token, ticket, link or renew key of A sent to B: refused, with no data and no hint in the error.
- An unknown or malformed enterprise: the same answer and time as wrong credentials, and no new object.
- An Admin of A: every `platform.*` call refused. An agent: every `platform.*` call refused and absent from the tool list.
- A paused enterprise: every path refused, sockets closed, no mail and no push.
- The people and storage limits: refusal at the limit, and the turned-off rule.
- Daftra: an enterprise with a sub-company named "Vado" never reads the keys of VADOs' Companies.

## 9. Left to the builder
- The table and row forms of the platform object, and the form of the link, key and ticket tags.
- How the Worker calls itself for each enterprise in the Cron (after S1).
- The share rule of the day cap (5.14), within its rule.
- The word keys, the exact screen layout of the platform page (one list, one button, one sheet), and the icons.
- The route path of the platform page.

## 10. Calls I made (the owner can change each one)
1. One signing key for all enterprises, with an `ent` claim (5.3).
2. The MCP address `/mcp/<address name>` for new enterprises; VADOs' Companies keeps `/mcp` (5.5).
3. A platform owner is a person of VADOs' Companies on an owner list, not a second account and not a right in `can()` (5.6).
4. The free-plan meter on the platform page (G8).
5. The Arabic name «شركات فادو» for VADOs' Companies, and the address name `vados` (5.10, 5.1).
6. «منشأة» as the Arabic word for an enterprise, and «منشآت مدار» for Madar enterprises («شركة فرعية» already means a
   sub-company).
7. The mail sender stays `Madar <madar@vado.sa>` (5.12).
8. PostHog usage and replays for VADOs' Companies only (5.16).
9. People limit counts active and invited people (5.9).
10. Every enterprise is Saudi in version 1 (time zone, work week, currency).

## 11. Questions of the builder check, settled by the lead

The owner gave the approval to the Opus lead (2026-11-08). So the lead settled each question of the builder check:

- **D1. Day one of a new enterprise:** the code defaults only, never VADO content, and a code prefix from the address name
  (5.7). P5 also sweeps the shared screens, words, defaults and docs for VADO-only text (Vado, Bunah, VADO, Al Khobar, `KH`,
  "our office") and makes each one neutral or enterprise data. The mail sender `madar@vado.sa` stays (call 7).
- **D2. Day cap:** VADOs' Companies is never refused; the others get a share, and all others stop at 90% of the account (5.14).
- **D3. Support for other enterprises:** outside the product in version 1. Reports ("Requests and bugs") stay inside each
  enterprise, as today. The owner reaches a customer through its first Admin (name and email on the platform page). Error
  records with the enterprise id and no names reach PostHog (5.16). A later version can add a "Send to the Madar team" choice
  in the report sheet, which the person picks on purpose. Reason: owner answer 3 (no view inside).
- **D4. The owner's own account:** each platform call checks again that the owner is active, and an enterprise with a
  platform owner cannot be paused (5.6).
- **D5. The move:** untagged items are dropped, open invitations go out again, records are imported; a 14-day way-back window
  with enterprise creation closed in production (section 6).
- **D6. Daftra (Q1):** VADOs' Companies only in version 1; for the others `daftra.status` answers "no accounts" (5.17). A
  later version lets each Admin enter its own keys.

The builder decides: how uploads check the storage limit, the Cron self-call and its fallback, the order of the directory
reserve and its undo, and the forms of the MCP discovery paths.

## 12. Change of 2026-11-08 (owner): Madar enterprises is a separate platform

The owner, after the first build: "Madar enterprises is a separate platform, and VADO, the current one, is one of the enterprises."
The first build put the platform page inside the app of the companies (a line in VADO's person menu and Me tab), and made the
platform owner a person of VADOs' Companies (call 3 of section 10). That was wrong. This section replaces 5.6, call 3, D4, and the
platform parts of 5.19. The rest of the design stays: each company keeps its own office object, and VADO is the company `ent_001`.

Owner answers (AskUserQuestion, 2026-11-08):
- **D7. Its own address.** Madar enterprises is a separate site: its own Cloudflare Pages project `madar-platform`, its own small
  build, its own sign-in page and its own screens. Test: `preview.madar-platform-d6c.pages.dev`. Production: `madar-platform-d6c.pages.dev`,
  then `platform.madar.vado.sa` (a DNS record that the owner adds), and later an address on the product domain madar.sa.
- **D8. Its own accounts.** Platform accounts belong to no company. They live in the platform object (email, name, password hash,
  state, sessions). The owner gets one with its own email and password; more platform people can come later. His VADO account
  stays a normal VADO account.

Rules that follow (the lead):
- **D9.** The app of the companies (madar.vado.sa, and every later company address) holds no door to the platform and no platform
  code: no menu line, no Me tab line, no `/enterprises` route, no platform client, no `platformOwner` value in `session.get` (the field
  stays optional in the contract and is never set). A bundle check refuses platform code in the companies' bundles.
- **D10.** A platform token works only on the platform routes, and a company token never works there: the platform token has the
  audience `madar-platform` and no `ent` claim; the company routes need the audience `authenticated` and an `ent` claim.
- **D11.** VADO is a normal company on the platform: the platform can pause it like any other (the "type the name" step stays). The
  owner list (`isOwner`, `setOwners`, the mirror in each company object, the `owner_enterprise` refusal) goes away.
- **D12.** The prototype of the companies holds no platform part (no "Platform owner" in Preview as, no platform fakes). The
  platform site is built only for the real copies.
- **D13.** A platform account is made, gets a new password, or is turned off only from the Mac, with a script and the ops secret
  (`scripts/office/platform-account.ts`); the script reads the password from a hidden prompt. No forgot or invite mail in this version.
- **Owner steps** (outside the repo, each with the owner's OK): make the Pages project `madar-platform` with the service binding of
  each copy (`MADAR_SERVER_TEST` on preview, `MADAR_SERVER_PRODUCTION` on production); later the DNS record of `platform.madar.vado.sa`.
