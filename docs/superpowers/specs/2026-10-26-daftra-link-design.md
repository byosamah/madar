# The Daftra link (flow A): design

Owner decisions: 2026-10-06 and 2026-10-26 (`TASKS.md`, "Daftra link"). Facts of the Daftra API: `docs/superpowers/real-build/proof.md`,
section "Daftra study on the Mazj account". This spec wins over the code maps; the code wins where this spec is wrong about the code.

## What the office gets

The accountant keeps the books in Daftra. Madar keeps the payment schedule of each project. Madar only reads Daftra and never writes to it.

1. A payment reaches its due date. The bell of each Accounting person says "Al Noor Villa: payment 2 is due today." (trigger `payment_due`).
2. The accountant makes the invoice in Daftra, as today. Daftra sends it to the client.
3. The bell notice opens the payment sheet. The sheet shows the Daftra invoice of the same client with the same amount, and one main
   button: "Link this invoice". "Not this one? Choose another" lists the other recent invoices of that client.
4. The first time for a client, the sheet asks the person to pick that client in Daftra (a search by name). The match is kept.
5. After Link, the payment row says "Invoiced". The 15-minute job reads the linked invoice. When Daftra says it is paid, Madar sets
   "Received" to the date of the last Daftra payment of that invoice. The History says that Daftra set it.

## Rules

- Madar sends only GET requests to Daftra. No code path sends POST, PUT, PATCH or DELETE to Daftra. A test pins this on the client module.
- One Daftra account for each sub-company (owner, 2026-10-26): Bunah, MAZJ, Tuba, Vado and Zuraa each keep their own books in their own
  Daftra account, with their own key. See the section "Accounts" below. This replaces the one-account design of the first draft.
- Each Daftra key lives only on the server: `DAFTRA_<NAME>_KEY` and `DAFTRA_<NAME>_SITE` (each pair all or none, like VAPID). Never in the
  browser, never in an answer, never in a log, never for an AI agent. Error texts name the variable, never the value; strip every key from
  any error text (as `clean()` in `server/mail/resend.ts`).
- With no Daftra config (the prototype, a copy without the keys), every Daftra screen part is hidden, the calls answer
  `daftra_not_ready`, and the job step does nothing. The due notice still goes out: it does not need Daftra.
- New right switch `payment.daftraLink` ("Link Daftra invoices"), section `money`, `scope: null`, `basic: false`, needs `payment.view`.
  `DEFAULT_EXTRA`: Accounting only. The Admin holds it, because the Admin holds every right. Follow commit `87345b21` (`ai.projectSetup`)
  for every place a switch touches. `MAX_STORED_RIGHTS` 120 leaves room for it.
- The due notice goes only to Accounting: active people, not agents, whose role is not `admin`, and who hold `payment.daftraLink` and
  `payment.view` and may view the project. With no such person, nobody gets it. The Admin gets no copy (no `COPY_TRIGGERS` line).
- Every amount compare uses whole halalas: `Math.round(x * 100)`. Daftra gives amounts as strings or numbers, with up to 4 decimals.
- A Madar payment amount includes VAT. Compare it with the Daftra `summary_total`.

## Accounts: one Daftra account for each sub-company

- An account name is `^[A-Z][A-Z0-9]{1,19}$`. The server reads every env pair `DAFTRA_<NAME>_KEY` and `DAFTRA_<NAME>_SITE` into
  `Config.daftra: Record<name, { key, site }>` (empty or missing: no account). A pair with one half missing fails the start with a
  `MissingConfigError` that names the missing variable. The old names `DAFTRA_API_KEY` and `DAFTRA_SITE` go away (nothing is released).
- The account of a project: its sub-company (`Project.subCompanyId`), whose English `name` in capitals with every character that is not
  A to Z or 0 to 9 removed equals the account name ("MAZJ" is `MAZJ`, "Vado" is `VADO`). One pure function, tested, used by every path.
  A project with no sub-company, or a sub-company with no account, has no Daftra account: the sheet says why, in one line.
- The browser never names an account. Every call takes a `paymentId` and the server finds the project, its client and its account.
- The account names are sub-company names: not secret. `daftra.status` may list them.
- `checkSecrets` and `FUNCTION_SECRETS` accept the name pattern (not a fixed list of five), and the Worker secret list follows the same
  rule. A test proves that a pattern name passes and that `DAFTRA_X_KEY` without its site fails.
- The test copy gets only the MAZJ pair (the owner's test key) until the last step. Production gets all five pairs at the last step.

## Data

1. `Payment.daftra` (optional, additive; `src/api/contract/entities.ts`):
   `{ account: string, invoiceId: string, invoiceNo: string, total: number, issuedOn: Day, linkedBy: UserId, linkedAt: Stamp }`.
   `account` is the account name at link time. The paid check reads that account, even if the sub-company changes later.
   Payments already go only to people with `payment.view`, so the field needs no new gate. `PaymentRow.status` keeps its three values
   (an old screen build must still parse a new answer). The screens show "Invoiced" when `payment.daftra` is set and `receivedOn` is null.
2. Server-only table `daftra_clients` (in `SERVER_TABLES`, no State, no prototype): `account text not null`, `client_id text not null`
   (the Madar client), primary key `(account, client_id)`, `daftra_id text not null`, `daftra_name text not null`, `matched_by text not null`,
   `matched_at timestamptz not null`. One Madar client can have a match in several accounts (projects under two sub-companies).
   A Madar client sits in every person's answer (`clients.list`, `ProjectDetail.client`), so the match must not sit on `Client`.
3. Server-only table `daftra_invoices` (in `SERVER_TABLES`): a cache of the recent invoices of matched clients. Columns: `account text not null`,
   `id text not null` (the Daftra invoice id; ids repeat across accounts), primary key `(account, id)`, `daftra_client_id text not null`, `no text not null`, `total_halalas bigint not null`, `issued_on date not null`,
   `created_at timestamptz not null` (the Daftra `created`), `payment_status int not null`, `paid_on date` (the date of the last Daftra
   payment row, null until paid), `draft boolean not null`, `seen_at timestamptz not null`. Index on `(account, daftra_client_id)`. "Held by another payment" compares account and id together.
4. One migration `supabase/migrations/20261026000100_daftra.sql`, with the full rights block of a private table (copy
   `20261008000100_push_devices.sql`). The SQLite twin: a new `LITE_STEPS` entry, `LITE_SCHEMA_VERSION` + 1, the pinned sha. List the
   two tables in `OUTSIDE_OFFICE_LOCK` (`scripts/backup/check.ts`) when a write runs outside the office lock.

## The Daftra client (`server/daftra/`)

- Test samples of real Daftra answers (personal data removed): `server/daftra/fixtures/` (a list, a single invoice, clients).
- `server/daftra/client.ts`: `daftraOf(deps, account)` gives a client for one account from `Config.daftra`, or undefined. Base URL `https://<site>/api2`,
  header `apikey`, `Accept: application/json`. An injectable fetch: `Deps.daftraFetch` (as `Deps.googleFetch`). No test reaches Daftra.
- Timeout 10 s for each call, the documented exception to the 3 s rule (Daftra answers in 1 to 3.4 s; proof.md). Add the line to the
  network rule in `server/CLAUDE.md`.
- `DaftraError { status, retryable }`. Retryable: 429, 5xx, timeout, network. 401 and 403 mean a bad key or a key role that refuses the
  entity: keep that state for `daftra.status`.
- Methods (GET only): `findClients(keywords)` (`/clients.json?keywords=&limit=10`), `client(id)` (`/clients/<id>.json`),
  `invoicesOf(daftraClientId, createdFrom)` (`/invoices.json?client_id=&created_from=&limit=50`), `invoice(id)` (`/invoices/<id>.json`).
- Parse both forms of an answer (proof.md): the list gives strings and ISO dates; the single invoice gives numbers and the date format of
  the account (`29/09/2026`). Take `issued_on` from `created` when the date form is not ISO. Take `paid_on` from the last
  `InvoicePayment.date` (ISO `YYYY-MM-DD HH:MM:SS`). Paid means `payment_status` 2. Never compare `summary_paid` with the total.
  Leave out drafts (`draft` 1) from suggestions.
- Config shape check in `scripts/deploy/secrets.ts` (`checkSecrets`): the key is 20 to 128 letters and digits; the site matches
  `^[A-Za-z0-9-]+\.(daftra|daftara)\.com$` (no `https://`, no slash). The names follow the pattern of the section "Accounts".

## Calls

All follow the new-call checklist of `src/api/CLAUDE.md`. All go on the MCP deny list: agents never touch Daftra.

| Call | Kind | Right | What it does |
| --- | --- | --- | --- |
| `daftra.status` | server-only read, `rule('none', [])` | `payment.daftraLink` | `{ ready, accounts: [{ name, lastReadAt, problem }] }`. `ready` false with no account. `problem`: `bad_key`, `refused` (key role), `unreachable`, or null. |
| `daftra.paymentLink {paymentId}` | server-only read | `payment.view` and `payment.daftraLink`, and the project view | For the sheet: `account` (name or null) and `noAccount` (`no_sub_company`, `no_daftra_account` or null), the client match (`matched`, Daftra name), `suggested` (one invoice or null), `others` (up to 10 recent unlinked invoices of the client in that account, newest first), `projectHasNoClient`. Reads the cache only; fast. |
| `daftra.findClients {paymentId, query}` | server-only read | `payment.daftraLink`, and the project view | Live GET to the account of the payment, up to 10 `{ id, name, number }`. |
| `daftra.matchClient {paymentId, daftraClientId}` | server-only write | `payment.daftraLink`, and the project view | The server finds the client and the account of the payment. GET the Daftra client first (outside any lock). Upsert `daftra_clients` for that account. Then fill the cache for that client (`invoicesOf` from 180 days ago), so the sheet shows a suggestion at once. A second match replaces the first. |
| `payments.linkInvoice {id, invoiceId}` | shared write with a server `preflight` | `payment.daftraLink` | The preflight finds the account of the payment and reads the invoice from that account (`invoice(id)`), never from the browser. It refuses: no config or no account for the project (`daftra_not_ready`), an invoice of another Daftra client than the match of the project client (`daftra_client_mismatch`), a draft (`daftra_draft`), an invoice that another payment holds (`daftra_invoice_taken`). The handler sets `Payment.daftra` from the prepared snapshot. Event `payment.daftra_linked`. Undo works. The prototype fake answers `daftra_not_ready`. |
| `payments.unlinkInvoice {id}` | shared write | `payment.daftraLink` | Clears `Payment.daftra`. Event `payment.daftra_unlinked`. Undo works. A payment that Daftra already marked received keeps its `receivedOn`. |

- A different amount does not refuse a link (a partial invoice is possible), but the sheet shows both amounts when they differ.
- `payments.update` and `payments.markReceived` keep their rules. While `Payment.daftra` is set and `receivedOn` is null, the sheet hides
  "Mark as received" and shows "Daftra sets Received when the invoice is paid." The calls themselves do not refuse.
- `WRITE_KINDS`, `readMap`, loaders, `everyCall`, pinned counts, as the checklist says.

## The job step `daftra`

- A new step in `JOB_STEPS` (`server/jobs/run.ts`), after `meetings`. It runs every 15 minutes and is safe to run twice.
- With no config it returns at once. On the office object path (`MADAR_DATA=office`) it also returns at once, with a test, until a
  `NetApi` method exists. Write that limit in the new guide and in `TASKS.md`.
- Never hold the office lock during a Daftra call. Budget: at most 20 Daftra calls and 60 s for each run, for all accounts together;
  take the accounts in turn so one slow account cannot starve the others; stop early and leave the rest for the next run. One account
  that fails (bad key, down) does not stop the others. Log codes, ids and account names only.
- Each paid check reads the account stored in `Payment.daftra.account`. Each cache fill reads the account of the project.
- Work in this order:
  1. Paid check: each payment with `daftra` set and `receivedOn` null, oldest link first: `invoice(id)`. When paid, set `receivedOn` to
     `paid_on` (never after today; clamp to today) through a path that the browser and agents cannot call, under the office lock, with the
     save and the signals (the `triggers.ts` path, or a server-internal run). The event names Daftra as the source; the History line says
     "Received, set by Daftra". The actor is the person who linked it while active, else the first active Admin.
  2. Cache: each matched client with an unlinked open payment due within 30 days or past due: `invoicesOf(client, min(dueDate) - 60 days)`.
     Upsert into `daftra_invoices`.
  3. Keep `lastReadAt` and the last `problem` of each account for `daftra.status` (a `job_runs` row for each account is enough).
- Suggestion rule (pure, tested): the invoices of the matched client, not draft, not held by another payment, `total_halalas` equal to the
  payment amount in halalas, `created_at` on or after the payment due date minus 60 days. The newest wins.

## The due notice `payment_due`

- New trigger in `TRIGGERS`, in `IN_APP_ONLY_TRIGGERS` (mail quota) and in `ACTION_TRIGGERS` (it counts on the bell). Not in
  `COPY_TRIGGERS`. Settings shows its switch only to people who hold `payment.daftraLink` and are not Admin (as `ADMIN_ONLY_TRIGGERS` hides one).
- Sent by `runScheduledTriggers` (pure, `src/api/notify.ts`) on the due day, for each payment with `receivedOn` null and no `daftra` link,
  in a project that is not internal. Dedupe key `payment_due:<paymentId>:<dueDate>`, so a moved date notifies again. A payment that is
  already past due on release day gets no notice (only the due day itself counts).
- `loadJobs` (`server/data/loaders/jobs.ts`) loads the open payments with `dueDate` in the window, with a `_LITE` twin.
- Target: `targetType: 'project'`, link `/projects/<projectId>?payment=<paymentId>` (the link of the money panel). Words: the bell
  sentence `inbox.trigger.payment_due`, the Settings label `settings.triggers.payment_due`, and the import line in `server/push/words.ts`.
  Browser push follows by itself (`pushRows`).

## Screens

- `src/features/project/payments/PaymentSheet.tsx`: a "Daftra" part, only when `daftra.status` says ready and the viewer holds
  `payment.daftraLink`. States:
  0. No Daftra account for the project: one line. With no sub-company: "Pick a sub-company for this project to link a Daftra invoice."
     With a sub-company that has no account: "<Sub-company> has no Daftra account in Madar yet." The sub-company name in the screen language.
  1. The project has no client: one line, "Add a client to this project to link a Daftra invoice."
  2. The client has no match: "Find <client> in Daftra", a search field with the client name in it, up to 10 results; one press on a
     result matches it (with a toast).
  3. A suggestion: "Invoice 1521945, 12,500 SAR, made 26 Oct" and the main button "Link this invoice". Under it a quiet link
     "Not this one? Choose another" opens the list of `others`.
  4. No suggestion: "No Daftra invoice of 12,500 SAR yet. Madar looks again every 15 minutes." and "Choose another invoice".
  5. Linked, not paid: "Invoiced: invoice 1521945. Daftra sets Received when it is paid." and a quiet "Unlink" (Undo toast).
  6. Linked and paid: the received date as today, plus "Invoice 1521945".
  A person with `payment.view` but without `payment.daftraLink` sees only states 5 and 6 as read-only lines.
- The sheet keeps one main button: Link when state 3 shows; else the main button stays as today.
- `PaymentsPanel.tsx` `PaymentSign`: "Invoiced" (a shape sign and an ink word, design rules) when linked and not received.
- Calm rules of `DESIGN.md`: one next step, the fewest controls, gentle words, no red except errors.
- Words in a new track pair `src/i18n/real/daftra.en.json` and `daftra.ar.json`. ASD-STE100 English, Thmanyah Arabic. No em-dash.

## MCP

- Deny list: the four `daftra.*` calls, `payments.linkInvoice`, `payments.unlinkInvoice`.
- `TOOL_DOCS` of `payments.list`: the optional `daftra` field (read only; the invoice number and total). Of `payments.markReceived`: a
  linked payment gets Received from Daftra by itself.
- `INSTRUCTIONS`: one short rule: "A payment can be linked to a Daftra invoice in the screens. Daftra then sets Received. Agents cannot
  link or unlink."
- Re-record the samples when an allowed answer changes (`scripts/record-samples.ts`).

## What's new

One entry, id `2026-10-23-113` (madar-83 holds 108 to 112), `right: 'payment.daftraLink'`, the day `2026-10-26` for now (the lead sets
the real release day before `all.sh test`; add the day to the pinned set in `entries.test.ts`). Words in `whatsnew.en.json` and
`whatsnew.ar.json`, second in the list.

## Leak tests (the builder writes them)

Probe as an outsider on every read path: a Member without `payment.view` gets no `daftra` field in any answer, no `payment_due`
notice, no Realtime signal that names a Daftra change, and the `daftra.*` calls answer `not_found` or `forbidden` with no Daftra name in
the error text. No answer, log line or error text ever holds the key or the site.

## Guides

- New `server/daftra/CLAUDE.md` (the module, the GET-only rule, the timeout, the job step, the office-path limit) and its row in the
  table of the root `CLAUDE.md`.
- Update `server/CLAUDE.md` (the job step list, the timeout exception), `src/api/CLAUDE.md` (the two payment calls, the trigger),
  `server/mcp/CLAUDE.md` (counts), `scripts/deploy/CLAUDE.md` (the two secrets).

## Last step (after the owner tries it on the test copy)

The test copy reads only the MAZJ Daftra account (the owner's test key). Production gets the five keys last (Bunah, MAZJ, Tuba, Vado,
Zuraa), each with the key role "Only Allow" `invoice` and `client`.
