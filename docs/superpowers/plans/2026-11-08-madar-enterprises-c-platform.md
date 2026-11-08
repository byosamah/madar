# Madar enterprises, plan C: the platform part and the per-enterprise features

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform owner creates, changes, pauses and resumes enterprises from one page, and each enterprise gets its own name, logo, people limit, storage limit and share of the free day limits.

**Architecture:** The `platform.*` calls run in the Worker and the platform object, behind an owner check, on the new route `POST /api/platform`. They reach an enterprise object only through new RPC methods (`init`, `setState`, `setLimits`, `setIdentity`, `reinvite`, `person`, `setPlatformOwners`). The per-enterprise features (email reserve, limits, name and logo, day cap) are server hooks and small additive contract fields, so the shared calls keep their shape.

**Tech Stack:** TypeScript, zod, Hono on one Cloudflare Worker, SQLite Durable Objects (`Office`, `Platform`), React 19, TanStack Query, i18next, vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-madar-enterprises-design.md` (5.6 to 5.10, 5.14, 5.18, D1, D2, D4). Shared names: `docs/superpowers/plans/2026-11-08-madar-enterprises-contract.md`. Plan B is built first. Plan D fills the prototype fakes.

## Global Constraints

- Track `ent-c`. Branch `rb/ent-c` in `~/dev/madar-rb/ent-c`. `node_modules` links to `/Users/osamakhalil/dev/madar/.claude/worktrees/deploy-test/node_modules`. The builder edits only the files of this plan. New words go only into `src/i18n/real/ent-c.en.json` and `src/i18n/real/ent-c.ar.json`.
- Plan B changes some files named here (`officeWorker.ts`, `officeEntry.ts`, `parts.ts`, `office.ts`, the Cron). The line ranges below come from main before plan B. Find each function by its name and read it again before the edit.
- Use the names of the contract file exactly: `EnterpriseId`, `ENT_VADO`, `EnterpriseRow`, `EnterpriseLimits`, `EnterpriseStatus`, `DayCounts`, `EnterpriseInit`, `PlatformStub`, `CapAnswer`, `stubFor(env, ent)`, `platformStub(env)`, `PLAN_LIMITS`, `MADAR_ENTERPRISE_CREATE`. Do not edit the contract file. New shared names are in the list "New shared names" below.
- A new RPC method of the object calls the identity check of plan B first, as the other methods do (`grep -n unauthorized server/office/parts.ts`).
- Free limits (values for `FREE_LIMITS`): requests 100,000, rows read 5,000,000, rows written 100,000, mails 100 a day. Share of each enterprise except `ENT_VADO`: 10% (`MADAR_ENTERPRISE_SHARE`). All others stop at 90% of the account. The warning is at 70%. `ENT_VADO` is never refused by the cap. The Worker keeps the cap answer for 60 seconds.
- The people limit counts human people who are active (invited people are active people). Turned-off, removed and agent users do not count. The storage limit counts the bytes of every version of every file record. Both limits live in the server rows of the object, never in the Settings record. `null` means no limit. `ENT_VADO` starts with `null` for both.
- Order of a two-sided change (pause, resume, update): the enterprise object first, then the platform row. A retry of the same call is harmless.
- The platform page and the platform calls show no project, task, chat, file, person name or email of an enterprise, except the name and email of the first Admin of an enterprise that the owner created.
- A non-owner gets `not_found` ("This address does not exist.") on `POST /api/platform`, the same answer as an unknown address. An agent token gets the usual 403 `agent_token` of the browser token check.
- The paused text is exact. English: "Madar is paused for your company. Ask your Admin." Arabic: «توقّف مدار في منشأتك مؤقتاً. تواصل مع مدير النظام لديكم.» It shows only after a correct password.
- The name of the enterprise goes into HTML and mail text only through `escapeHtml`.
- Write every text in ASD-STE100. No em-dash. Every visible word has an English key and an Arabic key (Thmanyah style, `src/i18n/CLAUDE.md`).
- Inside a task, run only `npm run typecheck` and `npx vitest run <files> --testTimeout=60000`. A task marked (office) also runs `npm run test:lite` and `npm run test:office` with the sandbox off. The full suites are the work of the lead.
- One commit for each task. A plain message in STE. No `Co-Authored-By` line. No `Claude-Session` line.
- Steps for the lead are written "Lead step:". The builder skips them.

### New shared names (to add to the contract file by the lead)

- Platform tables, if plan B stored fewer fields: columns `name_ar`, `limits`, `created_at`, `admin_name`, `admin_email`, `logo` on the enterprise table of the platform object.
- `PlatformStub` additions: `list`, `getEnterprise`, `create`, `activate`, `update`, `setState`, `activeIds`, `ownersOf`, `capState`, `meterToday` (signatures in Tasks 8 and 15).
- `OfficeStub` additions: `setIdentity`, `setPlatformOwners`, `person`, `reinvite` (Task 6).
- `LITE_SCHEMA_VERSION` 14 becomes 15. New table `enterprise_use` (`id`, `storage_bytes`, `owners`).
- `Deps.enterprise?: EnterpriseFacts`, `Ctx.enterprise?: { id: string; platformOwner: boolean }`, `ExecuteBase.enterprise?`.
- `NetApi.directoryReserve(email)`, `NetApi.directoryRelease(email)`, `Deps.directory?: DirectoryPort`, `ServerHooks.settle`.
- Env names: `MADAR_PLAN_REQUESTS`, `MADAR_PLAN_ROWS_READ`, `MADAR_PLAN_ROWS_WRITTEN`, `MADAR_PLAN_MAILS`.
- Error reasons: `create_closed`, `address_taken`, `owner_enterprise`, `name_mismatch`, `not_finished`, `already_accepted`.
- Ops route `POST /api/office/platform-owners` (made by plan B; this plan changes its handler to `writeOwners`).
- Contract file `src/api/contract/platform.ts`: `PLATFORM_CALL_NAMES`, `platformContracts`, `PlatformApi`, `EnterpriseView`.

## Review Focus

1. A turned-off or removed owner with a token that is still valid: every `platform.*` call must refuse at once (D4). Test in Task 11.
2. A repeat of `platform.enterprises.create` (the same address and email, after a failed `init`): no second object, no second Admin, one invitation. Test in Task 9.
3. A refused `users.create` (right check, duplicate email in the same enterprise) must not free the email of a real person in the directory. Test in Task 12.
4. The storage total after a new version, a delete, a project delete and an import: the total must equal the sum of the versions, and the recount must repair a wrong total. The limit is exact (equal to the limit passes, one byte more fails). Test in Task 14.
5. A paused enterprise: a stranger who types the email of a paused enterprise must see the usual answers (sign-in, forgot), never the paused text, and a person with a good token must see the paused text on the next call. Tests in Tasks 7 and 22.

## File structure

| File | Task | Responsibility |
| --- | --- | --- |
| `server/enterprise/plan.ts` | 1 | `PLAN_LIMITS`, shares, `capVerdict`, warnings |
| `src/api/contract/platform.ts`, `src/api/platformFake.ts`, `src/api/remote/platformClient.ts` | 2, 19 | the 8 contracts, the `PlatformApi` interface, the empty fake, the HTTP client |
| `server/enterprise/facts.ts` | 4 | `EnterpriseFacts`: id, state, limits, owners in memory |
| `server/enterprise/lifecycle.ts` | 5, 6 | object side: `initEnterprise`, `codePrefixOf`, state, limits, identity, person, reinvite |
| `server/enterprise/platform/enterprises.ts` | 8 | platform rows: list, create, activate, update, state |
| `server/enterprise/platform/handlers.ts` | 9, 10 | the 8 platform calls (server only) |
| `server/enterprise/platform/guard.ts`, `route.ts`, `owners.ts` | 11 | owner check, `POST /api/platform`, owner list route |
| `server/calls/peopleHooks.ts` | 12, 13 | email reserve and people limit hooks |
| `server/enterprise/storage.ts` | 14 | storage total, recount, room check |
| `server/enterprise/platform/meter.ts`, `server/enterprise/gate.ts` | 15 | account meter, Worker cap gate |
| `server/enterprise/brand.ts`, `server/enterprise/logoRoute.ts` | 16 | name and logo for mails, consent and logo route |
| `src/features/enterprises/*` | 19, 20 | the page "Madar enterprises" |

## The words (key, English, Arabic)

Keys go in `ent-c.en.json` and `ent-c.ar.json` under `enterprises`, `admin` and `errors.reasons` as shown. The builder adds each key in the task that uses it.

| Key | English | Arabic |
| --- | --- | --- |
| `enterprises.title` | Madar enterprises | منشآت مدار |
| `enterprises.new` | New enterprise | منشأة جديدة |
| `enterprises.state.active` / `paused` / `creating` | Active / Paused / Not finished | فعّالة / متوقفة مؤقتاً / لم تكتمل |
| `enterprises.field.name` / `nameAr` / `address` / `logo` | Name / Name in Arabic / Address name / Logo | الاسم / الاسم بالعربية / اسم العنوان / الشعار |
| `enterprises.field.people` / `storage` | People limit / Storage limit (GB) | حد عدد الأشخاص / حد التخزين (جيجابايت) |
| `enterprises.field.adminName` / `adminEmail` / `adminLanguage` | First Admin name / First Admin email / Language of the invitation | اسم مدير النظام الأول / بريد مدير النظام الأول / لغة الدعوة |
| `enterprises.create` / `pause` / `resume` / `resend` | Create / Pause / Resume / Send the invitation again | أنشئ / أوقف مؤقتاً / استأنف / أرسل الدعوة مرة أخرى |
| `enterprises.pauseAsk` | Type the name of the enterprise to pause it. | اكتب اسم المنشأة لتوقفها مؤقتاً. |
| `enterprises.meter.title` | Today's use of the free limits | استخدام اليوم من الحدود المجانية |
| `enterprises.meter.requests` / `rowsRead` / `rowsWritten` / `mails` | Requests / Rows read / Rows written / Mails | الطلبات / الصفوف المقروءة / الصفوف المكتوبة / الرسائل |
| `enterprises.meter.warn` | {{limit}} is at {{percent}} percent of today's limit. | {{limit}} وصل إلى {{percent}}% من حد اليوم. |
| `enterprises.createClosed` | Creating enterprises is closed now. | إنشاء المنشآت مغلق الآن. |
| `admin.enterpriseName` / `enterpriseNameAr` / `enterpriseLogo` | Company name / Company name in Arabic / Company logo | اسم الشركة / اسم الشركة بالعربية / شعار الشركة |
| `admin.usage.people` / `storage` | People: {{used}} of {{limit}} / Storage: {{used}} of {{limit}} | الأشخاص: {{used}} من {{limit}} / التخزين: {{used}} من {{limit}} |
| `admin.usage.noLimit` / `readOnly` | No limit / Only the Madar team changes these limits. | بلا حد / فريق مدار وحده يغيّر هذه الحدود. |
| `errors.reasons.enterprise_paused` | Madar is paused for your company. Ask your Admin. | توقّف مدار في منشأتك مؤقتاً. تواصل مع مدير النظام لديكم. |
| `errors.reasons.people_limit` | Your company reached its limit of people. Ask the Madar team to raise it. | وصلت منشأتك إلى حد عدد الأشخاص. اطلب من فريق مدار رفع الحد. |
| `errors.reasons.storage_limit` | Your company has no more room for files. Ask the Madar team to raise the limit. | لا توجد مساحة كافية لملفات منشأتك. اطلب من فريق مدار رفع الحد. |
| `errors.reasons.create_closed` | Creating enterprises is closed now. | إنشاء المنشآت مغلق الآن. |
| `errors.reasons.address_taken` | This address name is taken. | اسم العنوان مستخدم. |
| `errors.reasons.owner_enterprise` | You cannot pause an enterprise that holds a platform owner. | لا يمكنك إيقاف منشأة فيها مالك للمنصة. |
| `errors.reasons.name_mismatch` | The name does not match. | الاسم غير مطابق. |
| `errors.reasons.not_finished` | Finish creating this enterprise first. | أكمل إنشاء هذه المنشأة أولاً. |
| `errors.reasons.already_accepted` | This person accepted the invitation already. | هذا الشخص قبل الدعوة بالفعل. |

---

### Task 1: Plan settings and the cap rule

**Files:**
- Create: `server/enterprise/plan.ts`
- Test: `server/enterprise/plan.test.ts`
- Read first: `server/office/cap.ts:1-40` (`DayCap`, `capRefusal`), `server/office/test/` helpers for env reads.

**Interfaces:**
- Consumes: `EnterpriseId`, `ENT_VADO` (`server/enterprise/ids.ts`), `DayCounts`, `CapAnswer` (plan B).
- Produces:
```ts
export type PlanLimits = { requests: number; rowsRead: number; rowsWritten: number; mails: number };
export const FREE_LIMITS: PlanLimits;            // 100_000, 5_000_000, 100_000, 100
export const STOP_LINE = 0.9; export const WARN_LINE = 0.7; export const DEFAULT_SHARE = 0.1;
export type Plan = { limits: PlanLimits; share: number };
export function planFrom(read: (name: string) => string | undefined): Plan;
export function shareCapOf(plan: Plan): DayCap;   // rowsRead, rowsWritten, requests at share x limit
export function capVerdict(o: { ent: EnterpriseId; plan: Plan; own: DayCounts; account: DayCounts; writes: boolean }): CapAnswer;
export function warnings(plan: Plan, account: DayCounts): (keyof PlanLimits)[];
export const PLAN_LIMITS: PlanLimits;             // planFrom(env).limits, read once at start
```

- [ ] **Step 1: Write the failing test** `plan.test.ts`
```ts
const plan = planFrom(() => undefined);
it('reads the Free limits with no variable', () => expect(plan).toEqual({ limits: FREE_LIMITS, share: 0.1 }));
it('reads the MADAR_PLAN_* variables and the share', () => {
  const p = planFrom((n) => ({ MADAR_PLAN_REQUESTS: '200000', MADAR_ENTERPRISE_SHARE: '0.25' })[n]);
  expect(p.limits.requests).toBe(200_000); expect(p.share).toBe(0.25);
});
it('names the variable in the error of a bad value', () =>
  expect(() => planFrom((n) => (n === 'MADAR_ENTERPRISE_SHARE' ? '2' : undefined))).toThrow('MADAR_ENTERPRISE_SHARE'));
const day = (o: Partial<DayCounts>): DayCounts => ({ requests: 0, rowsRead: 0, rowsWritten: 0, mails: 0, ...o });
it('never refuses ENT_VADO', () => expect(capVerdict({ ent: 'ent_001', plan, own: day({ requests: 1e9 }), account: day({ rowsRead: 1e9 }), writes: true })).toEqual({ allowed: true }));
it('refuses another enterprise at its share of requests', () => {
  expect(capVerdict({ ent: 'ent_002', plan, own: day({ requests: 10_000 }), account: day({}), writes: false })).toEqual({ allowed: false, reason: 'busy' });
  expect(capVerdict({ ent: 'ent_002', plan, own: day({ requests: 9_999 }), account: day({}), writes: false }).allowed).toBe(true);
});
it('rows written over the share refuse a write only', () => {
  const own = day({ rowsWritten: 10_000 });
  expect(capVerdict({ ent: 'ent_002', plan, own, account: day({}), writes: true }).allowed).toBe(false);
  expect(capVerdict({ ent: 'ent_002', plan, own, account: day({}), writes: false }).allowed).toBe(true);
});
it('stops every other enterprise at 90 percent of the account', () => {
  const account = day({ rowsRead: 4_500_000 });
  expect(capVerdict({ ent: 'ent_002', plan, own: day({}), account, writes: false }).allowed).toBe(false);
  expect(capVerdict({ ent: 'ent_001', plan, own: day({}), account, writes: false }).allowed).toBe(true);
});
it('warns at 70 percent', () => expect(warnings(plan, day({ requests: 70_000, rowsRead: 100 }))).toEqual(['requests']));
```
- [ ] **Step 2: Run** `npx vitest run server/enterprise/plan.test.ts --testTimeout=60000`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `plan.ts` as the signatures above. `mails` has no effect on `capVerdict` (the mail pool is plan D). `planFrom` throws an `Error` that names the variable for a value that is not a positive integer (limits) or not a number above 0 and at most 1 (share).
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server/enterprise/plan.ts server/enterprise/plan.test.ts && git commit -m "Add the plan limits and the day cap rule of the enterprises"`.

### Task 2: The platform contract and the fake interface

**Files:**
- Create: `src/api/contract/platform.ts`, `src/api/platformFake.ts`
- Modify: `src/api/contract/server.ts:24` (add the new reasons to `SERVER_REASONS`)
- Test: `src/api/contract/platform.test.ts`

**Interfaces:**
- Consumes: `Stamp`, `PICTURE_DATA_MAX` (`src/api/contract/entities.ts:248`), `PICTURE_DATA` (`src/api/contract/limits.ts:20`).
- Produces:
```ts
export const PLATFORM_CALL_NAMES = ['platform.me','platform.enterprises.list','platform.enterprises.create','platform.enterprises.update',
  'platform.enterprises.pause','platform.enterprises.resume','platform.enterprises.resendInvite','platform.meter.get'] as const;
export type PlatformCallName = (typeof PLATFORM_CALL_NAMES)[number];
export const ADDRESS_NAME_RULE: RegExp;           // same source as ADDRESS_NAME of plan B
export const EnterpriseLimitsIn = z.object({ people: z.number().int().min(1).nullable(), storageBytes: z.number().int().min(1).nullable() });
export const EnterpriseView: z.ZodType<{
  id: string; address: string; name: string; nameAr: string; logo: string | null; state: 'creating' | 'active' | 'paused';
  limits: { people: number | null; storageBytes: number | null };
  people: number; invited: number; storageBytes: number; lastWriteAt: string | null; createdAt: string;
  firstAdmin: { name: string; email: string } | null; hasOwner: boolean;
}>;
export const platformContracts: Record<PlatformCallName, { input: z.ZodType; output: z.ZodType }>;
export type PlatformApi = { [N in PlatformCallName]: (input: z.input<(typeof platformContracts)[N]['input']>) => Promise<z.output<(typeof platformContracts)[N]['output']>> };
```
Inputs: `me {}`; `list {}` returns `EnterpriseView[]`; `create { name, nameAr, address, logo?: string|null, limits: EnterpriseLimitsIn, admin: { name, email, language: 'en'|'ar' } }`; `update { id, patch: strict { name?, nameAr?, logo?, limits?: partial EnterpriseLimitsIn } }`; `pause { id, confirmName }`; `resume { id }`; `resendInvite { id }`; `meter.get {}`. `me` output `{ owner: true; ent: string; createOpen: boolean }`. `meter.get` output `{ day: string; limits: PlanLimits; total: DayCounts; share: number; warn: string[]; stop: boolean; enterprises: { id: string; name: string; nameAr: string; day: DayCounts }[] }`. Names are 1 to 80 characters. `platformFake.ts` exports `fakePlatform: PlatformApi` whose every method rejects with `ApiError('not_found', 'The prototype platform is built by plan D.')`.

- [ ] **Step 1: Write the failing test** `platform.test.ts`: `PLATFORM_CALL_NAMES` equals the 8 names in order; `create` input refuses addresses `'A'`, `'ab'`, `'1abc'`, `'ab_c'`, `'a'.repeat(33)` and accepts `'vados'`, `'acme-co'`; `ADDRESS_NAME_RULE.source` equals `ADDRESS_NAME.source` of `server/enterprise/ids.ts`; `update` refuses an extra key `state` in `patch`; `Object.keys(EnterpriseView.shape)` equals the 14 fields above (a pin: no person data); `logo` refuses text that is not picture data; every `fakePlatform` method rejects with code `not_found`.
- [ ] **Step 2: Run** `npx vitest run src/api/contract/platform.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. Add `'enterprise_paused','people_limit','storage_limit','create_closed','address_taken','owner_enterprise','name_mismatch','not_finished','already_accepted'` to `SERVER_REASONS` and fix the pin in `src/api/contract/server.test.ts` if it fails.
- [ ] **Step 4: Run** the test, `npx vitest run src/api/contract --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/api && git commit -m "Add the contract of the platform calls and the fake interface"`.

### Task 3: Settings fields, session.get, settings.get usage, report header

**Files:**
- Modify: `src/api/contract/entities.ts:1241-1256` (`Settings`), `src/api/registry.ts` (`Ctx`), `src/api/execute.ts:56-70` (`ExecuteBase`), `src/api/handlers/people.ts:44-85` (`sessionGet`) and `:455-500` (`settingsGet`, `settingsUpdate`), `src/api/handlers/reports.ts:42` and `:159`, `server/core/runCall.ts:166-169` (`baseOf`), `server/core/ports.ts:173` (`Deps`).
- Test: `src/api/handlers/enterpriseName.test.ts`

**Interfaces:**
- Consumes: `Settings`, `SubCompany.logo` rule (`PICTURE_DATA`), `can(actor, 'office.settings')`.
- Produces:
  - `Settings` gets optional `enterpriseName`, `enterpriseNameAr` (`z.string().trim().min(1).max(80)`) and `enterpriseLogo` (`z.string().max(PICTURE_DATA_MAX).regex(PICTURE_DATA).nullable()`).
  - `settings.update` input takes the same three fields (optional). The right stays `office.settings`.
  - `Ctx.enterprise?: { id: string; platformOwner: boolean }` and `ExecuteBase.enterprise?` with the same type. `baseOf` fills it from `deps.enterprise` (Task 4): `{ id, platformOwner: owners.has(authorityId) }`, only when the id is known.
  - `session.get` output gets `enterprise?: { id: string; name: string; nameAr: string; logo: string | null }` and `platformOwner?: true`. Name falls back to `'Madar'` and `'مدار'`.
  - `settings.get` output becomes `Settings.extend({ usage: Usage.optional() })`, `Usage = { people: { used: number; limit: number | null }; storage: { used: number; limit: number | null } }`. The handler adds `usage` only when `prepared` is set (Task 14 supplies it with a preflight hook) and the viewer holds `office.settings`. `people.used` counts human active users of the state.
  - Report header: `office.name` is `enterpriseName` of Settings when there is no sub-company, else `OFFICE_NAME` (`'Madar'`). A sub-company name still wins.

- [ ] **Step 1: Write the failing test** `enterpriseName.test.ts` (use the harness of `src/api/handlers/profile.test.ts`): `settings.update` by the Admin saves the three fields; by a Member fails `forbidden`; a logo `'http://x'` fails `invalid_input`; a Settings row without the fields parses; `session.get` with `ctx.enterprise = { id: 'ent_002', platformOwner: true }` returns `enterprise.id 'ent_002'`, the Settings name, and `platformOwner true`; without `ctx.enterprise` it returns neither key; `reports.office` header is the enterprise name when set, `'Madar'` when not, and the sub-company name when `subCompanyId` is set; `settings.get` returns no `usage` when `prepared` is `undefined` and a `usage` with `people.used` equal to the number of active human users when `prepared = { peopleLimit: 5, storageUsed: 7, storageLimit: null }` for the Admin, and none for a Member.
- [ ] **Step 2: Run** `npx vitest run src/api/handlers/enterpriseName.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits. `settingsGet` becomes `defineCall<..., { peopleLimit: number | null; storageUsed: number; storageLimit: number | null } | undefined>`; `settingsOut` still removes `resourceFolders`.
- [ ] **Step 4: Run** the test, `npx vitest run src/api server/core --testTimeout=60000`, `npm run typecheck`. Fix pins that count call output keys. Expected: PASS.
- [ ] **Step 5: Commit** `git add src server && git commit -m "Add the enterprise name and logo to Settings and session.get"`.

### Task 4: (office) Schema step 15, the enterprise facts, the wiring

**Files:**
- Modify: `server/data/lite/schema.ts` (`LITE_SCHEMA_VERSION` 15, `SERVER_SQL`, `LITE_STEPS[15]`, the header comment), `server/data/lite/schema.test.ts` (`PINNED_SHA256`), `server/office/parts.ts:75-110,182-203` (`PartsInput.facts`, `depsFor`), `server/office/office.ts:41-50` (load the facts before `officeParts`), `server/core/ports.ts` (`Deps.enterprise`), `server/test/nodeOffice.ts` or `server/office/test/nodeOffice.ts` (the node harness gets `facts`).
- Create: `server/enterprise/facts.ts`
- Test: `server/enterprise/facts.test.ts`, `server/data/lite/schema.test.ts`

**Interfaces:**
- Consumes: the `enterprise` table of plan B (`id`, `state`, `limits` JSON text, `created_at`).
- Produces:
```ts
export class EnterpriseFacts {
  load(db: LiteDb): Promise<void>;                    // reads the enterprise row and enterprise_use; id() stays undefined with no row
  id(): EnterpriseId | undefined;
  state(): EnterpriseState;                           // 'active' with no row
  limits(): EnterpriseLimits;                         // { people: null, storageBytes: null } with no row
  owners(): ReadonlySet<string>;
  set(change: { state?: EnterpriseState; limits?: EnterpriseLimits; owners?: string[] }): void;
}
```
SQL: `create table enterprise_use (id integer primary key check (id = 1), storage_bytes integer not null default 0, owners text not null default '[]')` and `insert into enterprise_use (id) values (1)` in `liteSchemaSql`. The step 15 makes the same table and inserts the row with `storage_bytes = (select coalesce(sum(json_extract(v.value, '$.size')), 0) from files f, json_each(f.doc, '$.versions') v)`.

- [ ] **Step 1: Write the failing tests**: a new office has one `enterprise_use` row with `0` and `'[]'`; an office at version 14 with two `files` rows (versions of 100 and 50 bytes, and 7) steps to 15 with `storage_bytes 157`, and its schema text equals a new office (`schema.test.ts` already compares); `facts.load` on an object with the `enterprise` row `ent_002`, limits `{"people":5,"storageBytes":1000}` and owners `["usr_001"]` gives those values; `facts.id()` is `undefined` with no row; `depsFor(net).enterprise` is the facts object.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/facts.test.ts server/data/lite/schema.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** as above. Update `PINNED_SHA256` with the value that the test prints. Keep `Office` constructor order: schema, `await facts.load(db)`, `officeParts({ ..., facts })`. Add the table to the list that `server/office/ops.ts` tests name (derived data, not exported). The recount of a file import is in Task 14.
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run test:lite`, `npm run test:office` (sandbox off). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Add the enterprise_use table and the enterprise facts"` after `git add server`.

### Task 5: (office) The object `init`

**Files:**
- Create: `server/enterprise/lifecycle.ts`
- Modify: `server/office/parts.ts` (`OfficeParts.init`), `server/office/office.ts` (`init` method), `server/entries/officeWorker.ts:78-88` (`OfficeStub.init`)
- Test: `server/enterprise/lifecycle.init.test.ts`
- Read first: `server/office/import.ts:107-169` (`importPart`, `importFinish`), `server/auth/invite.ts:199` (`inviteRow`), `server/core/effects.ts` (`writeOutbox`, `processOutbox`).

**Interfaces:**
- Consumes: `EnterpriseInit` (contract), `importPart`, `importFinish`, `inviteRow`, `writeOutbox`, `processOutbox`, `defaultPreferences` (`entities.ts:183`), `DEFAULT_SETTINGS`.
- Produces:
```ts
export function codePrefixOf(address: string): string;   // first two letters of the address, capitals: 'acme-co' -> 'AC', 'x9y' -> 'XY'
export async function initEnterprise(o: { db: LiteDb; clock: Clock; deps: Deps; facts: EnterpriseFacts }, input: EnterpriseInit): Promise<{ adminUserId: string }>;
// Office.init(input: EnterpriseInit, net: NetApi): Promise<OpResult<{ adminUserId: string }>>
```
Algorithm of `initEnterprise` (one write transaction for the rows, then the mail): if an `enterprise` row exists with the same id, skip the rows. Else insert the `enterprise` row (`state 'active'`, `limits` JSON, `created_at`), then `importPart` for `settings` (`{ ...DEFAULT_SETTINGS, codePrefix, enterpriseName, enterpriseNameAr, enterpriseLogo }`) and `users` (`usr_001`: Admin, human, `discipline 'Administration'`, `preferences.language` of the input), then `importFinish` with `counters: [{ prefix: 'usr', n: 1 }]`, `officeSeq 0`, `version 0`, empty lists, and one sign-in row (`id` a new UUID, the email lower case, `password_hash null`, `user_id 'usr_001'`, all flags false). After the commit: `facts.load(db)`. Then queue `inviteRow('usr_001')` once (skip if an `auth.invite` row exists) and `processOutbox` with the Deps of the call. A different `ent` than the row gives `unauthorized` (plan B check). The Admin gets no History event.

- [ ] **Step 1: Write the failing tests** (node harness with a made object): `codePrefixOf` cases above; `init` makes `usr_001` with `systemRole 'admin'` and the language of the input; the Settings row holds the name, Arabic name, logo and `codePrefix 'AC'` for address `acme-co`; day one holds the defaults only (the tables `clients`, `stage_templates`, `task_templates`, `project_templates`, `sub_companies`, `projects`, `teams` have 0 rows, and `settings.resourceFolders` is absent); a second `init` with the same input returns the same `adminUserId` and leaves exactly one `auth.invite` outbox row; `init` with `ent: 'ent_009'` on an object of `ent_002` rejects; the invitation mail is sent through the fake mail port to the Admin email; the next user created in the office gets `usr_002`.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/lifecycle.init.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** `codePrefixOf`, `initEnterprise`, the parts method and the class method. The email is normalized with `trim().toLowerCase()`.
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add init to the enterprise object"`.

### Task 6: (office) Object RPCs: state, limits, identity, owners, person, reinvite

**Files:**
- Modify: `server/enterprise/lifecycle.ts`, `server/office/parts.ts`, `server/office/office.ts`, `server/entries/officeWorker.ts:78-88`
- Test: `server/enterprise/lifecycle.rpc.test.ts`
- Read first: `server/calls/people.ts:49-120` (the invitation limit `RESEND_PER_DAY`, `hitLimit`), `server/data/lite/office.ts:66-110` (`writeOfficeSnapshot`, `readLiteOffice`), `server/auth/principal.ts:14-20` (`principalOf`).

**Interfaces:**
```ts
// OfficeStub and Office
setState(input: { ent: EnterpriseId; state: EnterpriseState }): Promise<void>;        // contract name
setLimits(input: { ent: EnterpriseId; limits: EnterpriseLimits }): Promise<void>;     // contract name
setIdentity(input: { ent: EnterpriseId; name: string; nameAr: string; logo: string | null }): Promise<void>;
setPlatformOwners(input: { ent: EnterpriseId; userIds: string[] }): Promise<void>;
person(input: { ent: EnterpriseId; authUserId: string }): Promise<{ userId: string } | null>;
reinvite(input: { ent: EnterpriseId }, net: NetApi): Promise<OpResult<{ sentAt: string }>>;
```
Rules: `setState` writes `enterprise.state`, updates the facts, and for `paused` closes every socket with tag `office` (code 1012, text "Paused."). `setLimits` writes `enterprise.limits` and the facts. `setIdentity` updates the three Settings fields of the `settings` row, raises `office_meta.version`, and rewrites the snapshot (`writeOfficeSnapshot`), in one transaction. `setPlatformOwners` writes `enterprise_use.owners` and the facts. `person` runs `principalOf` on `readLiteOffice` and returns `null` when it throws. `reinvite` refuses with `already_accepted` when `auth_users.password_set = 1` for `usr_001`, counts the limit `invite:usr_001` (5 a day, reason `invite_limit`), queues `inviteRow('usr_001')`, runs `processOutbox`, and returns `sentAt`.

- [ ] **Step 1: Write the failing tests**: `setState paused` closes every fake socket and a later `batch` rejects with `forbidden` reason `enterprise_paused` (plan B gate; if this fails, add the check to `batch`); a socket open on a paused object is refused (if plan B did not cover `fetch`, add the check to `socket`); `resume` lets the batch run; `setLimits` changes `facts.limits()`; a `settings.update` call with a `limits` field leaves the limits as they were; `setIdentity` makes the next `session.get` show the new name and logo; `person` returns `{ userId: 'usr_001' }` for an active linked person and `null` for a turned-off, a removed and an unknown auth id; `setPlatformOwners(['usr_001'])` makes `session.get` return `platformOwner true` for `usr_001` and not for `usr_002`; `reinvite` queues exactly one new `auth.invite` row, refuses after the Admin set a password (`already_accepted`), and refuses the sixth call of a day (`invite_limit`).
- [ ] **Step 2: Run** `npx vitest run server/enterprise/lifecycle.rpc.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the six methods in `lifecycle.ts` and wire them in `parts.ts`, `office.ts` and `OfficeStub`. All six run before the paused gate only where the contract says so: `setState` and `status` always run; the other five refuse when paused (plan B gate).
- [ ] **Step 4: Run** the test, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add state, limits, identity, owner and invitation methods to the enterprise object"`.

### Task 7: (office) The paused sign-in and the paused mail routes

**Files:**
- Modify: `server/auth/own/ops.ts:48-72` (`passwordSignIn`), `server/office/parts.ts:331-376` (`signin`, `mailRoute`, `mailWork`)
- Test: `server/auth/own/pausedSignin.test.ts`

**Interfaces:**
- Produces: `export function pausedSignIn(): ApiError` (`ApiError('unauthenticated', 'Madar is paused for your company. Ask your Admin.', { reason: 'enterprise_paused' })`) in `ops.ts`; `export const PAUSED_SQL = 'select state from enterprise limit 1'`.
- The `signin` method of the object must pass the plan B pause gate for every step, then decide by the step: when paused, only `auth.password` runs its checks. It throws `pausedSignIn` after the password check passed and before the session insert. Every other step answers `{ ok: false, error: unauthenticated, reason 'session_ended' }`. `mailRoute` on a paused object runs the same route and the same answer but drops the `work` value, so no mail goes out and the body is the usual body. `mailWork` on a paused object does nothing.

- [ ] **Step 1: Write the failing tests**: paused + right password gives `unauthenticated` reason `enterprise_paused` and inserts no `auth_sessions` row; paused + wrong password and paused + unknown email give `invalid_credentials` (the same body as an active object); paused `auth.refresh` and `auth.verify` give `session_ended`; paused `forgot` answers status 200 with the same body as an active `forgot` for the same email and queues no mail and no outbox row; after `setState active` the same password signs in.
- [ ] **Step 2: Run** `npx vitest run server/auth/own/pausedSignin.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits. Update the sentence in `server/auth/CLAUDE.md` ("The own sign-in") with one line about the paused password step.
- [ ] **Step 4: Run** the test, `npx vitest run server/auth --testTimeout=60000`, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Show the paused answer only after a correct password"`.

### Task 8: The platform rows

**Files:**
- Create: `server/enterprise/platform/enterprises.ts`
- Modify: `server/enterprise/platform/object.ts` (class `Platform`), `server/enterprise/platform/schema.ts` (plan B; a new step for the missing columns), `server/entries/officeWorker.ts` or the file where plan B declares `PlatformStub`
- Test: `server/enterprise/platform/enterprises.test.ts`
- Read first: plan B `server/enterprise/platform/*` (the tables, `reserveEmail`, `report`, `listed`). Use its helpers. Add a column only when it is missing.

**Interfaces:**
```ts
export type EnterpriseListRow = EnterpriseRow & { logo: string | null; status: EnterpriseStatus | null };
export type CreateRowInput = { name: string; nameAr: string; address: string; logo: string | null; limits: EnterpriseLimits; admin: { name: string; email: string } };
// PlatformStub additions
list(): Promise<EnterpriseListRow[]>;
getEnterprise(input: { ent: EnterpriseId }): Promise<EnterpriseListRow | null>;
create(input: CreateRowInput): Promise<{ ok: true; row: EnterpriseRow; fresh: boolean } | { ok: false; refused: 'address_taken' | 'email_taken' }>;
activate(input: { ent: EnterpriseId }): Promise<void>;
update(input: { ent: EnterpriseId; patch: { name?: string; nameAr?: string; logo?: string | null; limits?: EnterpriseLimits } }): Promise<void>;
setState(input: { ent: EnterpriseId; state: 'active' | 'paused' }): Promise<void>;
activeIds(): Promise<EnterpriseId[]>;
ownersOf(): Promise<{ ent: EnterpriseId; userId: string }[]>;
```
Rules: `create` is one transaction. The new id is the highest `ent_NNN` plus one, at least `ent_002` (`ent_001` is VADO). It reserves the address and the Admin email (`reserveEmail` logic, normalized). The same address with the same Admin email in state `creating` returns that row with `fresh: false`. Any other use of the address gives `address_taken`. A taken email gives `email_taken` and names nothing. `activate` moves `creating` to `active` only. `list` ignores the status name when the status row is empty and uses the status `name` and `nameAr` when present. `list` returns no person data except `firstAdmin`.

- [ ] **Step 1: Write the failing tests**: first `create` on a platform with `ent_001` returns `ent_002`, state `creating`, `fresh true`; the same input again returns `ent_002` with `fresh false`; the same address with another email gives `address_taken`; another address with the Admin email of `ent_001` gives `email_taken` and the result has no `ent` key; `listed()` does not contain `ent_002` until `activate`, then does; `activeIds()` omits a paused one while `listed()` keeps it; `list` row for `ent_002` has `firstAdmin` and `status` null before the first report, and takes people and storage from a `report`; `update` changes name and limits; `setState` refuses a `creating` row.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/platform/enterprises.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the methods. The `Platform` class methods delegate to the functions of `enterprises.ts`.
- [ ] **Step 4: Run** the test, `npx vitest run server/enterprise --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add the enterprise rows to the platform object"`.

### Task 9: The call `platform.enterprises.create`

**Files:**
- Create: `server/enterprise/platform/handlers.ts` (`createEnterprise`, `viewOf`, `PlatformCtx`)
- Test: `server/enterprise/platform/handlers.create.test.ts`

**Interfaces:**
- Consumes: `PlatformStub` (Task 8), `OfficeStub.init` (Task 5), `stubFor` (plan B), `codePrefixOf`, `testToolsOn` (`server/office/ops.ts`).
- Produces:
```ts
export type PlatformCtx = {
  ent: EnterpriseId; userId: string;                    // the caller (a platform owner)
  platform: PlatformStub; office(ent: EnterpriseId): OfficeStub; net(): NetApi;
  read(name: string): string | undefined; now(): Date; log: Logger;
};
export function viewOf(row: EnterpriseListRow): z.output<typeof EnterpriseView>;
export function createOpen(read: (name: string) => string | undefined): boolean;   // MADAR_ENTERPRISE_CREATE === 'open' or testToolsOn(read)
export async function createEnterprise(input: CreateInput, ctx: PlatformCtx): Promise<EnterpriseView>;
```
Order (design 5.7): refuse with `forbidden` reason `create_closed` when `!createOpen(read)`; `platform.create` (map `refused` to `invalid_input` field `address` reason `address_taken`, or field `admin.email` reason `email_taken`); `office(ent).init({ ent, address, name, nameAr, logo, limits, codePrefix: codePrefixOf(address), admin }, net())`; on a failed init throw and leave the row `creating`; `platform.activate`; return `viewOf(getEnterprise)`.

- [ ] **Step 1: Write the failing tests** (fake `PlatformStub` and fake `OfficeStub` that log their calls): closed with no variable and no test tools (`create_closed`); open with `MADAR_ENTERPRISE_CREATE = 'open'`; open when `MADAR_TEST_TOOLS = 'on'`; the call log is `['create', 'init', 'activate']`; `init` gets `codePrefix 'AC'` for `acme-co` and the language of the Admin; a throwing `init` leaves state `creating`, and the same call again (the fake `init` now works) ends `active` with the log `create, init, activate` and one `init` that wrote an Admin (the fake counts one invitation); `address_taken` and `email_taken` map to `invalid_input` with the reason; the answer is `EnterpriseView`-valid with `firstAdmin` and `state 'active'`.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/platform/handlers.create.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** `handlers.ts` with `createEnterprise`, `viewOf` and `createOpen`.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add the create call of the platform"`.

### Task 10: The other platform calls

**Files:**
- Modify: `server/enterprise/platform/handlers.ts` (`PLATFORM_HANDLERS`), the Cron fan-out of plan B (`grep -rn "listed()" server/enterprise` to find it)
- Test: `server/enterprise/platform/handlers.test.ts`

**Interfaces:**
```ts
export const PLATFORM_HANDLERS: { [N in PlatformCallName]: (input: z.output<(typeof platformContracts)[N]['input']>, ctx: PlatformCtx) => Promise<z.output<(typeof platformContracts)[N]['output']>> };
```
Rules: `me` returns `{ owner: true, ent, createOpen }`. `list` returns `viewOf` for every row. `update`: refuses `creating` with `not_finished` and `paused` with `enterprise_paused`; calls `office.setIdentity` (when name, Arabic name or logo changed) and `office.setLimits` (when limits changed), then `platform.update`. `pause`: refuses an enterprise that holds an owner (`ownersOf` contains its id) with `forbidden` reason `owner_enterprise`; refuses a `confirmName` that differs from the trimmed enterprise name with `invalid_input` field `confirmName` reason `name_mismatch`; `office.setState('paused')` then `platform.setState('paused')`. `resume`: `office.setState('active')` then `platform.setState('active')`. `resendInvite`: refuses `creating` with `not_finished`; `office.reinvite`. `meter.get`: Task 15. The Cron fan-out reads `activeIds()`.

- [ ] **Step 1: Write the failing tests**: `me` shape; `list` has one view for each fake row; `update` calls the office first and the platform second, and a throwing office call leaves the platform row unchanged; `update` of a paused row rejects `enterprise_paused`, of a creating row `not_finished`; `pause` of the enterprise of an owner rejects `owner_enterprise`; `pause` with `confirmName: 'Acme'` for `'Acme Co'` rejects `name_mismatch`, with `' Acme Co '` passes; `pause` twice is harmless; `resume` order is office then platform; `resendInvite` of a `creating` row rejects; the Cron fan-out test of plan B shows that a paused enterprise gets no `cron` call.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/platform/handlers.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the handlers and the one-line change of the fan-out.
- [ ] **Step 4: Run** the test, `npx vitest run server/enterprise --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add the update, pause, resume and list calls of the platform"`.

### Task 11: The owner check, the route and the owner list

**Files:**
- Create: `server/enterprise/platform/guard.ts`, `server/enterprise/platform/route.ts`, `server/enterprise/platform/owners.ts`, `scripts/office/platform-owners.ts`
- Modify: `server/entries/officeWorker.ts:94-108,259-272` (a `platform` option and `app.post('/api/platform', ...)`, the ops route `owners`), `server/entries/officeEntry.ts:39-75` (wire the options)
- Test: `server/enterprise/platform/guard.test.ts`, `server/enterprise/platform/route.test.ts`
- Read first: `server/entries/officeWorker.ts:128-167` (`batch`), `server/http/limits.ts` (`parseBatch`), `server/http/batch.ts:49` (`entryOf`).

**Interfaces:**
```ts
export async function ownerOf(o: { token: { authUserId: string; ent: EnterpriseId }; office(ent: EnterpriseId): Pick<OfficeStub, 'person'>; platform: Pick<PlatformStub, 'isOwner'> }): Promise<{ ent: EnterpriseId; userId: string } | null>;
export function platformRoute(o: PlatformRouteOptions): (request: Request, env: Env, after?: After) => Promise<Response>;
export async function writeOwners(o: { platform: PlatformStub; office(ent: EnterpriseId): OfficeStub }, owners: { ent: EnterpriseId; userId: string }[]): Promise<void>;
```
`ownerOf` calls `office(ent).person({ ent, authUserId })` (null gives null), then `platform.isOwner({ ent, userId })`. The route: `checkBuild`, `parseBatch` with exactly one call; a name outside `PLATFORM_CALL_NAMES` gives `not_found`; the token check (`verifyToken`) runs before the owner check; a null owner gives `not_found`; the input is parsed with `platformContracts[name].input`; the handler runs; the answer is `{ v: 1, serverTime, results: [entry] }` as `entryOf` builds it. `writeOwners` calls `platform.setOwners` and then `setPlatformOwners` on every listed enterprise (the user ids of that enterprise, or `[]`). The ops route `POST /api/office/platform-owners` of plan B (keep its secret check) now calls `writeOwners`. It takes `{ owners: [...] }` (zod: ids by `ENTERPRISE_ID` and `^usr_\d+$`), and calls `writeOwners`. The script posts the pairs given as `ent_001:usr_001` arguments to `/api/office/platform-owners` with the secret from `MADAR_OPS_SECRET` (it never prints it).

- [ ] **Step 1: Write the failing tests**: owner passes; an Admin who is no owner gets `null`; a pair `(ent_002, usr_001)` when only `(ent_001, usr_001)` is an owner gets `null`; a turned-off owner and a removed owner get `null` although the token is good (`person` returns `null`); the route answers `not_found` for an Admin, for a 2-call batch `invalid_input`, for `projects.list` `not_found`, for `GET` 404; an agent token gets 403 `agent_token`; a good owner call answers the wire entry; `entries/worker.ts` (the Postgres path) answers 404 to `POST /api/platform`; the owners route answers 401 with no secret header, and with the secret calls `setOwners` and `setPlatformOwners` (`['usr_001']` for `ent_001`, `[]` for `ent_002`); the script builds the body from `ent_001:usr_001` and refuses a bad pair.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/platform --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files and the two mounts. The route and the owners route are part of `officeRoutes`, so they exist only on the office path.
- [ ] **Step 4: Run** the tests, `npx vitest run server/entries --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server scripts && git commit -m "Add the owner check and the route of the platform calls"`.

### Task 12: (office) The email reserve in the directory

**Files:**
- Create: `server/calls/peopleHooks.ts`
- Modify: `server/office/net.ts:25-34,114-134` (`NetApi`, `netPorts`), `server/office/workerNet.ts` (`WorkerNet`), `server/core/ports.ts` (`DirectoryPort`, `Deps.directory`), `src/api/registry.ts:105-135` (`ServerHooks.settle`), `server/core/runCall.ts:204-300` (`runWrite`), `server/calls/index.ts:44-52` (`SERVER_HOOKS`), `server/entries/officeEntry.ts` and `officeWorker.ts` (the batch and mcp paths pass `ent` to `net`), `server/office/parts.ts` (`depsFor` sets `deps.directory`)
- Test: `server/calls/peopleHooks.test.ts`, `server/core/settle.test.ts`

**Interfaces:**
```ts
// ports.ts
export interface DirectoryPort { reserve(email: string): Promise<'ok' | 'taken'>; release(email: string): Promise<void> }
// net.ts NetApi
directoryReserve(email: string): Promise<NetAnswer<'ok' | 'taken'>>;
directoryRelease(email: string): Promise<NetAnswer<null>>;
// registry.ts ServerHooks
settle?(input: I, ctx: HookCtx<D>, preflight: unknown, outcome: { ok: true; output: unknown } | { ok: false }): Promise<void>;
// peopleHooks.ts
export const usersCreateHooks: ServerHooks<unknown, unknown, Deps>;     // key: 'users.create'
export const usersUpdateHooks: ServerHooks<unknown, unknown, Deps>;     // key: 'users.update'
export const usersRemoveHooks: ServerHooks<unknown, unknown, Deps>;     // key: 'users.remove'
```
Rules: `WorkerNet` takes an optional `directory` (`{ reserve, release }` bound to the `ent` of the request, built from `platformStub(env)`); `netPorts` makes `deps.directory` from the net calls (each counts in `NET_BUDGET`, refused inside a transaction). With no directory in the net, `directoryReserve` answers a failure (fail closed). The email is `trim().toLowerCase()`. `runWrite` calls `hooks.settle` once after the transaction ended: `{ ok: true, output }` after a commit or a replay, `{ ok: false }` after any throw (the guard stop too). A throw in `settle` is logged and never changes the answer. All hooks do nothing when `deps.directory` is undefined (the Postgres path and tests without a directory).
- `usersCreateHooks.preflight` (human only): if a user of this enterprise holds the email (`select 1 from users where lower(json_extract(doc, '$.email')) = ?1`), reserve nothing (the handler refuses `email_taken`); else `reserve`; `'taken'` throws `invalid('email', 'This email is already in use.', 'email_taken')`. Returns `{ reserved: boolean, email }`. `settle` on `{ ok: false }`: release only when `reserved` and no user row holds the email now.
- `usersUpdateHooks.preflight`: read the target (`kind`, `email`); for a human and a changed email, reserve the new email as above. `settle` ok: release the old email; not ok: release the new one under the same re-check.
- `usersRemoveHooks.settle` ok and human: release the email of the output.

- [ ] **Step 1: Write the failing tests**: `settle.test.ts` (map built as `runCall.test.ts` builds hook calls): settle gets `{ ok: true }` after a commit and after a replay of a key, `{ ok: false }` after a handler throw and after a guard stop, and a throwing settle keeps the answer. `peopleHooks.test.ts` (fake `DirectoryPort` with a Map): a `users.create` for a new email reserves it once; a taken email gives `email_taken` and the message has no enterprise id; a refused create by a Member (`forbidden`) releases the reserve; a create of an email that a user of the enterprise holds reserves nothing and the failure releases nothing, also when two creates run at once (the re-check keeps the email); `A@X.com` and `a@x.com` are one email; an agent create reserves nothing; `users.update` of the email reserves the new one and releases the old after the commit, and releases the new one after a refusal; `users.remove` of a human releases the email; `users.deactivate` releases nothing; with `deps.directory` undefined all three hooks do nothing.
- [ ] **Step 2: Run** `npx vitest run server/calls/peopleHooks.test.ts server/core/settle.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files. `ServerHooks.settle` is a type only in `src/api/registry.ts`.
- [ ] **Step 4: Run** the tests, `npx vitest run server/core server/calls server/office --testTimeout=60000`, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server src && git commit -m "Reserve the email of a person in the directory before the write"`.

### Task 13: (office) The people limit

**Files:**
- Modify: `server/calls/peopleHooks.ts` (`prepare` of `usersCreateHooks`; new `usersReactivateHooks`), `server/calls/index.ts` (`'users.reactivate'`)
- Test: `server/calls/peopleLimit.test.ts`

**Interfaces:**
```ts
export const PEOPLE_COUNT_LITE =
  "select count(*) as n from users where json_extract(doc, '$.kind') = 'human' and json_extract(doc, '$.active') = 1 and coalesce(json_extract(doc, '$.removed'), 0) = 0";
export async function assertRoomForPerson(q: HookQuery, limit: number | null): Promise<void>;   // throws ApiError('conflict', ..., { reason: 'people_limit' })
export const usersReactivateHooks: ServerHooks<unknown, unknown, Deps>;
```
Rules: `prepare` runs inside the lock. The limit comes from `deps.enterprise?.limits().people`; `null` or no facts means no check. `users.create` of a human and `users.reactivate` of a human check `count + 1 > limit`. An agent is never counted and never refused. The reason text is `errors.reasons.people_limit`.

- [ ] **Step 1: Write the failing tests** (limit 3, one Admin plus two Members active): create of the 4th human is refused with `conflict` reason `people_limit`; create of the 3rd human succeeds when only the Admin and one Member are active; a turned-off Member does not count, so create passes; `users.reactivate` of that Member when 3 are active is refused; a removed person does not count; an invited person (active, no password) counts; creating an agent passes at the limit; `limit null` never refuses; `ENT_VADO` facts (no limit) never refuse.
- [ ] **Step 2: Run** `npx vitest run server/calls/peopleLimit.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** and register `users.reactivate`.
- [ ] **Step 4: Run** the test, `npx vitest run server/calls server/core --testTimeout=60000`, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Refuse a new person above the people limit"`.

### Task 14: (office) The storage limit

**Files:**
- Create: `server/enterprise/storage.ts`
- Modify: `server/data/lite/save.ts:46-86` (`writeTable`), `server/office/import.ts:107-125` (`importFinish`), `server/calls/files.ts:44-95` (`filesUploadStart`), `server/calls/index.ts` (`'settings.get'` preflight hook), `server/jobs/steps/` (a daily step), `server/office/jobs.ts:14-22`
- Test: `server/enterprise/storage.test.ts`

**Interfaces:**
```ts
export const RECOUNT_STORAGE_LITE = "select coalesce(sum(json_extract(v.value, '$.size')), 0) as n from files f, json_each(f.doc, '$.versions') v";
export function bytesOfFile(doc: { versions?: { size: number }[] } | undefined): number;   // sum of the version sizes
export async function recountStorage(q: Query): Promise<number>;                           // writes enterprise_use.storage_bytes
export async function storageUsed(db: Db): Promise<number>;
export async function assertStorageRoom(deps: Deps, size: number): Promise<void>;          // ApiError('conflict', ..., { reason: 'storage_limit' })
export const settingsGetHooks: ServerHooks<unknown, unknown, Deps>;                        // preflight: { peopleLimit, storageUsed, storageLimit }
export const STORAGE_STEP: JobStep;                                                        // name 'storage': recountStorage, first run after 00:00 UTC
```
Rules: `writeTable` adds the delta `sum(bytesOfFile(new doc)) - sum(bytesOfFile(old doc))` for the table `files` (a deleted file counts its old doc, an inserted file its new doc) and writes it with `update enterprise_use set storage_bytes = max(0, storage_bytes + ?1) where id = 1` only when the delta is not 0. `importFinish` calls `recountStorage(q)`. `filesUploadStart` calls `assertStorageRoom(deps, input.size)` after the size check. The check passes when `storageBytes` is `null`, and when `used + size <= limit`. Feedback pictures are not counted (design gap: version 1 counts file records only).

- [ ] **Step 1: Write the failing tests** (limit 1000): a new file of 400 bytes raises the total to 400; a second version of 300 raises it to 700; the delete of the file lowers it to 0; the delete of a project with two files lowers it by both; an upload start for `size 300` at 700 passes (equal to the limit) and for `size 301` is refused with `storage_limit`; `limit null` never refuses; a wrong total (set to 5 by hand) is repaired by `recountStorage` and by the step `storage`; `importFinish` ends with the right total; `settings.get` as the Admin returns `usage.storage.used` and `usage.storage.limit`; the `files.uploadContent` path of an agent is refused the same way.
- [ ] **Step 2: Run** `npx vitest run server/enterprise/storage.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files. The daily step joins `officeSteps` in the first run of the day, as `SIGNIN_STEP` does.
- [ ] **Step 4: Run** the test, `npx vitest run server/data server/calls server/office --testTimeout=60000`, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. The rows pins of `test:office` may change by one row for a file write: record the new value in `server/office/test/pins.ts` only if the pin test names it. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Count the file bytes and refuse an upload above the storage limit"`.

### Task 15: (office) The meter, the day cap and `platform.meter.get`

**Files:**
- Create: `server/enterprise/platform/meter.ts`, `server/enterprise/gate.ts`
- Modify: `server/enterprise/platform/object.ts` (`meter`, `capState`, `meterToday`), `server/enterprise/platform/handlers.ts` (`platform.meter.get`), `server/office/cap.ts` (`capRefusal` takes the busy error), `server/office/parts.ts:234-243` (`capped`), `server/entries/officeWorker.ts:137-200` (the gate in `batch` and `mcp`)
- Test: `server/enterprise/platform/meter.test.ts`, `server/enterprise/gate.test.ts`, `server/office/cap.test.ts`

**Interfaces:**
```ts
// PlatformStub (meter replaces the verdict of plan B; capState and meterToday are new)
meter(input: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer>;      // stores the absolute counts of the day, answers capVerdict
capState(input: { day: string }): Promise<{ stop: boolean; writesStop: boolean }>;            // account at STOP_LINE for requests or rows read; rows written for writesStop
meterToday(input: { day: string }): Promise<{ account: DayCounts; byEnterprise: { ent: EnterpriseId; counts: DayCounts }[] }>;
// gate.ts
export function accountGate(o: { platform: Pick<PlatformStub, 'capState'>; now(): Date; ttlMs?: number }): (ent: EnterpriseId, writes: boolean) => Promise<RunError | undefined>;
```
Rules: the gate returns `undefined` for `ENT_VADO`, returns the `busy` error (`reason 'busy'`, calm text "Madar is busy today. It works again at 03:00 Riyadh.") when `capState.stop` (or `writesStop` for a write), keeps the answer 60 seconds per isolate, and returns `undefined` when the platform call throws (fail open). The Worker applies it in `batch` and `mcp`, never in the sign-in steps, `forgot` and `renew`. In the object, `capped()` also applies `shareCapOf(plan)` for an enterprise that is not `ENT_VADO` (`deps.enterprise.id()`), with the busy error "Madar is busy for your company today. It works again at 03:00 Riyadh." The existing `MADAR_DAY_CAP` of the test Worker stays and wins when set. `platform.meter.get` returns `{ day, limits: PLAN_LIMITS, total, share, warn: warnings(plan, total), stop, enterprises }` with the names from the list rows.

- [ ] **Step 1: Write the failing tests**: `meter` keeps the latest absolute counts, and two reports of one enterprise on one day do not add; `meterToday` sums the account over all enterprises; `capState.stop` is false at 89 percent and true at 90 percent of rows read; `meter` answers `busy` for `ent_002` over its share and `allowed` for `ent_001`; the gate lets `ent_001` through at `stop`, refuses `ent_002`, asks the platform once in 60 seconds (fake clock), asks again after 60 seconds, and lets a call through when `capState` throws; a sign-in step of `ent_002` passes at `stop` (route test); the object refuses a batch of `ent_002` at its share of requests and allows the sign-in step; `ent_001` is never refused; `platform.meter.get` lists `warn: ['requests']` at 70,000 requests and `stop: true` at 90,000.
- [ ] **Step 2: Run** `npx vitest run server/enterprise server/office/cap.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files. `capRefusal(day, cap, writes, busy = DAY_CAP_BUSY)`.
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npm run test:lite`, `npm run test:office`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Add the account meter and the day cap of the enterprises"`.

### Task 16: Name and logo in the mails, the logo route and the consent screen

**Files:**
- Create: `server/enterprise/brand.ts`, `server/enterprise/logoRoute.ts`
- Modify: `server/mail/templates/index.ts:103-125` (`MailOptions`), `server/mail/templates/layout.ts` (the header), `server/auth/mail.ts:108-130` (`SigninMailOptions`), the callers `server/auth/invite.ts:281`, `server/auth/forgot.ts:104`, `server/mail/notices.ts:203,230`, `server/mail/summary.ts:214`, the agent-code mail (`grep -rn "mail.agentCode\|guard" server/mcp/guard.ts`), `server/mcp/oauth/ops.ts` (`authorizationDetails` adds the enterprise name), `src/features/oauth/ConsentScreen.tsx`, `src/features/oauth/oauthPort.tsx`, `server/entries/officeWorker.ts` (route `GET /api/enterprise-logo/:ent`)
- Test: `server/enterprise/brand.test.ts`, `server/enterprise/logoRoute.test.ts`, `src/features/oauth/ConsentScreen.test.tsx`

**Interfaces:**
```ts
export type Brand = { name: string; nameAr: string; logo: string | null };
export function brandOfSettings(settings: Pick<Settings, 'enterpriseName' | 'enterpriseNameAr' | 'enterpriseLogo'> | undefined): Brand;   // fallbacks 'Madar' and 'مدار', logo null
export async function readBrand(deps: Pick<Deps, 'db'>): Promise<Brand>;                  // select doc from settings where id = 'office'
export function enterpriseLogoUrl(appUrl: string, ent: EnterpriseId): string;             // `${appUrl}/api/enterprise-logo/${ent}`; not the Madar mark function logoAddress of layout.ts
// MailOptions and SigninMailOptions get: brand?: { name: string; logoUrl?: string }
```
Rules: with `brand`, the mail header shows `brand.name` in place of `t('mail.common.brand')` and `brand.logoUrl` in place of the Madar mark. Without `brand` the output stays as it is (the snapshots do not change). The name goes through `escapeHtml`. The language picks `name` or `nameAr`. A mail for an enterprise with no logo keeps the Madar mark. `logoRoute`: public `GET /api/enterprise-logo/:ent`; an id that the platform does not list, an enterprise with no logo and a malformed id all give the same 404 (same body); a listed enterprise with a logo gives the picture bytes with its type from the data address, `Cache-Control: public, max-age=3600`, `X-Content-Type-Options: nosniff`, and never the picture as `text/html`. The consent details answer gets `enterpriseName`; the screen shows "Allow <app> to act for you in <name>?" through the words of `oauth.*` (add one key with a `{{name}}` slot).

- [ ] **Step 1: Write the failing tests**: `brandOfSettings` fallbacks; invite, reset and agent-code mails of `ent_002` show the name in the header, in English and Arabic; a name of `<b>x</b>` is escaped; no-brand render equals the old snapshot; the logo route gives 404 for `ent_999`, `bad`, a listed enterprise without a logo (bodies equal), and 200 with `image/png` for a listed one with a PNG logo; a logo whose data address says `text/html` is refused at save time (`PICTURE_DATA` allows only WebP, JPEG and PNG) and the route sets `nosniff`; the consent screen shows the name from the details answer.
- [ ] **Step 2: Run** `npx vitest run server/enterprise server/mail server/auth src/features/oauth --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files. Each caller passes `brand` from `readBrand(deps)` and the logo address from `deps.enterprise.id()`; a caller with no enterprise id (Postgres path) passes only the name.
- [ ] **Step 4: Run** the tests, `npm run typecheck`, `npx vitest run server/push src/i18n --testTimeout=60000`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server src && git commit -m "Show the enterprise name and logo in the mails and the consent screen"`.

### Task 17: The name in the push line

**Files:**
- Create: `src/app/remote/brandCache.ts`, `src/app/remote/brandCache.test.ts`
- Modify: `public/sw.js:23-60,80-140`, `src/app/remote/serviceWorker.test.ts`, the place where the session loads for the remote build (`grep -n "session.get" src/app/remote/bootstrap.ts`)

**Interfaces:**
```ts
export const BRAND_CACHE = 'madar-brand';
export const BRAND_KEY = '/__brand';
export async function saveBrand(brand: { name: string; nameAr: string }, cacheStorage?: CacheStorage): Promise<void>;   // never throws
// sw.js
function pushText(language, brand): { title: string; body: string }   // body "You have something new in <name>." or «لديك جديد في <name>.»
```
Rules: the page writes `{ name, nameAr }` to the Cache `madar-brand` after each `session.get` answer. The fixed line reads the cache inside `event.waitUntil`. A missing cache, a wrong shape, a throw or a wait over 300 ms gives the old fixed line ("Madar"). The line of a push with keys is unchanged. WebKit still shows the line (the rule `mayStaySilent` stays). The title stays "Madar".

- [ ] **Step 1: Write the failing tests**: `saveBrand` writes the JSON and swallows a failing `caches`; the worker with a cache of `{ name: 'Acme', nameAr: 'أكمي' }` shows body "You have something new in Acme." for `en-US` and «لديك جديد في أكمي.» for `ar-SA`; with no cache, with a throwing cache and with a cache that never answers (fake timer 300 ms) it shows the old line; the existing `serviceWorker.test.ts` cases keep passing (the line equals `push.notificationBody` when no brand exists); on WebKit the line shows even when the cache read is slow.
- [ ] **Step 2: Run** `npx vitest run src/app/remote/brandCache.test.ts src/app/remote/serviceWorker.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.** The test context of `serviceWorker.test.ts` gets `caches` and a timer in the `vm` context.
- [ ] **Step 4: Run** the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add public src && git commit -m "Name the enterprise in the fixed push line"`.

### Task 18: The MCP deny list and the leak tests

**Files:**
- Modify: `server/mcp/tools.ts:153` (`MCP_DENY` type and list), `server/mcp/docs.ts` (`INSTRUCTIONS`, `TOOL_DOCS` check), `server/mcp/CLAUDE.md`
- Test: `server/mcp/platformDeny.test.ts`, `server/enterprise/platform/leaks.test.ts`

**Interfaces:** `MCP_DENY` gets `...PLATFORM_CALL_NAMES` and its type widens to `SharedCallName | ServerCallName | PlatformCallName`. `INSTRUCTIONS` gets one sentence: "You act for one person of one company. You cannot see or change other companies." (check `server/mcp/toolSize.test.ts` for the size limit.)

- [ ] **Step 1: Write the failing tests**: no tool name of `mcpTools` starts with `platform.`; a `tools/call` for each of the 8 names answers an unknown tool; `MCP_DENY` contains all 8; `INSTRUCTIONS` holds the new sentence. Leak tests (fake office stubs and a fake platform): an Admin token of `ent_002` gets `not_found` for each of the 8 calls; an agent token gets 403 `agent_token` for each; a Member gets `not_found`; the answer of `platform.enterprises.list` as the owner holds, for each row, no key outside the `EnterpriseView` pin and no person name or email except `firstAdmin`; `platform.enterprises.list` JSON text contains none of the strings `projects`, `tasks`, `chats`, `files` as keys; the error text for `email_taken` never holds another enterprise id or name; `platform.meter.get` holds only counts and names.
- [ ] **Step 2: Run** `npx vitest run server/mcp/platformDeny.test.ts server/enterprise/platform/leaks.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits. Add one line to `server/mcp/CLAUDE.md` about the `platform.*` deny rule.
- [ ] **Step 4: Run** the tests, `npx vitest run server/mcp --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add server && git commit -m "Keep the platform calls away from AI agents and test the leaks"`.

### Task 19: The client and the page "Madar enterprises"

**Files:**
- Create: `src/api/remote/platformClient.ts`, `src/features/enterprises/EnterprisesScreen.tsx`, `EnterpriseSheet.tsx`, `NewEnterpriseSheet.tsx`, `MeterStrip.tsx`, `usePlatform.tsx`, and a test for each; `src/i18n/real/ent-c.en.json`, `ent-c.ar.json`
- Modify: `src/app/screenLoaders.ts` (screen `enterprises`), `src/app/routes.tsx:62-65` (route `enterprises`)
- Read first: `src/features/oauth/ConsentScreen.tsx` (a screen with `useQuery`), `src/features/settings/admin/SubCompaniesSection.tsx:44-130` (a sheet with a logo and `pictureOf`), `src/api/remote/errors.ts` (`fromEntry`, `fromStatus`, `noAnswer`), `src/components/Sheet*`.

**Interfaces:**
```ts
export function createPlatformClient(o: { url: string; build: string; token: () => Promise<string | null>; fetch?: typeof fetch }): PlatformApi;   // POST `${url}/platform`
export function PlatformProvider(props: { api: PlatformApi; children: ReactNode }): JSX.Element;
export function usePlatform(): PlatformApi;      // default: createPlatformClient on the remote build, fakePlatform on the prototype
```
Page rules: route `/enterprises`, gated by `session.platformOwner` (a person without it sees `NotFound`). Top: the meter strip (`platform.meter.get`: four bars for requests, rows read, rows written, mails; a calm warning line for each name in `warn`, and a line when `stop`). Below: one list (`platform.enterprises.list`), a row shows the logo, the name in the language of the screen, the state chip and the people count. One button "New enterprise" (disabled with the line `enterprises.createClosed` when `me.createOpen` is false). A row opens `EnterpriseSheet`: name, Arabic name, logo, address name (read only), state, people (active and invited), storage used, last activity, the two limits (editable, storage in GB), the first Admin name and email, and the buttons Pause or Resume and "Send the invitation again". A `creating` row shows "Not finished" and "Try again" (the same `create` call with the saved input is not kept: the button opens the new-enterprise sheet filled from the row). Pause opens a field "Type the name of the enterprise to pause it." and the Pause button stays off until the text equals the name. One next step in each sheet; no other control. 390 px: sheets are full height, the list rows stack.

- [ ] **Step 1: Write the failing tests** (RTL with a `PlatformProvider` of a fake `PlatformApi`): the client sends one wire call with the bearer token and maps a `not_found` entry to `ApiError`; a person without `platformOwner` sees the not-found page and no platform call runs; an owner sees the meter strip with the 70 percent warning text, the list with the VADO row and the paused state text, and the button; the button is off with the closed line when `createOpen` false; the new sheet sends `create` with `limits.storageBytes = GB * 1024^3` and shows `address_taken` and `email_taken` under their fields; the row sheet shows the first Admin only for a row that has one; Pause stays off until the exact name is typed, then sends `confirmName`; a refused pause shows `owner_enterprise`; Resume and "Send the invitation again" send their calls; the English and Arabic trees have the same keys (`i18n.test.ts`); no em-dash in the words.
- [ ] **Step 2: Run** `npx vitest run src/api/remote/platformClient.test.ts src/features/enterprises --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the files with the words of the table above. Use logical classes only (RTL).
- [ ] **Step 4: Run** the tests, `npx vitest run src/app src/i18n --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Add the page Madar enterprises"`.
- [ ] **Step 6: Lead step:** the lead takes the screenshots of the page, the row sheet, the new-enterprise sheet and the pause field (English and Arabic, light and dark, 390 px) on `npm run dev:office`, with a subagent.

### Task 20: The person menu line

**Files:**
- Modify: `src/app/PersonMenuPanel.tsx:121-130`
- Test: `src/app/PersonMenuGroups.test.tsx`

**Interfaces:** the "places" group gets a link `/enterprises` with the key `enterprises.title`, shown only when `session.platformOwner === true`. It sits under the Admin line.

- [ ] **Step 1: Write the failing test**: an owner sees the link "Madar enterprises" with `href="/enterprises"`; an Admin who is no owner and a Member do not; the Arabic label is «منشآت مدار».
- [ ] **Step 2: Run** `npx vitest run src/app/PersonMenuGroups.test.tsx --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the link with the same `row` class and an icon that the menu already imports.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Add the platform line to the person menu"`.

### Task 21: The header, the Office settings rows and the usage lines

**Files:**
- Modify: `src/app/HomeMark.tsx`, `src/app/AppShell.tsx:132`, `src/features/settings/admin/OfficeSection.tsx:19-100`, `src/app/remote/homeCache.ts:70` (`fingerprintOf`), `src/app/remote/bootstrap.ts` (call `saveBrand`)
- Test: `src/app/HomeMark.test.tsx`, `src/features/settings/admin/OfficeEnterprise.test.tsx`, `src/app/remote/homeCache.test.ts`

**Interfaces:** `HomeMark` shows the enterprise logo (when set, in the same 36 px frame, `object-contain`) and the name in the language of the screen next to it on a desk; on a phone the logo only. With no enterprise it shows the Madar mark as today. `OfficeSection` gets three fields (`admin.enterpriseName`, `enterpriseNameAr`, `enterpriseLogo`, the logo through `pictureOf(file, { fit: 'contain' })` as `SubCompaniesSection` does) saved by the same `settings.update`, and under them two read-only lines from `settings.get.usage` (`admin.usage.people`, `admin.usage.storage`, `admin.usage.noLimit` for `null`, and the hint `admin.usage.readOnly`). Storage shows as GB with one decimal. `fingerprintOf(session)` includes `session.enterprise?.id`.

- [ ] **Step 1: Write the failing tests**: the header shows the logo and name of `session.enterprise`; Arabic shows `nameAr`; no enterprise shows the Madar mark; the Office form saves the three fields and shows `errors.reasons` for a too-big logo as `SubCompaniesSection` does; the usage lines show "People: 3 of 5" and "Storage: 0.5 of 1.0 GB" and "No limit" for `null`, with no input control; a person who lacks `office.settings` sees no usage; `fingerprintOf` differs for two enterprise ids with the same user.
- [ ] **Step 2: Run** `npx vitest run src/app/HomeMark.test.tsx src/features/settings/admin/OfficeEnterprise.test.tsx src/app/remote/homeCache.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the keys to `ent-c` words. Keep the first-load bundle bound (`npm run build:remote -- test` is a lead step); do not import the platform page here.
- [ ] **Step 4: Run** the tests, `npx vitest run src/app src/features/settings --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Show the enterprise name and logo in the header and the Office settings"`.
- [ ] **Step 6: Lead step:** the lead takes the screenshots of the header and the Office settings (English and Arabic, light and dark, 390 px) on `npm run dev:office`.

### Task 22: The paused text and the reason texts

**Files:**
- Modify: `src/features/auth/authFailure.ts:9-48`, `src/app/remote/madarAuth.ts:27`, `src/app/errors.ts:27`, `src/features/auth/SignInScreen.tsx` (only if the failure text needs a place), `src/i18n/real/ent-c.*.json`
- Test: `src/features/auth/SignInScreen.test.tsx`, `src/app/remote/madarAuth.test.ts`, `src/app/errors.test.ts`

**Interfaces:** `AUTH_FAILURE_REASONS` gets `'enterprise_paused'`. `REASONS` of `madarAuth.ts` maps the API reason `enterprise_paused` to it. `failureText` returns `t('errors.reasons.enterprise_paused')`. `canRetry` is false for an `unauthenticated` error with reason `enterprise_paused` (as for `account_off`). A `forbidden` call error with reason `enterprise_paused` shows the same sentence through `errorMessage`. All reason texts of the words table are added.

- [ ] **Step 1: Write the failing tests**: a sign-in answer `unauthenticated` reason `enterprise_paused` shows the exact English and Arabic text on the sign-in screen; a wrong password still shows the usual text; `canRetry` is false for the paused error; `errorMessage` of `forbidden` with that reason, and of `people_limit`, `storage_limit`, `create_closed`, `address_taken`, `owner_enterprise`, `name_mismatch`, `not_finished` and `already_accepted`, return the table text in both languages.
- [ ] **Step 2: Run** `npx vitest run src/features/auth src/app/remote/madarAuth.test.ts src/app/errors.test.ts --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the edits and the words.
- [ ] **Step 4: Run** the tests, `npx vitest run src/i18n --testTimeout=60000`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src && git commit -m "Add the paused text and the limit texts"`.
- [ ] **Step 6: Lead step:** the lead takes the screenshot of the sign-in screen with the paused text (English and Arabic, light and dark, 390 px).

### Task 23: What's new and the guides

**Files:**
- Modify: `src/whatsNew/entries.ts`, `src/i18n/real/whatsnew.en.json`, `src/i18n/real/whatsnew.ar.json` (the two entries; this is the one allowed edit outside the `ent-c` word files, as `src/i18n/CLAUDE.md` requires), `src/whatsNew/entries.test.ts` (pins), `server/enterprise/CLAUDE.md` (a section "Platform calls"), `server/office/CLAUDE.md` (the object RPCs, the share cap), `src/api/CLAUDE.md` (the `Ctx.enterprise` line), `server/data/CLAUDE.md` (table `enterprise_use`, the storage total), `src/features/settings/CLAUDE.md` (the Office rows)
- Test: `src/whatsNew/entries.test.ts`

**Interfaces:** two entries below the usage entry, ids above the newest id on main and on every `rb/*` branch (take the number by the rule in `src/i18n/CLAUDE.md`): one for everyone, "Madar now shows the name and logo of your company." / «يعرض مدار الآن اسم شركتك وشعارها.»; one with `right: 'office.settings'` and `to: '/admin'`, "Office settings now has rows for your company name and logo." / «في إعدادات المكتب الآن خانات لاسم شركتك وشعارها.». No platform word goes into What's new.

- [ ] **Step 1: Write the failing test**: `entries.test.ts` finds both entries by id; the Admin entry carries the right and the link; both have an English and an Arabic body; the pin for the allowed rights includes `office.settings`; no em-dash or en-dash.
- [ ] **Step 2: Run** `npx vitest run src/whatsNew --testTimeout=60000`. Expected: FAIL.
- [ ] **Step 3: Implement** the entries and the guide lines (each line states one fact of this plan, in STE).
- [ ] **Step 4: Run** the test, `git diff main | grep -nP '^\+[^+].*\x{2014}'` (must print nothing), `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src server && git commit -m "Add the What's new entries and the guide lines of the platform part"`.

---

## Self-review

- **Spec coverage.** 5.6: Tasks 2, 10, 11, 18, 19, 20. 5.7: Tasks 5, 8, 9 (retry, prefix, D1 day one). 5.8: Tasks 6, 7, 10, 22. 5.9: Tasks 13, 14, 21. 5.10: Tasks 3, 16, 17, 21. 5.14 and D2: Tasks 1, 15. 5.18: Tasks 19 to 22. D4: Tasks 10, 11. D1: Task 5 (the day-one test). The email reserve of 5.4: Task 12. The prototype fakes: Task 2 gives the interface `PlatformApi` and the empty `fakePlatform` that plan D fills. The cap of 5.14 is rebuilt on the platform meter of Task 15.
- **Step scan.** Each task lists the file, the signature, the rule that the signature does not fix, and the test names with the exact values. No task says "handle edge cases".
- **Type consistency.** `PlatformCtx` (Task 9) is used by Tasks 10 and 11. `EnterpriseListRow` (Task 8) feeds `viewOf` (Task 9). `EnterpriseFacts` (Task 4) feeds Tasks 3, 6, 13, 14 and 15. `OfficeStub` names (Tasks 5 and 6) match the calls in Tasks 9, 10 and 11.
- **Proportion.** About 23 tasks for 8 calls and 6 cross-cutting rules. Each task is the smallest unit with its own test.

## Lead steps (not for the builder)

- Lead step: after the merge gate, run `npm run build:remote -- test` and check the first-load bundle bound (`entries.test.ts` and `check-bundles`), because Task 21 touches the header.
- Lead step: the screenshots of Tasks 19, 21 and 22, on `npm run dev:office` (never the test copy), with one Playwright subagent.
- Lead step: tell the owner that the owner list needs one run of `scripts/office/platform-owners.ts` with the ops secret before the menu line shows (plan E does it for production).
- Lead step: write the new shared names (list at the top) into the contract file.
