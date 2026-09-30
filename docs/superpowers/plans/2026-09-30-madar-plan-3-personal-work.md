# Madar Plan 3 of 5: Personal work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build My Work (my tasks from all projects, and my weekly timesheet), the Inbox, comments with mentions and reactions on tasks and posts, and search with commands, and publish them on the same review link.

**Architecture:** The same layers as plan 2. The API gets three small additions: `canEdit` on posts and comments, `canApprove` on review notices, and notice links that open the right tab. Pure helpers (task groups, day groups, hour parsing, project links in text) carry the unit tests. A shared `MentionField` gives the composer and the comment box the same @mention picker. Search uses cmdk for the list and keyboard.

**Tech Stack:** as plan 2, plus the already installed cmdk 1.1.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-madar-prototype-design.md` (sections 5.4, 6, 7, and 10 for design).

**Base:** branch `plan-3-personal-work`, cut from `plan-2-projects` after the plan 2 review fixes. The owner approved this plan in advance ("I approve all plans you do from now", 2026-09-30).

## Global Constraints

- Every rule in plan 1 and plan 2 Global Constraints still applies (office dates only through `src/lib/dates.ts`, screens reach data only through the API hooks, logical CSS only, all text in both language files, only `transform` and `opacity` animate, WCAG 2.2 AA, 44 px targets, Simplified Technical English with no em-dash character, the commit command with the Claude-Session line and no Co-Authored-By line, `TASKS.md` in step with this plan).
- A screen never decides a permission: it uses `canEdit`, `canApprove`, `canMove` and `viewerCan` from the API.
- Changes with an Undo toast go through `useUndoable`.
- The timesheet takes hours in steps of 0.5, 0 to 24 per day. The API is the judge; the screen checks the same rule first, so a person sees the message at once.
- Tests use `renderApp(path, prepare)` over the sample office. Sample facts from plan 2 still hold. Extra facts for this plan: Sara (`usr_005`) owns `tsk_010` Toilet details (in review, due 28 Sep) and `tsk_012` Civil Defense drawings (to do, due 18 Oct) on `prj_001`; Faisal (`usr_002`) leads `prj_001` and reviews Toilet details; the sample hours run Sunday to Thursday from the week of 9 Aug up to today, split over each person's active projects at the current stage (Sara logged 6 hours a day last week, the week of 20 Sep); nobody has hours on a Friday or Saturday; the week of 30 Aug is locked (it ended 5 Sep, more than 14 days ago).

**Clarifications of the spec made in this plan.** Tell the owner about these at handoff.

1. My Work shows a task that is In review with a past due date under "Today", because a task in review is never overdue (spec 4.2).
2. A task opened from My Work opens its task panel in place, over My Work.
3. "Log time" in a task opens the Hours tab of this week with a row for the task's project, stage and task, and puts the cursor in today's cell.
4. Friday and Saturday stay folded unless the week has hours on them or the person opens them. The choice lasts to the next visit.
5. A person can view past weeks and this week. The next-week button stops at this week.
6. The Inbox "Approve" button shows only while the task still waits for review and the person may approve it. Opening an item marks it read.
7. A swipe to either side on a phone marks an Inbox item read.
8. Search shows people too. A person opens a small sheet with their active projects.
9. A comment or a post counts "@Full Name" of a project person as a mention, also when typed without the picker.
10. `#KH-26-014` in a post or comment is a link to that project.

## Review Focus

1. **A person who may not act.** A person outside the project reads its comments; a member looks at a comment by someone else. Expected: no comment box, no reaction buttons, no Edit or Delete. Tests: Task 4.
2. **Timesheet input in other forms.** "1,5", Arabic-Indic digits "٢", "2.3", "25", an empty cell. Expected: the first two save as 1.5 and 2, the next two show "Use steps of 0.5, from 0 to 24." and save nothing, an empty cell saves 0. Tests: Task 2 (`parseHours`) and Task 6.
3. **A locked week and a future day.** Expected: no input takes hours, and the lock message shows. Test: Task 6.
4. **An Inbox item whose task changed.** The task was approved or deleted after the notice. Expected: no Approve button, and Open still works or shows "not found" on the project. Test: Task 1 (`canApprove`) and Task 8.
5. **Search with other letter forms and no match.** "CORNICHE", Arabic text, "zzzz". Expected: the same matches as lower case (plan 1 normalization), and one sentence when nothing matches. Tests: Task 9.

## File Map

| File | Responsibility |
|---|---|
| `src/api/contract/views.ts`, `src/api/views.ts`, `src/api/handlers/content.ts`, `src/api/handlers/notifications.ts` | `canEdit` on posts and comments, `canApprove` and tab links on notices |
| `src/lib/myWork.ts`, `src/lib/group.ts`, `src/lib/hours.ts`, `src/lib/text.ts`, `src/lib/dates.ts` | Task groups, day groups, hour parsing, project links, weekday names |
| `src/components/MentionField.tsx` | The shared @mention text box |
| `src/features/comments/CommentThread.tsx` | Comments, reactions, edit and delete |
| `src/features/project/ProjectByCode.tsx` | `#KH-26-014` links |
| `src/features/work/*` | My Work screen, task groups, Hours tab, add-row sheet |
| `src/features/inbox/InboxScreen.tsx` | The Inbox |
| `src/features/search/*` | Search screen, New task sheet, person sheet |
| `tests/e2e/work.spec.ts` | Browser sweep for this plan (run by a subagent) |

---
### Task 1: API additions for comments, posts and notices

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/views.ts`, `src/api/handlers/content.ts`, `src/api/handlers/notifications.ts`
- Test: `src/api/handlers/content.test.ts`, `src/api/handlers/notifications.test.ts`

**Interfaces:**
- Consumes: `can`, `projectRoleOf`, `principalOf`.
- Produces: `FeedItem` (update kind) gets `canEdit: boolean`; `CommentView.canEdit: boolean`; `NotificationView.canApprove: boolean`; notice links `/projects/<id>?tab=tasks&task=<id>` and `/projects/<id>?tab=overview&update=<id>`; `updateItemOf(state, update, viewer)`, `feedFor(state, projectId, filter, limit, viewer)`, `commentViewOf(state, comment, viewer)`.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/handlers/content.test.ts`:

```ts
describe('rights on posts and comments', () => {
  it('tells the viewer which posts and comments they may edit', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Mine' });
    const comment = await t.api.call('comments.create', { targetType: 'update', targetId: post.id, body: 'Note' });
    expect(post).toMatchObject({ kind: 'update', canEdit: true });
    expect(comment.canEdit).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('updates.list', { projectId: 'prj_001', filter: 'posts' }))[0]).toMatchObject({ canEdit: false });
    expect((await t.api.call('comments.list', { targetType: 'update', targetId: post.id }))[0].canEdit).toBe(false);
  });
});
```

Append to `src/api/handlers/notifications.test.ts` (add `import { taskCalls } from './tasks';` and `import { contentCalls } from './content';`):

```ts
describe('notice links and approval', () => {
  it('opens tasks and posts on the right tab, and offers Approve only while the task waits', async () => {
    const t = testApi({ ...notificationCalls, ...taskCalls, ...contentCalls });
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: true });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Ready @[Faisal Leader](usr_002)' });
    t.as('usr_002');
    const views = await t.api.call('notifications.list', {});
    const review = views.find((v) => v.notification.trigger === 'review_requested');
    expect(review?.link).toBe('/projects/prj_001?tab=tasks&task=tsk_001');
    expect(review?.canApprove).toBe(true);
    expect(views.find((v) => v.notification.trigger === 'mention')?.link).toBe(`/projects/prj_001?tab=overview&update=${post.id}`);
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    const after = await t.api.call('notifications.list', {});
    expect(after.find((v) => v.notification.trigger === 'review_requested')?.canApprove).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/api/handlers/content.test.ts src/api/handlers/notifications.test.ts`
Expected: FAIL: `canEdit` and `canApprove` are undefined, and the links have no `tab`.

- [ ] **Step 3: Change the contract and the builders**

In `src/api/contract/views.ts`, add `canEdit: z.boolean(),` to the `update` object of `FeedItem` (after `commentCount`), and replace `CommentView` with:

```ts
export const CommentView = z.object({ comment: Comment, author: UserCard, canEdit: z.boolean() });
export type CommentView = z.infer<typeof CommentView>;
```

In `src/api/views.ts`, add `principalOf` to the `./permissions` import, then replace `updateItemOf`, `feedFor` and `commentViewOf` with:

```ts
/** True when the viewer may edit or delete this post or comment: its author, or the person its agent acted for (spec 7.2). */
function canEditContent(state: State, projectId: string, authorId: string, viewer: User): boolean {
  return can(viewer, 'content.editOwn', { projectRole: projectRoleOf(state, projectId, viewer.id), authorId: principalOf(state, authorId) });
}

export function updateItemOf(state: State, update: Update, viewer: User): FeedItem {
  return {
    kind: 'update', id: update.id, at: update.createdAt, author: cardOf(state, update.authorId), body: update.body,
    fileIds: update.fileIds, editedAt: update.editedAt, commentCount: countComments(state, 'update', update.id),
    canEdit: canEditContent(state, update.projectId, update.authorId, viewer),
  };
}
```

```ts
export function feedFor(
  state: State, projectId: string, filter: 'all' | 'posts' | 'tasks' | 'files', limit: number, viewer: User,
): FeedItem[] {
  const items: FeedItem[] = [];
  if (filter === 'all' || filter === 'posts') {
    for (const update of Object.values(state.updates)) if (update.projectId === projectId) items.push(updateItemOf(state, update, viewer));
  }
  if (filter !== 'posts') {
    for (const event of Object.values(state.events)) {
      if (event.projectId !== projectId || event.undoneBy || !FEED_VERBS.has(event.verb)) continue;
      if (filter === 'tasks' && !event.verb.startsWith('task.')) continue;
      if (filter === 'files' && !event.verb.startsWith('file.')) continue;
      const { label, detail } = eventLabel(state, event);
      items.push({
        kind: 'event', id: event.id, at: event.createdAt, author: cardOf(state, event.actorId), verb: event.verb,
        targetType: event.targetType, targetId: event.targetId, label, detail,
      });
    }
  }
  return items.sort(newestFirst).slice(0, limit);
}
```

```ts
export function commentViewOf(state: State, comment: Comment, viewer: User): CommentView {
  const target = comment.targetType === 'task' ? state.tasks[comment.targetId] : state.updates[comment.targetId];
  return {
    comment,
    author: cardOf(state, comment.authorId),
    canEdit: target ? canEditContent(state, target.projectId, comment.authorId, viewer) : false,
  };
}
```

In `summaryOf`, change `feedFor(state, project.id, 'all', 2)` to `feedFor(state, project.id, 'all', 2, viewer)`.

In `src/api/handlers/content.ts`, pass `ctx.authority` as the last argument at every call of `feedFor`, `updateItemOf` and `commentViewOf` (7 calls).

- [ ] **Step 4: Change the notices**

In `src/api/handlers/notifications.ts`, add `import { can, projectRoleOf } from '../permissions';` and `type User` to the entities import. Add `canApprove: z.boolean(),` to `NotificationView` after `needsAction`. Replace `viewOf` with:

```ts
function viewOf(state: State, n: Notification, viewer: User): NotificationView {
  let target = '';
  let projectCode: string | null = null;
  let link = '/inbox';
  let canApprove = false;
  if (n.targetType === 'task') {
    const task = state.tasks[n.targetId];
    const project = task ? state.projects[task.projectId] : undefined;
    target = task?.title ?? '';
    projectCode = project?.code ?? null;
    if (task) link = `/projects/${task.projectId}?tab=tasks&task=${task.id}`;
    canApprove = n.trigger === 'review_requested' && task?.status === 'in_review'
      && can(viewer, 'task.review', { projectRole: projectRoleOf(state, task.projectId, viewer.id) });
  } else if (n.targetType === 'update') {
    const update = state.updates[n.targetId];
    const project = update ? state.projects[update.projectId] : undefined;
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    if (update) link = `/projects/${update.projectId}?tab=overview&update=${update.id}`;
  } else if (n.targetType === 'project') {
    const project = state.projects[n.targetId];
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    if (project) link = `/projects/${project.id}`;
  } else {
    target = n.targetId;
    link = `/work?tab=hours&week=${n.targetId}`;
  }
  return {
    notification: n, actor: n.actorId ? cardOf(state, n.actorId) : null, target, projectCode, link,
    needsAction: ACTION_TRIGGERS.has(n.trigger), canApprove,
  };
}
```

and change the map in `notificationsList` to `.map((n) => viewOf(ctx.state, n, ctx.authority))`.

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS. (The screens do not read `canEdit` yet, so nothing else changes.)

- [ ] **Step 6: Commit**

```bash
git add src/api
git commit -m "feat: add edit rights on posts and comments, and approval and tab links on notices" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 2: Pure helpers, test stubs and all plan 3 text

**Files:**
- Create: `src/lib/myWork.ts`, `src/lib/group.ts`, `src/lib/hours.ts`
- Modify: `src/lib/text.ts`, `src/lib/dates.ts`, `src/test/setup.ts`, `src/i18n/en.json`, `src/i18n/ar.json`, `src/i18n/keys.test.ts`
- Test: `src/lib/myWork.test.ts`, `src/lib/group.test.ts`, `src/lib/hours.test.ts`, `src/lib/text.test.ts`, `src/lib/dates.test.ts`

**Interfaces:**
- Consumes: `addDays`, `weekStartOf`, `TaskRow`.
- Produces: `WorkGroup`, `WORK_GROUPS`, `workGroupOf(row, today)`, `groupMyTasks(rows, today): { group; rows }[]`; `groupByDay<T>(items, dayOf): { day; items }[]`; `ParsedHours`, `parseHours(text)`, `hoursText(value)`; `Segment` gains `{ kind: 'project'; code: string }`; `formatWeekday(day, lang)`; jsdom stubs for `ResizeObserver` and `scrollIntoView` (cmdk needs both); every text key of this plan.

- [ ] **Step 1: Write the failing tests**

`src/lib/myWork.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask } from '../test/factories';
import { groupMyTasks, workGroupOf } from './myWork';

const TODAY = '2026-09-30'; // a Wednesday; the office week ends on Saturday 3 Oct
const row = (id: string, dueDate: string | null, overdue = false): TaskRow => ({
  task: makeTask({ id, dueDate }),
  owner: { id: 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower' },
  stage: { id: 'stg_002', name: 'Schematic Design' },
  commentCount: 0,
  fileCount: 0,
  overdue,
  canMove: true,
});

describe('My Work groups', () => {
  it('puts each task in one group', () => {
    expect(workGroupOf(row('tsk_001', '2026-09-25', true), TODAY)).toBe('overdue');
    expect(workGroupOf(row('tsk_002', '2026-09-28'), TODAY)).toBe('today');
    expect(workGroupOf(row('tsk_003', TODAY), TODAY)).toBe('today');
    expect(workGroupOf(row('tsk_004', '2026-10-03'), TODAY)).toBe('week');
    expect(workGroupOf(row('tsk_005', '2026-10-04'), TODAY)).toBe('later');
    expect(workGroupOf(row('tsk_006', null), TODAY)).toBe('none');
  });

  it('keeps the group order and leaves out empty groups', () => {
    const groups = groupMyTasks([row('tsk_006', null), row('tsk_001', '2026-09-25', true)], TODAY);
    expect(groups.map((group) => group.group)).toEqual(['overdue', 'none']);
  });
});
```

`src/lib/group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupByDay } from './group';

describe('groupByDay', () => {
  it('keeps the order and starts a new group when the day changes', () => {
    expect(groupByDay(['a1', 'a2', 'b1', 'a3'], (item) => item[0])).toEqual([
      { day: 'a', items: ['a1', 'a2'] },
      { day: 'b', items: ['b1'] },
      { day: 'a', items: ['a3'] },
    ]);
  });
});
```

`src/lib/hours.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hoursText, parseHours } from './hours';

describe('timesheet cells', () => {
  it('reads half-hour steps from 0 to 24 in other forms too', () => {
    expect(parseHours('')).toEqual({ ok: true, hours: 0 });
    expect(parseHours(' 7.5 ')).toEqual({ ok: true, hours: 7.5 });
    expect(parseHours('1,5')).toEqual({ ok: true, hours: 1.5 });
    expect(parseHours('٢')).toEqual({ ok: true, hours: 2 });
    expect(parseHours('٧٫٥')).toEqual({ ok: true, hours: 7.5 });
  });

  it('refuses other values', () => {
    for (const text of ['2.3', '25', 'abc', '-1', '1.25']) expect(parseHours(text)).toEqual({ ok: false });
  });

  it('shows 0 as an empty cell', () => {
    expect(hoursText(0)).toBe('');
    expect(hoursText(7.5)).toBe('7.5');
  });
});
```

Append to `src/lib/text.test.ts`, inside the `describe('mentions in posts', ...)` block:

```ts
  it('finds project links', () => {
    expect(segmentsOf('See #KH-26-014 and @[Sara Al-Qahtani](usr_005)')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'project', code: 'KH-26-014' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' },
    ]);
  });
```

Append to `src/lib/dates.test.ts` (add `formatWeekday` to its import):

```ts
describe('formatWeekday', () => {
  it('gives the short weekday name in both languages', () => {
    expect(formatWeekday('2026-09-27', 'en')).toBe('Sun');
    expect(formatWeekday('2026-09-27', 'ar')).toBe('الأحد');
  });
});
```

In `src/i18n/keys.test.ts`, add these keys to the list in "has the plan 2 groups" (and rename it "has the plan 2 and plan 3 groups"): `'work.group.review'`, `'hours.invalid'`, `'inbox.trigger.mention'`, `'comments.react'`, `'search.command.newTask'`.

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib src/i18n`
Expected: FAIL: `./myWork`, `./group`, `./hours` and `formatWeekday` do not exist, `segmentsOf` does not know project links, and the plan 3 keys are missing.

- [ ] **Step 3: Write the helpers**

`src/lib/myWork.ts`:

```ts
import type { TaskRow } from '../api/contract/views';
import { addDays, weekStartOf } from './dates';

export type WorkGroup = 'overdue' | 'today' | 'week' | 'later' | 'none';
export const WORK_GROUPS: WorkGroup[] = ['overdue', 'today', 'week', 'later', 'none'];

/** Spec 6.1: Overdue, Today, This week, Later and No date. A task in review is never overdue, so a past date shows under Today. */
export function workGroupOf(row: TaskRow, today: string): WorkGroup {
  if (row.overdue) return 'overdue';
  const due = row.task.dueDate;
  if (!due) return 'none';
  if (due <= today) return 'today';
  return due <= addDays(weekStartOf(today), 6) ? 'week' : 'later';
}

export function groupMyTasks(rows: TaskRow[], today: string): { group: WorkGroup; rows: TaskRow[] }[] {
  return WORK_GROUPS
    .map((group) => ({ group, rows: rows.filter((row) => workGroupOf(row, today) === group) }))
    .filter((group) => group.rows.length > 0);
}
```

`src/lib/group.ts`:

```ts
/** Groups items that are already in order by a day key. A new group starts each time the day changes. */
export function groupByDay<T>(items: T[], dayOf: (item: T) => string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayOf(item);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
```

`src/lib/hours.ts`:

```ts
const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export type ParsedHours = { ok: true; hours: number } | { ok: false };

/**
 * Reads a timesheet cell (spec 6.2): steps of 0.5 from 0 to 24. An empty cell is 0.
 * A comma or the Arabic decimal sign works as the decimal point, and Arabic-Indic digits work.
 */
export function parseHours(text: string): ParsedHours {
  const clean = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit)))
    .replace(/[,٫]/, '.');
  if (clean === '') return { ok: true, hours: 0 };
  if (!/^\d{1,2}(\.\d+)?$/.test(clean)) return { ok: false };
  const hours = Number(clean);
  if (hours > 24 || Math.round(hours * 2) !== hours * 2) return { ok: false };
  return { ok: true, hours };
}

/** The text of a cell: empty for 0, Western digits and a point otherwise, in both languages. */
export function hoursText(hours: number): string {
  return hours === 0 ? '' : String(hours);
}
```

In `src/lib/text.ts`, replace the `Segment` type and `segmentsOf` with:

```ts
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string; userId: string }
  | { kind: 'project'; code: string };

const TOKEN = /@\[([^\]]{1,80})\]\((usr_\d{3,})\)|#([A-Z]{1,4}-\d{2}-\d{3,})\b/g;

/** Splits a post into plain text, mentions and project links (spec 7.2), for display. */
export function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: body.slice(last, index) });
    out.push(match[3] ? { kind: 'project', code: match[3] } : { kind: 'mention', name: match[1], userId: match[2] });
    last = index + match[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}
```

Add to `src/lib/dates.ts`, after `formatMonth`:

```ts
/** The short weekday name, for the timesheet columns. */
export function formatWeekday(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short', timeZone: 'UTC' }).format(new Date(toMs(day)));
}
```

In `src/components/RichText.tsx`, the new segment kind needs a branch. Replace its body with:

```tsx
import { Fragment } from 'react';
import { Link } from 'react-router';
import { segmentsOf } from '../lib/text';

/** A post or a comment. It keeps its own text direction (spec 10.8), shows mentions as names and project codes as links. */
export function RichText({ body, className = '' }: { body: string; className?: string }) {
  return (
    <p dir="auto" className={`whitespace-pre-line break-words ${className}`}>
      {segmentsOf(body).map((segment, i) => {
        if (segment.kind === 'text') return <Fragment key={i}>{segment.text}</Fragment>;
        if (segment.kind === 'mention') return <span key={i} className="font-semibold text-accent">@{segment.name}</span>;
        return <Link key={i} to={`/projects/code/${segment.code}`} className="font-semibold text-accent underline-offset-2 hover:underline">#{segment.code}</Link>;
      })}
    </p>
  );
}
```

Add to `src/test/setup.ts`, after the blob URL lines:

```ts
// cmdk measures its list and scrolls the selected item into view. jsdom has neither.
if (!('ResizeObserver' in window)) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
```

- [ ] **Step 4: Add the text**

Merge the two blocks below into the language files with the same `node -e` merge command as plan 2 Task 2 Step 4 (save them as `madar-en.json` and `madar-ar.json` in the scratchpad first).

English additions:

```json
{
  "work": {
    "tabs": "My Work sections",
    "tab": { "tasks": "Tasks", "hours": "Hours" },
    "group": { "review": "Waiting for my review", "overdue": "Overdue", "today": "Today", "week": "This week", "later": "Later", "none": "No date" },
    "emptyTitle": "All clear",
    "empty": "You have no open tasks."
  },
  "hours": {
    "weekRange": "{{start}} to {{end}}",
    "previous": "Previous week",
    "next": "Next week",
    "thisWeek": "This week",
    "logged": "{{logged}} of {{target}} h",
    "copyLast": "Copy last week",
    "copied": "Last week's rows are added.",
    "addRow": "Add row",
    "addTitle": "Add a row",
    "project": "Project",
    "stage": "Stage",
    "task": "Task",
    "noTask": "No task",
    "rowAdded": "Row added.",
    "row": "Row",
    "removeRow": "Remove {{row}}",
    "cell": "Hours for {{row}} on {{day}}",
    "total": "Total",
    "dayTotal": "Day total",
    "showWeekend": "Show Friday and Saturday",
    "hideWeekend": "Hide Friday and Saturday",
    "locked": "This week is locked. Ask the Admin to unlock it.",
    "invalid": "Use steps of 0.5, from 0 to 24.",
    "emptyTitle": "No hours this week",
    "empty": "Add a row, or copy last week's rows."
  },
  "inbox": {
    "markAllRead": "Mark all read",
    "allRead": "All caught up.",
    "emptyTitle": "No notifications",
    "empty": "Assignments, mentions and reviews show here.",
    "today": "Today",
    "yesterday": "Yesterday",
    "unread": "Unread",
    "open": "Open",
    "approve": "Approve",
    "openTimesheet": "Open timesheet",
    "someone": "Someone",
    "trigger": {
      "task_assigned": "{{actor}} gave you “{{target}}”",
      "mention": "{{actor}} mentioned you in {{target}}",
      "due_tomorrow": "“{{target}}” is due tomorrow",
      "overdue": "“{{target}}” is overdue",
      "review_requested": "{{actor}} sent “{{target}}” to review",
      "task_approved": "{{actor}} approved “{{target}}”",
      "task_sent_back": "{{actor}} sent back “{{target}}”",
      "stage_changed": "{{actor}} changed the stage of {{target}}",
      "added_to_project": "{{actor}} added you to {{target}}",
      "week_under_target": "Your hours for the week of {{target}} are under target"
    }
  },
  "comments": {
    "title": "Comments",
    "show": "Comments: {{n}}",
    "start": "Comment",
    "hide": "Hide comments",
    "add": "Add a comment",
    "placeholder": "Write a comment. Type @ to mention someone.",
    "send": "Send",
    "edit": "Edit",
    "delete": "Delete",
    "deleted": "Comment deleted.",
    "save": "Save",
    "edited": "edited",
    "react": "React with {{emoji}}, {{n}}",
    "actions": "Actions for this comment",
    "empty": "No comments yet.",
    "cannot": "Only the project team can comment here."
  },
  "posts": {
    "actions": "Actions for this post",
    "edit": "Edit post",
    "delete": "Delete post",
    "deleted": "Post deleted.",
    "saved": "Post saved.",
    "editLabel": "Post text"
  },
  "search": {
    "label": "Search",
    "placeholder": "Search projects, tasks, people and files",
    "commands": "Commands",
    "projects": "Projects",
    "tasks": "Tasks",
    "people": "People",
    "files": "Files",
    "empty": "No results for “{{text}}”.",
    "command": { "newTask": "New task", "newProject": "New project", "logTime": "Log time", "dashboard": "Go to Dashboard", "myWork": "Go to My Work" }
  },
  "newTask": {
    "title": "New task",
    "project": "Project",
    "name": "Title",
    "stage": "Stage",
    "due": "Due date",
    "create": "Create task",
    "created": "Task created.",
    "open": "Open",
    "noProjects": "You are on no active project yet."
  },
  "person": { "projects": "Active projects", "leads": "Leader", "member": "Member", "none": "No active projects." }
}
```

Arabic additions (a draft for the native-speaker review):

```json
{
  "work": {
    "tabs": "أقسام عملي",
    "tab": { "tasks": "المهام", "hours": "الساعات" },
    "group": { "review": "بانتظار مراجعتي", "overdue": "متأخرة", "today": "اليوم", "week": "هذا الأسبوع", "later": "لاحقًا", "none": "بلا تاريخ" },
    "emptyTitle": "لا شيء معلّق",
    "empty": "لا توجد لديك مهام مفتوحة."
  },
  "hours": {
    "weekRange": "من {{start}} إلى {{end}}",
    "previous": "الأسبوع السابق",
    "next": "الأسبوع التالي",
    "thisWeek": "هذا الأسبوع",
    "logged": "{{logged}} من {{target}} س",
    "copyLast": "نسخ الأسبوع الماضي",
    "copied": "أُضيفت صفوف الأسبوع الماضي.",
    "addRow": "إضافة صف",
    "addTitle": "إضافة صف",
    "project": "المشروع",
    "stage": "المرحلة",
    "task": "المهمة",
    "noTask": "بلا مهمة",
    "rowAdded": "أُضيف الصف.",
    "row": "الصف",
    "removeRow": "حذف {{row}}",
    "cell": "ساعات {{row}} يوم {{day}}",
    "total": "المجموع",
    "dayTotal": "مجموع اليوم",
    "showWeekend": "إظهار الجمعة والسبت",
    "hideWeekend": "إخفاء الجمعة والسبت",
    "locked": "هذا الأسبوع مقفل. اطلب من مدير النظام فتحه.",
    "invalid": "استخدم خطوات من 0.5، من 0 إلى 24.",
    "emptyTitle": "لا توجد ساعات هذا الأسبوع",
    "empty": "أضف صفًا، أو انسخ صفوف الأسبوع الماضي."
  },
  "inbox": {
    "markAllRead": "تعليم الكل كمقروء",
    "allRead": "لا يوجد جديد.",
    "emptyTitle": "لا توجد إشعارات",
    "empty": "تظهر هنا المهام الموكلة إليك والإشارات والمراجعات.",
    "today": "اليوم",
    "yesterday": "أمس",
    "unread": "غير مقروء",
    "open": "فتح",
    "approve": "اعتماد",
    "openTimesheet": "فتح سجل الساعات",
    "someone": "شخص ما",
    "trigger": {
      "task_assigned": "{{actor}} أسند إليك «{{target}}»",
      "mention": "{{actor}} أشار إليك في {{target}}",
      "due_tomorrow": "موعد «{{target}}» غدًا",
      "overdue": "«{{target}}» متأخرة",
      "review_requested": "{{actor}} أرسل «{{target}}» للمراجعة",
      "task_approved": "{{actor}} اعتمد «{{target}}»",
      "task_sent_back": "{{actor}} أعاد «{{target}}» للتعديل",
      "stage_changed": "{{actor}} غيّر مرحلة {{target}}",
      "added_to_project": "{{actor}} أضافك إلى {{target}}",
      "week_under_target": "ساعاتك لأسبوع {{target}} أقل من المستهدف"
    }
  },
  "comments": {
    "title": "التعليقات",
    "show": "التعليقات: {{n}}",
    "start": "تعليق",
    "hide": "إخفاء التعليقات",
    "add": "أضف تعليقًا",
    "placeholder": "اكتب تعليقًا. اكتب @ للإشارة إلى شخص.",
    "send": "إرسال",
    "edit": "تعديل",
    "delete": "حذف",
    "deleted": "حُذف التعليق.",
    "save": "حفظ",
    "edited": "معدّل",
    "react": "تفاعل بـ {{emoji}}، {{n}}",
    "actions": "إجراءات هذا التعليق",
    "empty": "لا توجد تعليقات بعد.",
    "cannot": "التعليق هنا لفريق المشروع فقط."
  },
  "posts": {
    "actions": "إجراءات هذا المنشور",
    "edit": "تعديل المنشور",
    "delete": "حذف المنشور",
    "deleted": "حُذف المنشور.",
    "saved": "حُفظ المنشور.",
    "editLabel": "نص المنشور"
  },
  "search": {
    "label": "البحث",
    "placeholder": "ابحث في المشاريع والمهام والأشخاص والملفات",
    "commands": "الأوامر",
    "projects": "المشاريع",
    "tasks": "المهام",
    "people": "الأشخاص",
    "files": "الملفات",
    "empty": "لا توجد نتائج لـ «{{text}}».",
    "command": { "newTask": "مهمة جديدة", "newProject": "مشروع جديد", "logTime": "تسجيل الوقت", "dashboard": "الانتقال إلى لوحة المعلومات", "myWork": "الانتقال إلى عملي" }
  },
  "newTask": {
    "title": "مهمة جديدة",
    "project": "المشروع",
    "name": "العنوان",
    "stage": "المرحلة",
    "due": "تاريخ الاستحقاق",
    "create": "إنشاء المهمة",
    "created": "أُنشئت المهمة.",
    "open": "فتح",
    "noProjects": "لست في أي مشروع نشط بعد."
  },
  "person": { "projects": "المشاريع النشطة", "leads": "القائد", "member": "عضو", "none": "لا توجد مشاريع نشطة." }
}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/components/RichText.tsx src/test/setup.ts src/i18n
git commit -m "feat: add task groups, day groups, hour parsing, project links and the plan 3 text" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 3: The shared mention box and project links

**Files:**
- Create: `src/components/MentionField.tsx`, `src/features/project/ProjectByCode.tsx`
- Modify: `src/features/project/overview/Composer.tsx`, `src/app/routes.tsx`, `src/features/project/overview/OverviewTab.test.tsx`
- Test: `src/components/MentionField.test.tsx`, `src/features/project/ProjectByCode.test.tsx`

**Interfaces:**
- Consumes: `activeMention`, `normalizeForSearch`, `segmentsOf` (Task 2), `projects.list`.
- Produces: `MentionField({ id, label, value, onChange, people, onPick?, placeholder?, rows?, inputRef?, className? })` with the list id `<id>-mentions` and option ids `<id>-mentions-<userId>`; the route `/projects/code/:code`.

- [ ] **Step 1: Write the failing tests**

`src/components/MentionField.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { MentionField } from './MentionField';

beforeEach(() => {
  initI18n('en');
});

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });

function Harness() {
  const [value, setValue] = useState('');
  return <MentionField id="box" label="Box" value={value} onChange={setValue} people={[person('usr_005', 'Sara Al-Qahtani'), person('usr_007', 'Lina Mansour')]} />;
}

describe('the mention box', () => {
  it('picks a name with the arrow keys and Enter', async () => {
    render(<Harness />);
    const box = screen.getByRole('textbox', { name: 'Box' });
    await userEvent.type(box, 'Hi @');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', 'box-mentions-usr_007');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Hi @Lina Mansour ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes the list with Escape', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Box' }), '@Sa');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
```

`src/features/project/ProjectByCode.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('project links', () => {
  it('opens a project from its code', async () => {
    await renderApp('/projects/code/KH-26-003');
    expect(await screen.findByRole('heading', { level: 1, name: 'Eastern Shore Primary School' })).toBeInTheDocument();
  });

  it('says when no project has the code', async () => {
    await renderApp('/projects/code/KH-99-999');
    expect(await screen.findByText('This project does not exist anymore.')).toBeInTheDocument();
  });

  it('turns a project code in a post into a link', async () => {
    const { api } = await renderApp('/projects/prj_001', (state) => {
      state.session.currentUserId = 'usr_002';
    });
    await api.call('updates.create', { projectId: 'prj_001', body: 'Same facade as #KH-26-003' });
    await userEvent.click(await screen.findByRole('link', { name: '#KH-26-003' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Eastern Shore Primary School' })).toBeInTheDocument();
  });
});
```

In `src/features/project/overview/OverviewTab.test.tsx`, change `toHaveAttribute('aria-controls', 'mention-list')` to `toHaveAttribute('aria-controls', 'composer-mentions')`, because the shared box names its list after its own id.

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/components/MentionField.test.tsx src/features/project`
Expected: FAIL: `./MentionField` does not exist, the code route shows nothing, and the composer list id is still `mention-list`.

- [ ] **Step 3: Write the mention box and the code route**

`src/components/MentionField.tsx`:

```tsx
import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { activeMention, normalizeForSearch } from '../lib/text';
import { Avatar } from './Avatar';

/** A text box with an @mention picker (spec 5.2 and 7.2). The arrow keys move through the names, Enter picks one, Escape closes the list. */
export function MentionField({
  id, label, value, onChange, people, onPick, placeholder, rows = 3, inputRef, className = '',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  people: UserCard[];
  onPick?: (person: UserCard) => void;
  placeholder?: string;
  rows?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const { t } = useTranslation();
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const mention = activeMention(value, caret);
  const matches = mention
    ? people.filter((person) => normalizeForSearch(person.name).includes(normalizeForSearch(mention.query))).slice(0, 5)
    : [];
  const open = matches.length > 0 && dismissedAt !== mention?.start;
  const listId = `${id}-mentions`;

  const pick = (person: UserCard) => {
    if (!mention) return;
    const before = value.slice(0, mention.start);
    const insert = `@${person.name} `;
    const position = before.length + insert.length;
    onChange(before + insert + value.slice(caret));
    setCaret(position);
    setActive(0);
    onPick?.(person);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(matches[active] ?? matches[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(mention?.start ?? null);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        dir="auto"
        rows={rows}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setDismissedAt(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-control bg-fill px-3 py-2 text-body text-label placeholder:text-label-2"
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={t('overview.mentionList')} className="glass absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-2xl p-1.5 shadow-float">
          {matches.map((person, i) => (
            <li
              key={person.id}
              id={`${listId}-${person.id}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 ${i === active ? 'bg-fill' : ''}`}
            >
              <span aria-hidden><Avatar user={person} size={24} /></span>
              <bdi>{person.name}</bdi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Replace `src/features/project/overview/Composer.tsx` with:

```tsx
import { Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { ProjectDetail, UserCard } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { MentionField } from '../../../components/MentionField';
import { withMentionMarkup } from '../../../lib/text';

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<UserCard[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const me = session.data?.authority.id;
  const people = detail.members.map((member) => member.user).filter((person) => person.id !== me);

  useEffect(() => {
    if (params.get('compose') !== '1') return;
    area.current?.focus();
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('compose');
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const addFiles = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    setFiles((current) => [...current, ...chosen.filter((f) => f.size <= MAX_FILE_BYTES)]);
  };

  const post = async (event: FormEvent) => {
    event.preventDefault();
    const body = withMentionMarkup(text.trim(), picked);
    if (!body) return;
    const meta = { correlationId: newStoryId() };
    setPosting(true);
    try {
      const fileIds: string[] = [];
      for (const file of files) {
        const view = await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, stageId: detail.currentStage.id }, meta);
        fileIds.push(view.file.id);
      }
      await api.call('updates.create', { projectId: detail.project.id, body, fileIds }, meta);
      setText('');
      setPicked([]);
      setFiles([]);
      toast.show({ message: t('overview.posted') });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setPosting(false);
    }
  };

  return (
    <form onSubmit={post} aria-label={t('overview.composer')} className="surface flex flex-col gap-3 rounded-card p-4">
      <MentionField
        id="composer"
        label={t('overview.composer')}
        value={text}
        onChange={setText}
        people={people}
        onPick={(person) => setPicked((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]))}
        placeholder={t('overview.placeholder')}
        inputRef={area}
        className="[&_textarea]:min-h-24"
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-fill ps-3">
              <bdi className="text-footnote">{file.name}</bdi>
              <IconButton label={t('overview.removeFile', { name: file.name })} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                <X size={14} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <label className="pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-subheadline font-semibold text-accent hover:bg-fill">
          <Paperclip size={18} aria-hidden />
          {t('overview.attach')}
          <input
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
        <Button variant="primary" type="submit" disabled={!text.trim() || posting}>{t('overview.post')}</Button>
      </div>
    </form>
  );
}
```

`src/features/project/ProjectByCode.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';

/** "#KH-26-014" in a post or comment links here (spec 7.2). The screen finds the project by its code. */
export function ProjectByCode() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const list = useCall('projects.list', { status: 'all' });
  if (!list.data) return null;
  const match = list.data.find((summary) => summary.project.code === code);
  if (match) return <Navigate replace to={`/projects/${match.project.id}`} />;
  return (
    <>
      <ScreenTitle title={t('project.notFoundTitle')} />
      <EmptyState title={t('project.notFoundTitle')} body={t('project.notFound')} />
    </>
  );
}
```

In `src/app/routes.tsx`, import `ProjectByCode` and add `{ path: 'projects/code/:code', element: <ProjectByCode /> },` before the `projects/:projectId` route.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS, the plan 2 Overview tests included.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: share the mention box and link project codes in posts" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 4: Comments, reactions, and post edit and delete

**Files:**
- Create: `src/features/comments/CommentThread.tsx`
- Modify: `src/features/project/tasks/TaskSheet.tsx`, `src/features/project/overview/FeedEntry.tsx`, `src/features/project/overview/OverviewTab.tsx`
- Test: `src/features/comments/CommentThread.test.tsx`

**Interfaces:**
- Consumes: `CommentView.canEdit`, `FeedItem.canEdit` (Task 1), `MentionField`, `withMentionMarkup`, `plainText`, `REACTIONS`, `Menu`, `useUndoable`, `comments.*`, `reactions.toggle`, `updates.update`, `updates.delete`.
- Produces: `CommentThread({ targetType, targetId, people, canPost })`; `FeedEntry({ item, fileNames, people, canPost, startOpen })`. The Overview opens the thread of the post in `?update=<id>` and scrolls to it.

- [ ] **Step 1: Write the failing test**

`src/features/comments/CommentThread.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;

describe('comments', () => {
  it('adds a comment with a mention on a task', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Checked with @Kh');
    await userEvent.click(within(sheet).getByRole('option', { name: 'Khalid Al-Mutairi' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Checked with @[Khalid Al-Mutairi](usr_008)')).toBe(true));
    expect(await within(sheet).findByText('@Khalid Al-Mutairi')).toBeInTheDocument();
  });

  it('toggles a reaction', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const [like] = await within(sheet).findAllByRole('button', { name: /React with 👍/ });
    await userEvent.click(like);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👍'].includes('usr_006'))).toBe(true));
    await waitFor(() => expect(within(sheet).getAllByRole('button', { name: /React with 👍/ })[0]).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(sheet).getAllByRole('button', { name: /React with 👍/ })[0]);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👍'].includes('usr_006'))).toBe(false));
  });

  it('edits and deletes my own comment, with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'First draft');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByText('First draft');
    const mine = () => within(sheet).getByText(/First draft|Second draft/).closest('li') as HTMLElement;
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = within(mine()).getByRole('textbox', { name: 'Edit' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Second draft');
    await userEvent.click(within(mine()).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Second draft')).toBeInTheDocument();
    expect(within(mine()).getByText(/edited/)).toBeInTheDocument();
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(true));
  });

  it('shows a person outside the project the comments only', async () => {
    await renderApp(TASK('tsk_007'), as('usr_003'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /React with/ })).toBeNull();
  });

  it('opens the thread of the post in the link', async () => {
    await renderApp('/projects/prj_001?tab=overview&update=upd_002', as('usr_002'));
    expect(await screen.findByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('lets the author delete a post, then brings it back with Undo', async () => {
    const { store } = await renderApp('/projects/prj_001', as('usr_005'));
    const post = (await screen.findByText(/I uploaded revision B/)).closest('li') as HTMLElement;
    await userEvent.click(within(post).getByRole('button', { name: 'Actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeDefined());
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/comments`
Expected: FAIL: there is no comment box, and posts have no actions menu.

- [ ] **Step 3: Write the thread**

`src/features/comments/CommentThread.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REACTIONS } from '../../api/contract/entities';
import type { CommentView, UserCard } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { MentionField } from '../../components/MentionField';
import { Menu } from '../../components/Menu';
import { RichText } from '../../components/RichText';
import { plainText, withMentionMarkup } from '../../lib/text';

function CommentItem({ view, people, canPost }: { view: CommentView; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const { comment, author, canEdit } = view;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const update = useAction('comments.update', { onSuccess: () => setEditing(false) });
  const remove = useUndoable('comments.delete', { message: () => t('comments.deleted') });
  const react = useAction('reactions.toggle');
  const me = session.data?.user.id;
  return (
    <li className="flex gap-3">
      <Avatar user={author} size={28} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-footnote">
          <bdi className="font-semibold">{author.name}</bdi>
          {author.kind === 'agent' && <AgentLabel />}
          <span className="text-label-2">
            <Age stamp={comment.createdAt} />
            {comment.editedAt && ` · ${t('comments.edited')}`}
          </span>
        </p>
        {editing ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const body = withMentionMarkup(draft.trim(), people);
              if (body) update.mutate({ id: comment.id, body });
            }}
          >
            <MentionField id={`edit-${comment.id}`} label={t('comments.edit')} value={draft} onChange={setDraft} people={people} rows={2} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={!draft.trim() || update.isPending}>{t('comments.save')}</Button>
            </div>
          </form>
        ) : <RichText body={comment.body} className="text-subheadline" />}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {REACTIONS.map((emoji) => {
            const ids = comment.reactions[emoji];
            if (!canPost) {
              return ids.length > 0 ? (
                <span key={emoji} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-fill px-2 text-footnote">
                  <span aria-hidden>{emoji}</span>
                  <span className="tabular">{ids.length}</span>
                </span>
              ) : null;
            }
            const mine = me !== undefined && ids.includes(me);
            return (
              <button
                key={emoji}
                type="button"
                aria-pressed={mine}
                aria-label={t('comments.react', { emoji, n: ids.length })}
                onClick={() => react.mutate({ commentId: comment.id, emoji })}
                className={`pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-subheadline ${mine ? 'bg-fill-strong ring-1 ring-inset ring-accent' : 'bg-fill'}`}
              >
                <span aria-hidden>{emoji}</span>
                {ids.length > 0 && <span className="tabular text-footnote">{ids.length}</span>}
              </button>
            );
          })}
          {canEdit && !editing && (
            <Menu
              label={t('comments.actions')}
              items={[
                {
                  label: t('comments.edit'),
                  onSelect: () => {
                    setDraft(plainText(comment.body));
                    setEditing(true);
                  },
                },
                { label: t('comments.delete'), onSelect: () => remove.mutate({ id: comment.id }), destructive: true },
              ]}
            />
          )}
        </div>
      </div>
    </li>
  );
}

/** Comments on a task or a post (spec 7.2): @mentions, #project links, three reactions, and edit or delete for the author. */
export function CommentThread({
  targetType, targetId, people, canPost,
}: { targetType: 'task' | 'update'; targetId: string; people: UserCard[]; canPost: boolean }) {
  const { t } = useTranslation();
  const comments = useCall('comments.list', { targetType, targetId });
  const [body, setBody] = useState('');
  const create = useAction('comments.create', { onSuccess: () => setBody('') });
  const list = comments.data ?? [];
  return (
    <section aria-label={t('comments.title')} className="flex flex-col gap-3">
      <h3 className="text-headline">{t('comments.title')}</h3>
      {comments.data && list.length === 0 && <p className="text-footnote text-label-2">{t('comments.empty')}</p>}
      {list.length > 0 && (
        <ol className="flex flex-col gap-3">
          {list.map((view) => <CommentItem key={view.comment.id} view={view} people={people} canPost={canPost} />)}
        </ol>
      )}
      {canPost ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = withMentionMarkup(body.trim(), people);
            if (text) create.mutate({ targetType, targetId, body: text });
          }}
        >
          <MentionField id={`comment-${targetId}`} label={t('comments.add')} value={body} onChange={setBody} people={people} placeholder={t('comments.placeholder')} rows={2} />
          <Button variant="primary" type="submit" className="self-end" disabled={!body.trim() || create.isPending}>{t('comments.send')}</Button>
        </form>
      ) : <p className="text-footnote text-label-2">{t('comments.cannot')}</p>}
    </section>
  );
}
```

- [ ] **Step 4: Put the thread on tasks and posts**

In `src/features/project/tasks/TaskSheet.tsx`, import `CommentThread` from `../../comments/CommentThread` and replace the line `<p className="text-footnote text-label-2">{t('taskSheet.comments', { n: data.commentCount })}</p>` with:

```tsx
      <CommentThread targetType="task" targetId={task.id} people={people} canPost={detail.viewerCan.post} />
```

Replace `src/features/project/overview/FeedEntry.tsx` with:

```tsx
import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeedItem, UserCard } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { MentionField } from '../../../components/MentionField';
import { Menu } from '../../../components/Menu';
import { RichText } from '../../../components/RichText';
import { plainText, withMentionMarkup } from '../../../lib/text';
import { CommentThread } from '../../comments/CommentThread';
import { feedText } from '../../projects/feed';

type PostItem = Extract<FeedItem, { kind: 'update' }>;

function PostCard({ item, fileNames, people, canPost, startOpen }: {
  item: PostItem; fileNames: Map<string, string>; people: UserCard[]; canPost: boolean; startOpen: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ref = useRef<HTMLLIElement>(null);
  const [showComments, setShowComments] = useState(startOpen);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const save = useAction('updates.update', {
    onSuccess: () => {
      setEditing(false);
      toast.show({ message: t('posts.saved') });
    },
  });
  const remove = useUndoable('updates.delete', { message: () => t('posts.deleted') });
  useEffect(() => {
    if (startOpen) ref.current?.scrollIntoView({ block: 'center' });
  }, [startOpen]);
  const commentLabel = showComments ? t('comments.hide') : item.commentCount > 0 ? t('comments.show', { n: item.commentCount }) : t('comments.start');
  return (
    <li ref={ref} className="surface flex flex-col gap-2 rounded-card p-4">
      <div className="flex items-center gap-3">
        <Avatar user={item.author} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <bdi className="truncate font-semibold">{item.author.name}</bdi>
            {item.author.kind === 'agent' && <AgentLabel />}
          </p>
          <p className="text-caption text-label-2">
            <Age stamp={item.at} />
            {item.editedAt && <> · {t('overview.edited')}</>}
          </p>
        </div>
        {item.canEdit && !editing && (
          <Menu
            label={t('posts.actions')}
            items={[
              {
                label: t('posts.edit'),
                onSelect: () => {
                  setDraft(plainText(item.body));
                  setEditing(true);
                },
              },
              { label: t('posts.delete'), onSelect: () => remove.mutate({ id: item.id }), destructive: true },
            ]}
          />
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = withMentionMarkup(draft.trim(), people);
            if (body) save.mutate({ id: item.id, body });
          }}
        >
          <MentionField id={`post-${item.id}`} label={t('posts.editLabel')} value={draft} onChange={setDraft} people={people} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" type="submit" disabled={!draft.trim() || save.isPending}>{t('comments.save')}</Button>
          </div>
        </form>
      ) : <RichText body={item.body} className="text-body" />}
      {item.fileIds.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {item.fileIds.map((id) => (
            <li key={id} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-footnote">
              <Paperclip size={14} aria-hidden />
              <bdi>{fileNames.get(id) ?? id}</bdi>
            </li>
          ))}
        </ul>
      )}
      <Button variant="plain" className="self-start px-0" aria-expanded={showComments} onClick={() => setShowComments((open) => !open)}>{commentLabel}</Button>
      {showComments && <CommentThread targetType="update" targetId={item.id} people={people} canPost={canPost} />}
    </li>
  );
}

/** A post as a card with its comments, or a system event as one quiet line (spec 5.2 and 7.2). */
export function FeedEntry({ item, fileNames, people, canPost, startOpen }: {
  item: FeedItem; fileNames: Map<string, string>; people: UserCard[]; canPost: boolean; startOpen: boolean;
}) {
  const { t } = useTranslation();
  if (item.kind === 'update') return <PostCard item={item} fileNames={fileNames} people={people} canPost={canPost} startOpen={startOpen} />;
  return (
    <li className="flex items-center gap-3 px-1">
      <Avatar user={item.author} size={28} />
      <p className="min-w-0 flex-1 text-subheadline">
        <bdi className="font-semibold">{item.author.name}</bdi>{' '}
        {item.author.kind === 'agent' && <><AgentLabel />{' '}</>}
        <span className="text-label-2">{feedText(item, t)}</span>
      </p>
      <span className="text-caption text-label-2"><Age stamp={item.at} /></span>
    </li>
  );
}
```

In `src/features/project/overview/OverviewTab.tsx`, add `import { useSearchParams } from 'react-router';`, read `const [params] = useSearchParams();` and `const openUpdate = params.get('update');` in `OverviewTab`, and change the feed item line to:

```tsx
          : <ol className="flex flex-col gap-3">{(feed.data ?? []).map((item) => (
            <FeedEntry
              key={item.id}
              item={item}
              fileNames={fileNames}
              people={detail.members.map((member) => member.user)}
              canPost={detail.viewerCan.post}
              startOpen={item.id === openUpdate}
            />
          ))}</ol>}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features
git commit -m "feat: add comments with mentions and reactions, and post edit and delete with Undo" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 5: My Work, the Tasks tab

**Files:**
- Create: `src/features/work/WorkScreen.tsx`, `src/features/work/WorkTasks.tsx`, `src/features/work/tabs.tsx`
- Modify: `src/features/project/tasks/TaskRowItem.tsx`, `src/features/project/tasks/TaskSheet.tsx`, `src/app/routes.tsx`
- Test: `src/features/work/WorkTasks.test.tsx`

**Interfaces:**
- Consumes: `groupMyTasks` (Task 2), `TaskRowItem`, `TaskSheet`, `Tabs`, `tasks.list` with `filter: 'mine'` and `'review_for_me'`, `projects.get`.
- Produces: `WorkScreen()` at `/work` with `?tab=tasks|hours`; `WORK_TAB_BODY` (Task 6 fills `hours`); `TaskRowItem({ row, onOpen, showProject? })`; `ProjectTaskSheet({ projectId, taskId, onClose })`. My Work opens a task with `?task=<id>&project=<id>`.

- [ ] **Step 1: Write the failing test**

`src/features/work/WorkTasks.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('My Work tasks', () => {
  it('groups my open tasks by date', async () => {
    await renderApp('/work', as('usr_005'));
    expect(within(await screen.findByRole('region', { name: 'Today' })).getByText('Toilet details')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Later' })).getByText('Civil Defense drawings')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Waiting for my review' })).toBeNull();
  });

  it('shows a leader the tasks that wait for their review first', async () => {
    await renderApp('/work', as('usr_002'));
    const review = await screen.findByRole('region', { name: 'Waiting for my review' });
    expect(within(review).getByText('Toilet details')).toBeInTheDocument();
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toBe(review);
  });

  it('ticks a task from My Work', async () => {
    const { store } = await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Civil Defense drawings' }));
    expect(await screen.findByText('Sent to review. The leader checks it next.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_review');
  });

  it('opens the task panel in place', async () => {
    await renderApp('/work', as('usr_005'));
    await userEvent.click(await screen.findByRole('button', { name: /Civil Defense drawings/ }));
    expect(await screen.findByRole('dialog', { name: 'Civil Defense drawings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
  });

  it('says when there is nothing open', async () => {
    await renderApp('/work', (state) => {
      state.session.currentUserId = 'usr_005';
      for (const task of Object.values(state.tasks)) task.status = 'done';
    });
    expect(await screen.findByText('You have no open tasks.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/work`
Expected: FAIL: `/work` still shows the placeholder.

- [ ] **Step 3: Write the screen**

In `src/features/project/tasks/TaskRowItem.tsx`, add `showProject = false` to the props (`{ row, onOpen, showProject = false }: { row: TaskRow; onOpen: (taskId: string) => void; showProject?: boolean }`) and replace the last child `<Avatar user={row.owner} size={28} />` with:

```tsx
      {showProject
        ? <span className="tabular shrink-0 pe-2 text-footnote text-label-2">{row.project.code}</span>
        : <Avatar user={row.owner} size={28} />}
```

Add to the end of `src/features/project/tasks/TaskSheet.tsx`:

```tsx
/** The task panel outside its project screen, for example over My Work. */
export function ProjectTaskSheet({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const detail = useCall('projects.get', { id: projectId });
  if (!detail.data) return null;
  return <TaskSheet taskId={taskId} detail={detail.data} onClose={onClose} />;
}
```

`src/features/work/tabs.tsx`:

```tsx
import type { ComponentType } from 'react';

export const WORK_TABS = ['tasks', 'hours'] as const;
export type WorkTab = (typeof WORK_TABS)[number];

/** The body of each My Work tab. Task 6 fills in the Hours tab. */
export const WORK_TAB_BODY: Record<WorkTab, ComponentType | null> = {
  tasks: null,
  hours: null,
};
```

`src/features/work/WorkTasks.tsx`:

```tsx
import { AnimatePresence } from 'motion/react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { EmptyState } from '../../components/EmptyState';
import { todayISO } from '../../lib/dates';
import { groupMyTasks } from '../../lib/myWork';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { TaskRowItem } from '../project/tasks/TaskRowItem';

function TaskGroup({ id, title, rows, onOpen }: { id: string; title: string; rows: TaskRow[]; onOpen: (row: TaskRow) => void }) {
  return (
    <section aria-labelledby={`work-${id}`} className="surface overflow-hidden rounded-card pb-2">
      <h2 id={`work-${id}`} className="px-4 pb-1 pt-3 text-headline">{title}</h2>
      <ul>
        <AnimatePresence initial={false}>
          {rows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => onOpen(row)} showProject />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

/** My open tasks from all projects, by date, with the leader's review queue first (spec 6.1). */
export function WorkTasks() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mine = useCall('tasks.list', { filter: 'mine', includeDone: false });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
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
  if (!mine.data || !review.data) return null;
  const groups = groupMyTasks(mine.data, todayISO());
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="flex flex-col gap-5">
      {review.data.length > 0 && <TaskGroup id="review" title={t('work.group.review')} rows={review.data} onOpen={open} />}
      {groups.length === 0 && review.data.length === 0
        ? <EmptyState title={t('work.emptyTitle')} body={t('work.empty')} />
        : groups.map((group) => <TaskGroup key={group.group} id={group.group} title={t(`work.group.${group.group}`)} rows={group.rows} onOpen={open} />)}
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
```

`src/features/work/WorkScreen.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import { WORK_TAB_BODY, WORK_TABS, type WorkTab } from './tabs';
import { WorkTasks } from './WorkTasks';

/** My tasks from all projects, and my timesheet (spec 6). The tab lives in the link. */
export function WorkScreen() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: WorkTab = WORK_TABS.includes(raw as WorkTab) ? (raw as WorkTab) : 'tasks';
  const Hours = WORK_TAB_BODY.hours;
  let body = <WorkTasks />;
  if (tab === 'hours') body = Hours ? <Hours /> : <EmptyState title={t('work.tab.hours')} body={t('project.comingSoon')} />;
  return (
    <div className="flex flex-col gap-4">
      <ScreenTitle title={t('screens.myWork')} />
      <Tabs label={t('work.tabs')} value={tab} idPrefix="work" onChange={(next) => setParams({ tab: next })} options={WORK_TABS.map((value) => ({ value, label: t(`work.tab.${value}`) }))} />
      <TabPanel value={tab} idPrefix="work">{body}</TabPanel>
    </div>
  );
}
```

In `src/app/routes.tsx`, import `WorkScreen` and change the `work` route to `{ path: 'work', element: <WorkScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add My Work with task groups, the review queue and the task panel in place" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 6: My Work, the Hours tab

**Files:**
- Create: `src/features/work/HoursTab.tsx`, `src/features/work/AddRowSheet.tsx`
- Modify: `src/features/work/tabs.tsx`, `src/features/project/tasks/TaskSheet.tsx`
- Test: `src/features/work/HoursTab.test.tsx`

**Interfaces:**
- Consumes: `parseHours`, `hoursText` (Task 2), `formatWeekday`, `usePersistentChoice`, `time.week`, `time.set`, `time.addRow`, `time.removeRow`, `time.copyLastWeek`, `projects.list` (with `viewerCan.logTime`), `tasks.list`.
- Produces: `HoursTab()` as `WORK_TAB_BODY.hours`; `AddRowSheet({ open, onOpenChange, weekStart })`. The link `/work?tab=hours&week=<Sunday>` opens a week; `/work?tab=hours&project=<id>&stage=<id>&task=<id>` adds that row to this week and puts the cursor in today's cell. The task sheet's "Log time" uses that link.

- [ ] **Step 1: Write the failing test**

`src/features/work/HoursTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const HOURS = '/work?tab=hours';
const LAST = '/work?tab=hours&week=2026-09-20';
const cells = () => screen.findAllByRole('textbox', { name: /^Hours for / });

describe('the Hours tab', () => {
  it('shows this week with row, day and week totals against the target', async () => {
    await renderApp(HOURS, asSara);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText(/of 40 h$/)).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Day total' })).toBeInTheDocument();
  });

  it('says when a week has no rows', async () => {
    await renderApp(HOURS, (state) => {
      asSara(state);
      for (const [id, entry] of Object.entries(state.time)) if (entry.userId === 'usr_005') delete state.time[id];
    });
    expect(await screen.findByText('No hours this week')).toBeInTheDocument();
  });

  it('saves a cell with Enter, and reads a comma as the decimal point', async () => {
    const { store } = await renderApp(LAST, asSara);
    const [first] = await cells();
    await userEvent.clear(first);
    await userEvent.type(first, '7,5{Enter}');
    await waitFor(() => expect(Object.values(store.state.time).some((e) => e.userId === 'usr_005' && e.date === '2026-09-20' && e.hours === 7.5)).toBe(true));
  });

  it('refuses a value off the half-hour steps and saves nothing', async () => {
    const { store } = await renderApp(LAST, asSara);
    const before = JSON.stringify(store.state.time);
    const [first] = await cells();
    await userEvent.clear(first);
    await userEvent.type(first, '2.3{Enter}');
    expect(await screen.findByText('Use steps of 0.5, from 0 to 24.')).toBeInTheDocument();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(JSON.stringify(store.state.time)).toBe(before);
  });

  it('locks a week that ended more than 14 days ago', async () => {
    await renderApp('/work?tab=hours&week=2026-08-30', asSara);
    expect(await screen.findByText('This week is locked. Ask the Admin to unlock it.')).toBeInTheDocument();
    for (const cell of await cells()) expect(cell).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
  });

  it('keeps Friday and Saturday folded until asked', async () => {
    await renderApp(LAST, asSara);
    await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader')).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: 'Show Friday and Saturday' }));
    expect(screen.getAllByRole('columnheader')).toHaveLength(10);
  });

  it('adds a row, then removes it while it is empty', async () => {
    const { store } = await renderApp(HOURS, asSara);
    await userEvent.click(await screen.findByRole('button', { name: 'Add row' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a row' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Project'), 'KH-26-001 · Corniche Office Tower');
    await userEvent.selectOptions(within(sheet).getByLabelText('Stage'), 'Permits');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add row' }));
    const remove = await screen.findByRole('button', { name: 'Remove KH-26-001 · Permits' });
    expect(Object.values(store.state.timeRows).some((row) => row.userId === 'usr_005' && row.stageId === 'stg_005')).toBe(true);
    await userEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove KH-26-001 · Permits' })).toBeNull());
  });

  it("copies last week's rows", async () => {
    await renderApp(HOURS, asSara);
    await userEvent.click(await screen.findByRole('button', { name: 'Copy last week' }));
    expect(await screen.findByText("Last week's rows are added.")).toBeInTheDocument();
  });

  it("opens this week from a task's Log time, with the cursor in today's cell", async () => {
    await renderApp('/projects/prj_001?tab=tasks&task=tsk_012', asSara);
    const sheet = await screen.findByRole('dialog', { name: 'Civil Defense drawings' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Log time' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
    const today = await screen.findByRole('textbox', { name: 'Hours for KH-26-001 · Permits · Civil Defense drawings on 30 September 2026' });
    await waitFor(() => expect(today).toHaveFocus());
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/work/HoursTab.test.tsx`
Expected: FAIL: the Hours tab shows the "arrives later" note.

- [ ] **Step 3: Write the timesheet**

`src/features/work/AddRowSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';

/** A new timesheet row: a project, a stage and, when the person wants, a task (spec 6.2). */
export function AddRowSheet({ open, onOpenChange, weekStart }: { open: boolean; onOpenChange: (open: boolean) => void; weekStart: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const options = (projects.data ?? []).filter((summary) => summary.viewerCan.logTime);
  const [projectId, setProjectId] = useState('');
  const [stageId, setStageId] = useState('');
  const [taskId, setTaskId] = useState('');
  const tasks = useCall('tasks.list', { projectId: projectId || undefined, includeDone: false });
  const summary = options.find((option) => option.project.id === projectId);
  const stageTasks = (tasks.data ?? []).filter((row) => row.task.projectId === projectId && row.task.stageId === stageId);
  const add = useAction('time.addRow', {
    onSuccess: () => {
      toast.show({ message: t('hours.rowAdded') });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setStageId('');
    setTaskId('');
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('hours.addTitle')}
      footer={(
        <Button variant="primary" disabled={!projectId || !stageId || add.isPending} onClick={() => add.mutate({ weekStart, projectId, stageId, taskId: taskId || null })}>
          {t('hours.addRow')}
        </Button>
      )}
    >
      <div className="flex flex-col gap-4 pt-1">
        <SelectField
          id="row-project"
          label={t('hours.project')}
          value={projectId}
          onChange={(event) => {
            const id = event.target.value;
            setProjectId(id);
            setStageId(options.find((option) => option.project.id === id)?.currentStage.id ?? '');
            setTaskId('');
          }}
        >
          <option value="" disabled>{t('hours.project')}</option>
          {options.map((option) => <option key={option.project.id} value={option.project.id}>{`${option.project.code} · ${option.project.name}`}</option>)}
        </SelectField>
        <SelectField
          id="row-stage"
          label={t('hours.stage')}
          value={stageId}
          disabled={!summary}
          onChange={(event) => {
            setStageId(event.target.value);
            setTaskId('');
          }}
        >
          {(summary?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </SelectField>
        <SelectField id="row-task" label={t('hours.task')} value={taskId} disabled={!summary} onChange={(event) => setTaskId(event.target.value)}>
          <option value="">{t('hours.noTask')}</option>
          {stageTasks.map((row) => <option key={row.task.id} value={row.task.id}>{row.task.title}</option>)}
        </SelectField>
      </div>
    </Sheet>
  );
}
```

`src/features/work/HoursTab.tsx`:

```tsx
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { usePersistentChoice } from '../../app/choices';
import { useLang } from '../../app/lang';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { addDays, formatDay, formatNumber, formatWeekday, todayISO, weekStartOf } from '../../lib/dates';
import { hoursText, parseHours } from '../../lib/hours';
import { AddRowSheet } from './AddRowSheet';

type WeekRow = CallOutput<'time.week'>['rows'][number];
type Focus = { projectId: string; stageId: string; taskId: string | null };

const WEEKEND = ['hide', 'show'] as const;

function HoursCell({ row, day, value, disabled, label, focus }: {
  row: WeekRow; day: string; value: number; disabled: boolean; label: string; focus: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(hoursText(value));
  const [invalid, setInvalid] = useState(false);
  const save = useAction('time.set');
  useEffect(() => {
    setText(hoursText(value));
    setInvalid(false);
  }, [value]);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const commit = () => {
    const parsed = parseHours(text);
    if (!parsed.ok) {
      setInvalid(true);
      toast.show({ tone: 'error', message: t('hours.invalid') });
      return;
    }
    setInvalid(false);
    if (parsed.hours !== value) {
      save.mutate({ projectId: row.project.id, stageId: row.stage.id, taskId: row.task?.id ?? null, date: day, hours: parsed.hours });
    }
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      dir="ltr"
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit();
      }}
      className="tabular min-h-11 w-14 rounded-control bg-fill px-1 text-center text-body text-label aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-red disabled:bg-transparent disabled:text-label-2"
    />
  );
}

/** The weekly timesheet: rows are project and stage pairs, the columns are the days, Sunday to Thursday (spec 6.2). */
export function HoursTab() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const current = weekStartOf(today);
  const raw = params.get('week');
  const weekStart = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? weekStartOf(raw) : current;
  const week = useCall('time.week', { weekStart });
  const [weekend, setWeekend] = usePersistentChoice('madar.hours.weekend', WEEKEND, 'hide');
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const copy = useAction('time.copyLastWeek', { onSuccess: () => toast.show({ message: t('hours.copied') }) });
  const addRow = useAction('time.addRow');
  const removeRow = useAction('time.removeRow');
  const go = (next: string) => setParams((currentParams) => {
    const nextParams = new URLSearchParams(currentParams);
    nextParams.set('tab', 'hours');
    nextParams.set('week', next);
    return nextParams;
  });

  // "Log time" on a task opens this tab with the task's project, stage and task (plan clarification 3).
  useEffect(() => {
    const projectId = params.get('project');
    const stageId = params.get('stage');
    if (!projectId || !stageId) return;
    const taskId = params.get('task') || null;
    addRow.mutate({ weekStart: current, projectId, stageId, taskId }, { onSuccess: () => setFocus({ projectId, stageId, taskId }) });
    setParams((currentParams) => {
      const next = new URLSearchParams(currentParams);
      next.delete('project');
      next.delete('stage');
      next.delete('task');
      next.set('tab', 'hours');
      next.set('week', current);
      return next;
    }, { replace: true });
    // The link runs once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!week.data) return null;
  const view = week.data;
  const weekendHours = view.dayTotals[5] + view.dayTotals[6] > 0;
  const showWeekend = weekend === 'show' || weekendHours;
  const columns = showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
  const labelOf = (row: WeekRow) => [row.project.code, row.stage.name, row.task?.title].filter(Boolean).join(' · ');
  const percent = view.target > 0 ? Math.min(100, (view.weekTotal / view.target) * 100) : 0;
  const isFocus = (row: WeekRow) => focus !== null && row.project.id === focus.projectId && row.stage.id === focus.stageId && (row.task?.id ?? null) === focus.taskId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton label={t('hours.previous')} onClick={() => go(addDays(weekStart, -7))}>
          <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        </IconButton>
        <p className="tabular text-headline">{t('hours.weekRange', { start: formatDay(view.days[0], lang), end: formatDay(view.days[6], lang) })}</p>
        <IconButton label={t('hours.next')} disabled={weekStart >= current} onClick={() => go(addDays(weekStart, 7))}>
          <ChevronRight size={20} className="rtl:-scale-x-100" aria-hidden />
        </IconButton>
        {weekStart !== current && <Button variant="plain" onClick={() => go(current)}>{t('hours.thisWeek')}</Button>}
        <div className="ms-auto flex min-w-48 flex-col gap-1">
          <p className="tabular text-footnote text-label-2">{t('hours.logged', { logged: formatNumber(view.weekTotal, lang, 1), target: formatNumber(view.target, lang) })}</p>
          <div className="h-2 overflow-hidden rounded-full bg-fill">
            <div style={{ width: `${percent}%` }} className={`h-full rounded-full ${view.weekTotal >= view.target ? 'bg-green' : 'bg-accent-fill'}`} />
          </div>
        </div>
      </div>
      {view.locked && <p role="status" className="rounded-2xl bg-fill p-3 text-footnote">{t('hours.locked')}</p>}
      {view.rows.length === 0 ? <EmptyState title={t('hours.emptyTitle')} body={t('hours.empty')} /> : (
        <div className="surface overflow-x-auto rounded-card">
          <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-subheadline">
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 z-10 bg-card p-3 text-start font-semibold">{t('hours.row')}</th>
                {columns.map((i) => {
                  const day = view.days[i];
                  return (
                    <th key={day} scope="col" className={`p-2 text-center font-medium ${day === today ? 'text-accent' : 'text-label-2'}`}>
                      <span className="block text-caption">{formatWeekday(day, lang)}</span>
                      <span className="tabular">{Number(day.slice(8))}</span>
                    </th>
                  );
                })}
                <th scope="col" className="p-2 text-center font-medium text-label-2">{t('hours.total')}</th>
                <th scope="col"><span className="sr-only">{t('common.remove')}</span></th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => {
                const label = labelOf(row);
                return (
                  <tr key={row.key}>
                    <th scope="row" className="sticky start-0 z-10 max-w-56 bg-card p-3 text-start font-normal">
                      <span className="tabular block text-footnote text-label-2">{row.project.code}</span>
                      <bdi className="block truncate">{[row.stage.name, row.task?.title].filter(Boolean).join(' · ')}</bdi>
                    </th>
                    {columns.map((i) => {
                      const day = view.days[i];
                      return (
                        <td key={day} className="p-1 text-center">
                          <HoursCell
                            row={row}
                            day={day}
                            value={row.hours[i]}
                            disabled={view.locked || day > today}
                            label={t('hours.cell', { row: label, day: formatDay(day, lang, 'long') })}
                            focus={day === today && isFocus(row)}
                          />
                        </td>
                      );
                    })}
                    <td className="tabular p-2 text-center font-semibold">{formatNumber(row.total, lang, 1)}</td>
                    <td className="p-1">
                      {row.pinned && row.total === 0 && !view.locked && (
                        <IconButton label={t('hours.removeRow', { row: label })} onClick={() => removeRow.mutate({ weekStart, rowKey: row.key })}>
                          <X size={16} aria-hidden />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="sticky start-0 z-10 bg-card p-3 text-start">{t('hours.dayTotal')}</th>
                {columns.map((i) => <td key={i} className="tabular p-2 text-center text-label-2">{formatNumber(view.dayTotals[i], lang, 1)}</td>)}
                <td className="tabular p-2 text-center font-bold">{formatNumber(view.weekTotal, lang, 1)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!view.locked && (
          <>
            <Button onClick={() => setAdding(true)}>
              <Plus size={18} aria-hidden />
              {t('hours.addRow')}
            </Button>
            <Button disabled={copy.isPending} onClick={() => copy.mutate({ weekStart })}>{t('hours.copyLast')}</Button>
          </>
        )}
        <Button variant="plain" disabled={weekendHours} onClick={() => setWeekend(showWeekend ? 'hide' : 'show')}>
          {showWeekend ? t('hours.hideWeekend') : t('hours.showWeekend')}
        </Button>
      </div>
      <AddRowSheet open={adding} onOpenChange={setAdding} weekStart={weekStart} />
    </div>
  );
}
```

In `src/features/work/tabs.tsx`, add `import { HoursTab } from './HoursTab';` and set `hours: HoursTab,`.

In `src/features/project/tasks/TaskSheet.tsx`, change the Log time button's click to:

```tsx
onClick={() => navigate(`/work?tab=hours&project=${task.projectId}&stage=${task.stageId}&task=${task.id}`)}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features
git commit -m "feat: add the weekly timesheet with totals, lock, rows and Log time" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 7: The Inbox

**Files:**
- Create: `src/features/inbox/InboxScreen.tsx`
- Modify: `src/app/routes.tsx`
- Test: `src/features/inbox/InboxScreen.test.tsx`

**Interfaces:**
- Consumes: `NotificationView` with `link` and `canApprove` (Task 1), `groupByDay` (Task 2), `notifications.list`, `notifications.markRead`, `notifications.markAllRead`, `tasks.approve`, `useIsPhone`.
- Produces: `InboxScreen()` at `/inbox`.

- [ ] **Step 1: Write the failing test**

`src/features/inbox/InboxScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

type Notice = State['notifications'][string];

const notice = (id: string, trigger: Notice['trigger'], targetType: Notice['targetType'], targetId: string, createdAt: string, actorId: string | null = 'usr_002'): Notice => ({
  id, userId: '', trigger, actorId, targetType, targetId, read: false, createdAt, dedupeKey: null,
});

const withNotices = (userId: string, list: Notice[]) => (state: State) => {
  state.session.currentUserId = userId;
  for (const [id, n] of Object.entries(state.notifications)) if (n.userId === userId) delete state.notifications[id];
  for (const n of list) state.notifications[n.id] = { ...n, userId };
};

const TODAY_8 = '2026-09-30T08:00:00.000+03:00';
const TODAY_7 = '2026-09-30T07:00:00.000+03:00';
const YESTERDAY = '2026-09-29T16:00:00.000+03:00';

const itemWith = (text: RegExp) => screen.getByText(text).closest('li') as HTMLElement;

describe('the Inbox', () => {
  it('groups notices by day and writes one sentence for each', async () => {
    await renderApp('/inbox', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_902', 'mention', 'update', 'upd_001', TODAY_7),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi gave you “Civil Defense drawings”')).toBeInTheDocument();
    expect(screen.getByText('Faisal Al-Harbi mentioned you in Corniche Office Tower')).toBeInTheDocument();
    expect(screen.getByText('“Toilet details” is overdue')).toBeInTheDocument();
  });

  it('marks a notice read when it opens, and goes to the task', async () => {
    const { store } = await renderApp('/inbox', withNotices('usr_005', [notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8)]));
    await screen.findByText(/gave you/);
    await userEvent.click(within(itemWith(/gave you/)).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(store.state.notifications.ntf_901.read).toBe(true));
    expect(window.location.hash).toContain('tab=tasks&task=tsk_012');
  });

  it('marks all read', async () => {
    const { store } = await renderApp('/inbox', withNotices('usr_005', [
      notice('ntf_901', 'task_assigned', 'task', 'tsk_012', TODAY_8),
      notice('ntf_903', 'overdue', 'task', 'tsk_010', YESTERDAY, null),
    ]));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('All caught up.')).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.userId === 'usr_005').every((n) => n.read)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('lets the leader approve from the Inbox while the task waits', async () => {
    const { store } = await renderApp('/inbox', withNotices('usr_002', [notice('ntf_904', 'review_requested', 'task', 'tsk_010', TODAY_8, 'usr_005')]));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull());
  });

  it('opens the timesheet from a week reminder', async () => {
    await renderApp('/inbox', withNotices('usr_005', [notice('ntf_905', 'week_under_target', 'week', '2026-09-20', TODAY_8, null)]));
    expect(await screen.findByText(/week of 20 September 2026 are under target/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open timesheet' }));
    await waitFor(() => expect(window.location.hash).toContain('week=2026-09-20'));
  });

  it('says when there is nothing', async () => {
    await renderApp('/inbox', withNotices('usr_005', []));
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/inbox`
Expected: FAIL: `/inbox` shows the placeholder.

- [ ] **Step 3: Write the Inbox**

`src/features/inbox/InboxScreen.tsx`:

```tsx
import { Bell } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { CallOutput } from '../../api/calls';
import { useLang } from '../../app/lang';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { useIsPhone } from '../../app/useIsPhone';
import { Age } from '../../components/Age';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { addDays, formatDay, stampDay, todayISO } from '../../lib/dates';
import { groupByDay } from '../../lib/group';

type NoticeView = CallOutput<'notifications.list'>[number];

function InboxItem({ view }: { view: NoticeView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { notification: n, actor, target, projectCode, link, canApprove } = view;
  const markRead = useAction('notifications.markRead');
  const approve = useAction('tasks.approve', { onSuccess: () => toast.show({ message: t('taskSheet.approved') }) });
  const read = () => {
    if (!n.read) markRead.mutate({ ids: [n.id] });
  };
  const sentence = t(`inbox.trigger.${n.trigger}`, {
    actor: actor?.name ?? t('inbox.someone'),
    target: n.trigger === 'week_under_target' ? formatDay(target, lang, 'long') : target,
  });
  return (
    <motion.li
      drag={phone ? 'x' : false}
      dragSnapToOrigin
      onDragEnd={(_event, info) => {
        // A swipe to either side marks the item read (plan clarification 7).
        if (Math.abs(info.offset.x) > 80) read();
      }}
      className="flex flex-wrap items-start gap-3 bg-card px-4 py-3"
    >
      <span aria-hidden className={`mt-3 size-2.5 shrink-0 rounded-full ${n.read ? '' : 'bg-accent-fill'}`} />
      {actor
        ? <Avatar user={actor} size={36} />
        : <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-label-2"><Bell size={16} aria-hidden /></span>}
      <div className="min-w-48 flex-1">
        <p className={`text-subheadline ${n.read ? 'text-label-2' : 'font-medium text-label'}`}>
          {!n.read && <span className="sr-only">{t('inbox.unread')}: </span>}
          {sentence}
        </p>
        <p className="text-footnote text-label-2">
          {projectCode && <span className="tabular">{projectCode} · </span>}
          <Age stamp={n.createdAt} />
        </p>
      </div>
      <div className="ms-auto flex gap-2">
        {canApprove && (
          <Button
            variant="primary"
            disabled={approve.isPending}
            onClick={() => {
              approve.mutate({ id: n.targetId });
              read();
            }}
          >
            {t('inbox.approve')}
          </Button>
        )}
        <Button
          onClick={() => {
            read();
            navigate(link);
          }}
        >
          {n.trigger === 'week_under_target' ? t('inbox.openTimesheet') : t('inbox.open')}
        </Button>
      </div>
    </motion.li>
  );
}

/** My notifications by day, with an unread dot and one action each (spec 7.1). */
export function InboxScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const list = useCall('notifications.list', {});
  const markAll = useAction('notifications.markAllRead', { onSuccess: () => toast.show({ message: t('inbox.allRead') }) });
  const today = todayISO();
  const dayLabel = (day: string) => (day === today ? t('inbox.today') : day === addDays(today, -1) ? t('inbox.yesterday') : formatDay(day, lang, 'long'));
  const items = list.data ?? [];
  const unread = items.some((view) => !view.notification.read);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title={t('screens.inbox')} />
        {unread && <Button className="shrink-0" onClick={() => markAll.mutate({})}>{t('inbox.markAllRead')}</Button>}
      </div>
      {list.data && items.length === 0 && <EmptyState title={t('inbox.emptyTitle')} body={t('inbox.empty')} />}
      <div className="flex flex-col gap-5">
        {groupByDay(items, (view) => stampDay(view.notification.createdAt)).map((group) => (
          <section key={group.day} aria-labelledby={`inbox-${group.day}`}>
            <h2 id={`inbox-${group.day}`} className="pb-2 text-headline">{dayLabel(group.day)}</h2>
            <ul className="surface flex flex-col divide-y divide-separator overflow-hidden rounded-card">
              {group.items.map((view) => <InboxItem key={view.notification.id} view={view} />)}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
```

In `src/app/routes.tsx`, import `InboxScreen` and change the `inbox` route to `{ path: 'inbox', element: <InboxScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add the Inbox with day groups, actions, Approve and mark all read" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 8: Search and commands

**Files:**
- Create: `src/features/search/SearchScreen.tsx`, `src/features/search/NewTaskSheet.tsx`, `src/features/search/PersonSheet.tsx`, `src/app/useDebounced.ts`
- Modify: `src/app/routes.tsx`
- Test: `src/features/search/SearchScreen.test.tsx`

**Interfaces:**
- Consumes: `search.query`, `projects.list`, `users.get`, `tasks.create`, `NewProjectSheet`, cmdk `Command`.
- Produces: `SearchScreen()` at `/search` (the Search tab on phones, Ctrl+K on desktop); `NewTaskSheet({ open, onOpenChange })`; `PersonSheet({ person, onClose })`; `useDebounced(value, ms)`.

- [ ] **Step 1: Write the failing test**

`src/features/search/SearchScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const asSara = (state: State) => {
  state.session.currentUserId = 'usr_005';
};
const box = () => screen.findByRole('combobox');

describe('search', () => {
  it('finds a project in capital letters and opens it with Enter', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'CORNICHE');
    expect(await screen.findByRole('option', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
  });

  it('shows tasks and files in their own groups', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'ground floor');
    const tasks = await screen.findByRole('group', { name: 'Tasks' });
    expect(within(tasks).getAllByRole('option', { name: /Ground floor plan/ }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('group', { name: 'Files' })).getAllByRole('option', { name: /Ground floor plan\.pdf/ }).length).toBeGreaterThan(0);
  });

  it('runs a command', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'dash');
    await userEvent.click(await screen.findByRole('option', { name: 'Go to Dashboard' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dashboard'));
  });

  it('creates a task from the New task command', async () => {
    const { store } = await renderApp('/search', asSara);
    await userEvent.click(await screen.findByRole('option', { name: 'New task' }));
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Project'), 'KH-26-001 · Corniche Office Tower');
    await userEvent.type(within(sheet).getByLabelText('Title'), 'Fire exit check');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Task created.')).toBeInTheDocument();
    expect(Object.values(store.state.tasks).some((task) => task.title === 'Fire exit check' && task.ownerId === 'usr_005' && task.stageId === 'stg_004')).toBe(true);
  });

  it('opens a person with their active projects', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'sara');
    await userEvent.click(await screen.findByRole('option', { name: /Sara Al-Qahtani/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sara Al-Qahtani' });
    expect(within(sheet).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    await renderApp('/search');
    await userEvent.type(await box(), 'zzzz');
    expect(await screen.findByText('No results for “zzzz”.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/search`
Expected: FAIL: `/search` shows the placeholder.

- [ ] **Step 3: Write search**

`src/app/useDebounced.ts`:

```ts
import { useEffect, useState } from 'react';

/** The value after it stops changing for a moment, so a search does not run on every key press. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
```

`src/features/search/NewTaskSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField, TextField } from '../../components/Fields';
import { Sheet } from '../../components/Sheet';

/** The "New task" command: a task for me on one of my projects, in its current stage unless I pick another. */
export function NewTaskSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const options = (projects.data ?? []).filter((summary) => summary.viewerCan.createTaskForSelf);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [stageId, setStageId] = useState('');
  const [due, setDue] = useState('');
  const summary = options.find((option) => option.project.id === projectId);
  const create = useAction('tasks.create', {
    onSuccess: (detail) => {
      onOpenChange(false);
      toast.show({
        message: t('newTask.created'),
        action: { label: t('newTask.open'), run: () => navigate(`/projects/${detail.task.projectId}?tab=tasks&task=${detail.task.id}`) },
      });
    },
  });

  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setTitle('');
    setStageId('');
    setDue('');
  }, [open]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('newTask.title')}
      footer={(
        <Button
          variant="primary"
          disabled={!projectId || !title.trim() || create.isPending}
          onClick={() => create.mutate({ projectId, title: title.trim(), stageId: stageId || undefined, dueDate: due || null })}
        >
          {t('newTask.create')}
        </Button>
      )}
    >
      {projects.data && options.length === 0 ? <p className="text-subheadline text-label-2">{t('newTask.noProjects')}</p> : (
        <div className="flex flex-col gap-4 pt-1">
          <SelectField
            id="new-task-project"
            label={t('newTask.project')}
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setStageId(options.find((option) => option.project.id === event.target.value)?.currentStage.id ?? '');
            }}
          >
            <option value="" disabled>{t('newTask.project')}</option>
            {options.map((option) => <option key={option.project.id} value={option.project.id}>{`${option.project.code} · ${option.project.name}`}</option>)}
          </SelectField>
          <TextField id="new-task-title" label={t('newTask.name')} value={title} dir="auto" onChange={(event) => setTitle(event.target.value)} />
          <SelectField id="new-task-stage" label={t('newTask.stage')} value={stageId} disabled={!summary} onChange={(event) => setStageId(event.target.value)}>
            {(summary?.stages ?? []).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
          <TextField id="new-task-due" type="date" label={t('newTask.due')} value={due} onChange={(event) => setDue(event.target.value)} />
        </div>
      )}
    </Sheet>
  );
}
```

`src/features/search/PersonSheet.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { Avatar } from '../../components/Avatar';
import { Sheet } from '../../components/Sheet';

/** A person from search: their discipline, email and active projects (plan clarification 8). */
export function PersonSheet({ person, onClose }: { person: UserCard; onClose: () => void }) {
  const { t } = useTranslation();
  const user = useCall('users.get', { id: person.id });
  const projects = useCall('projects.list', { status: 'active', sort: 'name' });
  const theirs = (projects.data ?? []).filter((summary) => summary.leader?.id === person.id || summary.team.some((member) => member.id === person.id));
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={person.name} description={person.discipline}>
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex items-center gap-3">
          <Avatar user={person} size={56} />
          {user.data && <p dir="ltr" className="break-all text-subheadline text-label-2">{user.data.email}</p>}
        </div>
        <section className="flex flex-col gap-1">
          <h3 className="text-headline">{t('person.projects')}</h3>
          {projects.data && theirs.length === 0 ? <p className="text-footnote text-label-2">{t('person.none')}</p> : (
            <ul>
              {theirs.map((summary) => (
                <li key={summary.project.id}>
                  <Link to={`/projects/${summary.project.id}`} onClick={onClose} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
                    <span className="tabular text-footnote text-label-2">{summary.project.code}</span>
                    <bdi className="min-w-0 flex-1 truncate">{summary.project.name}</bdi>
                    <span className="text-footnote text-label-2">{summary.leader?.id === person.id ? t('person.leads') : t('person.member')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
```

`src/features/search/SearchScreen.tsx`:

```tsx
import { Command } from 'cmdk';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { UserCard } from '../../api/contract/views';
import { useCall } from '../../app/runtime';
import { useDebounced } from '../../app/useDebounced';
import { Avatar } from '../../components/Avatar';
import { ScreenTitle } from '../../components/ScreenTitle';
import { normalizeForSearch } from '../../lib/text';
import { NewProjectSheet } from '../projects/NewProjectSheet';
import { NewTaskSheet } from './NewTaskSheet';
import { PersonSheet } from './PersonSheet';

const GROUP = 'flex flex-col [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-footnote [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-label-2';

function Item({ value, onSelect, children }: { value: string; onSelect: () => void; children: ReactNode }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-body data-[selected=true]:bg-fill">
      {children}
    </Command.Item>
  );
}

function Results({ query, onPerson }: { query: string; onPerson: (person: UserCard) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const results = useCall('search.query', { text: query });
  if (!results.data) return null;
  const { projects, tasks, people, files } = results.data;
  if (projects.length + tasks.length + people.length + files.length === 0) {
    return <p className="px-3 py-2 text-subheadline text-label-2">{t('search.empty', { text: query })}</p>;
  }
  return (
    <>
      {projects.length > 0 && (
        <Command.Group heading={t('search.projects')} className={GROUP}>
          {projects.map((p) => (
            <Item key={p.id} value={`project-${p.id}`} onSelect={() => navigate(`/projects/${p.id}`)}>
              <span className="tabular text-footnote text-label-2">{p.code}</span>
              <bdi>{p.name}</bdi>
            </Item>
          ))}
        </Command.Group>
      )}
      {tasks.length > 0 && (
        <Command.Group heading={t('search.tasks')} className={GROUP}>
          {tasks.map((task) => (
            <Item key={task.id} value={`task-${task.id}`} onSelect={() => navigate(`/projects/${task.projectId}?tab=tasks&task=${task.id}`)}>
              <bdi className="min-w-0 flex-1 truncate">{task.title}</bdi>
              <span className="tabular text-footnote text-label-2">{task.projectCode}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {people.length > 0 && (
        <Command.Group heading={t('search.people')} className={GROUP}>
          {people.map((person) => (
            <Item key={person.id} value={`person-${person.id}`} onSelect={() => onPerson(person)}>
              <span aria-hidden><Avatar user={person} size={24} /></span>
              <bdi className="min-w-0 flex-1 truncate">{person.name}</bdi>
              <span className="text-footnote text-label-2">{person.discipline}</span>
            </Item>
          ))}
        </Command.Group>
      )}
      {files.length > 0 && (
        <Command.Group heading={t('search.files')} className={GROUP}>
          {files.map((file) => (
            <Item key={file.id} value={`file-${file.id}`} onSelect={() => navigate(`/projects/${file.projectId}?tab=files`)}>
              <bdi className="min-w-0 flex-1 truncate">{file.name}</bdi>
              <span className="tabular text-footnote text-label-2">{file.projectCode}</span>
            </Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

/** Search for projects, tasks, people and files, and commands (spec 7.3). The arrow keys move, Enter opens. */
export function SearchScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 150);
  const [sheet, setSheet] = useState<'task' | 'project' | null>(null);
  const [person, setPerson] = useState<UserCard | null>(null);
  const commands = [
    { id: 'new-task', label: t('search.command.newTask'), run: () => setSheet('task') },
    { id: 'new-project', label: t('search.command.newProject'), run: () => setSheet('project') },
    { id: 'log-time', label: t('search.command.logTime'), run: () => navigate('/work?tab=hours') },
    { id: 'dashboard', label: t('search.command.dashboard'), run: () => navigate('/dashboard') },
    { id: 'my-work', label: t('search.command.myWork'), run: () => navigate('/work') },
  ].filter((command) => !text.trim() || normalizeForSearch(command.label).includes(normalizeForSearch(text)));
  return (
    <>
      <ScreenTitle title={t('screens.search')} />
      <Command label={t('search.label')} shouldFilter={false} className="flex flex-col gap-3">
        <Command.Input
          autoFocus
          value={text}
          onValueChange={setText}
          placeholder={t('search.placeholder')}
          className="min-h-12 w-full rounded-2xl bg-fill px-4 text-body text-label placeholder:text-label-2"
        />
        <Command.List className="surface flex flex-col gap-2 rounded-card p-2">
          {commands.length > 0 && (
            <Command.Group heading={t('search.commands')} className={GROUP}>
              {commands.map((command) => <Item key={command.id} value={`command-${command.id}`} onSelect={command.run}>{command.label}</Item>)}
            </Command.Group>
          )}
          {query && <Results query={query} onPerson={setPerson} />}
        </Command.List>
      </Command>
      <NewTaskSheet open={sheet === 'task'} onOpenChange={(open) => { if (!open) setSheet(null); }} />
      <NewProjectSheet open={sheet === 'project'} onOpenChange={(open) => { if (!open) setSheet(null); }} />
      {person && <PersonSheet person={person} onClose={() => setPerson(null)} />}
    </>
  );
}
```

In `src/app/routes.tsx`, import `SearchScreen` and change the `search` route to `{ path: 'search', element: <SearchScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add search with grouped results, commands, a New task sheet and a person sheet" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 9: Browser sweep and the review link

**Files:**
- Create: `tests/e2e/work.spec.ts`
- Modify: the review wrapper `index.html` in the session scratchpad and the progress page status

**Interfaces:**
- Consumes: the whole app.
- Produces: a green sweep, screenshots, and the review link with the plan 3 screens.

- [ ] **Step 1: Write the browser sweep**

`tests/e2e/work.spec.ts`:

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

const SCREENS: { name: string; path: string; ready: (page: Page) => Promise<void> }[] = [
  { name: 'work', path: '/#/work', ready: async (page) => { await expect(page.getByRole('region').first()).toBeVisible(); } },
  { name: 'hours', path: '/#/work?tab=hours', ready: async (page) => { await expect(page.getByRole('table')).toBeVisible(); } },
  { name: 'inbox', path: '/#/inbox', ready: async (page) => { await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); } },
  { name: 'search', path: '/#/search', ready: async (page) => { await page.getByRole('combobox').fill('a'); await expect(page.getByRole('option').first()).toBeVisible(); } },
  { name: 'task-comments', path: '/#/projects/prj_001?tab=tasks&task=tsk_007', ready: async (page) => { await expect(page.getByRole('dialog')).toBeVisible(); } },
];

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`personal work screens at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        await screen.ready(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `test-results/work/${width}-${lang}-${screen.name}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('hours typed in a cell stay after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/work?tab=hours');
  await page.getByRole('button', { name: 'Previous week' }).click();
  const cell = page.getByRole('textbox', { name: /^Hours for / }).first();
  await cell.fill('7.5');
  await cell.press('Enter');
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page.getByRole('textbox', { name: /^Hours for / }).first()).toHaveValue('7.5');
});

test('Ctrl+K opens search, and Enter opens the project', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('article').first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('corniche');
  await expect(page.getByRole('option', { name: /Corniche Office Tower/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeVisible();
});

test('Mark all read clears the Inbox badge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/inbox');
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  if (await markAll.isVisible()) await markAll.click();
  await expect(page.getByRole('navigation').first().getByText(/items need action/)).toHaveCount(0);
});
```

- [ ] **Step 2: Run the browser sweep in a subagent**

Delegate to one subagent (Playwright always runs in a subagent). Command: `npx playwright test tests/e2e --reporter=line`, run twice at the end. The subagent fixes only test-side mistakes, lists them, and reports every app defect with its assertion or axe rule and target, plus the paths of four screenshots (1440 English hours, 1440 Arabic inbox, 390 English search, 390 Arabic task comments).
Expected: all tests pass. Fix each app defect in the main session, with a failing unit test first when a unit test can show it.

- [ ] **Step 3: Look at the screens**

Read the four screenshots. Check: the timesheet scrolls sideways on a phone with the row names pinned, the Inbox reads well in Arabic, the search groups have headings, and comments sit well in the task panel.

- [ ] **Step 4: Publish the review link and the progress page**

Build, point the review wrapper at the new `dist/assets` file names, and publish it to the same path (new files added, old ones set to `null`). Update the progress page status (build step 3 done) and publish it.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/work.spec.ts TASKS.md
git commit -m "test: add the browser sweep for My Work, the Inbox, comments and search" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```
