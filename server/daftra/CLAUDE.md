# Daftra link (the Daftra link, flow A, owner 2026-10-26)

Madar only reads Daftra. The accountant keeps the books in Daftra, and Madar keeps the payment schedule of each project. A person links a payment to a
Daftra invoice in the screens. The 15-minute job then reads the invoice, and when Daftra says it is paid, Madar sets "Received". The spec is
`docs/superpowers/specs/2026-10-26-daftra-link-design.md`. Facts of the Daftra API: `docs/superpowers/real-build/proof.md`, section "Daftra study on the Mazj account".

## One account for each sub-company
- Bunah, MAZJ, Tuba, Vado and Zuraa each have their own Daftra account and their own key. The account name is the English name of the sub-company in
  capitals, only A to Z and 0 to 9 (`account.ts`: `accountNameOf`, `accountOfProject`; pattern `DAFTRA_ACCOUNT_PATTERN` in `src/api/contract/limits.ts`).
  "MAZJ" is `MAZJ`, "Vado" is `VADO`. A project with no sub-company, or a sub-company with no account in this copy, has no Daftra account
  (`no_sub_company`, `no_daftra_account`).
- The secrets are `DAFTRA_<NAME>_KEY` and `DAFTRA_<NAME>_SITE`, both or none for each name. `config.ts` reads every pair that the environment holds, by the
  name pattern, so a new sub-company needs two new secrets and no code change. `env.names()` (`server/env.ts`) lists the names of the host
  (Worker bindings, `Deno.env.toObject()`, `process.env`); `ReadEnv.names` carries it into `serverEnvFrom`. A reader with no `names` holds no account.
  A pair with one half makes `serverEnvFrom` fail with a `MissingConfigError` that names the missing variable. `Config.daftra` is `Record<name, { key, site }>`,
  and missing when the copy has no account. The names are not secret. A key, a site, a Daftra answer text and a client name never go in an answer, an error
  text, a log line, a signal or an event (`leaks.test.ts`, `calls/daftra.test.ts`, `jobs/steps/daftra.test.ts` prove it).
- The browser never names an account. Each call takes a `paymentId`, and the server finds the project, its sub-company and the account. The account of a
  link is stored in `Payment.daftra.account` at link time: the paid check reads that account, even when the sub-company changes later.
- The test copy gets only the MAZJ pair (the owner's test key) until the last step. Production gets the five pairs at the last step. Each key role should be
  "Only Allow" `invoice` and `client`.
- Test copy setup (2026-10-26): `secrets/test.env` holds the `DAFTRA_MAZJ_*` pair, and the sample office has the sub-company MAZJ (مزج)
  with prj_001 under it. Its links point at real Mazj invoices: read only, and a payment recorded in Mazj Daftra is a real entry there.
- Check a key role from the Mac with one GET of `/api2/products.json`: 403 means the role "Only Allow" `invoice` and `client` holds; 200 means
  it is not on (2026-10-26: all five production keys answered 200; Madar's own lock keeps them GET-only).

## The client (`client.ts`)
- GET only. One private function (`get`) calls fetch and sets `method: 'GET'`; `client.test.ts` fails when the file holds any other method or a body.
- The read-only lock is Madar's own (owner, 2026-10-26): Daftra has no read-only key, and a key role ("Only Allow") limits the record types,
  not the changes. `readOnly.ts` wraps the fetch of `client.ts` and refuses any request that is not a GET or that has a body, with the code
  `read_only`, before it leaves. `client.ts` is the one door to `/api2/` (`readOnly.test.ts` scans `server/`). To let Madar write to Daftra,
  the owner decides first; then `DAFTRA_READ_ONLY` and the tests change in one commit.
  `daftraOf(deps, account)` gives a client for one account (undefined without keys for it), `daftraClientOf` is the same with explicit values.
  Address `https://<site>/api2/<entity>.json`, header `apikey`. `Deps.daftraFetch` is the fetch of a test: no test reaches Daftra (`fakeDaftra.ts`, one fake for each
  account, and `daftraDeps(...fakes)` routes each request by host).
- Four reads: `findClients(keywords)`, `client(id)`, `invoicesOf(daftraClientId, createdFrom)`, `invoice(id)`. Ids are numbers (checked before any request).
- The timeout is 10 s for each call (`DAFTRA_TIMEOUT_MS`), the documented exception to the 3 s rule of `server/CLAUDE.md` (Daftra answers in 1 to 3.4 s).
  A redirect is a refusal (`redirect: 'manual'`): the key never goes to another host.
- `DaftraError { code, status, retryable }`; its message is only the code. 401 is `bad_key`, 403 is `refused` (the key role refuses the entity), 404 `not_found`,
  429 `rate_limited`, 5xx `server`, plus `timeout`, `unreachable` and `bad_answer`. Retryable: rate limit, server, timeout, unreachable.
- `parse.ts` reads both forms of an answer (the list gives strings and ISO dates, the single invoice gives numbers and the date form of the account). Money is whole
  halalas (`Math.round(x * 100)`). Paid means `payment_status` 2: never compare `summary_paid` with the total. `paid_on` is the newest ISO `InvoicePayment.date`.
  `suggest.ts` is the pure suggestion rule: not a draft, not held by another payment of the same account, the same total in halalas, made on or after the due day minus 60 days, newest wins.

## The data (`store.ts`, migration `20261026000100_daftra.sql`, SQLite version 11)
- Two server-only tables, no State collection: `daftra_clients` (primary key `(account, client_id)`: the match of a Madar client to a Daftra client, in one account) and
  `daftra_invoices` (primary key `(account, id)`: the cache of recent invoices; ids repeat across accounts). Both are in `SERVER_TABLES` and in `OUTSIDE_OFFICE_LOCK`
  (`scripts/backup/check.ts`): the cache fill writes outside the office lock. The match must not sit on `Client`: a Client is in every answer.
- The state of each account is in `job_runs`: `daftra:read:<ACCOUNT>` (last good read) and `daftra:problem:<ACCOUNT>:<code>` (one problem at a time).
- Every statement has a Postgres text and a SQLite twin (`sqlFor`). "Held by another payment" compares account and id together (`takenInvoiceIds`).
- The migration and the SQLite step are not released: change them in place until the first release of this link, then add a new file and LITE version.

## The calls (`server/calls/daftra.ts`)
- Four server-only calls: `daftra.status` (the accounts and their state), `daftra.paymentLink` (account, match, one suggestion, up to 10 others; from the copy, plus one fresh look in Daftra when no invoice matches and the newer of the last invoice read and the last look (`daftra:look:<ACCOUNT>:<client>` in job_runs, saved before the look whatever its result) is a minute old or more, `FRESH_LOOK_MS`, owner 2026-10-26; a failed look keeps the copy and logs the code),
  `daftra.findClients` (the one live read of a screen), `daftra.matchClient` (keeps the match, fills the cache). Two shared calls: `payments.linkInvoice` (the preflight
  `paymentsLinkInvoiceHooks` reads the invoice from the account of the project, never from the browser) and `payments.unlinkInvoice`.
- Rights: `payment.view` first, then `payment.daftraLink`. An agent is refused. A payment of a project that the person may not see reads as `not_found`. A person without
  `payment.view` reads a refusal that names no Daftra word. All six calls are on the MCP deny list.
- The preflight reads the person and the roles with two single statements (`linkerFromDb`, as the file hooks) before any other read, so a copy with no account reads no office.
- Refusals: `daftra_not_ready` (no account in the copy, or none for the project), `daftra_no_client`, `daftra_no_match`, `daftra_client_mismatch`, `daftra_draft`,
  `daftra_invoice_taken` (inside the lock, in the handler), `daftra_invoice_not_found`, `daftra_client_not_found`, `daftra_bad_key`, `daftra_refused`,
  `daftra_unreachable`, `daftra_invoice_changed`, `daftra_already_linked`. Words: `src/i18n/real/daftra.*.json` (`errors.reasons.*`).
- Events: `payment.daftra_linked` and `payment.daftra_unlinked` (the before side of a link holds `daftra: null`, and an Undo takes the field away: `ABSENT_WHEN_NULL` in
  `src/api/events.ts`). A payment that Daftra marked received keeps `receivedOn` after an unlink.

## The job step (`server/jobs/steps/daftra.ts`)
- After `meetings` in `JOB_STEPS`. Order: the paid check (each linked payment with no received day, the oldest link first, one `invoice(id)` in the stored account), then the
  cache fill (each matched client with an open unlinked payment due within 30 days or past due: `invoicesOf` from 60 days before the oldest due day), then the state of each account.
- No lock and no transaction during a Daftra call. Budget for all accounts together: 20 calls and 60 s (`DAFTRA_MAX_CALLS`, `DAFTRA_MAX_MS`). The accounts take turns, one item each.
  An account that fails (`bad_key`, `refused`, `unreachable`) stops only its own items for this run. A missing invoice is no problem of the account.
  Known limit: a long queue of linked payments that are not paid is read from the oldest link each run, so with more than 20 such payments the newest ones wait until older ones are paid.
- The paid write is the internal call `payments.daftraPaid` (`paidCall.ts`): in no public map, so a person, an agent, the HTTP routes and MCP get `not_found`; only the step passes
  `DAFTRA_INTERNAL_CALLS` to `createRunCall`. It runs under the office lock with a story, the event `payment.received_daftra` (it names Daftra as the source and has no Undo),
  the save and the signals. It checks again inside the lock that the payment still holds the same account and invoice and has no received day. The day never lies after today; a paid
  invoice with no payment row gets today. The actor is the person who linked the payment while active, else the first active Admin (`paidActorOf`).
- With no account in the config it returns `{ skipped: 'no_config' }`. On the office object path (SQLite, `MADAR_DATA=office`) it returns `{ skipped: 'office' }` at once, until a
  `NetApi` method exists for it (`TASKS.md`). A test turns the office path on with `onOffice` (the test office does).
- It logs codes, ids and account names only: `{ step: 'daftra', account, code, status }`.

## Tests
- `testOffice.ts` is the sample office on SQLite with sub-companies (MAZJ, Vado, Studio X) and a fake Daftra for each account. Files: `client.test.ts`, `parse.test.ts`, `suggest.test.ts`,
  `account.test.ts`, `config.test.ts`, `store.test.ts`, `paidCall.test.ts`, `words.test.ts`, `leaks.test.ts`; `server/calls/daftra.test.ts`; `server/jobs/steps/daftra.test.ts`;
  `server/it/daftra.it.test.ts` (Postgres, run by the merge lead).
- `fixtures/` holds test samples of real Daftra answers with the personal data removed.
