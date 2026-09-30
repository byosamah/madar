# Madar Plan 4 of 5: Dashboard, Task list and Admin settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Dashboard (filters, six tiles, four charts, the workload grid and the office schedule), the Task list screen that the dashboard opens, and the Admin parts of Settings (People, Office settings, unlock a week), and publish them on the same review link.

**Architecture:** `dashboard.get` from plan 1 already returns every number. This plan adds two read calls the click-through needs (`deadlines.list`, and created and done date filters on `tasks.list`), then screens that turn each number into a link to the list behind it. The Projects screen and the dashboard keep their filters in the link, so a click lands on the right list. Charts are CSS bars with real links, and one Recharts chart (tasks per week) with a table beside it for keyboard and screen reader users.

**Tech Stack:** as plan 3, plus the already installed recharts 3.10.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-madar-prototype-design.md` (sections 8 and 9, and 10 for design).

**Base:** branch `plan-4-dashboard`, cut from `plan-3-personal-work` after its review fixes. The owner approved this plan in advance (2026-09-30).

## Global Constraints

- Every rule in the Global Constraints of plans 1 to 3 still applies.
- Every number on the dashboard opens the list behind it with the filter already set (spec 8.2 and 8.3). A number is a link or a button, never plain text.
- The dashboard filters live in the link (`/dashboard?period=&status=&leader=&client=`), and so do the Projects screen filters (`/?filter=&status=`) and the Task list filters (`/tasks?...`).
- Charts show values with a word or a number next to each color. A chart that draws with Recharts has a table with the same numbers and links for keyboard and screen reader users.
- In Arabic, time runs from right to left on the office schedule and on the tasks-per-week chart.
- Admin controls show only when `session.get().authority.systemRole` is `admin`; the API refuses them for everyone else.

**Clarifications of the spec made in this plan.** Tell the owner about these at handoff.

1. The dashboard filters (period, status, leader, client) apply to the dashboard. A tile or bar click opens the Projects screen or the Task list with the matching filter; those screens have fewer filters, so the leader and client filters do not carry over.
2. "Area in design" opens the Projects screen with the Active filter.
3. A click on a week of the tasks-per-week chart opens the Task list for the tasks done in that week; the table beside the chart also links the created tasks.
4. A click on a project in "Hours per project" opens that project's Team tab.
5. The office schedule zoom shows a window around today: Month (1 week before to 5 weeks after), Quarter (1 month before to 2 months after), Year (3 months before to 9 months after). The choice lasts to the next visit.
6. The Admin cannot change a person into an agent or back (plan 1 review finding). The kind is set when the Admin adds the person. There is no "reactivate"; Undo on the deactivate toast brings the person back.

## Review Focus

1. **Filters that match nothing.** A client with no projects, or the Archived status. Expected: zeros in the tiles, and one sentence in each chart instead of an empty frame. Test: Task 4 and Task 5.
2. **A person with far more open tasks than the limit, and a limit change.** Expected: the cell turns red above the limit with a word, not only a color, and turns back after the Admin raises the limit. Test: Task 6 and Task 9.
3. **Arabic on the dashboard.** Expected: the office schedule and the tasks-per-week chart run right to left, numbers keep Western digits. Tests: Task 2 (`scheduleWindow`) and the browser sweep.
4. **A Task list link typed by hand with bad values.** `/tasks?from=banana`. Expected: the screen ignores the bad value and shows the list without that filter. Test: Task 8.
5. **An Admin who removes their own rights.** The last Admin sets their role to Member, or deactivates themselves. Expected: the API refuses with a clear message, and the Settings screen does not offer "Deactivate" on the Admin's own row. Test: Task 9.

## File Map

| File | Responsibility |
|---|---|
| `src/api/handlers/projects.ts`, `src/api/handlers/tasks.ts`, `src/api/contract/views.ts` | `deadlines.list`; created and done filters on `tasks.list` |
| `src/lib/schedule.ts`, `src/lib/params.ts` | Schedule windows and clipping; safe reading of link values |
| `src/features/projects/ProjectsScreen.tsx` | Filters from the link |
| `src/features/dashboard/*` | Dashboard screen, tiles, hours sheet, charts, workload grid, office schedule |
| `src/features/tasklist/TaskListScreen.tsx` | The Task list screen |
| `src/features/settings/admin/*` | People, person sheet, office settings, unlock a week |
| `tests/e2e/dashboard.spec.ts` | Browser sweep for this plan (run by a subagent) |

---

### Task 1: Read calls for the click-through

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/handlers/projects.ts`, `src/api/handlers/tasks.ts`, `src/api/calls.test.ts`
- Test: `src/api/handlers/projects.test.ts`, `src/api/handlers/tasks.test.ts`

**Interfaces:**
- Consumes: `deadlinesOf`, `stampDay`, `diffDays`.
- Produces: `DeadlineRow = { deadline: Deadline; project: { id; code; name }; daysLeft: number }`; `deadlines.list({ from?, to?, status = 'active' }) → DeadlineRow[]` sorted by date; `tasks.list` accepts `createdFrom`, `createdTo`, `doneFrom`, `doneTo` (days, both ends included).

- [ ] **Step 1: Write the failing tests**

Append to `src/api/handlers/projects.test.ts`:

```ts
describe('deadlines across projects', () => {
  beforeEach(() => setNow(NOW));

  it('lists the deadlines of active projects in a date range, soonest first', async () => {
    const t = testApi(projectCalls);
    const s = t.store.state;
    s.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Workshop', date: '2026-10-09' };
    s.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Submission', date: '2026-10-02' };
    s.deadlines.ddl_003 = { id: 'ddl_003', projectId: 'prj_001', stageId: null, name: 'Handover', date: '2026-12-01' };
    const rows = await t.api.call('deadlines.list', { from: '2026-09-30', to: '2026-10-14' });
    expect(rows.map((row) => row.deadline.name)).toEqual(['Submission', 'Workshop']);
    expect(rows[0]).toMatchObject({ project: { id: 'prj_001', code: 'KH-26-001' }, daysLeft: 2 });
    s.projects.prj_001.status = 'on_hold';
    expect(await t.api.call('deadlines.list', { from: '2026-09-30', to: '2026-10-14' })).toEqual([]);
  });
});
```

Append to `src/api/handlers/tasks.test.ts`:

```ts
describe('created and done filters', () => {
  it('finds tasks by the day they were created or finished', async () => {
    const t = testApi(taskCalls);
    t.store.state.tasks.tsk_001 = makeTask({ createdAt: '2026-09-21T09:00:00.000+03:00', status: 'done', completedAt: '2026-09-29T10:00:00.000+03:00' });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', createdAt: '2026-09-28T09:00:00.000+03:00' });
    const ids = async (input: Record<string, string>) => (await t.api.call('tasks.list', input)).map((row) => row.task.id).sort();
    expect(await ids({ createdFrom: '2026-09-27', createdTo: '2026-10-03' })).toEqual(['tsk_002']);
    expect(await ids({ doneFrom: '2026-09-27', doneTo: '2026-10-03' })).toEqual(['tsk_001']);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/api/handlers/projects.test.ts src/api/handlers/tasks.test.ts`
Expected: FAIL: there is no call `deadlines.list`, and `tasks.list` drops the unknown filters.

- [ ] **Step 3: Write the calls**

In `src/api/contract/views.ts`, add after `NextDeadline`:

```ts
export const DeadlineRow = z.object({
  deadline: Deadline,
  project: z.object({ id: ProjectId, code: z.string(), name: z.string() }),
  daysLeft: z.number().int(),
});
export type DeadlineRow = z.infer<typeof DeadlineRow>;
```

In `src/api/handlers/projects.ts`, add `DeadlineRow` to the `../contract/views` import and `diffDays` from `../../lib/dates` if it is not there, then add before the call map:

```ts
/** Deadlines of all projects in a date range, soonest first: the dashboard's "Deadlines, next 14 days" list (spec 8.2). */
export const deadlinesList = defineCall({
  input: z.object({
    from: Day.optional(),
    to: Day.optional(),
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
  }),
  output: z.array(DeadlineRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today } = ctx;
    return Object.values(state.deadlines)
      .filter((d) => {
        const project = state.projects[d.projectId];
        if (!project || (input.status !== 'all' && project.status !== input.status)) return false;
        return (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to);
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((d) => {
        const project = state.projects[d.projectId];
        return { deadline: d, project: { id: project.id, code: project.code, name: project.name }, daysLeft: diffDays(today, d.date) };
      });
  },
});
```

and `'deadlines.list': deadlinesList,` in `projectCalls`.

In `src/api/handlers/tasks.ts`, add `stampDay` from `../../lib/dates` to the imports, add to the `tasksList` input object:

```ts
    createdFrom: Day.optional(),
    createdTo: Day.optional(),
    doneFrom: Day.optional(),
    doneTo: Day.optional(),
```

and add these lines after the `dueTo` check in the filter:

```ts
      const created = stampDay(task.createdAt);
      if (input.createdFrom && created < input.createdFrom) return false;
      if (input.createdTo && created > input.createdTo) return false;
      if (input.doneFrom || input.doneTo) {
        if (!task.completedAt) return false;
        const done = stampDay(task.completedAt);
        if (input.doneFrom && done < input.doneFrom) return false;
        if (input.doneTo && done > input.doneTo) return false;
      }
```

In `src/api/calls.test.ts`, add `'deadlines.list'` to `EXTRA_CALLS`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api
git commit -m "feat: add the cross-project deadline list and created and done task filters" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 2: Schedule windows, link values and all plan 4 text

**Files:**
- Create: `src/lib/params.ts`
- Modify: `src/lib/schedule.ts`, `src/i18n/en.json`, `src/i18n/ar.json`, `src/i18n/keys.test.ts`
- Test: `src/lib/schedule.test.ts`, `src/lib/params.test.ts`

**Interfaces:**
- Consumes: `addDays`, `weekStartOf`, `monthStarts`, `Span`.
- Produces: `Zoom = 'month' | 'quarter' | 'year'`, `ZOOMS`, `scheduleWindow(today, zoom): { span: Span; ticks: string[] }`, `clipSpan(bar, window): Span | null`; `oneOf(value, allowed, fallback)`, `dayParam(value): string | undefined`; every text key of this plan.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/schedule.test.ts` (add `clipSpan` and `scheduleWindow` to its import):

```ts
describe('office schedule windows', () => {
  it('sets a window around today and ticks it by week or by month', () => {
    expect(scheduleWindow('2026-09-30', 'month')).toEqual({
      span: { start: '2026-09-23', end: '2026-11-03' },
      ticks: ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'],
    });
    expect(scheduleWindow('2026-09-30', 'quarter')).toEqual({
      span: { start: '2026-08-31', end: '2026-11-30' },
      ticks: ['2026-09-01', '2026-10-01', '2026-11-01'],
    });
    expect(scheduleWindow('2026-09-30', 'year').ticks).toHaveLength(12);
  });

  it('cuts a bar to the window, or drops it', () => {
    const window = { start: '2026-09-01', end: '2026-09-30' };
    expect(clipSpan({ start: '2026-08-20', end: '2026-09-10' }, window)).toEqual({ start: '2026-09-01', end: '2026-09-10' });
    expect(clipSpan({ start: '2026-09-05', end: '2026-10-10' }, window)).toEqual({ start: '2026-09-05', end: '2026-09-30' });
    expect(clipSpan({ start: '2026-10-01', end: '2026-10-10' }, window)).toBeNull();
  });
});
```

`src/lib/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dayParam, oneOf } from './params';

describe('link values', () => {
  it('keeps a known value and falls back on anything else', () => {
    expect(oneOf('quarter', ['month', 'quarter'] as const, 'month')).toBe('quarter');
    expect(oneOf('decade', ['month', 'quarter'] as const, 'month')).toBe('month');
    expect(oneOf(null, ['month', 'quarter'] as const, 'month')).toBe('month');
  });

  it('keeps a real day only', () => {
    expect(dayParam('2026-09-30')).toBe('2026-09-30');
    expect(dayParam('banana')).toBeUndefined();
    expect(dayParam('2026-02-31')).toBeUndefined();
    expect(dayParam(null)).toBeUndefined();
  });
});
```

In `src/i18n/keys.test.ts`, add `'dashboard.tiles.overdueTasks'`, `'taskList.overdue'` and `'admin.unlockButton'` to the list of group keys.

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib src/i18n`
Expected: FAIL: `scheduleWindow`, `clipSpan` and `./params` do not exist, and the plan 4 keys are missing.

- [ ] **Step 3: Write the helpers**

Append to `src/lib/schedule.ts` (add `weekStartOf` to its `./dates` import):

```ts
export type Zoom = 'month' | 'quarter' | 'year';
export const ZOOMS: Zoom[] = ['month', 'quarter', 'year'];

const WINDOWS: Record<Zoom, [number, number]> = { month: [-7, 34], quarter: [-30, 61], year: [-91, 273] };

/** The office schedule window around today (plan clarification 5). Month ticks each Sunday, the others tick each month. */
export function scheduleWindow(today: string, zoom: Zoom): { span: Span; ticks: string[] } {
  const [before, after] = WINDOWS[zoom];
  const span = { start: addDays(today, before), end: addDays(today, after) };
  const ticks: string[] = [];
  if (zoom === 'month') {
    const first = weekStartOf(span.start) === span.start ? span.start : addDays(weekStartOf(span.start), 7);
    for (let day = first; day <= span.end; day = addDays(day, 7)) ticks.push(day);
  } else {
    for (const day of monthStarts({ start: `${span.start.slice(0, 7)}-01`, end: span.end })) if (day >= span.start) ticks.push(day);
  }
  return { span, ticks };
}

/** The part of a bar inside the window, or null when the bar is outside it. */
export function clipSpan(bar: Span, window: Span): Span | null {
  if (bar.end < window.start || bar.start > window.end) return null;
  return { start: bar.start < window.start ? window.start : bar.start, end: bar.end > window.end ? window.end : bar.end };
}
```

`src/lib/params.ts`:

```ts
/** A value from the link, when it is one of the allowed values. Anything else gives the fallback. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A day from the link, when it is a real calendar day. A person can type anything into a link. */
export function dayParam(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}
```

- [ ] **Step 4: Add the text**

Merge the two blocks with the same `node -e` merge command as plan 2 Task 2 Step 4.

English additions:

```json
{
  "dashboard": {
    "filters": "Dashboard filters",
    "period": "Period",
    "periods": { "month": "This month", "quarter": "This quarter", "year": "This year" },
    "statusLabel": "Status",
    "leader": "Leader",
    "anyLeader": "Any leader",
    "client": "Client",
    "anyClient": "Any client",
    "tiles": {
      "activeProjects": "Active projects",
      "atRiskOrLate": "At risk or late",
      "overdueTasks": "Overdue tasks",
      "deadlines": "Deadlines, next 14 days",
      "officeHours": "Office hours this week",
      "area": "Area in design"
    },
    "hoursOf": "{{hours}} of {{target}} h",
    "percent": "{{n}}%",
    "areaValue": "{{n}} m²",
    "charts": {
      "perStage": "Projects per stage",
      "health": "Health mix",
      "throughput": "Tasks done and created per week",
      "hoursPerProject": "Hours per project"
    },
    "created": "Created",
    "done": "Done",
    "week": "Week of {{date}}",
    "noData": "No data for these filters.",
    "workload": "Workload",
    "workloadHint": "Open tasks due each week. A red cell has more than {{n}}.",
    "person": "Person",
    "over": "Over the limit",
    "overShort": "Over",
    "cell": "{{name}}, week of {{week}}: {{n}} tasks",
    "schedule": "Office schedule",
    "zoom": "Zoom",
    "zooms": { "month": "Month", "quarter": "Quarter", "year": "Year" },
    "hoursSheet": "Hours this week",
    "perProject": "Per project",
    "perPerson": "Per person",
    "hoursValue": "{{n}} h"
  },
  "taskList": {
    "title": "Task list",
    "deadlinesTitle": "Deadlines",
    "overdue": "Overdue tasks",
    "flagged": "Flagged tasks",
    "forPerson": "Tasks of {{name}}",
    "dueRange": "Due {{from}} to {{to}}",
    "createdRange": "Created {{from}} to {{to}}",
    "doneRange": "Done {{from}} to {{to}}",
    "dateRange": "{{from}} to {{to}}",
    "empty": "No tasks match this list.",
    "emptyDeadlines": "No deadlines in this period.",
    "count": "Items: {{n}}"
  },
  "admin": {
    "people": "People",
    "addPerson": "Add person",
    "name": "Name",
    "email": "Email",
    "role": "Role",
    "roles": { "admin": "Admin", "member": "Member" },
    "kind": "Kind",
    "kinds": { "human": "Person", "agent": "Agent" },
    "owner": "Acts for",
    "discipline": "Discipline",
    "target": "Weekly target (h)",
    "deactivate": "Deactivate",
    "deactivated": "{{name}} deactivated.",
    "added": "{{name}} added.",
    "saved": "Saved.",
    "inactive": "Inactive",
    "actions": "Actions for {{name}}",
    "edit": "Edit",
    "editTitle": "Edit person",
    "save": "Save",
    "office": "Office settings",
    "stages": "Default stages",
    "prefix": "Project code prefix",
    "prefixHint": "One to four capital letters, for example KH.",
    "limit": "Workload limit",
    "limitHint": "Open tasks per person in one week before the cell turns red.",
    "saveOffice": "Save office settings",
    "officeSaved": "Office settings saved.",
    "unlock": "Unlock a week",
    "unlockHint": "A week locks 14 days after it ends. Unlock it so the person can fix their hours.",
    "person": "Person",
    "week": "Any day in the week",
    "unlockButton": "Unlock week",
    "unlocked": "The week of {{week}} is open for {{name}}."
  }
}
```

Arabic additions (a draft for the native-speaker review):

```json
{
  "dashboard": {
    "filters": "تصفية لوحة المعلومات",
    "period": "الفترة",
    "periods": { "month": "هذا الشهر", "quarter": "هذا الربع", "year": "هذه السنة" },
    "statusLabel": "الحالة",
    "leader": "القائد",
    "anyLeader": "أي قائد",
    "client": "العميل",
    "anyClient": "أي عميل",
    "tiles": {
      "activeProjects": "المشاريع النشطة",
      "atRiskOrLate": "معرضة للتأخر أو متأخرة",
      "overdueTasks": "المهام المتأخرة",
      "deadlines": "المواعيد خلال 14 يومًا",
      "officeHours": "ساعات المكتب هذا الأسبوع",
      "area": "المساحة قيد التصميم"
    },
    "hoursOf": "{{hours}} من {{target}} س",
    "percent": "{{n}}٪",
    "areaValue": "{{n}} م²",
    "charts": {
      "perStage": "المشاريع حسب المرحلة",
      "health": "توزيع الحالة",
      "throughput": "المهام المنجزة والمنشأة أسبوعيًا",
      "hoursPerProject": "الساعات حسب المشروع"
    },
    "created": "منشأة",
    "done": "منجزة",
    "week": "أسبوع {{date}}",
    "noData": "لا توجد بيانات لهذه التصفية.",
    "workload": "عبء العمل",
    "workloadHint": "المهام المفتوحة المستحقة كل أسبوع. الخانة الحمراء فيها أكثر من {{n}}.",
    "person": "الشخص",
    "over": "فوق الحد",
    "overShort": "فوق",
    "cell": "{{name}}، أسبوع {{week}}: {{n}} مهام",
    "schedule": "جدول المكتب",
    "zoom": "التكبير",
    "zooms": { "month": "شهر", "quarter": "ربع سنة", "year": "سنة" },
    "hoursSheet": "ساعات هذا الأسبوع",
    "perProject": "حسب المشروع",
    "perPerson": "حسب الشخص",
    "hoursValue": "{{n}} س"
  },
  "taskList": {
    "title": "قائمة المهام",
    "deadlinesTitle": "المواعيد",
    "overdue": "المهام المتأخرة",
    "flagged": "المهام المميّزة",
    "forPerson": "مهام {{name}}",
    "dueRange": "مستحقة من {{from}} إلى {{to}}",
    "createdRange": "أُنشئت من {{from}} إلى {{to}}",
    "doneRange": "أُنجزت من {{from}} إلى {{to}}",
    "dateRange": "من {{from}} إلى {{to}}",
    "empty": "لا توجد مهام تطابق هذه القائمة.",
    "emptyDeadlines": "لا توجد مواعيد في هذه الفترة.",
    "count": "العناصر: {{n}}"
  },
  "admin": {
    "people": "الأشخاص",
    "addPerson": "إضافة شخص",
    "name": "الاسم",
    "email": "البريد الإلكتروني",
    "role": "الدور",
    "roles": { "admin": "مدير النظام", "member": "عضو" },
    "kind": "النوع",
    "kinds": { "human": "شخص", "agent": "وكيل" },
    "owner": "يعمل نيابة عن",
    "discipline": "التخصص",
    "target": "الساعات المستهدفة أسبوعيًا",
    "deactivate": "إيقاف الحساب",
    "deactivated": "أُوقف حساب {{name}}.",
    "added": "أُضيف {{name}}.",
    "saved": "تم الحفظ.",
    "inactive": "غير نشط",
    "actions": "إجراءات {{name}}",
    "edit": "تعديل",
    "editTitle": "تعديل الشخص",
    "save": "حفظ",
    "office": "إعدادات المكتب",
    "stages": "المراحل الافتراضية",
    "prefix": "بادئة رمز المشروع",
    "prefixHint": "من حرف إلى أربعة أحرف لاتينية كبيرة، مثل KH.",
    "limit": "حد عبء العمل",
    "limitHint": "عدد المهام المفتوحة للشخص في الأسبوع قبل أن تصبح الخانة حمراء.",
    "saveOffice": "حفظ إعدادات المكتب",
    "officeSaved": "حُفظت إعدادات المكتب.",
    "unlock": "فتح أسبوع",
    "unlockHint": "يُقفل الأسبوع بعد 14 يومًا من نهايته. افتحه ليصحح الشخص ساعاته.",
    "person": "الشخص",
    "week": "أي يوم في الأسبوع",
    "unlockButton": "فتح الأسبوع",
    "unlocked": "أسبوع {{week}} مفتوح الآن لـ {{name}}."
  }
}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/i18n
git commit -m "feat: add schedule windows, safe link values and the plan 4 text" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 3: Projects screen filters in the link

**Files:**
- Modify: `src/features/projects/ProjectsScreen.tsx`
- Test: `src/features/projects/ProjectsScreen.test.tsx`

**Interfaces:**
- Consumes: `oneOf` (Task 2).
- Produces: the Projects screen reads and writes `?filter=all|mine|at_risk`, `?stage=<stage name>` and `?status=<status>`, so the dashboard can open it with a filter set.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/projects/ProjectsScreen.test.tsx`, inside its `describe`:

```tsx
  it('opens with the filters in the link', async () => {
    const first = await renderApp('/?filter=at_risk');
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(screen.getByRole('radio', { name: 'At risk' })).toHaveAttribute('aria-checked', 'true');
    first.unmount();
    const second = await renderApp('/?stage=Permits');
    expect(await screen.findByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull();
    second.unmount();
    await renderApp('/?status=on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
  });

  it('writes a chip choice into the link', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'At risk' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=at_risk'));
  });
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/features/projects/ProjectsScreen.test.tsx`
Expected: FAIL: the screen ignores the link and keeps its own state.

- [ ] **Step 3: Read the filters from the link**

In `src/features/projects/ProjectsScreen.tsx`, add `import { useSearchParams } from 'react-router';` and `import { oneOf } from '../../lib/params';`, add `const FILTERS = ['all', 'mine', 'at_risk'] as const;`, and replace the two `useState` lines for `filter` and `status`, the `stageName` line and `showAll` with:

```tsx
  const [params, setParams] = useSearchParams();
  const stageName = params.get('stage') ?? undefined;
  const filterParam = oneOf(params.get('filter'), FILTERS, 'all');
  const filter = stageName ? `stage:${stageName}` : filterParam;
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const update = (change: (next: URLSearchParams) => void) => setParams((current) => {
    const next = new URLSearchParams(current);
    change(next);
    return next;
  }, { replace: true });
  const setFilter = (value: string) => update((next) => {
    next.delete('stage');
    next.delete('filter');
    if (value.startsWith('stage:')) next.set('stage', value.slice('stage:'.length));
    else if (value !== 'all') next.set('filter', value);
  });
  const setStatus = (value: (typeof STATUSES)[number]) => update((next) => {
    if (value === 'active') next.delete('status');
    else next.set('status', value);
  });
  const showAll = () => setParams({ status: 'all' }, { replace: true });
```

Change the `projects.list` input `filter` to `stageName ? 'all' : filterParam`. Remove `useState` from the React import only if nothing else uses it (the `creating` state still does).

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/projects`
Expected: PASS, the earlier Projects screen tests included.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects
git commit -m "feat: keep the Projects screen filters in the link" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 4: The Dashboard, filters and tiles

**Files:**
- Create: `src/features/dashboard/DashboardScreen.tsx`, `src/features/dashboard/Tiles.tsx`
- Modify: `src/app/routes.tsx`
- Test: `src/features/dashboard/DashboardScreen.test.tsx`

**Interfaces:**
- Consumes: `dashboard.get`, `users.list`, `clients.list`, `oneOf`.
- Produces: `DashboardScreen()` at `/dashboard` with `?period=&status=&leader=&client=`; `Tiles({ view })` with the Hours summary sheet; `type DashboardData = CallOutput<'dashboard.get'>`. Tasks 5 to 7 add their sections to the screen.

- [ ] **Step 1: Write the failing test**

`src/features/dashboard/DashboardScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const tile = (name: RegExp) => screen.findByRole('button', { name });

describe('the Dashboard', () => {
  it('shows the six tiles with the office numbers', async () => {
    await renderApp('/dashboard');
    expect(await tile(/Active projects/)).toHaveTextContent('10');
    expect(await tile(/At risk or late/)).toHaveTextContent('5');
    for (const name of [/Overdue tasks/, /Deadlines, next 14 days/, /Office hours this week/, /Area in design/]) expect(await tile(name)).toBeInTheDocument();
  });

  it('opens the list behind a tile', async () => {
    await renderApp('/dashboard');
    await userEvent.click(await tile(/At risk or late/));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5));
  });

  it('keeps its filters in the link', async () => {
    await renderApp('/dashboard');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'on_hold');
    await waitFor(() => expect(window.location.hash).toContain('status=on_hold'));
    await waitFor(async () => expect(await tile(/Active projects/)).toHaveTextContent('0'));
  });

  it('shows hours per person to the Admin only', async () => {
    const first = await renderApp('/dashboard');
    await userEvent.click(await tile(/Office hours this week/));
    const sheet = await screen.findByRole('dialog', { name: 'Hours this week' });
    expect(within(sheet).getByText('Per person')).toBeInTheDocument();
    first.unmount();
    await renderApp('/dashboard', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    await userEvent.click(await tile(/Office hours this week/));
    const other = await screen.findByRole('dialog', { name: 'Hours this week' });
    expect(within(other).queryByText('Per person')).toBeNull();
    expect(within(other).getByText('Per project')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/dashboard`
Expected: FAIL: `/dashboard` shows the placeholder.

- [ ] **Step 3: Write the screen and the tiles**

`src/features/dashboard/Tiles.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { Avatar } from '../../components/Avatar';
import { Sheet } from '../../components/Sheet';
import { addDays, formatNumber, todayISO } from '../../lib/dates';

export type DashboardData = CallOutput<'dashboard.get'>;

function HoursSheet({ open, onOpenChange, view }: { open: boolean; onOpenChange: (open: boolean) => void; view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { perProject, perPerson } = view.hoursThisWeek;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('dashboard.hoursSheet')}>
      <div className="flex flex-col gap-4 pt-1">
        <section className="flex flex-col gap-1">
          <h3 className="text-headline">{t('dashboard.perProject')}</h3>
          {perProject.length === 0 ? <p className="text-footnote text-label-2">{t('dashboard.noData')}</p> : (
            <ul>
              {perProject.map((row) => (
                <li key={row.projectId} className="flex min-h-11 items-center gap-3">
                  <span className="tabular text-footnote text-label-2">{row.code}</span>
                  <bdi className="min-w-0 flex-1 truncate">{row.name}</bdi>
                  <span className="tabular">{t('dashboard.hoursValue', { n: formatNumber(row.hours, lang, 1) })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {perPerson && (
          <section className="flex flex-col gap-1">
            <h3 className="text-headline">{t('dashboard.perPerson')}</h3>
            <ul>
              {perPerson.map((row) => (
                <li key={row.user.id} className="flex min-h-11 items-center gap-3">
                  <Avatar user={row.user} size={28} />
                  <bdi className="min-w-0 flex-1 truncate">{row.user.name}</bdi>
                  <span className={`tabular ${row.hours < row.target ? 'text-orange-text' : ''}`}>
                    {t('dashboard.hoursOf', { hours: formatNumber(row.hours, lang, 1), target: formatNumber(row.target, lang) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/** Six numbers, each a way into the list behind it (spec 8.2). */
export function Tiles({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const [hoursOpen, setHoursOpen] = useState(false);
  const today = todayISO();
  const { tiles } = view;
  const items: { key: string; value: string; detail?: string; open: () => void }[] = [
    { key: 'activeProjects', value: formatNumber(tiles.activeProjects, lang), open: () => navigate('/?status=active') },
    { key: 'atRiskOrLate', value: formatNumber(tiles.atRiskOrLate, lang), open: () => navigate('/?filter=at_risk') },
    { key: 'overdueTasks', value: formatNumber(tiles.overdueTasks, lang), open: () => navigate('/tasks?filter=overdue') },
    { key: 'deadlines', value: formatNumber(tiles.deadlinesNext14, lang), open: () => navigate(`/tasks?mode=deadlines&from=${today}&to=${addDays(today, 14)}`) },
    {
      key: 'officeHours',
      value: t('dashboard.percent', { n: formatNumber(tiles.officeHours.percent, lang) }),
      detail: t('dashboard.hoursOf', { hours: formatNumber(tiles.officeHours.hours, lang, 1), target: formatNumber(tiles.officeHours.target, lang) }),
      open: () => setHoursOpen(true),
    },
    { key: 'area', value: t('dashboard.areaValue', { n: formatNumber(tiles.areaInDesign, lang) }), open: () => navigate('/?status=active') },
  ];
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <li key={item.key}>
            <button type="button" onClick={item.open} className="pressable surface flex h-full w-full flex-col items-start gap-1 rounded-card p-4 text-start">
              <span className="text-footnote text-label-2">{t(`dashboard.tiles.${item.key}`)}</span>
              <span className="tabular text-title-1">{item.value}</span>
              {item.detail && <span className="tabular text-footnote text-label-2">{item.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
      <HoursSheet open={hoursOpen} onOpenChange={setHoursOpen} view={view} />
    </>
  );
}
```

`src/features/dashboard/DashboardScreen.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { SelectField } from '../../components/Fields';
import { ScreenTitle } from '../../components/ScreenTitle';
import { oneOf } from '../../lib/params';
import { Tiles } from './Tiles';

const PERIODS = ['month', 'quarter', 'year'] as const;
const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const USER_ID = /^usr_\d{3,}$/;
const CLIENT_ID = /^cli_\d{3,}$/;

/** Everyone sees the same dashboard (spec 8). The filters live in the link and apply to every number on the screen. */
export function DashboardScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const period = oneOf(params.get('period'), PERIODS, 'month');
  const status = oneOf(params.get('status'), STATUSES, 'active');
  const leader = params.get('leader') ?? '';
  const client = params.get('client') ?? '';
  const dashboard = useCall('dashboard.get', {
    period,
    status,
    leaderId: USER_ID.test(leader) ? leader : undefined,
    clientId: CLIENT_ID.test(client) ? client : undefined,
  });
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const set = (key: string, value: string, fallback: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
  const view = dashboard.data;
  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('screens.dashboard')} />
      <section aria-label={t('dashboard.filters')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SelectField id="dash-period" label={t('dashboard.period')} value={period} onChange={(event) => set('period', event.target.value, 'month')}>
          {PERIODS.map((value) => <option key={value} value={value}>{t(`dashboard.periods.${value}`)}</option>)}
        </SelectField>
        <SelectField id="dash-status" label={t('dashboard.statusLabel')} value={status} onChange={(event) => set('status', event.target.value, 'active')}>
          {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
        </SelectField>
        <SelectField id="dash-leader" label={t('dashboard.leader')} value={leader} onChange={(event) => set('leader', event.target.value, '')}>
          <option value="">{t('dashboard.anyLeader')}</option>
          {(users.data ?? []).filter((user) => user.kind === 'human').map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </SelectField>
        <SelectField id="dash-client" label={t('dashboard.client')} value={client} onChange={(event) => set('client', event.target.value, '')}>
          <option value="">{t('dashboard.anyClient')}</option>
          {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </section>
      {dashboard.error && (
        <EmptyState title={t('screens.dashboard')} body={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t('common.retry')}</Button>} />
      )}
      {view && (
        <>
          <Tiles view={view} />
        </>
      )}
    </div>
  );
}
```

In `src/app/routes.tsx`, import `DashboardScreen` and change the `dashboard` route to `{ path: 'dashboard', element: <DashboardScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add the Dashboard with filters in the link, six tiles and the hours sheet" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 5: The Dashboard charts

**Files:**
- Create: `src/features/dashboard/Charts.tsx`
- Modify: `src/features/dashboard/DashboardScreen.tsx`
- Test: `src/features/dashboard/Charts.test.tsx`

**Interfaces:**
- Consumes: `DashboardData` (Task 4), recharts `BarChart`, `Bar`, `XAxis`, `YAxis`, `ResponsiveContainer`.
- Produces: `Charts({ view })` below the tiles: Projects per stage, Health mix, Tasks done and created per week (chart plus table), Hours per project.

- [ ] **Step 1: Write the failing test**

`src/features/dashboard/Charts.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const chart = (name: string) => screen.findByRole('region', { name });

describe('the Dashboard charts', () => {
  it('links each stage bar to the Projects screen with that stage', async () => {
    await renderApp('/dashboard');
    await userEvent.click(within(await chart('Projects per stage')).getByRole('link', { name: /Construction Documents/ }));
    expect(await screen.findByRole('radio', { name: 'Construction Documents' })).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the health mix with a word and a number for each color', async () => {
    await renderApp('/dashboard');
    const health = await chart('Health mix');
    expect(within(health).getByRole('link', { name: /Late/ })).toHaveTextContent('2');
    expect(within(health).getByRole('link', { name: /At risk/ })).toHaveTextContent('3');
  });

  it('gives the weekly chart a table with 12 weeks and links', async () => {
    await renderApp('/dashboard');
    const throughput = await chart('Tasks done and created per week');
    expect(within(throughput).getAllByRole('row')).toHaveLength(13);
    await userEvent.click(within(throughput).getAllByRole('link', { name: /Done/ })[11]);
    await waitFor(() => expect(window.location.hash).toContain('doneFrom='));
  });

  it('links a project in Hours per project to its Team tab', async () => {
    await renderApp('/dashboard');
    const [first] = within(await chart('Hours per project')).getAllByRole('link');
    await userEvent.click(first);
    await waitFor(() => expect(window.location.hash).toContain('tab=team'));
  });

  it('says so when the filters leave nothing to draw', async () => {
    await renderApp('/dashboard?status=archived');
    await chart('Projects per stage');
    expect(screen.getAllByText('No data for these filters.').length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/dashboard/Charts.test.tsx`
Expected: FAIL: there are no chart sections.

- [ ] **Step 3: Write the charts**

`src/features/dashboard/Charts.tsx`:

```tsx
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { useLang } from '../../app/lang';
import { addDays, formatDay, formatNumber } from '../../lib/dates';
import type { DashboardData } from './Tiles';

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="surface flex min-w-0 flex-col gap-3 rounded-card p-4">
      <h2 id={id} className="text-headline">{title}</h2>
      {children}
    </section>
  );
}

function NoData() {
  const { t } = useTranslation();
  return <p className="text-footnote text-label-2">{t('dashboard.noData')}</p>;
}

/** One bar with its label and value. The whole row is a link to the list behind it (spec 8.3). */
function BarRow({ to, label, value, max, detail }: { to: string; label: string; value: number; max: number; detail: string }) {
  return (
    <li>
      <Link to={to} className="pressable grid min-h-11 grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 hover:bg-fill">
        <bdi className="truncate text-subheadline">{label}</bdi>
        <span aria-hidden className="h-2.5 rounded-full bg-fill">
          <span className="block h-full rounded-full bg-accent-fill" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
        </span>
        <span className="tabular text-subheadline">{detail}</span>
      </Link>
    </li>
  );
}

function PerStage({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.projectsPerStage;
  const max = Math.max(0, ...rows.map((row) => row.count));
  return (
    <Card title={t('dashboard.charts.perStage')}>
      {rows.length === 0 ? <NoData /> : (
        <ul>{rows.map((row) => <BarRow key={row.stage} to={`/?stage=${encodeURIComponent(row.stage)}`} label={row.stage} value={row.count} max={max} detail={formatNumber(row.count, lang)} />)}</ul>
      )}
    </Card>
  );
}

const HEALTH = [
  { key: 'on_track', color: 'bg-green', to: '/?status=active' },
  { key: 'at_risk', color: 'bg-orange', to: '/?filter=at_risk' },
  { key: 'late', color: 'bg-red', to: '/?filter=at_risk' },
] as const;

function HealthMix({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const mix = view.charts.healthMix;
  const total = mix.on_track + mix.at_risk + mix.late;
  return (
    <Card title={t('dashboard.charts.health')}>
      {total === 0 ? <NoData /> : (
        <>
          <div aria-hidden className="flex h-4 gap-0.5 overflow-hidden rounded-full">
            {HEALTH.map((item) => mix[item.key] > 0 && <span key={item.key} className={item.color} style={{ width: `${(mix[item.key] / total) * 100}%` }} />)}
          </div>
          <ul className="flex flex-wrap gap-2">
            {HEALTH.map((item) => (
              <li key={item.key}>
                <Link to={item.to} className="pressable inline-flex min-h-11 items-center gap-2 rounded-full bg-fill px-3 text-subheadline">
                  <span aria-hidden className={`size-2.5 rounded-full ${item.color}`} />
                  {t(`health.${item.key}`)}
                  <span className="tabular font-semibold">{formatNumber(mix[item.key], lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Throughput({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const rows = view.charts.throughput.map((week) => ({ ...week, label: formatDay(week.weekStart, lang), end: addDays(week.weekStart, 6) }));
  const doneLink = (row: (typeof rows)[number]) => `/tasks?doneFrom=${row.weekStart}&doneTo=${row.end}`;
  const createdLink = (row: (typeof rows)[number]) => `/tasks?createdFrom=${row.weekStart}&createdTo=${row.end}`;
  const rtl = lang === 'ar';
  return (
    <Card title={t('dashboard.charts.throughput')}>
      <div className="flex gap-4 text-footnote text-label-2" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-fill-strong" />{t('dashboard.created')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent-fill" />{t('dashboard.done')}</span>
      </div>
      <div aria-hidden className="h-52">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 208 }}>
          <BarChart data={rows} margin={{ top: 4, bottom: 0 }}>
            <XAxis dataKey="label" reversed={rtl} tick={{ fill: 'var(--c-label-2)', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} orientation={rtl ? 'right' : 'left'} width={28} tick={{ fill: 'var(--c-label-2)', fontSize: 11 }} tickLine={false} axisLine={false} />
            <Bar dataKey="created" fill="var(--c-fill-strong)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="done" fill="var(--c-accent-fill)" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(bar) => navigate(doneLink(bar.payload as (typeof rows)[number]))} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* The same numbers as a table, for keyboard and screen reader use. It shows when a link in it gets the focus. */}
      <div className="sr-only focus-within:not-sr-only">
        <table className="w-full text-footnote">
          <thead>
            <tr>
              <th scope="col" className="text-start">{t('dashboard.week', { date: '' })}</th>
              <th scope="col">{t('dashboard.created')}</th>
              <th scope="col">{t('dashboard.done')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.weekStart}>
                <th scope="row" className="text-start font-normal">{t('dashboard.week', { date: row.label })}</th>
                <td className="text-center"><Link to={createdLink(row)} aria-label={`${t('dashboard.created')} ${row.created}`} className="tabular">{row.created}</Link></td>
                <td className="text-center"><Link to={doneLink(row)} aria-label={`${t('dashboard.done')} ${row.done}`} className="tabular">{row.done}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HoursPerProject({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows = view.charts.hoursPerProject;
  const max = Math.max(0, ...rows.map((row) => row.hours));
  return (
    <Card title={t('dashboard.charts.hoursPerProject')}>
      {rows.length === 0 ? <NoData /> : (
        <ul>
          {rows.map((row) => (
            <BarRow
              key={row.projectId}
              to={`/projects/${row.projectId}?tab=team`}
              label={`${row.code} · ${row.name}`}
              value={row.hours}
              max={max}
              detail={t('dashboard.hoursValue', { n: formatNumber(row.hours, lang, 1) })}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Four charts; a click on any bar opens the list behind it (spec 8.3). */
export function Charts({ view }: { view: DashboardData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PerStage view={view} />
      <HealthMix view={view} />
      <Throughput view={view} />
      <HoursPerProject view={view} />
    </div>
  );
}
```

In `src/features/dashboard/DashboardScreen.tsx`, import `Charts` from `./Charts` and add `<Charts view={view} />` after `<Tiles view={view} />`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/dashboard`
Expected: PASS. If Recharts writes a size warning in the test browser, it is harmless: the chart has no size in jsdom, and the table carries the numbers the tests read.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard
git commit -m "feat: add the dashboard charts with links behind every bar" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 6: The workload grid

**Files:**
- Create: `src/features/dashboard/Workload.tsx`
- Modify: `src/features/dashboard/DashboardScreen.tsx`
- Test: `src/features/dashboard/Workload.test.tsx`

**Interfaces:**
- Consumes: `DashboardData.workload`.
- Produces: `Workload({ view })`: one row per person, one cell per week, each cell a link to `/tasks?owner=<id>&from=<Sunday>&to=<Saturday>`.

- [ ] **Step 1: Write the failing test**

`src/features/dashboard/Workload.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the workload grid', () => {
  it("opens a person's tasks for a week", async () => {
    await renderApp('/dashboard');
    const grid = await screen.findByRole('region', { name: 'Workload' });
    const [cell] = within(grid).getAllByRole('link', { name: /^Sara Al-Qahtani, week of/ });
    await userEvent.click(cell);
    await waitFor(() => expect(window.location.hash).toContain('owner=usr_005'));
  });

  it('marks a week over the limit with a word, and clears it when the limit rises', async () => {
    const low = await renderApp('/dashboard', (state) => {
      state.settings.workloadLimit = 1;
    });
    const grid = await screen.findByRole('region', { name: 'Workload' });
    expect(within(grid).getAllByText('Over').length).toBeGreaterThan(0);
    low.unmount();
    await renderApp('/dashboard', (state) => {
      state.settings.workloadLimit = 100;
    });
    const calm = await screen.findByRole('region', { name: 'Workload' });
    expect(within(calm).queryByText('Over')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/dashboard/Workload.test.tsx`
Expected: FAIL: there is no Workload section.

- [ ] **Step 3: Write the grid**

`src/features/dashboard/Workload.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../../app/lang';
import { Avatar } from '../../components/Avatar';
import { addDays, formatDay, formatNumber } from '../../lib/dates';
import type { DashboardData } from './Tiles';

/** People and the next 4 weeks: open tasks due in each week. Above the limit, the cell says "Over" in red (spec 8.4). */
export function Workload({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { weeks, limit, rows } = view.workload;
  return (
    <section aria-labelledby="dash-workload" className="surface flex flex-col gap-2 rounded-card p-4">
      <h2 id="dash-workload" className="text-headline">{t('dashboard.workload')}</h2>
      <p className="text-footnote text-label-2">{t('dashboard.workloadHint', { n: limit })}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-subheadline">
          <thead>
            <tr>
              <th scope="col" className="p-2 text-start font-medium text-label-2">{t('dashboard.person')}</th>
              {weeks.map((week) => <th key={week} scope="col" className="tabular p-2 text-center font-medium text-label-2">{formatDay(week, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.user.id}>
                <th scope="row" className="p-2 text-start font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={row.user} size={24} />
                    <bdi className="truncate">{row.user.name}</bdi>
                  </span>
                </th>
                {row.counts.map((count, i) => {
                  const over = row.over[i];
                  const label = t('dashboard.cell', { name: row.user.name, week: formatDay(weeks[i], lang), n: count });
                  return (
                    <td key={weeks[i]} className="p-1 text-center">
                      <Link
                        to={`/tasks?owner=${row.user.id}&from=${weeks[i]}&to=${addDays(weeks[i], 6)}`}
                        aria-label={over ? `${label}, ${t('dashboard.over')}` : label}
                        className={`pressable inline-flex min-h-11 min-w-14 flex-col items-center justify-center rounded-xl px-2 leading-tight ${over ? 'font-bold text-red-text ring-2 ring-inset ring-red' : 'bg-fill'}`}
                      >
                        <span className="tabular">{formatNumber(count, lang)}</span>
                        {over && <span aria-hidden className="text-caption">{t('dashboard.overShort')}</span>}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

In `src/features/dashboard/DashboardScreen.tsx`, import `Workload` and add `<Workload view={view} />` after `<Charts view={view} />`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/dashboard src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard src/i18n
git commit -m "feat: add the workload grid with a word on weeks over the limit" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 7: The office schedule

**Files:**
- Create: `src/features/dashboard/OfficeSchedule.tsx`
- Modify: `src/features/dashboard/DashboardScreen.tsx`
- Test: `src/features/dashboard/OfficeSchedule.test.tsx`

**Interfaces:**
- Consumes: `scheduleWindow`, `clipSpan`, `offsetPct`, `widthPct`, `ZOOMS` (Task 2), `formatMonth`, `usePersistentChoice`, `DashboardData.schedule`.
- Produces: `OfficeSchedule({ view })`: one row per active project by target end date, with stage bars in the stage rail colors, deadline diamonds and a line for today; each row name is a link to the project.

- [ ] **Step 1: Write the failing test**

`src/features/dashboard/OfficeSchedule.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the office schedule', () => {
  it('lists the active projects by target end date, each a link', async () => {
    await renderApp('/dashboard');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    const links = within(schedule).getAllByRole('link');
    expect(links).toHaveLength(10);
    await userEvent.click(within(schedule).getByRole('link', { name: /Corniche Office Tower/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('keeps the zoom for the next visit', async () => {
    const first = await renderApp('/dashboard');
    const schedule = await screen.findByRole('region', { name: 'Office schedule' });
    await userEvent.click(within(schedule).getByRole('radio', { name: 'Month' }));
    first.unmount();
    await renderApp('/dashboard');
    const again = await screen.findByRole('region', { name: 'Office schedule' });
    expect(within(again).getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/dashboard/OfficeSchedule.test.tsx`
Expected: FAIL: there is no Office schedule section.

- [ ] **Step 3: Write the schedule**

`src/features/dashboard/OfficeSchedule.tsx`:

```tsx
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePersistentChoice } from '../../app/choices';
import { useLang } from '../../app/lang';
import { SegmentedControl } from '../../components/SegmentedControl';
import { formatDay, formatMonth, todayISO } from '../../lib/dates';
import { clipSpan, offsetPct, scheduleWindow, widthPct, ZOOMS } from '../../lib/schedule';
import type { DashboardData } from './Tiles';

/** Every active project on one time scale, with a zoom. Time runs toward the end side, so Arabic reads right to left (spec 8.5). */
export function OfficeSchedule({ view }: { view: DashboardData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [zoom, setZoom] = usePersistentChoice('madar.office.zoom', ZOOMS, 'quarter');
  const today = todayISO();
  const { span, ticks } = scheduleWindow(today, zoom);
  const todayAt = { insetInlineStart: `${offsetPct(span, today)}%` };
  return (
    <section aria-labelledby="dash-schedule" className="surface flex flex-col gap-3 rounded-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="dash-schedule" className="text-headline">{t('dashboard.schedule')}</h2>
        <SegmentedControl label={t('dashboard.zoom')} value={zoom} onChange={setZoom} options={ZOOMS.map((value) => ({ value, label: t(`dashboard.zooms.${value}`) }))} />
      </div>
      {view.schedule.length === 0 ? <p className="text-footnote text-label-2">{t('dashboard.noData')}</p> : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[40rem] grid-cols-[10rem_minmax(0,1fr)] gap-x-3">
            <div />
            <div aria-hidden className="relative h-6">
              {ticks.map((tick) => (
                <span key={tick} style={{ insetInlineStart: `${offsetPct(span, tick)}%` }} className="absolute top-0 whitespace-nowrap border-s border-separator ps-1 text-caption text-label-2">
                  {zoom === 'month' ? formatDay(tick, lang) : formatMonth(tick, lang)}
                </span>
              ))}
            </div>
            {view.schedule.map((row) => {
              const current = row.stages.findIndex((stage) => stage.id === row.currentStageId);
              return (
                <Fragment key={row.project.id}>
                  <Link to={`/projects/${row.project.id}`} className="flex min-h-11 min-w-0 flex-col justify-center rounded-xl px-2 hover:bg-fill">
                    <span className="tabular text-caption text-label-2">{row.project.code}</span>
                    <bdi className="truncate text-subheadline">{row.project.name}</bdi>
                  </Link>
                  <div aria-hidden className="relative min-h-11">
                    <span style={todayAt} className="absolute inset-y-0 w-px bg-red" />
                    {row.stages.map((stage, i) => {
                      if (!stage.startDate || !stage.endDate) return null;
                      const part = clipSpan({ start: stage.startDate, end: stage.endDate }, span);
                      if (!part) return null;
                      const tone = i < current ? 'bg-label-3' : i === current ? 'bg-accent-fill' : 'bg-fill-strong';
                      return (
                        <span
                          key={stage.id}
                          title={stage.name}
                          style={{ insetInlineStart: `${offsetPct(span, part.start)}%`, width: `${widthPct(span, part.start, part.end)}%` }}
                          className={`absolute top-3.5 h-4 rounded-full ${tone}`}
                        />
                      );
                    })}
                    {row.deadlines.filter((d) => d.date >= span.start && d.date <= span.end).map((d) => (
                      <span
                        key={d.id}
                        title={d.name}
                        style={{ insetInlineStart: `calc(${offsetPct(span, d.date)}% - 5px)` }}
                        className="absolute top-4 size-2.5 rotate-45 rounded-sm bg-orange"
                      />
                    ))}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
```

In `src/features/dashboard/DashboardScreen.tsx`, import `OfficeSchedule` and add `<OfficeSchedule view={view} />` after `<Workload view={view} />`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/dashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard
git commit -m "feat: add the office schedule with zoom, stage bars, deadlines and today" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 8: The Task list screen

**Files:**
- Create: `src/features/tasklist/TaskListScreen.tsx`
- Modify: `src/app/routes.tsx`
- Test: `src/features/tasklist/TaskListScreen.test.tsx`

**Interfaces:**
- Consumes: `tasks.list` with its filters (Task 1), `deadlines.list`, `oneOf`, `dayParam`, `TaskRowItem`, `ProjectTaskSheet`, `NextDeadlineLabel`.
- Produces: `TaskListScreen()` at `/tasks`. Values in the link: `filter=all|overdue|flagged`, `owner=<user id>`, `from`, `to` (due dates, or deadline dates in deadline mode), `createdFrom`, `createdTo`, `doneFrom`, `doneTo`, `mode=deadlines`. A bad value is ignored.

- [ ] **Step 1: Write the failing test**

`src/features/tasklist/TaskListScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('the Task list', () => {
  it('shows overdue tasks', async () => {
    await renderApp('/tasks?filter=overdue');
    expect(await screen.findByRole('heading', { level: 1, name: 'Overdue tasks' })).toBeInTheDocument();
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it("shows a person's open tasks for a week", async () => {
    await renderApp('/tasks?owner=usr_005&from=2026-10-18&to=2026-10-24');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tasks of Sara Al-Qahtani' })).toBeInTheDocument();
    expect(await screen.findByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.getByText('Due 18 Oct to 24 Oct')).toBeInTheDocument();
  });

  it('lists deadlines and links each one to its project schedule', async () => {
    await renderApp('/tasks?mode=deadlines&from=2026-09-30&to=2026-10-14');
    expect(await screen.findByRole('heading', { level: 1, name: 'Deadlines' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('link', { name: /Balady submission/ }));
    await waitFor(() => expect(window.location.hash).toContain('tab=schedule'));
  });

  it('ignores bad values in the link', async () => {
    await renderApp('/tasks?from=banana&filter=weird&owner=nobody');
    expect(await screen.findByRole('heading', { level: 1, name: 'Task list' })).toBeInTheDocument();
    expect(await screen.findByText('Stair details')).toBeInTheDocument();
  });

  it('opens a task in place', async () => {
    await renderApp('/tasks?filter=overdue');
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    expect(await screen.findByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/tasklist`
Expected: FAIL: `/tasks` shows the placeholder.

- [ ] **Step 3: Write the screen**

`src/features/tasklist/TaskListScreen.tsx`:

```tsx
import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay } from '../../lib/dates';
import { dayParam, oneOf } from '../../lib/params';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';
import { NextDeadlineLabel } from '../projects/ProjectCard';

const FILTERS = ['all', 'overdue', 'flagged'] as const;
const USER_ID = /^usr_\d{3,}$/;

function Subtitle({ text }: { text: string }) {
  return text ? <p className="-mt-3 pb-4 text-subheadline text-label-2">{text}</p> : null;
}

function DeadlineList({ from, to }: { from?: string; to?: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const deadlines = useCall('deadlines.list', { from, to });
  const rows = deadlines.data ?? [];
  return (
    <>
      <ScreenTitle title={t('taskList.deadlinesTitle')} />
      <Subtitle text={from && to ? t('taskList.dateRange', { from: formatDay(from, lang), to: formatDay(to, lang) }) : ''} />
      {deadlines.data && rows.length === 0 ? <EmptyState title={t('taskList.deadlinesTitle')} body={t('taskList.emptyDeadlines')} /> : (
        <ul className="surface flex flex-col rounded-card p-2">
          {rows.map((row) => (
            <li key={row.deadline.id}>
              <Link to={`/projects/${row.project.id}?tab=schedule`} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2 hover:bg-fill">
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-footnote text-label-2">{row.project.code} · <bdi>{row.project.name}</bdi></span>
                </span>
                <NextDeadlineLabel deadline={{ id: row.deadline.id, name: row.deadline.name, date: row.deadline.date, daysLeft: row.daysLeft }} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TaskResults() {
  const { t } = useTranslation();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const filter = oneOf(params.get('filter'), FILTERS, 'all');
  const owner = params.get('owner') ?? '';
  const ownerId = USER_ID.test(owner) ? owner : undefined;
  const from = dayParam(params.get('from'));
  const to = dayParam(params.get('to'));
  const createdFrom = dayParam(params.get('createdFrom'));
  const createdTo = dayParam(params.get('createdTo'));
  const doneFrom = dayParam(params.get('doneFrom'));
  const doneTo = dayParam(params.get('doneTo'));
  const users = useCall('users.list', { includeInactive: true });
  const tasks = useCall('tasks.list', {
    filter, ownerId, dueFrom: from, dueTo: to, createdFrom, createdTo, doneFrom, doneTo, includeDone: Boolean(doneFrom || doneTo),
  });
  const open = (row: TaskRow) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', row.task.id);
    next.set('project', row.project.id);
    return next;
  });
  const close = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    next.delete('project');
    return next;
  }), [setParams]);
  const person = users.data?.find((user) => user.id === ownerId);
  const title = filter === 'overdue' ? t('taskList.overdue')
    : filter === 'flagged' ? t('taskList.flagged')
      : person ? t('taskList.forPerson', { name: person.name }) : t('taskList.title');
  const range = (key: string, a?: string, b?: string) => (a && b ? t(key, { from: formatDay(a, lang), to: formatDay(b, lang) }) : '');
  const subtitle = [range('taskList.dueRange', from, to), range('taskList.createdRange', createdFrom, createdTo), range('taskList.doneRange', doneFrom, doneTo)]
    .filter(Boolean).join(' · ');
  const rows = tasks.data ?? [];
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <>
      <ScreenTitle title={title} />
      <Subtitle text={subtitle} />
      {tasks.data && rows.length === 0 ? <EmptyState title={title} body={t('taskList.empty')} /> : (
        <ul className="surface overflow-hidden rounded-card py-1">
          <AnimatePresence initial={false}>
            {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => open(row)} showProject />)}
          </AnimatePresence>
        </ul>
      )}
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </>
  );
}

/** A filtered list of tasks or deadlines from all projects. The dashboard opens it; it is not in the navigation (spec 3.1). */
export function TaskListScreen() {
  const [params] = useSearchParams();
  if (params.get('mode') === 'deadlines') return <DeadlineList from={dayParam(params.get('from'))} to={dayParam(params.get('to'))} />;
  return <TaskResults />;
}
```

In `src/app/routes.tsx`, import `TaskListScreen` and change the `tasks` route to `{ path: 'tasks', element: <TaskListScreen /> }`. The placeholder import is now unused there; remove it from `routes.tsx` if no route uses it.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add the Task list screen for tasks and deadlines behind the dashboard" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 9: Admin settings

**Files:**
- Create: `src/features/settings/admin/AdminSettings.tsx`, `src/features/settings/admin/PeopleSection.tsx`, `src/features/settings/admin/PersonFormSheet.tsx`, `src/features/settings/admin/OfficeSection.tsx`, `src/features/settings/admin/UnlockSection.tsx`
- Modify: `src/features/settings/SettingsScreen.tsx`, `src/features/projects/ProjectFields.tsx` (export `StageList`)
- Test: `src/features/settings/admin/AdminSettings.test.tsx`

**Interfaces:**
- Consumes: `users.list`, `users.create`, `users.update`, `users.deactivate`, `settings.get`, `settings.update`, `time.unlockWeek`, `useUndoable`, `StageList`.
- Produces: `AdminSettings()`, shown in Settings only when the viewer is an Admin: People (add, edit, deactivate with Undo), Office settings (default stages, code prefix, workload limit), Unlock a week.

- [ ] **Step 1: Write the failing test**

`src/features/settings/admin/AdminSettings.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const region = (name: string) => screen.findByRole('region', { name });
const openMenu = async (name: string) => {
  await userEvent.click(within(await region('People')).getByRole('button', { name: `Actions for ${name}` }));
  return screen.getByRole('menu');
};

describe('Admin settings', () => {
  it('shows the Admin sections only to the Admin', async () => {
    const first = await renderApp('/settings');
    for (const name of ['People', 'Office settings', 'Unlock a week']) expect(await region(name)).toBeInTheDocument();
    first.unmount();
    await renderApp('/settings', (state: State) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(screen.queryByRole('region', { name: 'People' })).toBeNull();
  });

  it('adds a person', async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await region('People')).getByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Nora Salem');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'nora.salem@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Landscape');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(Object.values(store.state.users).some((u) => u.name === 'Nora Salem' && u.discipline === 'Landscape')).toBe(true));
  });

  it("edits a person's weekly target", async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await openMenu('Sara Al-Qahtani')).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    const target = within(sheet).getByLabelText('Weekly target (h)');
    await userEvent.clear(target);
    await userEvent.type(target, '36');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_005.weeklyHourTarget).toBe(36));
  });

  it('deactivates a person, then brings them back with Undo', async () => {
    const { store } = await renderApp('/settings');
    await userEvent.click(within(await openMenu('Omar Haddad')).getByRole('menuitem', { name: 'Deactivate' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.users.usr_004.active).toBe(true));
  });

  it('offers no Deactivate on my own row, and refuses to drop the last Admin', async () => {
    const { store } = await renderApp('/settings');
    const menu = await openMenu('Hala Nasser');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit person' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Role'), 'member');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Some fields are not valid.')).toBeInTheDocument();
    expect(store.state.users.usr_001.systemRole).toBe('admin');
  });

  it('saves the office settings', async () => {
    const { store } = await renderApp('/settings');
    const office = await region('Office settings');
    const limit = within(office).getByLabelText('Workload limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '12');
    await userEvent.click(within(office).getByRole('button', { name: 'Save office settings' }));
    await waitFor(() => expect(store.state.settings.workloadLimit).toBe(12));
  });

  it('unlocks a week for a person', async () => {
    const { store } = await renderApp('/settings');
    const unlock = await region('Unlock a week');
    await userEvent.selectOptions(within(unlock).getByLabelText('Person'), 'Sara Al-Qahtani');
    fireEvent.change(within(unlock).getByLabelText('Any day in the week'), { target: { value: '2026-09-02' } });
    await userEvent.click(within(unlock).getByRole('button', { name: 'Unlock week' }));
    await waitFor(() => expect(store.state.weekUnlocks).toContainEqual({ userId: 'usr_005', weekStart: '2026-08-30' }));
    expect(await screen.findByText(/is open for Sara Al-Qahtani/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/settings/admin`
Expected: FAIL: Settings has no People, Office settings or Unlock sections.

- [ ] **Step 3: Write the Admin sections**

In `src/features/projects/ProjectFields.tsx`, change `function StageList(` to `export function StageList(`.

`src/features/settings/admin/PersonFormSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Sheet } from '../../../components/Sheet';

type Form = { name: string; email: string; systemRole: 'admin' | 'member'; kind: 'human' | 'agent'; ownerId: string; discipline: string; target: string };
const EMPTY: Form = { name: '', email: '', systemRole: 'member', kind: 'human', ownerId: '', discipline: '', target: '40' };

/** Add a person or an agent, or edit a person (spec 9). The kind is set once, when the person is added (plan clarification 6). */
export function PersonFormSheet({ open, onOpenChange, person }: { open: boolean; onOpenChange: (open: boolean) => void; person: User | null }) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [form, setForm] = useState<Form>(EMPTY);
  useEffect(() => {
    if (!open) return;
    setForm(person
      ? { name: person.name, email: person.email, systemRole: person.systemRole, kind: person.kind, ownerId: person.ownerId ?? '', discipline: person.discipline, target: String(person.weeklyHourTarget) }
      : EMPTY);
  }, [open, person]);
  const done = (message: string) => {
    toast.show({ message });
    onOpenChange(false);
  };
  const create = useAction('users.create', { onSuccess: (user) => done(t('admin.added', { name: user.name })) });
  const update = useAction('users.update', { onSuccess: () => done(t('admin.saved')) });
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const target = Number(form.target);
  const valid = form.name.trim() && form.email.trim() && form.discipline.trim() && form.target.trim() !== '' && target >= 0 && target <= 80
    && (form.kind === 'human' || form.ownerId);
  const submit = () => {
    const common = { name: form.name.trim(), email: form.email.trim(), systemRole: form.systemRole, discipline: form.discipline.trim(), weeklyHourTarget: target };
    if (person) update.mutate({ id: person.id, patch: common });
    else create.mutate({ ...common, kind: form.kind, ownerId: form.kind === 'agent' ? form.ownerId : undefined });
  };
  const humans = (users.data ?? []).filter((user) => user.kind === 'human');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={person ? t('admin.editTitle') : t('admin.addPerson')}
      footer={<Button variant="primary" disabled={!valid || create.isPending || update.isPending} onClick={submit}>{t('admin.save')}</Button>}
    >
      <div className="flex flex-col gap-4 pt-1">
        <TextField id="person-name" label={t('admin.name')} value={form.name} dir="auto" onChange={(event) => set('name', event.target.value)} />
        <TextField id="person-email" type="email" dir="ltr" label={t('admin.email')} value={form.email} onChange={(event) => set('email', event.target.value)} />
        <SelectField id="person-role" label={t('admin.role')} value={form.systemRole} onChange={(event) => set('systemRole', event.target.value as Form['systemRole'])}>
          <option value="member">{t('admin.roles.member')}</option>
          <option value="admin">{t('admin.roles.admin')}</option>
        </SelectField>
        {!person && (
          <SelectField id="person-kind" label={t('admin.kind')} value={form.kind} onChange={(event) => set('kind', event.target.value as Form['kind'])}>
            <option value="human">{t('admin.kinds.human')}</option>
            <option value="agent">{t('admin.kinds.agent')}</option>
          </SelectField>
        )}
        {!person && form.kind === 'agent' && (
          <SelectField id="person-owner" label={t('admin.owner')} value={form.ownerId} onChange={(event) => set('ownerId', event.target.value)}>
            <option value="" disabled>{t('admin.owner')}</option>
            {humans.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </SelectField>
        )}
        <TextField id="person-discipline" label={t('admin.discipline')} value={form.discipline} dir="auto" onChange={(event) => set('discipline', event.target.value)} />
        <TextField id="person-target" label={t('admin.target')} inputMode="numeric" value={form.target} onChange={(event) => set('target', event.target.value)} />
      </div>
    </Sheet>
  );
}
```

`src/features/settings/admin/PeopleSection.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../../../api/contract/entities';
import { useUndoable } from '../../../app/actions';
import { useCall } from '../../../app/runtime';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { Menu } from '../../../components/Menu';
import { PersonFormSheet } from './PersonFormSheet';

export function PeopleSection() {
  const { t } = useTranslation();
  const users = useCall('users.list', { includeInactive: true });
  const session = useCall('session.get', {});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const deactivate = useUndoable('users.deactivate', { message: (user) => t('admin.deactivated', { name: user.name }) });
  const me = session.data?.authority.id;
  return (
    <section aria-labelledby="admin-people" className="surface flex flex-col gap-3 rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="admin-people" className="text-headline">{t('admin.people')}</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden />
          {t('admin.addPerson')}
        </Button>
      </div>
      <ul className="flex flex-col">
        {(users.data ?? []).map((user) => (
          <li key={user.id} className="flex items-center gap-3 py-2">
            <Avatar user={user} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{user.name}</bdi>
                {user.kind === 'agent' && <AgentLabel />}
                {!user.active && <span className="rounded-full bg-fill px-2 text-caption text-label-2">{t('admin.inactive')}</span>}
              </p>
              <p className="truncate text-footnote text-label-2">
                <span dir="ltr">{user.email}</span> · {t(`admin.roles.${user.systemRole}`)} · <bdi>{user.discipline}</bdi> · {t('dashboard.hoursValue', { n: user.weeklyHourTarget })}
              </p>
            </div>
            <Menu
              label={t('admin.actions', { name: user.name })}
              items={[
                { label: t('admin.edit'), onSelect: () => setEditing(user) },
                { label: t('admin.deactivate'), onSelect: () => deactivate.mutate({ id: user.id }), hidden: !user.active || user.id === me, destructive: true },
              ]}
            />
          </li>
        ))}
      </ul>
      <PersonFormSheet open={adding} onOpenChange={setAdding} person={null} />
      <PersonFormSheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} person={editing} />
    </section>
  );
}
```

`src/features/settings/admin/OfficeSection.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/Fields';
import { StageList } from '../../projects/ProjectFields';

export function OfficeSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const settings = useCall('settings.get', {});
  const [stages, setStages] = useState<{ name: string }[]>([]);
  const [prefix, setPrefix] = useState('');
  const [limit, setLimit] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setStages(settings.data.defaultStages.map((name) => ({ name })));
    setPrefix(settings.data.codePrefix);
    setLimit(String(settings.data.workloadLimit));
  }, [settings.data]);
  const save = useAction('settings.update', { onSuccess: () => toast.show({ message: t('admin.officeSaved') }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ defaultStages: stages.map((stage) => stage.name.trim()), codePrefix: prefix.trim(), workloadLimit: Number(limit) });
  };
  return (
    <section aria-labelledby="admin-office" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-office" className="text-headline">{t('admin.office')}</h2>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <StageList stages={stages} onChange={setStages} onBlur={() => undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="office-prefix" label={t('admin.prefix')} hint={t('admin.prefixHint')} dir="ltr" maxLength={4} value={prefix} onChange={(event) => setPrefix(event.target.value.toUpperCase())} />
          <TextField id="office-limit" label={t('admin.limit')} hint={t('admin.limitHint')} inputMode="numeric" value={limit} onChange={(event) => setLimit(event.target.value)} />
        </div>
        <Button variant="primary" type="submit" className="self-start" disabled={save.isPending}>{t('admin.saveOffice')}</Button>
      </form>
    </section>
  );
}
```

`src/features/settings/admin/UnlockSection.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { formatDay, weekStartOf } from '../../../lib/dates';

/** A week locks 14 days after it ends. The Admin can open it again for one person (spec 6.2 and 9). */
export function UnlockSection() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const users = useCall('users.list', {});
  const humans = (users.data ?? []).filter((user) => user.kind === 'human');
  const [userId, setUserId] = useState('');
  const [day, setDay] = useState('');
  const unlock = useAction('time.unlockWeek');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const person = humans.find((user) => user.id === userId);
    if (!person || !day) return;
    const weekStart = weekStartOf(day);
    unlock.mutate({ userId, weekStart }, {
      onSuccess: () => toast.show({ message: t('admin.unlocked', { week: formatDay(weekStart, lang, 'long'), name: person.name }) }),
    });
  };
  return (
    <section aria-labelledby="admin-unlock" className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 id="admin-unlock" className="text-headline">{t('admin.unlock')}</h2>
      <p className="text-footnote text-label-2">{t('admin.unlockHint')}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
        <SelectField id="unlock-person" label={t('admin.person')} value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="" disabled>{t('admin.person')}</option>
          {humans.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </SelectField>
        <TextField id="unlock-day" type="date" label={t('admin.week')} value={day} onChange={(event) => setDay(event.target.value)} />
        <Button variant="primary" type="submit" disabled={!userId || !day || unlock.isPending}>{t('admin.unlockButton')}</Button>
      </form>
    </section>
  );
}
```

`src/features/settings/admin/AdminSettings.tsx`:

```tsx
import { OfficeSection } from './OfficeSection';
import { PeopleSection } from './PeopleSection';
import { UnlockSection } from './UnlockSection';

/** The Admin parts of Settings (spec 9). The API refuses them for everyone else too. */
export function AdminSettings() {
  return (
    <>
      <PeopleSection />
      <OfficeSection />
      <UnlockSection />
    </>
  );
}
```

In `src/features/settings/SettingsScreen.tsx`, import `AdminSettings` from `./admin/AdminSettings` and add after the Notifications section:

```tsx
      {session.data.authority.systemRole === 'admin' && <AdminSettings />}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features
git commit -m "feat: add Admin settings for people, office settings and week unlock" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 10: Browser sweep and the review link

**Files:**
- Create: `tests/e2e/dashboard.spec.ts`
- Modify: the review wrapper in the session scratchpad and the progress page status

**Interfaces:**
- Consumes: the whole app.
- Produces: a green sweep, screenshots, and the review link with the plan 4 screens.

- [ ] **Step 1: Write the browser sweep**

`tests/e2e/dashboard.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect.soft(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

const SCREENS = [
  { name: 'dashboard', path: '/#/dashboard' },
  { name: 'task-list', path: '/#/tasks?filter=overdue' },
  { name: 'deadlines', path: '/#/tasks?mode=deadlines' },
  { name: 'settings-admin', path: '/#/settings' },
];

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`dashboard screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `test-results/dashboard/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('a tile and a workload cell open the lists behind them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/dashboard');
  await page.getByRole('button', { name: /Overdue tasks/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Overdue tasks' })).toBeVisible();
  await page.goBack();
  await page.getByRole('region', { name: 'Workload' }).getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tasks of');
});

test('the office schedule runs right to left in Arabic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await useArabic(page);
  await page.goto('/#/dashboard');
  const schedule = page.getByRole('region', { name: 'جدول المكتب' });
  await expect(schedule).toBeVisible();
  const ticks = await schedule.locator('span.border-s').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left)); // rtl-ok: screen positions
  expect(ticks[0]).toBeGreaterThan(ticks[ticks.length - 1]);
});
```

- [ ] **Step 2: Run the browser sweep in a subagent**

Delegate to one subagent. Command: `npx playwright test tests/e2e --reporter=line`, run twice at the end. Same rules as plan 3: test-side fixes only, listed; every app defect reported with its assertion or axe rule and target; paths of four screenshots (1440 English dashboard, 1440 Arabic dashboard, 390 English task list, 1440 English settings admin).
Expected: all tests pass. Fix each app defect in the main session with a failing unit test first when a unit test can show it.

- [ ] **Step 3: Look at the screens**

Read the four screenshots. Check: tiles line up, charts have words next to colors, the workload grid and the office schedule scroll sideways on a phone, and Arabic mirrors.

- [ ] **Step 4: Publish the review link and the progress page**

Build, point the review wrapper at the new asset names, publish to the same path (new files added, old ones set to `null`), and update the progress page (build step 4 done).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/dashboard.spec.ts TASKS.md
git commit -m "test: add the browser sweep for the Dashboard, the Task list and Admin settings" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```
