# Madar Plan 2 of 5: Projects screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Projects grid, the project card, the New Project sheet and the Project screen with its five tabs (Overview, Tasks, Schedule, Files, Team) on top of the plan 1 foundation, and publish them on the same review link.

**Architecture:** Screens stay thin. They read through `useCall` and change data through `useAction` or the new `useUndoable` hook, which gives every action its own story ID so the Undo toast can call `events.undoStory` and reverse the whole action. Permission checks stay in the API: every summary and detail carries `viewerCan`, and each task row carries `canMove`, so a screen only hides what the API says the viewer may not do. Pure helpers (ages, chart math, mention markup, form checks, board keys) live in `src/lib` and carry the unit tests. Sheets use Vaul: a side panel on the end side on desktop, a bottom sheet on phones.

**Tech Stack:** as plan 1 (TypeScript 7.0.2, React 19.3.0, Vite 8.3.1, React Router 8.4.0, Tailwind CSS 4.3.3, zod 4.6.5, TanStack Query 5.104.0, i18next 26.4.2, Motion 13.4.6), plus the already installed vaul 1.1.2 and @dnd-kit/core 6.3.1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-madar-prototype-design.md` (sections 4 and 5; 10 for design; 11.5 and 11.6 for undo and errors).

**Base:** branch `plan-2-projects`, cut from `plan-1-foundation` at `a8d9240` (plan 1 with its review fixes).

## Global Constraints

- Every rule in plan 1's Global Constraints still applies: exact versions, office dates only through `src/lib/dates.ts`, IDs only from `nextId()`, screens reach data only through `api.call` hooks, logical CSS only (`npm run check:rtl`), all visible text in `en.json` and `ar.json`, only `transform` and `opacity` animate, WCAG 2.2 AA contrast, `text-label-3` never for text, Simplified Technical English with no em-dash character, commits `git commit -m "<type>: <summary>" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"` with no Co-Authored-By line, `TASKS.md` in step with this plan.
- A screen never decides a permission. It shows an action only when `viewerCan`, `canMove` or `TaskDetail.viewerCan` from the API allows it.
- Every change that has an Undo toast goes through `useUndoable` (Task 5). The toast undoes the whole action through `events.undoStory`.
- UI state that a link must keep (the tab, the open task, the composer) lives in the URL search params: `?tab=`, `?task=`, `?compose=1`. Per-viewer choices (grid or list, board or list, sort) live in `localStorage` through `usePersistentChoice`, inside try and catch.
- Every tap target is at least 44 by 44 px (`min-h-11`, `size-11`).
- User text (names, titles, posts) renders with `dir="auto"` on its own block, or inside `<bdi>` when it sits inside an interface sentence.
- Tests render the whole app over the sample office with `renderApp(path, prepare)`. "As a person" means `prepare` sets `state.session.currentUserId`.
- The sample office facts the tests use: Hala Nasser `usr_001` (Admin), Faisal Al-Harbi `usr_002`, Reem Al-Ghamdi `usr_003`, Omar Haddad `usr_004`, Sara Al-Qahtani `usr_005`, Yousef Saleh `usr_006`, Lina Mansour `usr_007`, Khalid Al-Mutairi `usr_008`, Madar Assistant `usr_009` (agent for Hala). Project `prj_001` "Corniche Office Tower" (`KH-26-001`, client Gulf Crest Holding, leader Faisal, team Sara, Yousef, Khalid, current stage `stg_004` Construction Documents, Late, cover `fil_001`). Its open tasks: `tsk_007` Stair details (Yousef, in progress, due 25 Sep, overdue), `tsk_008` Structural drawings check (Khalid, flagged), `tsk_009` Specifications draft (Faisal), `tsk_010` Toilet details (Sara, in review), `tsk_011` Balady submission set (Faisal, Permits), `tsk_012` Civil Defense drawings (Sara, Permits, needs review), `tsk_013` Coordination meeting notes (Yousef). Its deadlines: Client presentation 25 Sep, Stage submission 27 Sep, Coordination workshop 5 Oct, Balady submission 7 Oct. Its files: Cover render.svg, Massing view.svg, Ground floor plan.pdf (versions A and B), Site plan.pdf, Facade study.svg, all in Construction Documents. Sara has 33.5 hours on it in September. `prj_005` Tamr Boutique Hotel has no cover. `prj_009` Gulf Crest HQ Interiors is On hold, `prj_010` Dune Line Show Villa is Completed. 2 projects are Late and 3 are At risk.

**Clarifications of the spec made in this plan.** Tell the owner about these at handoff.

1. "New Project" sits at the end of the Projects title row, which is the Projects screen's own toolbar. The global toolbar stays the same on every screen.
2. On desktop, sheets open as a side panel on the end side (right in English, left in Arabic). New Project, Edit project, Change leader, Delete and file preview dim the page. The task panel does not dim the page (spec 10.1). On phones, all sheets are bottom sheets.
3. The card-to-screen shared-element motion and the toolbar shrink come in plan 5, as the plan series says.
4. Comments and reactions come in plan 3. In this plan, the task sheet and posts show the comment count only.
5. One Undo toast undoes the whole action. Example: "Delete file" also brings back the project cover when that file was the cover.
6. "Change leader" has no Undo toast, because the old leader loses the right to undo it (plan 1 review finding 1). A second "Change leader" puts it back.
7. "Remove from team" shows only for people with no open tasks on the project, because the API refuses the others.
8. "Log time" in the task sheet opens My Work, which plan 3 builds.
9. "Download" works in the local app. The review link cannot download files, because its frame blocks downloads.
10. The agent's weekly summaries now say "in N days" instead of a fixed date, so they stay true after the date shift. This corrects a plan 1 review ruling.

## Review Focus

1. **A person without the right sees no dead buttons.** A member on another project, the agent, or a member looking at someone else's task. Expected: only the actions the API allows, and a "View only" label on a project they cannot change. Tests: Task 6 (card menu), Task 9 (header menu and label), Task 11 (tick is disabled), Task 14 (no drag handles), Task 16 (no hours, no menus).
2. **Arabic time runs from right to left.** A drag or an arrow key on the schedule, and an arrow key on the board. Expected: the end-side direction always means later or forward. Tests: Task 2 (`dayDelta` and `nextColumn` with `rtl`).
3. **Undo after someone changed the item again.** Expected: the Undo toast reports "This item changed after that edit. Undo is not available." and changes nothing. Test: Task 5.
4. **Projects with missing data.** No cover, no leader, no stage dates, no deadlines. Expected: a tinted panel with the code, "No leader", and an empty state with one sentence. Tests: Task 6 and Task 14.
5. **A file over 25 MB, and the same file name twice.** Expected: a clear message before any upload, and version B for the second upload. Test: Task 15.

## File Map

| File | Responsibility |
|---|---|
| `src/api/contract/views.ts`, `src/api/views.ts` | `viewerRole`, `viewerCan`, `healthSetBy` on summaries; `hoursThisMonth` on members; `canMove` on task rows |
| `src/api/handlers/projects.ts` | `projects.update` accepts `coverFileId` |
| `src/api/handlers/history.ts` | `events.undoStory` |
| `src/data/seed.ts` | Agent summaries with relative days |
| `src/lib/age.ts`, `src/lib/schedule.ts`, `src/lib/board.ts`, `src/lib/text.ts` | Pure helpers for ages, the chart, board keys, mentions |
| `src/features/projects/projectForm.ts` | Project form checks |
| `src/i18n/*.json`, `src/i18n/keys.test.ts` | All plan 2 text, and a test that every literal `t()` key exists |
| `src/components/*` | Chip group, fields, health pill, stage rail, avatar stack, age, rich text, agent label, icon button, sheet, menu, popover, tabs |
| `src/app/useIsPhone.ts`, `src/app/lang.ts`, `src/app/choices.ts`, `src/app/actions.ts`, `src/app/files.ts` | Screen size, language, stored choices, `useUndoable`, file URLs and downloads |
| `src/features/projects/*` | Projects screen, card, row, card menu, feed text, project form and sheets |
| `src/features/project/*` | Project screen, header, header controls, and one folder per tab |
| `tests/e2e/projects.spec.ts` | Browser sweep for this plan (run by a subagent) |

---

### Task 1: API additions for the Projects screens

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/views.ts`, `src/api/handlers/projects.ts`, `src/api/handlers/tasks.ts`, `src/api/handlers/history.ts`, `src/data/seed.ts`
- Test: `src/api/handlers/projects.test.ts`, `src/api/handlers/tasks.test.ts`, `src/api/handlers/history.test.ts`, `src/data/seed.test.ts`

**Interfaces:**
- Consumes: plan 1 `can`, `projectRoleOf`, `undoEvent`, `summaryOf`, `detailOf`, `taskRowOf`.
- Produces: `ProjectSummary.viewerRole: 'leader' | 'team' | 'other'`, `ProjectSummary.viewerCan: ViewerCan`, `ProjectSummary.healthSetBy: UserCard | null`, `ProjectDetail.members[].hoursThisMonth: number | null`, `TaskRow.canMove: boolean`, `summaryOf(state, project, today, viewer)`, `taskRowOf(state, task, today, viewer)`, the call `events.undoStory({ correlationId }) → { undone: EventView[] }`, `projects.update` patch field `coverFileId: string | null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/handlers/projects.test.ts` (add `setNow`, `NOW` and `STAMP` to its imports if they are missing):

```ts
describe('plan 2 additions', () => {
  beforeEach(() => setNow(NOW));

  it("gives each project summary the viewer's role and rights", async () => {
    const t = testApi(projectCalls);
    t.as('usr_004');
    const [outside] = await t.api.call('projects.list', {});
    expect(outside.viewerRole).toBe('other');
    expect(outside.viewerCan.archive).toBe(false);
    t.as('usr_002');
    const [led] = await t.api.call('projects.list', {});
    expect(led.viewerRole).toBe('leader');
    expect(led.viewerCan.archive).toBe(true);
  });

  it('names the person who set the health by hand', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client delay' });
    const [summary] = await t.api.call('projects.list', {});
    expect(summary.healthSetBy?.name).toBe('Faisal Leader');
  });

  it("shows this month's hours only to people who may see them", async () => {
    const t = testApi(projectCalls);
    const entry = { projectId: 'prj_001', stageId: 'stg_002', taskId: null };
    t.store.state.time.tim_001 = { ...entry, id: 'tim_001', userId: 'usr_003', date: '2026-09-14', hours: 6 };
    t.store.state.time.tim_002 = { ...entry, id: 'tim_002', userId: 'usr_003', date: '2026-08-31', hours: 5 };
    t.store.state.time.tim_003 = { ...entry, id: 'tim_003', userId: 'usr_002', date: '2026-09-15', hours: 4 };
    const hours = async (viewer: string) => {
      t.as(viewer);
      const detail = await t.api.call('projects.get', { id: 'prj_001' });
      return Object.fromEntries(detail.members.map((m) => [m.user.id, m.hoursThisMonth]));
    };
    expect(await hours('usr_002')).toEqual({ usr_002: 4, usr_003: 6 });
    expect(await hours('usr_003')).toEqual({ usr_002: null, usr_003: 6 });
    expect(await hours('usr_004')).toEqual({ usr_002: null, usr_003: null });
    expect(await hours('usr_001')).toEqual({ usr_002: 4, usr_003: 6 });
  });

  it('sets a project image as the cover and refuses other files', async () => {
    const t = testApi(projectCalls);
    const version = { letter: 'A', blobKey: 'blob_1', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP };
    t.store.state.files.fil_001 = {
      id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Render.png', versions: [{ ...version, mimeType: 'image/png' }],
    };
    t.store.state.files.fil_002 = {
      id: 'fil_002', projectId: 'prj_001', stageId: null, taskId: null, name: 'Plan.pdf', versions: [{ ...version, mimeType: 'application/pdf' }],
    };
    t.as('usr_002');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { coverFileId: 'fil_002' } })).rejects.toMatchObject({ code: 'invalid_input' });
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { coverFileId: 'fil_001' } });
    expect(detail.project.coverFileId).toBe('fil_001');
  });
});
```

Append to `src/api/handlers/tasks.test.ts`:

```ts
describe('task rows for the viewer', () => {
  it('tells the viewer which rows they may move', async () => {
    const t = testApi(taskCalls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002' });
    t.as('usr_003');
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(Object.fromEntries(rows.map((row) => [row.task.id, row.canMove]))).toEqual({ tsk_001: true, tsk_002: false });
  });
});
```

Append to `src/api/handlers/history.test.ts` (add `import { fileCalls } from './files';` and `STAMP` to the factory import):

```ts
describe('undo of a whole story', () => {
  const image = {
    id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Render.png',
    versions: [{ letter: 'A', blobKey: 'blob_1', mimeType: 'image/png', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP }],
  };

  it('undoes every change of one story, newest first', async () => {
    const t = testApi({ ...calls, ...fileCalls });
    t.store.state.files.fil_001 = structuredClone(image);
    t.store.state.projects.prj_001.coverFileId = 'fil_001';
    t.as('usr_002');
    await t.api.call('files.delete', { id: 'fil_001' }, { correlationId: 'cor_ui_story1' });
    expect(t.store.state.projects.prj_001.coverFileId).toBeNull();
    const result = await t.api.call('events.undoStory', { correlationId: 'cor_ui_story1' });
    expect(result.undone).toHaveLength(2);
    expect(t.store.state.files.fil_001).toBeDefined();
    expect(t.store.state.projects.prj_001.coverFileId).toBe('fil_001');
  });

  it("refuses another person's story and changes nothing", async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_story2' });
    t.as('usr_004');
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_ui_story2' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
  });

  it('reports an unknown story', async () => {
    const t = testApi(calls);
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_ui_none' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

Append to `src/data/seed.test.ts`:

```ts
it('writes agent summaries with relative days, so the date shift keeps them true', async () => {
  const state = await buildSeed(TODAY, async () => undefined);
  const bodies = Object.values(state.updates).filter((u) => state.users[u.authorId].kind === 'agent').map((u) => u.body);
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) expect(body).not.toMatch(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
  expect(bodies.some((body) => /in \d+ days|today|tomorrow/.test(body))).toBe(true);
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/api/handlers src/data/seed.test.ts`
Expected: FAIL. The new tests fail on missing fields (`viewerRole`, `healthSetBy`, `hoursThisMonth`, `canMove`), on the unknown call `events.undoStory`, on the `coverFileId` patch (zod drops the unknown field, so the PDF is not refused), and on the fixed date in the summaries.

- [ ] **Step 3: Change the view contract**

In `src/api/contract/views.ts`, move the `ViewerCan` schema above `ProjectSummary`, then replace `ProjectSummary`, `ProjectDetail` and `TaskRow` with:

```ts
export const ProjectSummary = z.object({
  project: Project,
  client: Client.nullable(),
  health: HealthResult.nullable(),
  healthSetBy: UserCard.nullable(),
  stages: z.array(Stage),
  currentStage: Stage,
  latest: z.array(FeedItem).max(2),
  nextDeadline: NextDeadline.nullable(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectDetail = ProjectSummary.extend({
  members: z.array(z.object({
    user: UserCard, discipline: z.string(), isLeader: z.boolean(), openTasks: z.number().int().min(0),
    hoursThisMonth: z.number().min(0).nullable(),
  })),
  deadlines: z.array(Deadline),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;
```

```ts
export const TaskRow = z.object({
  task: Task,
  owner: UserCard,
  project: z.object({ id: ProjectId, code: z.string(), name: z.string() }),
  stage: z.object({ id: StageId, name: z.string() }),
  commentCount: z.number().int().min(0),
  fileCount: z.number().int().min(0),
  overdue: z.boolean(),
  canMove: z.boolean(),
});
export type TaskRow = z.infer<typeof TaskRow>;
```

- [ ] **Step 4: Change the view builders**

In `src/api/views.ts`, import `type ProjectRole` from `./permissions` next to `can` and `projectRoleOf`. Replace `summaryOf` and `detailOf` with:

```ts
function viewerCanOf(viewer: User, projectRole: ProjectRole): ProjectSummary['viewerCan'] {
  const r = { projectRole };
  return {
    edit: can(viewer, 'project.edit', r),
    changeLeader: can(viewer, 'project.changeLeader', r),
    archive: can(viewer, 'project.archive', r),
    delete: can(viewer, 'project.delete', r),
    healthOverride: can(viewer, 'project.healthOverride', r),
    createTaskForAnyone: can(viewer, 'task.createForAnyone', r),
    createTaskForSelf: can(viewer, 'task.createForSelf', r),
    post: can(viewer, 'content.post', r),
    review: can(viewer, 'task.review', r),
    logTime: can(viewer, 'time.logOnProject', r),
  };
}

/** "viewer" is the person whose rights apply: the user, or the person an agent acts for. */
export function summaryOf(state: State, project: Project, today: string, viewer: User): ProjectSummary {
  const stages = stagesOf(state, project.id);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
  const deadlines = deadlinesOf(state, project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2);
  const newest = latest[0]?.at;
  const health = computeHealth({ project, stages, tasks }, today);
  const viewerRole = projectRoleOf(state, project.id, viewer.id);
  return {
    project,
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health,
    healthSetBy: health?.overridden && health.setBy ? cardOf(state, health.setBy) : null,
    stages,
    currentStage: state.stages[project.currentStageId] ?? stages[0],
    latest,
    nextDeadline: next ? { id: next.id, name: next.name, date: next.date, daysLeft: diffDays(today, next.date) } : null,
    leader: project.leaderId ? cardOf(state, project.leaderId) : null,
    team: Object.values(state.members)
      .filter((m) => m.projectId === project.id && m.userId !== project.leaderId)
      .map((m) => cardOf(state, m.userId))
      .sort((a, b) => a.name.localeCompare(b.name)),
    openTasks: tasks.filter((t) => t.status !== 'done').length,
    lastActivityAt: newest && newest > project.updatedAt ? newest : project.updatedAt,
    viewerRole,
    viewerCan: viewerCanOf(viewer, viewerRole),
  };
}

/** Hours on the project this month, or null when the viewer may not see that person's hours (spec 5.8). */
function monthHours(state: State, projectId: string, today: string, viewer: User, projectRole: ProjectRole, userId: string): number | null {
  if (!can(viewer, 'time.viewPerson', { targetUserId: userId, projectRole })) return null;
  const monthStart = `${today.slice(0, 7)}-01`;
  return Object.values(state.time)
    .filter((e) => e.projectId === projectId && e.userId === userId && e.date >= monthStart && e.date <= today)
    .reduce((sum, e) => sum + e.hours, 0);
}

export function detailOf(state: State, project: Project, today: string, viewer: User): ProjectDetail {
  const summary = summaryOf(state, project, today, viewer);
  const openBy = (userId: string) =>
    Object.values(state.tasks).filter((t) => t.projectId === project.id && t.ownerId === userId && t.status !== 'done').length;
  const members = Object.values(state.members)
    .filter((m) => m.projectId === project.id)
    .map((m) => ({
      user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId),
      hoursThisMonth: monthHours(state, project.id, today, viewer, summary.viewerRole, m.userId),
    }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  return { ...summary, members, deadlines: deadlinesOf(state, project.id) };
}
```

Change `taskRowOf` to take the viewer and add `canMove`:

```ts
export function taskRowOf(state: State, task: Task, today: string, viewer: User): TaskRow {
  const project = state.projects[task.projectId];
  const stage = state.stages[task.stageId];
  return {
    task,
    owner: cardOf(state, task.ownerId),
    project: { id: task.projectId, code: project?.code ?? '', name: project?.name ?? '' },
    stage: { id: task.stageId, name: stage?.name ?? '' },
    commentCount: countComments(state, 'task', task.id),
    fileCount: Object.values(state.files).filter((f) => f.taskId === task.id).length,
    overdue: isOverdue(task, today),
    canMove: can(viewer, 'task.updateOwn', { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId }),
  };
}
```

In `taskDetailOf`, change `...taskRowOf(state, task, today),` to `...taskRowOf(state, task, today, viewer),`.

In `src/api/handlers/projects.ts`, change the `projects.list` map to `.map((p) => summaryOf(state, p, today, ctx.authority))`. In `src/api/handlers/tasks.ts`, change the `tasks.list` return to `return tasks.map((task) => taskRowOf(state, task, today, authority));`.

- [ ] **Step 5: Let the leader set the cover from the Files tab**

In `src/api/handlers/projects.ts`, add `FileId` to the entities import. In `projectsUpdate`, add `coverFileId: FileId.nullable().optional(),` to the patch object, and add these lines after the client check:

```ts
    if (patch.coverFileId) {
      const file = ctx.state.files[patch.coverFileId];
      if (!file || file.projectId !== project.id) throw invalid('coverFileId', 'This file is not in the project.');
      if (!file.versions[file.versions.length - 1].mimeType.startsWith('image/')) throw invalid('coverFileId', 'The cover must be an image.');
    }
```

- [ ] **Step 6: Add `events.undoStory`**

In `src/api/handlers/history.ts`, replace `eventsUndo` and the call map with:

```ts
/** Undoes one event for the current person, under the rules of the original action. */
function undoOne(ctx: Ctx, event: Event): EventView {
  // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
  const own = event.actingForId === ctx.authority.id;
  const agentChange = event.actorKind === 'agent' && event.projectId !== null
    && can(ctx.authority, 'event.undoAgent', { projectRole: roleIn(ctx, event.projectId) });
  if (!own && !agentChange) throw forbidden('You can undo changes by you or your agent, and agent changes on a project you lead.');
  assertMayUndo(ctx, event);
  const undo = undoEvent(ctx, event.id);
  if (event.projectId && ctx.state.projects[event.projectId]) touch(ctx, event.projectId);
  return eventViewOf(ctx.state, undo);
}

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    return undoOne(ctx, event);
  },
});

/** Undoes every change of one story, newest first. The Undo toast calls it with the story ID of its action. */
export const eventsUndoStory = defineCall({
  input: z.object({ correlationId: z.string().min(1).max(80) }),
  output: z.object({ undone: z.array(EventView) }),
  run(input, ctx) {
    const story = Object.values(ctx.state.events)
      .filter((e) => e.correlationId === input.correlationId && e.verb !== 'undo')
      .sort((a, b) => b.seq - a.seq);
    if (story.length === 0) throw notFound('Story', input.correlationId);
    return { undone: story.map((event) => undoOne(ctx, event)) };
  },
});

export const historyCalls = {
  'events.list': eventsList,
  'events.undo': eventsUndo,
  'events.undoStory': eventsUndoStory,
};
```

Import `type EventView` from `../contract/views` next to the `EventView` schema if the type is not in scope (the schema and the type share the name).

- [ ] **Step 7: Make the agent summaries relative**

In `src/data/seed.ts`, inside `addAgentSummaries`, replace the `tail` line with:

```ts
      const days = next ? diffDays(sunday, next.date) : 0;
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
      const tail = next ? ` Next deadline: ${next.name}, ${when}.` : '';
```

Add `diffDays` to the `../lib/dates` import, and remove `formatDay` from it if nothing else in the file uses it.

- [ ] **Step 8: Run the tests to watch them pass**

Run: `npx vitest run src/api src/data`
Expected: PASS, all files.

- [ ] **Step 9: Commit**

```bash
git add src/api src/data
git commit -m "feat: add viewer rights, month hours, row rights, story undo and cover choice" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 2: Pure helpers and all plan 2 text

**Files:**
- Create: `src/lib/age.ts`, `src/lib/schedule.ts`, `src/lib/board.ts`, `src/features/projects/projectForm.ts`, `src/i18n/keys.test.ts`
- Modify: `src/lib/text.ts`, `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/lib/age.test.ts`, `src/lib/schedule.test.ts`, `src/lib/board.test.ts`, `src/lib/text.test.ts`, `src/features/projects/projectForm.test.ts`

**Interfaces:**
- Consumes: `addDays`, `diffDays`, `stampDay` from `src/lib/dates.ts`; the mention regex in `src/lib/text.ts`.
- Produces:
  - `ageOf(stamp: string, now: Date): Age` where `Age = { unit: 'now' | 'minutes' | 'hours' | 'days' | 'weeks'; n: number } | { unit: 'date'; day: string }`.
  - `Span = { start: string; end: string }`, `chartRange(days: (string | null)[]): Span | null`, `nextMonthStart(day)`, `spanDays(span)`, `offsetPct(span, day)`, `widthPct(span, start, end)`, `monthStarts(span): string[]`, `dayDelta(dxPx, widthPx, totalDays, rtl): number`, `moveEdge(stage: Span, edge: 'start' | 'end', days: number): Span`.
  - `BOARD_COLUMNS: TaskStatus[]`, `nextColumn(current: TaskStatus, key: string, rtl: boolean): TaskStatus | null`.
  - `Segment`, `segmentsOf(body): Segment[]`, `plainText(body): string`, `withMentionMarkup(text, people: { id: string; name: string }[]): string`, `activeMention(text, caret): { start: number; query: string } | null`.
  - `ProjectFormValues`, `ProjectFormErrors`, `emptyProjectForm(stages: string[]): ProjectFormValues`, `validateProjectForm(values): ProjectFormErrors` (values are i18n keys).
  - Every text key that later tasks use.

- [ ] **Step 1: Write the failing tests**

`src/lib/age.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ageOf } from './age';

const NOW = new Date('2026-09-30T12:00:00+03:00');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('ageOf', () => {
  it('uses the largest whole unit', () => {
    expect(ageOf(ago(20_000), NOW)).toEqual({ unit: 'now', n: 0 });
    expect(ageOf(ago(5 * 60_000), NOW)).toEqual({ unit: 'minutes', n: 5 });
    expect(ageOf(ago(2 * 3_600_000), NOW)).toEqual({ unit: 'hours', n: 2 });
    expect(ageOf(ago(3 * 86_400_000), NOW)).toEqual({ unit: 'days', n: 3 });
    expect(ageOf(ago(15 * 86_400_000), NOW)).toEqual({ unit: 'weeks', n: 2 });
  });

  it('shows the office date after four weeks, and "now" for a stamp in the future', () => {
    expect(ageOf('2026-08-01T10:00:00.000+03:00', NOW)).toEqual({ unit: 'date', day: '2026-08-01' });
    expect(ageOf('2026-10-01T10:00:00.000+03:00', NOW)).toEqual({ unit: 'now', n: 0 });
  });
});
```

`src/lib/schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chartRange, dayDelta, monthStarts, moveEdge, offsetPct, spanDays, widthPct } from './schedule';

describe('the chart range', () => {
  it('runs from the first month start to the last month end', () => {
    const span = chartRange(['2026-05-09', null, '2027-01-10', '2026-09-30']);
    expect(span).toEqual({ start: '2026-05-01', end: '2027-01-31' });
    expect(monthStarts(span!)).toHaveLength(9);
    expect(chartRange([null])).toBeNull();
  });

  it('places days and bars as percents', () => {
    const span = { start: '2026-09-01', end: '2026-09-30' };
    expect(spanDays(span)).toBe(30);
    expect(offsetPct(span, '2026-09-01')).toBe(0);
    expect(offsetPct(span, '2026-09-16')).toBe(50);
    expect(widthPct(span, '2026-09-01', '2026-09-30')).toBe(100);
  });
});

describe('dragging a stage edge', () => {
  it('turns pixels into whole days, later toward the end side', () => {
    expect(dayDelta(100, 1000, 100, false)).toBe(10);
    expect(dayDelta(100, 1000, 100, true)).toBe(-10);
    expect(dayDelta(-100, 1000, 100, true)).toBe(10);
    expect(Object.is(dayDelta(-4, 1000, 100, false), 0)).toBe(true);
    expect(dayDelta(50, 0, 100, false)).toBe(0);
  });

  it('keeps the start on or before the end', () => {
    const stage = { start: '2026-09-10', end: '2026-09-20' };
    expect(moveEdge(stage, 'end', 3)).toEqual({ start: '2026-09-10', end: '2026-09-23' });
    expect(moveEdge(stage, 'start', 20)).toEqual({ start: '2026-09-20', end: '2026-09-20' });
    expect(moveEdge(stage, 'end', -20)).toEqual({ start: '2026-09-10', end: '2026-09-10' });
  });
});
```

`src/lib/board.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextColumn } from './board';

describe('board keys', () => {
  it('moves forward with the end-side arrow', () => {
    expect(nextColumn('todo', 'ArrowRight', false)).toBe('in_progress');
    expect(nextColumn('todo', 'ArrowLeft', true)).toBe('in_progress');
    expect(nextColumn('in_progress', 'ArrowLeft', false)).toBe('todo');
    expect(nextColumn('in_progress', 'ArrowRight', true)).toBe('todo');
  });

  it('stops at the edges and ignores other keys', () => {
    expect(nextColumn('done', 'ArrowRight', false)).toBeNull();
    expect(nextColumn('todo', 'ArrowLeft', false)).toBeNull();
    expect(nextColumn('todo', 'ArrowDown', false)).toBeNull();
  });
});
```

Append to `src/lib/text.test.ts` (add the new names to its import from `./text`):

```ts
describe('mentions in posts', () => {
  const body = 'Hi @[Sara Al-Qahtani](usr_005), see the plan.';

  it('splits a post into text and mentions', () => {
    expect(segmentsOf(body)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', name: 'Sara Al-Qahtani', userId: 'usr_005' },
      { kind: 'text', text: ', see the plan.' },
    ]);
    expect(plainText(body)).toBe('Hi @Sara Al-Qahtani, see the plan.');
  });

  it('turns picked names into markup, longest name first', () => {
    const people = [{ id: 'usr_010', name: 'Sara' }, { id: 'usr_005', name: 'Sara Al-Qahtani' }];
    expect(withMentionMarkup('@Sara Al-Qahtani and @Sara', people)).toBe('@[Sara Al-Qahtani](usr_005) and @[Sara](usr_010)');
    expect(withMentionMarkup('email@Sara', [])).toBe('email@Sara');
  });

  it('finds the mention at the caret', () => {
    expect(activeMention('Hi @Sa', 6)).toEqual({ start: 3, query: 'Sa' });
    expect(activeMention('Hi @', 4)).toEqual({ start: 3, query: '' });
    expect(activeMention('@Sara Al', 8)).toEqual({ start: 0, query: 'Sara Al' });
    expect(activeMention('mail@x', 6)).toBeNull();
    expect(activeMention('Hi @Sa\nnext', 11)).toBeNull();
    expect(activeMention('Hi there', 8)).toBeNull();
  });
});
```

`src/features/projects/projectForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyProjectForm, validateProjectForm } from './projectForm';

describe('the project form checks', () => {
  const valid = { ...emptyProjectForm(['Concept', 'Permits']), name: 'Harbour Gate Offices' };

  it('needs only a name', () => {
    expect(validateProjectForm(valid)).toEqual({});
    expect(validateProjectForm({ ...valid, name: '  ' })).toEqual({ name: 'projectForm.errors.nameRequired' });
  });

  it('checks the area, the dates and the stages', () => {
    expect(validateProjectForm({ ...valid, area: '-5' }).area).toBe('projectForm.errors.areaNumber');
    expect(validateProjectForm({ ...valid, area: 'big' }).area).toBe('projectForm.errors.areaNumber');
    expect(validateProjectForm({ ...valid, startDate: '2026-10-01', targetEndDate: '2026-10-01' }).targetEndDate).toBe('projectForm.errors.endAfterStart');
    expect(validateProjectForm({ ...valid, stages: [] }).stages).toBe('projectForm.errors.stageRequired');
    expect(validateProjectForm({ ...valid, stages: [{ name: ' ' }] }).stages).toBe('projectForm.errors.stageName');
  });
});
```

`src/i18n/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from './en.json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function has(tree: unknown, key: string): boolean {
  let node = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

describe('text keys', () => {
  it('has an English text for every literal key in the code', () => {
    const missing: string[] = [];
    for (const file of sourceFiles('src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        if (!has(en, match[1])) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the plan 2 groups', () => {
    for (const key of ['projects.new', 'project.tab.overview', 'tasks.addTask', 'schedule.today', 'files.upload', 'team.add', 'feed.task.done', 'time.minutes']) {
      expect(has(en, key)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib src/features/projects src/i18n`
Expected: FAIL: the modules `./age`, `./schedule`, `./board`, `./projectForm` do not exist, the new text helpers are not exported, and the plan 2 keys are missing.

- [ ] **Step 3: Write the helpers**

`src/lib/age.ts`:

```ts
import { stampDay } from './dates';

export type Age = { unit: 'now' | 'minutes' | 'hours' | 'days' | 'weeks'; n: number } | { unit: 'date'; day: string };

/** How long ago a stamp was, in the largest whole unit. After four weeks, the office date shows instead. */
export function ageOf(stamp: string, now: Date): Age {
  const minutes = Math.floor((now.getTime() - new Date(stamp).getTime()) / 60_000);
  if (minutes < 1) return { unit: 'now', n: 0 };
  if (minutes < 60) return { unit: 'minutes', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', n: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: 'days', n: days };
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return { unit: 'weeks', n: weeks };
  return { unit: 'date', day: stampDay(stamp) };
}
```

`src/lib/schedule.ts`:

```ts
import { addDays, diffDays } from './dates';

/** A run of days, both ends included. */
export type Span = { start: string; end: string };

export function nextMonthStart(day: string): string {
  const [year, month] = day.split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

/** The chart range: whole months around every date, so the scale starts and ends on a month edge. */
export function chartRange(days: (string | null)[]): Span | null {
  const valid = days.filter((day): day is string => Boolean(day)).sort();
  if (valid.length === 0) return null;
  return { start: `${valid[0].slice(0, 7)}-01`, end: addDays(nextMonthStart(valid[valid.length - 1]), -1) };
}

export function spanDays(span: Span): number {
  return diffDays(span.start, span.end) + 1;
}

/** Where a day starts on the chart, as a percent from the start side. */
export function offsetPct(span: Span, day: string): number {
  return (diffDays(span.start, day) / spanDays(span)) * 100;
}

/** The width of a bar from its first day to its last day, as a percent. */
export function widthPct(span: Span, start: string, end: string): number {
  return ((diffDays(start, end) + 1) / spanDays(span)) * 100;
}

/** The first day of each month in the range, for the scale labels. */
export function monthStarts(span: Span): string[] {
  const out: string[] = [];
  for (let day = span.start; day <= span.end; day = nextMonthStart(day)) out.push(day);
  return out;
}

/** Whole days for a drag of dx pixels. Time runs toward the end side, so in Arabic a drag to the left moves dates later. */
export function dayDelta(dxPx: number, widthPx: number, totalDays: number, rtl: boolean): number {
  if (widthPx <= 0) return 0;
  const days = Math.round((dxPx / widthPx) * totalDays);
  return (rtl ? -days : days) || 0;
}

/** Moves one edge of a stage and keeps the start on or before the end. */
export function moveEdge(stage: Span, edge: 'start' | 'end', days: number): Span {
  if (edge === 'start') {
    const start = addDays(stage.start, days);
    return { start: start > stage.end ? stage.end : start, end: stage.end };
  }
  const end = addDays(stage.end, days);
  return { start: stage.start, end: end < stage.start ? stage.start : end };
}
```

`src/lib/board.ts`:

```ts
import type { TaskStatus } from '../api/contract/entities';

export const BOARD_COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

/** The column an arrow key moves a card to. The end-side arrow moves forward, so in Arabic ArrowLeft moves forward. */
export function nextColumn(current: TaskStatus, key: string, rtl: boolean): TaskStatus | null {
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  const index = BOARD_COLUMNS.indexOf(current);
  if (key === forward && index < BOARD_COLUMNS.length - 1) return BOARD_COLUMNS[index + 1];
  if (key === back && index > 0) return BOARD_COLUMNS[index - 1];
  return null;
}
```

Append to `src/lib/text.ts`:

```ts
export type Segment = { kind: 'text'; text: string } | { kind: 'mention'; name: string; userId: string };

/** Splits a post into plain text and mentions, for display. */
export function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: body.slice(last, index) });
    out.push({ kind: 'mention', name: match[1], userId: match[2] });
    last = index + match[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** The text of a post with each mention as "@Name". */
export function plainText(body: string): string {
  return body.replace(MENTION, (_match, name: string) => `@${name}`);
}

/** Turns "@Name" into mention markup for each picked person. Longer names go first, so "@Sara Al-Qahtani" wins over "@Sara". */
export function withMentionMarkup(text: string, people: { id: string; name: string }[]): string {
  let out = text;
  for (const person of [...people].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${person.name}`).join(mentionMarkup(person.name, person.id));
  }
  return out;
}

/** The mention that the caret is in: an "@" at the start of a word, then up to 30 characters on the same line. */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || query.includes('\n') || query.startsWith(' ')) return null;
  return { start: at, query };
}
```

`src/features/projects/projectForm.ts`:

```ts
export type ProjectFormValues = {
  name: string;
  clientId: string;
  leader: string;
  location: string;
  area: string;
  startDate: string;
  targetEndDate: string;
  stages: { id?: string; name: string }[];
  teamIds: string[];
  modelFolderPath: string;
  description: string;
};

/** Each value is a text key, so the form shows the message in the current language. */
export type ProjectFormErrors = Partial<Record<'name' | 'area' | 'targetEndDate' | 'stages', string>>;

export function emptyProjectForm(stages: string[]): ProjectFormValues {
  return {
    name: '', clientId: '', leader: 'me', location: '', area: '', startDate: '', targetEndDate: '',
    stages: stages.map((name) => ({ name })), teamIds: [], modelFolderPath: '', description: '',
  };
}

/** The same rules as projects.create (spec 4.4). Only the name is required. */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};
  if (!values.name.trim()) errors.name = 'projectForm.errors.nameRequired';
  if (values.area.trim() && !(Number(values.area) >= 0)) errors.area = 'projectForm.errors.areaNumber';
  if (values.startDate && values.targetEndDate && values.targetEndDate <= values.startDate) errors.targetEndDate = 'projectForm.errors.endAfterStart';
  if (values.stages.length === 0) errors.stages = 'projectForm.errors.stageRequired';
  else if (values.stages.some((stage) => !stage.name.trim())) errors.stages = 'projectForm.errors.stageName';
  return errors;
}
```

- [ ] **Step 4: Add the text**

Save the two blocks below as `/tmp/madar-en.json` and `/tmp/madar-ar.json` (or any scratch path), then merge them with:

```bash
node -e '
const fs = require("fs");
const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v; return a; };
for (const lang of ["en", "ar"]) {
  const file = `src/i18n/${lang}.json`;
  const next = merge(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse(fs.readFileSync(process.argv[1].replace("LANG", lang), "utf8")));
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
}' /tmp/madar-LANG.json
```

English additions:

```json
{
  "common": { "save": "Save", "add": "Add", "remove": "Remove", "delete": "Delete", "edit": "Edit", "none": "None", "agent": "Agent", "done": "Done" },
  "time": {
    "now": "now", "minutes": "{{n}}m", "hours": "{{n}}h", "days": "{{n}}d", "weeks": "{{n}}w",
    "daysLeft": "{{n}}d", "daysLate": "{{n}}d late", "today": "Today"
  },
  "health": {
    "on_track": "On track", "at_risk": "At risk", "late": "Late",
    "setBy": "Set by {{name}}", "override": "Set health", "overrideHint": "The pill shows your choice and reason until the current stage changes.",
    "reason": "Reason", "save": "Set health", "clear": "Use the computed health", "computed": "Computed: {{value}}"
  },
  "status": { "active": "Active", "on_hold": "On hold", "completed": "Completed", "archived": "Archived", "all": "All statuses" },
  "taskStatus": { "todo": "To do", "in_progress": "In progress", "in_review": "In review", "done": "Done" },
  "projects": {
    "new": "New Project",
    "filters": "Project filters",
    "filter": { "all": "All", "mine": "My projects", "at_risk": "At risk" },
    "statusFilter": "Status",
    "sort": "Sort",
    "sorts": { "updated": "Last update", "deadline": "Next deadline", "name": "Name" },
    "view": "View",
    "views": { "grid": "Grid", "list": "List" },
    "emptyTitle": "No projects",
    "empty": "No projects match these filters.",
    "showAll": "Show all projects",
    "noDeadline": "No deadline",
    "noLeader": "No leader",
    "morePeople": "+{{n}}",
    "latest": "Latest updates",
    "noUpdates": "No updates yet.",
    "stageOf": "Stage {{n}} of {{total}}: {{name}}",
    "menu": "Actions for {{name}}",
    "open": "Open",
    "postUpdate": "Post update",
    "copyLink": "Copy link",
    "linkCopied": "Link copied.",
    "archive": "Archive",
    "archived": "Project archived.",
    "cover": "Cover image of {{name}}",
    "openTasks": "Open tasks: {{n}}",
    "loadFailed": "The projects did not load."
  },
  "projectForm": {
    "createTitle": "New Project",
    "editTitle": "Edit project",
    "name": "Name",
    "client": "Client",
    "noClient": "No client",
    "newClient": "New client",
    "clientName": "Client name",
    "contactName": "Contact name",
    "phone": "Phone",
    "email": "Email",
    "addClient": "Add client",
    "clientAdded": "Client added.",
    "leader": "Leader",
    "leaderMe": "Me",
    "leaderNone": "No leader",
    "location": "Location",
    "locationHint": "City and district",
    "area": "Area (m²)",
    "startDate": "Start date",
    "endDate": "Target end date",
    "stages": "Stages",
    "stageName": "Stage {{n}}",
    "addStage": "Add stage",
    "removeStage": "Remove {{name}}",
    "team": "Team",
    "modelFolder": "Model folder path",
    "modelFolderHint": "Revit models stay on the office server.",
    "description": "Description",
    "cover": "Cover image",
    "create": "Create project",
    "save": "Save changes",
    "created": "{{code}} created.",
    "saved": "Project saved.",
    "errors": {
      "nameRequired": "Enter a name.",
      "areaNumber": "Enter a number of 0 or more.",
      "endAfterStart": "The end date must be after the start date.",
      "stageRequired": "Keep at least one stage.",
      "stageName": "Enter a name for each stage."
    }
  },
  "project": {
    "tabs": "Project sections",
    "tab": { "overview": "Overview", "tasks": "Tasks", "schedule": "Schedule", "files": "Files", "team": "Team" },
    "notFoundTitle": "Project not found",
    "notFound": "This project does not exist anymore.",
    "back": "Projects",
    "more": "More actions",
    "edit": "Edit project",
    "changeLeader": "Change leader",
    "statusTo": { "active": "Mark as active", "on_hold": "Put on hold", "completed": "Mark as completed", "archived": "Archive" },
    "delete": "Delete project",
    "deleteTitle": "Delete {{name}}?",
    "deleteBody": "This removes the project with its tasks, files, posts and hours. You cannot undo it.",
    "deleted": "Project deleted.",
    "viewOnly": "View only",
    "leaderChanged": "Leader changed.",
    "statusChanged": "Status changed.",
    "stageDates": "{{start}} to {{end}}",
    "noDates": "No dates",
    "stageTasks": "Tasks done: {{done}} of {{total}}",
    "makeCurrent": "Make current stage",
    "stageChanged": "Current stage changed.",
    "current": "Current stage",
    "comingSoon": "This tab arrives later in this build step."
  },
  "overview": {
    "composer": "Post an update",
    "placeholder": "Share progress. Type @ to mention someone.",
    "attach": "Attach files",
    "post": "Post",
    "posted": "Update posted.",
    "mentionList": "People to mention",
    "removeFile": "Remove {{name}}",
    "feed": "Updates",
    "feedFilter": { "all": "All", "posts": "Posts", "tasks": "Tasks", "files": "Files" },
    "emptyFeed": "No updates yet.",
    "facts": "Key facts",
    "deadlines": "Next deadlines",
    "noDeadlines": "No deadlines yet.",
    "team": "Team",
    "edited": "Edited",
    "comments": "Comments: {{n}}",
    "cannotPost": "Only the project team can post here.",
    "none": "Not set"
  },
  "feed": {
    "project": {
      "created": "created the project",
      "stage_changed": "moved the project to {{stage}}",
      "leader_changed": "made {{leader}} the leader",
      "leader_cleared": "removed the leader"
    },
    "task": {
      "created": "added the task “{{label}}”",
      "todo": "moved “{{label}}” to To do",
      "in_progress": "started “{{label}}”",
      "in_review": "sent “{{label}}” to review",
      "done": "completed “{{label}}”",
      "approved": "approved “{{label}}”",
      "sent_back": "sent back “{{label}}”"
    },
    "file": { "added": "added the file “{{label}}”", "version_added": "added version {{version}} of “{{label}}”" },
    "member": { "added": "added {{label}} to the team" },
    "other": "made a change"
  },
  "tasks": {
    "view": "Task view",
    "views": { "list": "List", "board": "Board" },
    "filters": "Task filters",
    "filter": { "all": "All", "mine": "Mine", "overdue": "Overdue", "flagged": "Flagged" },
    "showDone": "Show done tasks",
    "addTask": "Add a task",
    "addTaskIn": "Add a task in {{stage}}",
    "complete": "Complete {{title}}",
    "completed": "Task done.",
    "sentToReview": "Sent to review. The leader checks it next.",
    "moved": "Moved to {{status}}.",
    "moveTo": "Move {{title}}",
    "drag": "Drag {{title}}",
    "empty": "No tasks here yet.",
    "emptyFiltered": "No tasks match this filter.",
    "flagged": "Flagged",
    "overdue": "Overdue",
    "comments": "Comments: {{n}}",
    "files": "Files: {{n}}",
    "column": "{{status}}: {{n}}",
    "count": "Tasks: {{n}}"
  },
  "taskSheet": {
    "title": "Title",
    "status": "Status",
    "owner": "Owner",
    "dueDate": "Due date",
    "stage": "Stage",
    "flag": "Flag",
    "flagHint": "Mark this task as important.",
    "needsReview": "Needs review",
    "needsReviewHint": "The leader checks the task before it is done.",
    "description": "Description",
    "checklist": "Checklist",
    "addItem": "Add an item",
    "removeItem": "Remove {{text}}",
    "files": "Files",
    "noFiles": "No files on this task.",
    "hours": "Hours logged",
    "hoursValue": "{{n}} h",
    "logTime": "Log time",
    "history": "History",
    "noHistory": "No changes yet.",
    "approve": "Approve",
    "approved": "Task approved.",
    "sendBack": "Send back",
    "sendBackNote": "What needs to change?",
    "sentBack": "Task sent back.",
    "delete": "Delete task",
    "deleted": "Task deleted.",
    "saved": "Saved.",
    "readOnly": "You can view this task. Only its owner and the project leader can change it.",
    "undoAgent": "Undo agent change",
    "undone": "Change undone.",
    "comments": "Comments: {{n}}. Comments arrive in build step 3.",
    "review": "Review"
  },
  "taskHistory": {
    "created": "created the task",
    "updated": "changed {{fields}}",
    "reassigned": "changed the owner",
    "status": "moved it to {{status}}",
    "approved": "approved it",
    "sent_back": "sent it back",
    "deleted": "deleted the task",
    "undo": "undid a change",
    "fields": {
      "title": "the title", "description": "the description", "dueDate": "the due date", "stageId": "the stage",
      "ownerId": "the owner", "flagged": "the flag", "needsReview": "the review setting", "checklist": "the checklist",
      "status": "the status", "completedAt": "the status"
    }
  },
  "schedule": {
    "chart": "Stage timeline",
    "stages": "Stages",
    "deadlines": "Deadlines",
    "today": "Today",
    "noDatesTitle": "No dates yet",
    "noDates": "Add stage dates or a deadline to see the timeline.",
    "startOf": "Start of {{stage}}",
    "endOf": "End of {{stage}}",
    "datesChanged": "Dates changed.",
    "start": "Start",
    "end": "End",
    "addDeadline": "Add deadline",
    "deadlineName": "Deadline name",
    "deadlineDate": "Date",
    "deadlineStage": "Stage",
    "deleteDeadline": "Delete {{name}}",
    "deadlineAdded": "Deadline added.",
    "deadlineDeleted": "Deadline deleted.",
    "noDeadlines": "No deadlines yet."
  },
  "files": {
    "upload": "Upload files",
    "drop": "Drop files here to upload them.",
    "uploadStage": "Stage for new files",
    "noStage": "No stage",
    "uploaded": "Files uploaded: {{n}}.",
    "tooBig": "{{name}} is larger than 25 MB.",
    "emptyTitle": "No files yet",
    "empty": "Upload drawings, renders and documents here.",
    "version": "Version {{letter}}",
    "versions": "Versions",
    "preview": "Preview",
    "download": "Download",
    "setCover": "Set as cover",
    "coverSet": "Cover changed.",
    "isCover": "Cover",
    "delete": "Delete",
    "deleted": "File deleted.",
    "actions": "Actions for {{name}}",
    "kb": "{{n}} KB",
    "mb": "{{n}} MB",
    "noPreview": "There is no preview for this file type."
  },
  "team": {
    "leader": "Leader",
    "members": "Members",
    "noLeader": "This project has no leader.",
    "discipline": "Discipline of {{name}}",
    "disciplineSaved": "Discipline saved.",
    "openTasks": "Open tasks: {{n}}",
    "hoursMonth": "{{n}} h this month",
    "add": "Add member",
    "person": "Person",
    "newDiscipline": "Discipline",
    "added": "{{name}} added to the team.",
    "remove": "Remove from team",
    "removed": "{{name}} removed from the team.",
    "makeLeader": "Make leader",
    "actions": "Actions for {{name}}",
    "noOne": "Everyone is already on the team."
  }
}
```

Arabic additions (a draft for the native-speaker review):

```json
{
  "common": { "save": "حفظ", "add": "إضافة", "remove": "إزالة", "delete": "حذف", "edit": "تعديل", "none": "لا شيء", "agent": "وكيل", "done": "تم" },
  "time": {
    "now": "الآن", "minutes": "{{n}} د", "hours": "{{n}} س", "days": "{{n}} ي", "weeks": "{{n}} أ",
    "daysLeft": "{{n}} ي", "daysLate": "متأخر {{n}} ي", "today": "اليوم"
  },
  "health": {
    "on_track": "على المسار", "at_risk": "معرض للتأخر", "late": "متأخر",
    "setBy": "حدّدها {{name}}", "override": "تحديد الحالة", "overrideHint": "تعرض الشارة اختيارك وسببه حتى تتغير المرحلة الحالية.",
    "reason": "السبب", "save": "تحديد الحالة", "clear": "استخدام الحالة المحسوبة", "computed": "المحسوبة: {{value}}"
  },
  "status": { "active": "نشط", "on_hold": "معلّق", "completed": "مكتمل", "archived": "مؤرشف", "all": "كل الحالات" },
  "taskStatus": { "todo": "للتنفيذ", "in_progress": "قيد التنفيذ", "in_review": "قيد المراجعة", "done": "منجزة" },
  "projects": {
    "new": "مشروع جديد",
    "filters": "تصفية المشاريع",
    "filter": { "all": "الكل", "mine": "مشاريعي", "at_risk": "معرضة للتأخر" },
    "statusFilter": "الحالة",
    "sort": "الترتيب",
    "sorts": { "updated": "آخر تحديث", "deadline": "أقرب موعد", "name": "الاسم" },
    "view": "العرض",
    "views": { "grid": "شبكة", "list": "قائمة" },
    "emptyTitle": "لا توجد مشاريع",
    "empty": "لا توجد مشاريع تطابق هذه التصفية.",
    "showAll": "عرض كل المشاريع",
    "noDeadline": "لا يوجد موعد",
    "noLeader": "بلا قائد",
    "morePeople": "+{{n}}",
    "latest": "آخر التحديثات",
    "noUpdates": "لا توجد تحديثات بعد.",
    "stageOf": "المرحلة {{n}} من {{total}}: {{name}}",
    "menu": "إجراءات {{name}}",
    "open": "فتح",
    "postUpdate": "نشر تحديث",
    "copyLink": "نسخ الرابط",
    "linkCopied": "تم نسخ الرابط.",
    "archive": "أرشفة",
    "archived": "تمت أرشفة المشروع.",
    "cover": "صورة غلاف {{name}}",
    "openTasks": "المهام المفتوحة: {{n}}",
    "loadFailed": "لم يتم تحميل المشاريع."
  },
  "projectForm": {
    "createTitle": "مشروع جديد",
    "editTitle": "تعديل المشروع",
    "name": "الاسم",
    "client": "العميل",
    "noClient": "بلا عميل",
    "newClient": "عميل جديد",
    "clientName": "اسم العميل",
    "contactName": "اسم جهة الاتصال",
    "phone": "الهاتف",
    "email": "البريد الإلكتروني",
    "addClient": "إضافة العميل",
    "clientAdded": "تمت إضافة العميل.",
    "leader": "قائد المشروع",
    "leaderMe": "أنا",
    "leaderNone": "بلا قائد",
    "location": "الموقع",
    "locationHint": "المدينة والحي",
    "area": "المساحة (م²)",
    "startDate": "تاريخ البدء",
    "endDate": "تاريخ الانتهاء المستهدف",
    "stages": "المراحل",
    "stageName": "المرحلة {{n}}",
    "addStage": "إضافة مرحلة",
    "removeStage": "حذف {{name}}",
    "team": "الفريق",
    "modelFolder": "مسار مجلد النموذج",
    "modelFolderHint": "تبقى نماذج Revit على خادم المكتب.",
    "description": "الوصف",
    "cover": "صورة الغلاف",
    "create": "إنشاء المشروع",
    "save": "حفظ التغييرات",
    "created": "تم إنشاء {{code}}.",
    "saved": "تم حفظ المشروع.",
    "errors": {
      "nameRequired": "أدخل اسمًا.",
      "areaNumber": "أدخل رقمًا يساوي 0 أو أكثر.",
      "endAfterStart": "يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.",
      "stageRequired": "أبقِ مرحلة واحدة على الأقل.",
      "stageName": "أدخل اسمًا لكل مرحلة."
    }
  },
  "project": {
    "tabs": "أقسام المشروع",
    "tab": { "overview": "نظرة عامة", "tasks": "المهام", "schedule": "الجدول الزمني", "files": "الملفات", "team": "الفريق" },
    "notFoundTitle": "المشروع غير موجود",
    "notFound": "هذا المشروع لم يعد موجودًا.",
    "back": "المشاريع",
    "more": "إجراءات أخرى",
    "edit": "تعديل المشروع",
    "changeLeader": "تغيير القائد",
    "statusTo": { "active": "تعيينه نشطًا", "on_hold": "تعليق المشروع", "completed": "تعيينه مكتملًا", "archived": "أرشفة" },
    "delete": "حذف المشروع",
    "deleteTitle": "حذف {{name}}؟",
    "deleteBody": "يحذف هذا المشروع مع مهامه وملفاته ومنشوراته وساعاته. لا يمكن التراجع عن ذلك.",
    "deleted": "تم حذف المشروع.",
    "viewOnly": "للعرض فقط",
    "leaderChanged": "تم تغيير القائد.",
    "statusChanged": "تم تغيير الحالة.",
    "stageDates": "من {{start}} إلى {{end}}",
    "noDates": "بلا تواريخ",
    "stageTasks": "المهام المنجزة: {{done}} من {{total}}",
    "makeCurrent": "اعتمادها مرحلة حالية",
    "stageChanged": "تم تغيير المرحلة الحالية.",
    "current": "المرحلة الحالية",
    "comingSoon": "يصل هذا القسم لاحقًا في مرحلة البناء هذه."
  },
  "overview": {
    "composer": "انشر تحديثًا",
    "placeholder": "شارك التقدم. اكتب @ للإشارة إلى شخص.",
    "attach": "إرفاق ملفات",
    "post": "نشر",
    "posted": "تم نشر التحديث.",
    "mentionList": "أشخاص للإشارة إليهم",
    "removeFile": "إزالة {{name}}",
    "feed": "التحديثات",
    "feedFilter": { "all": "الكل", "posts": "المنشورات", "tasks": "المهام", "files": "الملفات" },
    "emptyFeed": "لا توجد تحديثات بعد.",
    "facts": "معلومات أساسية",
    "deadlines": "المواعيد القادمة",
    "noDeadlines": "لا توجد مواعيد بعد.",
    "team": "الفريق",
    "edited": "معدّل",
    "comments": "التعليقات: {{n}}",
    "cannotPost": "النشر هنا لفريق المشروع فقط.",
    "none": "غير محدد"
  },
  "feed": {
    "project": {
      "created": "أنشأ المشروع",
      "stage_changed": "نقل المشروع إلى {{stage}}",
      "leader_changed": "عيّن {{leader}} قائدًا",
      "leader_cleared": "أزال القائد"
    },
    "task": {
      "created": "أضاف المهمة «{{label}}»",
      "todo": "أعاد «{{label}}» إلى للتنفيذ",
      "in_progress": "بدأ «{{label}}»",
      "in_review": "أرسل «{{label}}» للمراجعة",
      "done": "أنجز «{{label}}»",
      "approved": "اعتمد «{{label}}»",
      "sent_back": "أعاد «{{label}}» للتعديل"
    },
    "file": { "added": "أضاف الملف «{{label}}»", "version_added": "أضاف النسخة {{version}} من «{{label}}»" },
    "member": { "added": "أضاف {{label}} إلى الفريق" },
    "other": "أجرى تغييرًا"
  },
  "tasks": {
    "view": "عرض المهام",
    "views": { "list": "قائمة", "board": "لوحة" },
    "filters": "تصفية المهام",
    "filter": { "all": "الكل", "mine": "مهامي", "overdue": "متأخرة", "flagged": "مميّزة" },
    "showDone": "إظهار المهام المنجزة",
    "addTask": "أضف مهمة",
    "addTaskIn": "أضف مهمة في {{stage}}",
    "complete": "إنجاز {{title}}",
    "completed": "أُنجزت المهمة.",
    "sentToReview": "أُرسلت للمراجعة. يراجعها القائد بعد ذلك.",
    "moved": "نُقلت إلى {{status}}.",
    "moveTo": "نقل {{title}}",
    "drag": "اسحب {{title}}",
    "empty": "لا توجد مهام هنا بعد.",
    "emptyFiltered": "لا توجد مهام تطابق هذه التصفية.",
    "flagged": "مميّزة",
    "overdue": "متأخرة",
    "comments": "التعليقات: {{n}}",
    "files": "الملفات: {{n}}",
    "column": "{{status}}: {{n}}",
    "count": "المهام: {{n}}"
  },
  "taskSheet": {
    "title": "العنوان",
    "status": "الحالة",
    "owner": "المسؤول",
    "dueDate": "تاريخ الاستحقاق",
    "stage": "المرحلة",
    "flag": "تمييز",
    "flagHint": "علّم هذه المهمة كمهمة مهمة.",
    "needsReview": "تحتاج مراجعة",
    "needsReviewHint": "يراجع القائد المهمة قبل إنجازها.",
    "description": "الوصف",
    "checklist": "قائمة التحقق",
    "addItem": "أضف بندًا",
    "removeItem": "حذف {{text}}",
    "files": "الملفات",
    "noFiles": "لا توجد ملفات لهذه المهمة.",
    "hours": "الساعات المسجلة",
    "hoursValue": "{{n}} س",
    "logTime": "تسجيل الوقت",
    "history": "السجل",
    "noHistory": "لا توجد تغييرات بعد.",
    "approve": "اعتماد",
    "approved": "تم اعتماد المهمة.",
    "sendBack": "إعادة للتعديل",
    "sendBackNote": "ما الذي يجب تغييره؟",
    "sentBack": "أُعيدت المهمة للتعديل.",
    "delete": "حذف المهمة",
    "deleted": "حُذفت المهمة.",
    "saved": "تم الحفظ.",
    "readOnly": "يمكنك عرض هذه المهمة. يغيّرها المسؤول عنها وقائد المشروع فقط.",
    "undoAgent": "التراجع عن تغيير الوكيل",
    "undone": "تم التراجع عن التغيير.",
    "comments": "التعليقات: {{n}}. تصل التعليقات في مرحلة البناء 3.",
    "review": "المراجعة"
  },
  "taskHistory": {
    "created": "أنشأ المهمة",
    "updated": "غيّر {{fields}}",
    "reassigned": "غيّر المسؤول",
    "status": "نقلها إلى {{status}}",
    "approved": "اعتمدها",
    "sent_back": "أعادها للتعديل",
    "deleted": "حذف المهمة",
    "undo": "تراجع عن تغيير",
    "fields": {
      "title": "العنوان", "description": "الوصف", "dueDate": "تاريخ الاستحقاق", "stageId": "المرحلة",
      "ownerId": "المسؤول", "flagged": "التمييز", "needsReview": "إعداد المراجعة", "checklist": "قائمة التحقق",
      "status": "الحالة", "completedAt": "الحالة"
    }
  },
  "schedule": {
    "chart": "الخط الزمني للمراحل",
    "stages": "المراحل",
    "deadlines": "المواعيد",
    "today": "اليوم",
    "noDatesTitle": "لا توجد تواريخ بعد",
    "noDates": "أضف تواريخ المراحل أو موعدًا لرؤية الخط الزمني.",
    "startOf": "بداية {{stage}}",
    "endOf": "نهاية {{stage}}",
    "datesChanged": "تم تغيير التواريخ.",
    "start": "البداية",
    "end": "النهاية",
    "addDeadline": "إضافة موعد",
    "deadlineName": "اسم الموعد",
    "deadlineDate": "التاريخ",
    "deadlineStage": "المرحلة",
    "deleteDeadline": "حذف {{name}}",
    "deadlineAdded": "تمت إضافة الموعد.",
    "deadlineDeleted": "تم حذف الموعد.",
    "noDeadlines": "لا توجد مواعيد بعد."
  },
  "files": {
    "upload": "رفع ملفات",
    "drop": "أفلت الملفات هنا لرفعها.",
    "uploadStage": "مرحلة الملفات الجديدة",
    "noStage": "بلا مرحلة",
    "uploaded": "الملفات المرفوعة: {{n}}.",
    "tooBig": "حجم {{name}} أكبر من 25 ميغابايت.",
    "emptyTitle": "لا توجد ملفات بعد",
    "empty": "ارفع هنا المخططات والصور والمستندات.",
    "version": "النسخة {{letter}}",
    "versions": "النسخ",
    "preview": "معاينة",
    "download": "تنزيل",
    "setCover": "تعيين كغلاف",
    "coverSet": "تم تغيير الغلاف.",
    "isCover": "الغلاف",
    "delete": "حذف",
    "deleted": "تم حذف الملف.",
    "actions": "إجراءات {{name}}",
    "kb": "{{n}} ك.ب",
    "mb": "{{n}} م.ب",
    "noPreview": "لا توجد معاينة لهذا النوع من الملفات."
  },
  "team": {
    "leader": "القائد",
    "members": "الأعضاء",
    "noLeader": "لا يوجد قائد لهذا المشروع.",
    "discipline": "تخصص {{name}}",
    "disciplineSaved": "تم حفظ التخصص.",
    "openTasks": "المهام المفتوحة: {{n}}",
    "hoursMonth": "{{n}} س هذا الشهر",
    "add": "إضافة عضو",
    "person": "الشخص",
    "newDiscipline": "التخصص",
    "added": "تمت إضافة {{name}} إلى الفريق.",
    "remove": "إزالة من الفريق",
    "removed": "تمت إزالة {{name}} من الفريق.",
    "makeLeader": "تعيينه قائدًا",
    "actions": "إجراءات {{name}}",
    "noOne": "كل الأشخاص في الفريق بالفعل."
  }
}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src/lib src/features/projects src/i18n`
Expected: PASS, all files. The language check test from plan 1 also passes, because both files got the same keys.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/features/projects src/i18n
git commit -m "feat: add the pure helpers and the text for the Projects screens" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 3: Display kit

**Files:**
- Create: `src/app/lang.ts`, `src/components/Chip.tsx`, `src/components/Fields.tsx`, `src/components/HealthPill.tsx`, `src/components/StageRail.tsx`, `src/components/AvatarStack.tsx`, `src/components/Age.tsx`, `src/components/RichText.tsx`, `src/components/AgentLabel.tsx`, `src/components/IconButton.tsx`
- Modify: `src/components/Avatar.tsx` (export `tintOf`)
- Test: `src/components/kit.test.tsx`

**Interfaces:**
- Consumes: `ageOf` (Task 2), `segmentsOf` (Task 2), `formatDay`, `now`, `Lang` from `src/lib/dates.ts`, `Avatar`.
- Produces: `useLang(): Lang`; `ChipGroup<T>({ label, value, options: { value: T; label: string }[], onChange })`; `TextField`, `TextArea`, `SelectField` (props `id`, `label`, `error?`, `hint?`, `className?` plus the native element props); `HealthPill({ health, status, setBy })`; `StageRail({ stages, currentId, onSelect?, showName? })`; `AvatarStack({ leader, team, max?, size? })`; `Age({ stamp })`; `RichText({ body, className? })`; `AgentLabel()`; `IconButton({ label, ...buttonProps })`; `tintOf(id): string`.

- [ ] **Step 1: Write the failing test**

`src/components/kit.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW } from '../test/factories';
import { Age } from './Age';
import { AvatarStack } from './AvatarStack';
import { ChipGroup } from './Chip';
import { TextField } from './Fields';
import { HealthPill } from './HealthPill';
import { RichText } from './RichText';
import { StageRail } from './StageRail';

beforeEach(() => {
  initI18n('en');
  setNow(NOW);
});

const person = (id: string, name: string) => ({ id, name, avatarUrl: null, kind: 'human' as const, discipline: 'Architect' });
const stage = (id: string, name: string, order: number) => ({ id, projectId: 'prj_001', name, order, startDate: null, endDate: null });

describe('the display kit', () => {
  it('selects one chip', async () => {
    const onChange = vi.fn();
    render(<ChipGroup label="Filters" value="all" options={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }]} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    expect(onChange).toHaveBeenCalledWith('mine');
  });

  it('links a field error to its input', () => {
    render(<TextField id="name" label="Name" error="Enter a name." value="" onChange={() => undefined} />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a name.');
  });

  it('shows the health word and who set it, or the project status', () => {
    const health = { value: 'at_risk' as const, computed: 'late' as const, overridden: true, reason: 'Client delay', setBy: 'usr_002' };
    const { rerender } = render(<HealthPill health={health} status="active" setBy={person('usr_002', 'Faisal Al-Harbi')} />);
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
    rerender(<HealthPill health={null} status="on_hold" setBy={null} />);
    expect(screen.getByText('On hold')).toBeInTheDocument();
  });

  it('names the current stage on the rail', () => {
    render(<StageRail stages={[stage('stg_001', 'Concept', 0), stage('stg_002', 'Permits', 1), stage('stg_003', 'Tender', 2)]} currentId="stg_002" />);
    expect(screen.getByRole('list', { name: 'Stage 2 of 3: Permits' })).toBeInTheDocument();
  });

  it('shows the leader first and counts the rest', () => {
    const team = [person('usr_005', 'Sara A'), person('usr_006', 'Yousef S'), person('usr_007', 'Lina M'), person('usr_008', 'Khalid M')];
    render(<AvatarStack leader={person('usr_002', 'Faisal Al-Harbi')} team={team} />);
    const avatars = screen.getAllByRole('img');
    expect(avatars[0]).toHaveAccessibleName('Faisal Al-Harbi');
    expect(avatars).toHaveLength(4);
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('shows short ages', () => {
    render(<Age stamp="2026-09-30T08:55:00.000+03:00" />);
    expect(screen.getByText('5m')).toBeInTheDocument();
  });

  it('shows mentions and lets the post keep its own text direction', () => {
    const { container } = render(<RichText body="Please check @[Sara Al-Qahtani](usr_005)" />);
    expect(screen.getByText('@Sara Al-Qahtani')).toBeInTheDocument();
    expect(container.querySelector('p')).toHaveAttribute('dir', 'auto');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/components/kit.test.tsx`
Expected: FAIL: the component modules do not exist.

- [ ] **Step 3: Write the components**

In `src/components/Avatar.tsx`, change `function tintOf(` to `export function tintOf(`.

`src/app/lang.ts`:

```ts
import { useTranslation } from 'react-i18next';
import type { Lang } from '../lib/dates';

/** The interface language, for formatDay and formatNumber. */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.language === 'ar' ? 'ar' : 'en';
}
```

`src/components/Chip.tsx`:

```tsx
export type ChipOption<T extends string> = { value: T; label: string };

/** One choice from a row of chips (spec 4.3). On a phone the row scrolls sideways. */
export function ChipGroup<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: ChipOption<T>[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`pressable min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-subheadline font-medium ${selected ? 'bg-accent-fill text-on-accent' : 'bg-fill text-label'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
```

`src/components/Fields.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type FieldProps = { id: string; label: string; error?: string; hint?: string; className?: string };

const CONTROL = 'w-full rounded-control bg-fill px-3 text-body text-label aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-red';

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

/** The label above, then the hint and the inline error below (spec 11.6). */
function Shell({ id, label, error, hint, className = '', children }: FieldProps & { children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-footnote text-label-2">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-caption text-label-2">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-footnote text-red-text">{error}</p>}
    </div>
  );
}

export function TextField({ id, label, error, hint, className, ...input }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-11 ${CONTROL}`} />
    </Shell>
  );
}

export function TextArea({ id, label, error, hint, className, ...input }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-24 py-2 ${CONTROL}`} />
    </Shell>
  );
}

export function SelectField({ id, label, error, hint, className, children, ...input }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Shell id={id} label={label} error={error} hint={hint} className={className}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...input} className={`min-h-11 ${CONTROL}`}>
        {children}
      </select>
    </Shell>
  );
}
```

`src/components/HealthPill.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ProjectStatus } from '../api/contract/entities';
import type { ProjectSummary, UserCard } from '../api/contract/views';

const TEXT = { on_track: 'text-green-text', at_risk: 'text-orange-text', late: 'text-red-text' } as const;
const DOT = { on_track: 'bg-green', at_risk: 'bg-orange', late: 'bg-red' } as const;

/** The health word always sits next to its color (spec 4.2). A project that is not active shows its status instead. */
export function HealthPill({ health, status, setBy }: { health: ProjectSummary['health']; status: ProjectStatus; setBy: UserCard | null }) {
  const { t } = useTranslation();
  if (!health) {
    return (
      <span className="inline-flex min-h-6 items-center rounded-full bg-fill px-2.5 text-caption font-semibold text-label-2">
        {t(`status.${status}`)}
      </span>
    );
  }
  return (
    <span
      title={health.overridden && health.reason ? health.reason : undefined}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-full bg-fill px-2.5 text-caption font-semibold ${TEXT[health.value]}`}
    >
      <span aria-hidden className={`size-2 rounded-full ${DOT[health.value]}`} />
      {t(`health.${health.value}`)}
      {health.overridden && setBy && <span className="font-normal text-label-2">{t('health.setBy', { name: setBy.name })}</span>}
    </span>
  );
}
```

`src/components/StageRail.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { Stage } from '../api/contract/entities';

/** One block per stage: past stages grey, the current stage in the accent color, future stages light (spec 4.1). */
export function StageRail({
  stages, currentId, onSelect, showName = true,
}: { stages: Stage[]; currentId: string; onSelect?: (stage: Stage, anchor: HTMLElement) => void; showName?: boolean }) {
  const { t } = useTranslation();
  const index = Math.max(0, stages.findIndex((stage) => stage.id === currentId));
  const current = stages[index];
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ol aria-label={t('projects.stageOf', { n: index + 1, total: stages.length, name: current?.name ?? '' })} className="flex flex-1 gap-1">
        {stages.map((stage, i) => {
          const tone = i < index ? 'bg-label-3' : i === index ? 'bg-accent-fill' : 'bg-fill-strong';
          const block = <span aria-hidden className={`block h-1.5 w-full rounded-full ${tone}`} />;
          return (
            <li key={stage.id} className="flex min-w-0 flex-1">
              {onSelect ? (
                <button
                  type="button"
                  aria-label={stage.name}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={(event) => onSelect(stage, event.currentTarget)}
                  className="flex min-h-11 w-full items-center"
                >
                  {block}
                </button>
              ) : block}
            </li>
          );
        })}
      </ol>
      {showName && current && <span className="max-w-[45%] truncate text-footnote text-label-2">{current.name}</span>}
    </div>
  );
}
```

`src/components/AvatarStack.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { UserCard } from '../api/contract/views';
import { Avatar } from './Avatar';

/** The leader first, then up to three team members, then "+N" (spec 4.1). */
export function AvatarStack({ leader, team, max = 3, size = 28 }: { leader: UserCard | null; team: UserCard[]; max?: number; size?: number }) {
  const { t } = useTranslation();
  const shown = [...(leader ? [leader] : []), ...team.slice(0, max)];
  const extra = team.length - Math.min(team.length, max);
  return (
    <div className="flex shrink-0 items-center">
      {shown.map((person, i) => (
        <span key={person.id} className={`rounded-full ring-2 ring-card ${i > 0 ? '-ms-2' : ''}`}>
          <Avatar user={person} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span style={{ width: size, height: size }} className="-ms-2 inline-flex items-center justify-center rounded-full bg-fill-strong text-caption font-semibold text-label ring-2 ring-card">
          {t('projects.morePeople', { n: extra })}
        </span>
      )}
    </div>
  );
}
```

`src/components/Age.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useLang } from '../app/lang';
import { ageOf } from '../lib/age';
import { formatDay, now } from '../lib/dates';

/** "5m", "2h", "3d", "2w", then the date (spec 4.1). */
export function Age({ stamp }: { stamp: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const age = ageOf(stamp, now());
  const text = age.unit === 'date' ? formatDay(age.day, lang) : age.unit === 'now' ? t('time.now') : t(`time.${age.unit}`, { n: age.n });
  return <time dateTime={stamp} className="tabular whitespace-nowrap">{text}</time>;
}
```

`src/components/RichText.tsx`:

```tsx
import { Fragment } from 'react';
import { segmentsOf } from '../lib/text';

/** A post or a description. It keeps its own text direction (spec 10.8) and shows mentions as names. */
export function RichText({ body, className = '' }: { body: string; className?: string }) {
  return (
    <p dir="auto" className={`whitespace-pre-line break-words ${className}`}>
      {segmentsOf(body).map((segment, i) =>
        segment.kind === 'text'
          ? <Fragment key={i}>{segment.text}</Fragment>
          : <span key={i} className="font-semibold text-accent">@{segment.name}</span>)}
    </p>
  );
}
```

`src/components/AgentLabel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

/** Every change by an AI agent carries this label (spec 10.7). */
export function AgentLabel() {
  const { t } = useTranslation();
  return <span className="inline-flex rounded-full bg-fill px-1.5 text-caption font-semibold text-label-2">{t('common.agent')}</span>;
}
```

`src/components/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

export function IconButton({ label, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full text-label-2 hover:bg-fill disabled:opacity-40 ${className}`}
    />
  );
}
```

- [ ] **Step 4: Run the test to watch it pass**

Run: `npx vitest run src/components`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/lang.ts src/components
git commit -m "feat: add chips, fields, health pill, stage rail and other display parts" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 4: Sheets, menus, popovers and tabs

**Files:**
- Create: `src/app/useIsPhone.ts`, `src/components/Sheet.tsx`, `src/components/Menu.tsx`, `src/components/Popover.tsx`, `src/components/Tabs.tsx`
- Modify: `src/test/setup.ts`
- Test: `src/components/overlays.test.tsx`

**Interfaces:**
- Consumes: `spring` from `src/design/motion.ts`, Vaul `Drawer`.
- Produces: `useIsPhone(): boolean`; `Sheet({ open, onOpenChange, title, description?, blocking?, wide?, footer?, children })`; `MenuItem = { label; onSelect; destructive?; hidden? }`; `Menu({ label, items, triggerClassName?, icon? })`; `MenuList(...)`; `useContextMenu(): { point, close, handlers }`; `ContextMenu({ label, items, point, onClose })`; `Popover({ anchor, label, onClose, children })`; `Tabs<T>({ label, value, options, onChange, idPrefix? })`; `TabPanel({ value, idPrefix?, children })`.

- [ ] **Step 1: Teach the test browser what it lacks**

Add to `src/test/setup.ts`, after the `matchMedia` block:

```ts
// jsdom has no pointer capture. Vaul calls it when a person presses inside a sheet.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
}

// jsdom has no blob URLs. File previews and covers use them.
if (!URL.createObjectURL) {
  URL.createObjectURL = () => 'blob:madar-test';
  URL.revokeObjectURL = () => undefined;
}
```

and add `window.localStorage.clear();` as the first line inside the existing `afterEach`.

- [ ] **Step 2: Write the failing test**

`src/components/overlays.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../i18n';
import { TextField } from './Fields';
import { ContextMenu, Menu, useContextMenu } from './Menu';
import { Popover } from './Popover';
import { Sheet } from './Sheet';
import { TabPanel, Tabs } from './Tabs';

beforeEach(() => {
  initI18n('en');
});

describe('overlays', () => {
  it('opens a sheet with its title and closes it with Escape', async () => {
    function Demo() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Sheet open={open} onOpenChange={setOpen} title="New Project">
            <TextField id="name" label="Name" />
          </Sheet>
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog', { name: 'New Project' });
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves through a menu with the keyboard and hides items the viewer may not use', async () => {
    const onEdit = vi.fn();
    render(
      <Menu
        label="Project actions"
        items={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Delete', onSelect: vi.fn(), hidden: true },
          { label: 'Archive', onSelect: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Project actions' });
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Project actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Archive']);
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('shows no menu button when every item is hidden', () => {
    render(<Menu label="Project actions" items={[{ label: 'Delete', onSelect: vi.fn(), hidden: true }]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens a context menu at the pointer', async () => {
    function Card() {
      const menu = useContextMenu();
      return (
        <div data-testid="card" {...menu.handlers}>
          Card
          <ContextMenu label="Card actions" items={[{ label: 'Open', onSelect: vi.fn() }]} point={menu.point} onClose={menu.close} />
        </div>
      );
    }
    render(<Card />);
    fireEvent.contextMenu(screen.getByTestId('card'), { clientX: 40, clientY: 50 });
    expect(await screen.findByRole('menu', { name: 'Card actions' })).toBeInTheDocument();
  });

  it('closes a popover with Escape and gives the focus back', async () => {
    function Demo() {
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <button type="button" onClick={(event) => setAnchor(event.currentTarget)}>Health</button>
          {anchor && <Popover anchor={anchor} label="Set health" onClose={() => setAnchor(null)}><button type="button">Inside</button></Popover>}
        </>
      );
    }
    render(<Demo />);
    await userEvent.click(screen.getByText('Health'));
    expect(screen.getByRole('dialog', { name: 'Set health' })).toBeInTheDocument();
    expect(screen.getByText('Inside')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Health')).toHaveFocus();
  });

  it('moves between tabs with the arrow keys', async () => {
    function Demo() {
      const [tab, setTab] = useState<'one' | 'two'>('one');
      return (
        <>
          <Tabs label="Sections" value={tab} onChange={setTab} options={[{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }]} />
          <TabPanel value={tab}>{tab}</TabPanel>
        </>
      );
    }
    render(<Demo />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('two');
  });
});
```

- [ ] **Step 3: Run the test to watch it fail**

Run: `npx vitest run src/components/overlays.test.tsx`
Expected: FAIL: `./Menu`, `./Popover`, `./Sheet` and `./Tabs` do not exist.

- [ ] **Step 4: Write the overlays**

`src/app/useIsPhone.ts`:

```ts
import { useSyncExternalStore } from 'react';

const PHONE = '(max-width: 639px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True under 640 px (spec 10.9). Sheets and the schedule change shape on a phone. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
}
```

`src/components/Sheet.tsx`:

```tsx
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'vaul';
import { useIsPhone } from '../app/useIsPhone';

/**
 * A sheet (spec 10.1 and 10.6): a bottom sheet on a phone that follows the finger, a side panel on the end side on desktop.
 * A blocking sheet dims the page and holds the focus. A non-blocking panel (the task panel) leaves the page usable.
 */
export function Sheet({
  open, onOpenChange, title, description, blocking = true, wide = false, footer, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  blocking?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const direction = phone ? 'bottom' : rtl ? 'left' : 'right'; // rtl-ok: Vaul names the screen edge
  const modal = phone || blocking;
  const shape = phone
    ? 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-sheet pb-[env(safe-area-inset-bottom)]'
    : `inset-y-3 end-3 rounded-sheet ${wide ? 'w-[min(40rem,calc(100vw-1.5rem))]' : 'w-[min(30rem,calc(100vw-1.5rem))]'}`;
  const described = description ? {} : { 'aria-describedby': undefined };
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={direction} modal={modal} handleOnly={!phone}>
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="fixed inset-0 z-40 bg-[var(--c-scrim)]" />}
        <Drawer.Content {...described} className={`glass fixed z-50 flex flex-col shadow-float outline-none ${shape}`}>
          {phone && <Drawer.Handle className="mt-2" />}
          <div className="flex items-start gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              <Drawer.Title className="text-title-3 font-bold [text-wrap:balance]">{title}</Drawer.Title>
              {description && <Drawer.Description className="text-footnote text-label-2">{description}</Drawer.Description>}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('common.close')}
              className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-fill text-label-2"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

`src/components/Menu.tsx`:

```tsx
import { AnimatePresence, motion } from 'motion/react';
import { Ellipsis } from 'lucide-react';
import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';

export type MenuItem = { label: string; onSelect: () => void; destructive?: boolean; hidden?: boolean };

/** The list of a menu. It takes the focus, moves with the arrow keys, and closes on Escape, Tab or a press outside. */
export function MenuList({
  label, items, onClose, boundary, className = '', style,
}: {
  label: string;
  items: MenuItem[];
  onClose: (restoreFocus: boolean) => void;
  boundary?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || boundary?.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [onClose, boundary]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      all[(index + 1) % all.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      all[(index - 1 + all.length) % all.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === 'Tab') {
      onClose(false);
    }
  };
  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={spring.standard}
      style={style}
      className={`glass z-50 flex min-w-52 flex-col rounded-2xl p-1.5 shadow-float ${className}`}
    >
      {items.filter((item) => !item.hidden).map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onClose(true);
            item.onSelect();
          }}
          className={`flex min-h-11 w-full items-center rounded-xl px-3 text-start text-body hover:bg-fill focus:bg-fill focus:outline-none ${item.destructive ? 'text-red-text' : 'text-label'}`}
        >
          {item.label}
        </button>
      ))}
    </motion.div>
  );
}

/** A "…" button with a menu that grows from it (spec 10.6). It hides itself when the viewer may use no item. */
export function Menu({ label, items, triggerClassName = '', icon }: { label: string; items: MenuItem[]; triggerClassName?: string; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  if (items.every((item) => item.hidden)) return null;
  const rtl = document.documentElement.dir === 'rtl';
  const origin = { transformOrigin: rtl ? 'top left' : 'top right' }; // rtl-ok: the menu grows from the corner of its button
  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`pressable grid size-11 place-items-center rounded-full ${triggerClassName || 'text-label-2 hover:bg-fill'}`}
      >
        {icon ?? <Ellipsis size={20} aria-hidden />}
      </button>
      <AnimatePresence>
        {open && <MenuList label={label} items={items} onClose={close} boundary={wrapper} className="absolute end-0 top-full mt-1" style={origin} />}
      </AnimatePresence>
    </div>
  );
}

/** Right-click on desktop, or a 500 ms press on a touch screen, opens a menu at the pointer (spec 4.1). */
export function useContextMenu() {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const openAt = (x: number, y: number) => setPoint({ x: Math.min(x, window.innerWidth - 224), y: Math.min(y, window.innerHeight - 240) });
  const cancel = () => {
    window.clearTimeout(timer.current);
    start.current = null;
  };
  const handlers = {
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      openAt(event.clientX, event.clientY);
    },
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'touch') return;
      fired.current = false;
      const { clientX, clientY } = event;
      start.current = { x: clientX, y: clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        openAt(clientX, clientY);
      }, 500);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long press opens the menu. The click that follows it must not open the card.
    onClickCapture: (event: ReactMouseEvent) => {
      if (!fired.current) return;
      event.preventDefault();
      event.stopPropagation();
      fired.current = false;
    },
  };
  const close = useCallback(() => setPoint(null), []);
  return { point, close, handlers };
}

export function ContextMenu({
  label, items, point, onClose,
}: { label: string; items: MenuItem[]; point: { x: number; y: number } | null; onClose: () => void }) {
  const position = point ? { position: 'fixed' as const, top: point.y, left: point.x } : undefined; // rtl-ok: pointer coordinates are screen coordinates
  return createPortal(
    <AnimatePresence>{point && <MenuList label={label} items={items} onClose={onClose} style={position} />}</AnimatePresence>,
    document.body,
  );
}
```

`src/components/Popover.tsx`:

```tsx
import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { spring } from '../design/motion';

/** A small glass panel next to its control, for a short choice. Escape or a press outside closes it. */
export function Popover({ anchor, label, onClose, children }: { anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
  }, []);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [anchor, onClose]);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8); // rtl-ok: screen coordinates
  const below = rect.bottom + 300 < window.innerHeight;
  const place = below ? { top: rect.bottom + 8, left: x } : { bottom: window.innerHeight - rect.top + 8, left: x }; // rtl-ok: screen coordinates
  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
        anchor.focus();
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.standard}
      style={{ position: 'fixed', width, ...place }}
      className="glass z-50 flex flex-col gap-3 rounded-3xl p-4 shadow-float"
    >
      {children}
    </motion.div>,
    document.body,
  );
}
```

`src/components/Tabs.tsx`:

```tsx
import type { KeyboardEvent, ReactNode } from 'react';

/** Tabs for the sections of one screen. The arrow keys move the selection, the end-side arrow forward. */
export function Tabs<T extends string>({
  label, value, options, onChange, idPrefix = 'tab',
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; idPrefix?: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const step = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    document.getElementById(`${idPrefix}-${next.value}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${idPrefix}-${option.value}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`pressable min-h-11 shrink-0 rounded-full px-4 text-subheadline font-semibold ${selected ? 'bg-label text-bg' : 'text-label-2 hover:bg-fill'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, idPrefix = 'tab', children }: { value: string; idPrefix?: string; children: ReactNode }) {
  return (
    <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-${value}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src/components src/app`
Expected: PASS, and the plan 1 shell tests still pass with the new setup lines.

- [ ] **Step 6: Commit**

```bash
git add src/app/useIsPhone.ts src/components src/test/setup.ts
git commit -m "feat: add sheets, menus, context menus, popovers and tabs" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 5: Undo toasts, retry, stored choices and file URLs

**Files:**
- Create: `src/app/actions.ts`, `src/app/choices.ts`, `src/app/files.ts`
- Modify: `src/app/errors.ts`, `src/app/runtime.tsx`, `src/test/render.tsx`
- Test: `src/app/actions.test.tsx`

**Interfaces:**
- Consumes: `events.undoStory` (Task 1), `useRuntime`, `useToast`, `errorMessage`.
- Produces: `canRetry(error): boolean`; `useAction` now offers Retry on a failed call; `newStoryId(): string`; `useUndoable<N>(name, { message(output): string; onSuccess?(output) })` returning a TanStack mutation over `CallInput<N>`; `usePersistentChoice<T>(key, allowed, fallback): [T, (next: T) => void]`; `useFileUrl(fileId: string | null, letter?: string): string | null`; `downloadFile(api, fileId, letter?)`; test helper `renderWithRuntime(ui, prepare?, options?)`.

- [ ] **Step 1: Write the failing test**

Add to `src/test/render.tsx` (import `createApi` options type as needed; `ReactElement` from `react`):

```tsx
/** Renders one component with the API, the toasts and the sample office, for hook tests. */
export async function renderWithRuntime(ui: ReactElement, prepare?: (state: State) => void, options: { failureRate?: () => number } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  prepare?.(state);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0, failureRate: options.failureRate });
  initI18n('en');
  const view = render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>{ui}</ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api };
}
```

`src/app/actions.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { renderWithRuntime } from '../test/render';
import { useUndoable } from './actions';
import { useRuntime } from './runtime';
import { usePersistentChoice } from './choices';
import { useFileUrl } from './files';

function Tick() {
  const complete = useUndoable('tasks.complete', { message: () => 'Task done.' });
  return <button type="button" onClick={() => complete.mutate({ id: 'tsk_009' })}>Tick</button>;
}
const asFaisal = (state: { session: { currentUserId: string } }) => {
  state.session.currentUserId = 'usr_002';
};

describe('undo toasts', () => {
  it('undoes the whole action from the toast', async () => {
    const { store } = await renderWithRuntime(<Tick />, asFaisal);
    await userEvent.click(screen.getByText('Tick'));
    expect(await screen.findByText('Task done.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_009.status).toBe('done');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_009.status).toBe('todo'));
  });

  it('says so when the item changed after the action, and changes nothing', async () => {
    const { store, api } = await renderWithRuntime(<Tick />, asFaisal);
    await userEvent.click(screen.getByText('Tick'));
    await screen.findByText('Task done.');
    await api.call('tasks.move', { id: 'tsk_009', status: 'in_progress' });
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('This item changed after that edit. Undo is not available.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_009.status).toBe('in_progress');
  });

  it('offers Retry when a call fails', async () => {
    let calls = 0;
    const { store } = await renderWithRuntime(<Tick />, asFaisal, { failureRate: () => (calls++ === 0 ? 1 : 0) });
    await userEvent.click(screen.getByText('Tick'));
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Task done.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_009.status).toBe('done');
  });
});

describe('stored choices', () => {
  function Choice() {
    const [view, setView] = usePersistentChoice('madar.test.view', ['grid', 'list'] as const, 'grid');
    return <button type="button" onClick={() => setView('list')}>{view}</button>;
  }

  it('keeps a choice for the next visit and ignores a stored value it does not know', async () => {
    const first = await renderWithRuntime(<Choice />);
    await userEvent.click(screen.getByText('grid'));
    expect(screen.getByText('list')).toBeInTheDocument();
    first.unmount();
    await renderWithRuntime(<Choice />);
    expect(screen.getByText('list')).toBeInTheDocument();
    window.localStorage.setItem('madar.test.view', 'cards');
    await renderWithRuntime(<Choice />);
    expect(screen.getAllByText('grid').length).toBeGreaterThan(0);
  });
});

describe('file URLs', () => {
  function UploadThenPreview() {
    const { api } = useRuntime();
    const [fileId, setFileId] = useState<string | null>(null);
    useEffect(() => {
      void api.call('files.upload', { projectId: 'prj_001', name: 'Note.png', blob: new Blob(['x'], { type: 'image/png' }) })
        .then((view) => setFileId(view.file.id));
    }, [api]);
    const url = useFileUrl(fileId, 'A');
    return url ? <img src={url} alt="Preview" /> : <span>Loading</span>;
  }

  it('gives a blob URL for a stored file', async () => {
    await renderWithRuntime(<UploadThenPreview />, asFaisal);
    expect(await screen.findByRole('img', { name: 'Preview' })).toHaveAttribute('src', 'blob:madar-test');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/app/actions.test.tsx`
Expected: FAIL: `./actions`, `./choices` and `./files` do not exist.

- [ ] **Step 3: Write the hooks**

Add to `src/app/errors.ts`:

```ts
/** Only a failed call is worth a retry. A refusal or an invalid field stays the same on a retry. */
export function canRetry(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'failed';
}
```

Replace `useAction` in `src/app/runtime.tsx` with (add `useRef` to the React import and `canRetry` to the errors import):

```tsx
export function useAction<N extends CallName>(name: N, options: { onSuccess?: (output: CallOutput<N>) => void } = {}) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const mutation = useMutation<CallOutput<N>, unknown, CallInput<N>>({
    mutationFn: (input) => api.call(name, input),
    onSuccess: (output) => options.onSuccess?.(output),
    onError: (error, input) => toast.show({
      tone: 'error',
      message: errorMessage(error, t),
      action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input) } : undefined,
    }),
  });
  retry.current = mutation.mutate;
  return mutation;
}
```

`src/app/actions.ts`:

```ts
import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput } from '../api/calls';
import { canRetry, errorMessage } from './errors';
import { useRuntime } from './runtime';
import { useToast } from './toasts';

/** A story ID for one action on screen. Every change the action makes carries it, so one Undo reverses them all. */
export function newStoryId(): string {
  return `cor_ui_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Runs a change and offers Undo for 5 seconds (spec 5.5 and 11.5). A failed call offers Retry (spec 11.6). */
export function useUndoable<N extends CallName>(
  name: N,
  options: { message: (output: CallOutput<N>) => string; onSuccess?: (output: CallOutput<N>) => void },
) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const retry = useRef<(input: CallInput<N>) => void>(() => undefined);
  const mutation = useMutation<{ output: CallOutput<N>; storyId: string }, unknown, CallInput<N>>({
    mutationFn: async (input) => {
      const storyId = newStoryId();
      return { output: await api.call(name, input, { correlationId: storyId }), storyId };
    },
    onSuccess: ({ output, storyId }) => {
      latest.current.onSuccess?.(output);
      toast.show({
        message: latest.current.message(output),
        action: {
          label: t('common.undo'),
          run: () => {
            api.call('events.undoStory', { correlationId: storyId }).catch((error: unknown) => {
              toast.show({ tone: 'error', message: errorMessage(error, t) });
            });
          },
        },
      });
    },
    onError: (error, input) => toast.show({
      tone: 'error',
      message: errorMessage(error, t),
      action: canRetry(error) ? { label: t('common.retry'), run: () => retry.current(input) } : undefined,
    }),
  });
  retry.current = mutation.mutate;
  return mutation;
}
```

`src/app/choices.ts`:

```ts
import { useCallback, useState } from 'react';

/** A per-viewer choice that lasts to the next visit, such as grid or list. Blocked storage makes it last for this visit only. */
export function usePersistentChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Storage is blocked. The choice lasts for this visit only.
    }
  }, [key]);
  return [value, choose];
}
```

`src/app/files.ts`:

```ts
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MadarApi } from '../api/calls';
import { useRuntime } from './runtime';

/**
 * A blob URL for a stored file version, for img and iframe tags. The query key sits outside the "api" keys,
 * so a change elsewhere in the office does not load the file again. The URL is released when it is not needed.
 */
export function useFileUrl(fileId: string | null, letter?: string): string | null {
  const { api } = useRuntime();
  const query = useQuery({
    queryKey: ['file-blob', fileId, letter ?? 'latest'],
    queryFn: () => api.call('files.get', { id: fileId as string, letter }),
    enabled: fileId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const blob = query.data?.blob;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Saves a stored file to the computer. The review link frame blocks this (plan clarification 9). */
export async function downloadFile(api: MadarApi, fileId: string, letter?: string): Promise<void> {
  const { blob, file } = await api.call('files.get', { id: fileId, letter });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app src/test/render.tsx
git commit -m "feat: add undo toasts with story IDs, retry, stored choices and file URLs" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 6: The project card and the compact row

**Files:**
- Create: `src/features/projects/feed.ts`, `src/features/projects/FeedLine.tsx`, `src/features/projects/cardMenu.ts`, `src/features/projects/ProjectCard.tsx`, `src/features/projects/ProjectRow.tsx`
- Modify: `src/test/render.tsx` (a `path` option for `renderWithRuntime`)
- Test: `src/features/projects/feed.test.ts`, `src/features/projects/ProjectCard.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 5 (`ProjectSummary.viewerCan`, `healthSetBy`, the kit, `useUndoable`, `useFileUrl`, `useContextMenu`).
- Produces: `feedText(item: FeedItem, t: TFunction): string`; `FeedLine({ item })`; `copyLink(path, show, t)`; `useCardMenu(summary): MenuItem[]`; `ProjectCover({ summary, className? })`; `NextDeadlineLabel({ deadline })`; `People({ summary })`; `ProjectCard({ summary })`; `ProjectRow({ summary })`; `renderWithRuntime(ui, prepare?, { failureRate?, path? })`.

- [ ] **Step 1: Let hook tests render inside a router**

In `src/test/render.tsx`, add `createMemoryRouter` to the `react-router` import, add `path?: string` to the options type of `renderWithRuntime`, and render `content` instead of `ui`:

```tsx
  const content = options.path === undefined
    ? ui
    : <RouterProvider router={createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [options.path] })} />;
```

- [ ] **Step 2: Write the failing tests**

`src/features/projects/feed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { initI18n } from '../../i18n';
import { STAMP } from '../../test/factories';
import { feedText } from './feed';

initI18n('en');
const t = i18n.t.bind(i18n);
const author = { id: 'usr_002', name: 'Faisal Al-Harbi', avatarUrl: null, kind: 'human' as const, discipline: 'Architect' };
const event = (verb: string, label: string, detail: Record<string, string> = {}): FeedItem => ({
  kind: 'event', id: 'evt_001', at: STAMP, author, verb, targetType: 'task', targetId: 'tsk_001', label, detail,
});

describe('feed sentences', () => {
  it('writes one sentence per event', () => {
    expect(feedText(event('task.status_changed', 'Stair details', { status: 'in_review' }), t)).toBe('sent “Stair details” to review');
    expect(feedText(event('task.created', 'Stair details'), t)).toBe('added the task “Stair details”');
    expect(feedText(event('file.version_added', 'Plan.pdf', { version: 'B' }), t)).toBe('added version B of “Plan.pdf”');
    expect(feedText(event('project.leader_changed', 'Tower', { leader: '' }), t)).toBe('removed the leader');
    expect(feedText(event('task.deleted', 'Stair details'), t)).toBe('made a change');
  });

  it('gives the text of a post with mentions as names', () => {
    const post: FeedItem = {
      kind: 'update', id: 'upd_001', at: STAMP, author, body: 'Hi @[Sara Al-Qahtani](usr_005)', fileIds: [], editedAt: null, commentCount: 0,
    };
    expect(feedText(post, t)).toBe('Hi @Sara Al-Qahtani');
  });
});
```

`src/features/projects/ProjectCard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { useCall } from '../../app/runtime';
import { renderWithRuntime } from '../../test/render';
import { ProjectCard } from './ProjectCard';

function Card({ id }: { id: string }) {
  const list = useCall('projects.list', { status: 'all' });
  const summary = list.data?.find((s) => s.project.id === id);
  return summary ? <ProjectCard summary={summary} /> : null;
}
const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const openMenu = async () => {
  fireEvent.contextMenu(await screen.findByRole('link', { name: /Corniche Office Tower/ }), { clientX: 20, clientY: 20 });
  return within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
};

describe('the project card', () => {
  it('shows the code, health, client, stage, latest updates, next deadline and people', async () => {
    await renderWithRuntime(<Card id="prj_001" />, undefined, { path: '/' });
    const card = await screen.findByRole('link', { name: /Corniche Office Tower/ });
    expect(within(card).getAllByText('KH-26-001').length).toBeGreaterThan(0);
    expect(within(card).getByText('Late')).toBeInTheDocument();
    expect(within(card).getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(within(card).getByRole('list', { name: 'Stage 4 of 7: Construction Documents' })).toBeInTheDocument();
    expect(within(within(card).getByRole('list', { name: 'Latest updates' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(card).getByText('Coordination workshop').closest('p')).toHaveTextContent('Coordination workshop · 5 Oct · 5d');
    expect(within(within(card).getByRole('group', { name: 'Team' })).getAllByRole('img')[0]).toHaveAccessibleName('Faisal Al-Harbi');
  });

  it('shows the code on a tinted panel when there is no cover, and says when there is no leader', async () => {
    await renderWithRuntime(<Card id="prj_005" />, (state) => {
      state.projects.prj_005.leaderId = null;
    }, { path: '/' });
    expect(await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' })).toHaveTextContent('KH-26-005');
    expect(screen.getByText('No leader')).toBeInTheDocument();
  });

  it('offers a person outside the project only Open and Copy link', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_004'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Copy link']);
  });

  it('lets a team member post, but not archive', async () => {
    await renderWithRuntime(<Card id="prj_001" />, as('usr_005'), { path: '/' });
    expect(await openMenu()).toEqual(['Open', 'Post update', 'Copy link']);
  });

  it('archives the project from the menu, then undoes it', async () => {
    const { store } = await renderWithRuntime(<Card id="prj_001" />, as('usr_002'), { path: '/' });
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Project archived.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.status).toBe('archived');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.projects.prj_001.status).toBe('active'));
  });
});
```

- [ ] **Step 3: Run the tests to watch them fail**

Run: `npx vitest run src/features/projects`
Expected: FAIL: `./feed` and `./ProjectCard` do not exist.

- [ ] **Step 4: Write the card**

`src/features/projects/feed.ts`:

```ts
import type { TFunction } from 'i18next';
import type { FeedItem } from '../../api/contract/views';
import { plainText } from '../../lib/text';

const SIMPLE = new Set(['project.created', 'task.created', 'task.approved', 'task.sent_back', 'file.added', 'member.added']);

/** One line for a feed item, without the author's name: the text of a post, or a sentence for an event (spec 5.2). */
export function feedText(item: FeedItem, t: TFunction): string {
  if (item.kind === 'update') return plainText(item.body);
  const { label, detail } = item;
  if (item.verb === 'task.status_changed') return t(`feed.task.${detail.status ?? 'done'}`, { label });
  if (item.verb === 'project.stage_changed') return t('feed.project.stage_changed', { stage: detail.stage ?? '' });
  if (item.verb === 'project.leader_changed') {
    return detail.leader ? t('feed.project.leader_changed', { leader: detail.leader }) : t('feed.project.leader_cleared');
  }
  if (item.verb === 'file.version_added') return t('feed.file.version_added', { label, version: detail.version ?? '' });
  if (SIMPLE.has(item.verb)) return t(`feed.${item.verb}`, { label });
  return t('feed.other');
}
```

`src/features/projects/FeedLine.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { FeedItem } from '../../api/contract/views';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { feedText } from './feed';

/** One latest update on a card: the avatar, one line of text and the age (spec 4.1). */
export function FeedLine({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Avatar user={item.author} size={20} />
      <p className="min-w-0 flex-1 truncate text-footnote">
        <bdi className="font-semibold">{item.author.name.split(' ')[0]}</bdi>{' '}
        {item.author.kind === 'agent' && <><AgentLabel />{' '}</>}
        <bdi className="text-label-2">{feedText(item, t)}</bdi>
      </p>
      <span className="shrink-0 text-caption text-label-2"><Age stamp={item.at} /></span>
    </li>
  );
}
```

`src/features/projects/cardMenu.ts`:

```ts
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useToast, type ToastInput } from '../../app/toasts';
import type { MenuItem } from '../../components/Menu';

/** Copies a link that opens the project in the app. */
export function copyLink(path: string, show: (toast: ToastInput) => void, t: TFunction): void {
  const url = `${window.location.origin}${window.location.pathname}#${path}`;
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(url))
    .then(() => show({ message: t('projects.linkCopied') }))
    .catch(() => show({ tone: 'error', message: t('errors.failed') }));
}

/** Open, Post update, Copy link, Archive: only what the viewer may do (spec 4.1). */
export function useCardMenu(summary: ProjectSummary): MenuItem[] {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const archive = useUndoable('projects.setStatus', { message: () => t('projects.archived') });
  const { project, viewerCan } = summary;
  const path = `/projects/${project.id}`;
  return [
    { label: t('projects.open'), onSelect: () => navigate(path) },
    { label: t('projects.postUpdate'), onSelect: () => navigate(`${path}?compose=1`), hidden: !viewerCan.post },
    { label: t('projects.copyLink'), onSelect: () => copyLink(path, toast.show, t) },
    {
      label: t('projects.archive'),
      onSelect: () => archive.mutate({ id: project.id, status: 'archived' }),
      hidden: !viewerCan.archive || project.status === 'archived',
    },
  ];
}
```

`src/features/projects/ProjectCard.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { useFileUrl } from '../../app/files';
import { useLang } from '../../app/lang';
import { tintOf } from '../../components/Avatar';
import { AvatarStack } from '../../components/AvatarStack';
import { HealthPill } from '../../components/HealthPill';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { StageRail } from '../../components/StageRail';
import { formatDay } from '../../lib/dates';
import { useCardMenu } from './cardMenu';
import { FeedLine } from './FeedLine';

/** The latest render at 16:9, or a tinted panel with the project code when there is no cover (spec 4.1). */
export function ProjectCover({ summary, className = 'aspect-video' }: { summary: ProjectSummary; className?: string }) {
  const { t } = useTranslation();
  const url = useFileUrl(summary.project.coverFileId);
  const label = t('projects.cover', { name: summary.project.name });
  if (url) return <img src={url} alt={label} className={`w-full object-cover ${className}`} />;
  return (
    <div role="img" aria-label={label} style={{ background: tintOf(summary.project.id) }} className={`grid w-full place-items-center ${className}`}>
      <span className="tabular text-title-2 font-bold text-white">{summary.project.code}</span>
    </div>
  );
}

/** "12 Oct · 5d". A deadline in the past shows in red (spec 4.1). */
export function NextDeadlineLabel({ deadline }: { deadline: ProjectSummary['nextDeadline'] }) {
  const { t } = useTranslation();
  const lang = useLang();
  if (!deadline) return <span className="text-footnote text-label-2">{t('projects.noDeadline')}</span>;
  const late = deadline.daysLeft < 0;
  const left = late
    ? t('time.daysLate', { n: -deadline.daysLeft })
    : deadline.daysLeft === 0 ? t('time.today') : t('time.daysLeft', { n: deadline.daysLeft });
  return (
    <p className={`min-w-0 truncate text-footnote ${late ? 'text-red-text' : 'text-label-2'}`}>
      <bdi className={`font-medium ${late ? '' : 'text-label'}`}>{deadline.name}</bdi>
      <span className="tabular"> · {formatDay(deadline.date, lang)} · {left}</span>
    </p>
  );
}

export function People({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('overview.team')} className="flex shrink-0 items-center gap-2">
      {!summary.leader && <span className="text-caption text-label-2">{t('projects.noLeader')}</span>}
      <AvatarStack leader={summary.leader} team={summary.team} />
    </div>
  );
}

export function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  return (
    <article className="relative h-full" {...menu.handlers}>
      <Link to={`/projects/${project.id}`} className="pressable surface flex h-full flex-col overflow-hidden rounded-card">
        <ProjectCover summary={summary} />
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthPill health={summary.health} status={project.status} setBy={summary.healthSetBy} />
          </div>
          <div className="min-w-0">
            <h2 dir="auto" className="line-clamp-2 text-headline">{project.name}</h2>
            {summary.client && <p dir="auto" className="truncate text-footnote text-label-2">{summary.client.name}</p>}
          </div>
          <StageRail stages={summary.stages} currentId={summary.currentStage.id} />
          <ul aria-label={t('projects.latest')} className="flex flex-col gap-1.5">
            {summary.latest.length > 0
              ? summary.latest.map((item) => <FeedLine key={item.id} item={item} />)
              : <li className="text-footnote text-label-2">{t('projects.noUpdates')}</li>}
          </ul>
          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <NextDeadlineLabel deadline={summary.nextDeadline} />
            <People summary={summary} />
          </div>
        </div>
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </article>
  );
}
```

`src/features/projects/ProjectRow.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { HealthPill } from '../../components/HealthPill';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { StageRail } from '../../components/StageRail';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel, People } from './ProjectCard';

/** The compact list: one row per project, the same data as the card without the cover (spec 4.3). */
export function ProjectRow({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  return (
    <li {...menu.handlers}>
      <Link to={`/projects/${project.id}`} className="pressable surface flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card p-4">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthPill health={summary.health} status={project.status} setBy={summary.healthSetBy} />
          </div>
          <p dir="auto" className="truncate text-headline">{project.name}</p>
          {summary.client && <p dir="auto" className="truncate text-footnote text-label-2">{summary.client.name}</p>}
        </div>
        <div className="min-w-0 basis-56"><StageRail stages={summary.stages} currentId={summary.currentStage.id} /></div>
        <div className="min-w-0 basis-48"><NextDeadlineLabel deadline={summary.nextDeadline} /></div>
        <People summary={summary} />
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </li>
  );
}
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npx vitest run src/features/projects`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/projects src/test/render.tsx
git commit -m "feat: add the project card, the compact row and the card menu" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 7: The New Project sheet

**Files:**
- Create: `src/features/projects/ProjectFields.tsx`, `src/features/projects/NewProjectSheet.tsx`
- Test: `src/features/projects/NewProjectSheet.test.tsx`

**Interfaces:**
- Consumes: `emptyProjectForm`, `validateProjectForm`, `ProjectFormValues`, `ProjectFormErrors` (Task 2), `Sheet`, fields, `Avatar`, `IconButton`, `useAction`, `useCall`, `useRuntime`, `useToast`, `errorMessage`.
- Produces: `useProjectForm(initial): ProjectForm` with `{ values, errors, set, touch, check, reset }`; `ProjectFields({ form, mode: 'create' | 'edit' })`; `NewProjectSheet({ open, onOpenChange })`.

- [ ] **Step 1: Write the failing test**

`src/features/projects/NewProjectSheet.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

async function openSheet() {
  const view = await renderWithRuntime(<Harness />, undefined, { path: '/' });
  await userEvent.click(screen.getByText('Start'));
  return { ...view, sheet: await screen.findByRole('dialog', { name: 'New Project' }) };
}

describe('the New Project sheet', () => {
  it('checks each field when the person leaves it', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByLabelText('Name'));
    await userEvent.tab();
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-10-10' } });
    const end = within(sheet).getByLabelText('Target end date');
    fireEvent.change(end, { target: { value: '2026-10-01' } });
    fireEvent.blur(end);
    expect(await within(sheet).findByText('The end date must be after the start date.')).toBeInTheDocument();
  });

  it('shows every error on submit and creates nothing', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByLabelText('Name')).toHaveFocus());
    expect(Object.keys(store.state.projects)).toHaveLength(12);
  });

  it('creates a project with a new client, another leader and a team', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('Client name'), 'Harbour Holding');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect((within(sheet).getByLabelText('Client') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Harbour Holding'));
    await userEvent.selectOptions(within(sheet).getByLabelText('Leader'), 'Faisal Al-Harbi');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Sara Al-Qahtani/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText(/KH-26-\d{3} created\./)).toBeInTheDocument();
    const project = Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices');
    expect(project?.leaderId).toBe('usr_002');
    expect(store.state.clients[project!.clientId!].name).toBe('Harbour Holding');
    expect(store.state.members[`${project!.id}:usr_005`]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/projects/NewProjectSheet.test.tsx`
Expected: FAIL: `./NewProjectSheet` does not exist.

- [ ] **Step 3: Write the form parts**

`src/features/projects/ProjectFields.tsx`:

```tsx
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Client, User } from '../../api/contract/entities';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { SelectField, TextArea, TextField } from '../../components/Fields';
import { IconButton } from '../../components/IconButton';
import { validateProjectForm, type ProjectFormErrors, type ProjectFormValues } from './projectForm';

const CHECKED: (keyof ProjectFormErrors)[] = ['name', 'area', 'targetEndDate', 'stages'];

/** Form state that shows an error only after the person leaves the field, or on submit (spec 4.4). */
export function useProjectForm(initial: ProjectFormValues) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const all = validateProjectForm(values);
  const errors = Object.fromEntries(Object.entries(all).filter(([field]) => touched.has(field))) as ProjectFormErrors;
  return {
    values,
    errors,
    set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
      setValues((current) => ({ ...current, [key]: value }));
    },
    touch(field: keyof ProjectFormErrors) {
      setTouched((current) => new Set(current).add(field));
    },
    /** Shows every error. True when the form can go. */
    check(): boolean {
      setTouched(new Set(CHECKED));
      return Object.keys(all).length === 0;
    },
    reset(next: ProjectFormValues) {
      setValues(next);
      setTouched(new Set());
    },
  };
}
export type ProjectForm = ReturnType<typeof useProjectForm>;

function ClientPicker({ value, onChange, clients }: { value: string; onChange: (id: string) => void; clients: Client[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const empty = { name: '', contactName: '', phone: '', email: '' };
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(empty);
  const create = useAction('clients.create', {
    onSuccess: (client) => {
      onChange(client.id);
      setAdding(false);
      setDraft(empty);
      toast.show({ message: t('projectForm.clientAdded') });
    },
  });
  const field = (key: keyof typeof empty) => ({
    value: draft[key],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value })),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <SelectField id="project-client" className="flex-1" label={t('projectForm.client')} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{t('projectForm.noClient')}</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </SelectField>
        <Button aria-expanded={adding} onClick={() => setAdding((open) => !open)}>{t('projectForm.newClient')}</Button>
      </div>
      {adding && (
        <div className="grid gap-3 rounded-2xl bg-fill p-3 sm:grid-cols-2">
          <TextField id="client-name" label={t('projectForm.clientName')} dir="auto" {...field('name')} />
          <TextField id="client-contact" label={t('projectForm.contactName')} dir="auto" {...field('contactName')} />
          <TextField id="client-phone" type="tel" dir="ltr" label={t('projectForm.phone')} {...field('phone')} />
          <TextField id="client-email" type="email" dir="ltr" label={t('projectForm.email')} {...field('email')} />
          <Button
            variant="primary"
            className="sm:col-span-2"
            disabled={!draft.name.trim() || create.isPending}
            onClick={() => create.mutate({ ...draft, name: draft.name.trim() })}
          >
            {t('projectForm.addClient')}
          </Button>
        </div>
      )}
    </div>
  );
}

function StageList({
  stages, onChange, onBlur, error,
}: { stages: ProjectFormValues['stages']; onChange: (stages: ProjectFormValues['stages']) => void; onBlur: () => void; error?: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-footnote text-label-2">{t('projectForm.stages')}</legend>
      <ol className="flex flex-col gap-2">
        {stages.map((stage, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              aria-label={t('projectForm.stageName', { n: i + 1 })}
              value={stage.name}
              dir="auto"
              onChange={(event) => onChange(stages.map((s, j) => (j === i ? { ...s, name: event.target.value } : s)))}
              onBlur={onBlur}
              className="min-h-11 min-w-0 flex-1 rounded-control bg-fill px-3 text-body text-label"
            />
            <IconButton label={t('projectForm.removeStage', { name: stage.name || String(i + 1) })} onClick={() => onChange(stages.filter((_, j) => j !== i))}>
              <X size={16} aria-hidden />
            </IconButton>
          </li>
        ))}
      </ol>
      <Button className="self-start" onClick={() => onChange([...stages, { name: '' }])}>
        <Plus size={16} aria-hidden />
        {t('projectForm.addStage')}
      </Button>
      {error && <p role="alert" className="text-footnote text-red-text">{error}</p>}
    </fieldset>
  );
}

function TeamPicker({ people, value, onChange }: { people: User[]; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="pb-1 text-footnote text-label-2">{t('projectForm.team')}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {people.map((person) => (
          <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-fill">
            <input
              type="checkbox"
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={value.includes(person.id)}
              onChange={(event) => onChange(event.target.checked ? [...value, person.id] : value.filter((id) => id !== person.id))}
            />
            <Avatar user={person} size={28} />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
            <span className="text-footnote text-label-2">{person.discipline}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The project fields of spec 4.4. "edit" leaves out the leader and the team, which the header and the Team tab change. */
export function ProjectFields({ form, mode }: { form: ProjectForm; mode: 'create' | 'edit' }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const users = useCall('users.list', {});
  const clients = useCall('clients.list', {});
  const meId = session.data?.authority.id;
  const people = (users.data ?? []).filter((user) => user.kind === 'human' && user.id !== meId);
  const { values, errors, set, touch } = form;
  const error = (field: keyof ProjectFormErrors) => (errors[field] ? t(errors[field] as string) : undefined);
  return (
    <div className="flex flex-col gap-4">
      <TextField
        id="project-name"
        label={t('projectForm.name')}
        value={values.name}
        dir="auto"
        autoComplete="off"
        required
        onChange={(event) => set('name', event.target.value)}
        onBlur={() => touch('name')}
        error={error('name')}
      />
      <ClientPicker value={values.clientId} onChange={(id) => set('clientId', id)} clients={clients.data ?? []} />
      {mode === 'create' && (
        <SelectField id="project-leader" label={t('projectForm.leader')} value={values.leader} onChange={(event) => set('leader', event.target.value)}>
          <option value="me">{t('projectForm.leaderMe')}</option>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          <option value="none">{t('projectForm.leaderNone')}</option>
        </SelectField>
      )}
      <TextField
        id="project-location"
        label={t('projectForm.location')}
        hint={t('projectForm.locationHint')}
        value={values.location}
        dir="auto"
        onChange={(event) => set('location', event.target.value)}
      />
      <TextField
        id="project-area"
        label={t('projectForm.area')}
        inputMode="decimal"
        value={values.area}
        onChange={(event) => set('area', event.target.value)}
        onBlur={() => touch('area')}
        error={error('area')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="project-start" type="date" label={t('projectForm.startDate')} value={values.startDate} onChange={(event) => set('startDate', event.target.value)} />
        <TextField
          id="project-end"
          type="date"
          label={t('projectForm.endDate')}
          value={values.targetEndDate}
          onChange={(event) => set('targetEndDate', event.target.value)}
          onBlur={() => touch('targetEndDate')}
          error={error('targetEndDate')}
        />
      </div>
      <StageList stages={values.stages} onChange={(stages) => set('stages', stages)} onBlur={() => touch('stages')} error={error('stages')} />
      {mode === 'create' && <TeamPicker people={people} value={values.teamIds} onChange={(ids) => set('teamIds', ids)} />}
      <TextField
        id="project-folder"
        label={t('projectForm.modelFolder')}
        hint={t('projectForm.modelFolderHint')}
        value={values.modelFolderPath}
        dir="ltr"
        onChange={(event) => set('modelFolderPath', event.target.value)}
      />
      <TextArea id="project-description" label={t('projectForm.description')} value={values.description} dir="auto" onChange={(event) => set('description', event.target.value)} />
    </div>
  );
}
```

`src/features/projects/NewProjectSheet.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MAX_FILE_BYTES } from '../../api/contract/entities';
import { errorMessage } from '../../app/errors';
import { useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { emptyProjectForm } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';

function focusFirstError(): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

/** Anyone can create a project (spec 2.2). Only the name is required (spec 4.4). */
export function NewProjectSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { api } = useRuntime();
  const settings = useCall('settings.get', {});
  const defaults = settings.data?.defaultStages ?? [];
  const form = useProjectForm(emptyProjectForm(defaults));
  const [cover, setCover] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.reset(emptyProjectForm(settings.data?.defaultStages ?? []));
    setCover(null);
    // The form starts empty each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.data]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.check()) {
      focusFirstError();
      return;
    }
    const v = form.values;
    setSaving(true);
    try {
      const detail = await api.call('projects.create', {
        name: v.name.trim(),
        clientId: v.clientId || null,
        leader: v.leader,
        location: v.location.trim(),
        areaM2: v.area.trim() ? Number(v.area) : null,
        startDate: v.startDate || null,
        targetEndDate: v.targetEndDate || null,
        stages: v.stages.map((stage) => stage.name.trim()),
        teamIds: v.teamIds,
        modelFolderPath: v.modelFolderPath.trim(),
        description: v.description.trim(),
      });
      if (cover && cover.size > MAX_FILE_BYTES) {
        toast.show({ tone: 'error', message: t('files.tooBig', { name: cover.name }) });
      } else if (cover) {
        await api.call('files.upload', { projectId: detail.project.id, name: cover.name, blob: cover, stageId: detail.currentStage.id, asCover: true });
      }
      toast.show({ message: t('projectForm.created', { code: detail.project.code }) });
      onOpenChange(false);
      navigate(`/projects/${detail.project.id}`);
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('projectForm.createTitle')}
      wide
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="new-project" disabled={saving}>{t('projectForm.create')}</Button>
        </>
      )}
    >
      <form id="new-project" noValidate onSubmit={submit} className="flex flex-col gap-4 pt-2">
        <ProjectFields form={form} mode="create" />
        <div className="flex flex-col gap-1">
          <label htmlFor="project-cover" className="text-footnote text-label-2">{t('projectForm.cover')}</label>
          <input
            id="project-cover"
            type="file"
            accept="image/*"
            onChange={(event) => setCover(event.target.files?.[0] ?? null)}
            className="text-subheadline file:me-3 file:min-h-11 file:rounded-full file:border-0 file:bg-fill file:px-4 file:text-label"
          />
        </div>
      </form>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run the test to watch it pass**

Run: `npx vitest run src/features/projects`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects
git commit -m "feat: add the New Project sheet with inline checks and a new-client form" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 8: The Projects screen

**Files:**
- Create: `src/features/projects/ProjectsScreen.tsx`
- Modify: `src/app/routes.tsx`
- Test: `src/features/projects/ProjectsScreen.test.tsx`

**Interfaces:**
- Consumes: `ProjectCard`, `ProjectRow`, `NewProjectSheet`, `ChipGroup`, `SegmentedControl`, `usePersistentChoice`, `projects.list`, `settings.get`.
- Produces: `ProjectsScreen()` at the route `/`.

- [ ] **Step 1: Write the failing test**

`src/features/projects/ProjectsScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const cards = () => screen.queryAllByRole('article');

describe('the Projects screen', () => {
  it('shows the 10 active projects as cards', async () => {
    await renderApp('/');
    expect(await screen.findByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(cards()).toHaveLength(10);
  });

  it('filters to the late and at-risk projects', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'At risk' }));
    await waitFor(() => expect(cards()).toHaveLength(5));
  });

  it('filters by the current stage and by status', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'Permits' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Corniche Office Tower/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Al Waha Clinic Fit-out/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'on_hold');
    expect(await screen.findByRole('link', { name: /Gulf Crest HQ Interiors/ })).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
  });

  it("shows a member only their projects under My projects", async () => {
    await renderApp('/', (state) => {
      state.session.currentUserId = 'usr_005';
    });
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.click(screen.getByRole('radio', { name: 'My projects' }));
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(screen.queryByRole('link', { name: /Tamr Boutique Hotel/ })).toBeNull();
  });

  it('sorts by name and keeps the list view for the next visit', async () => {
    const first = await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'name');
    await waitFor(() => expect(within(cards()[0]).getByRole('heading')).toHaveTextContent('Al Waha Clinic Fit-out'));
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    await waitFor(() => expect(cards()).toHaveLength(0));
    expect(screen.getAllByRole('link', { name: /KH-/ }).length).toBe(10);
    first.unmount();
    await renderApp('/');
    expect(await screen.findByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says when nothing matches and offers a way back', async () => {
    await renderApp('/');
    await screen.findByRole('link', { name: /Corniche Office Tower/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'archived');
    expect(await screen.findByText('No projects match these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(cards()).toHaveLength(12));
  });

  it('opens the New Project sheet', async () => {
    await renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: 'New Project' }));
    expect(await screen.findByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/projects/ProjectsScreen.test.tsx`
Expected: FAIL: `./ProjectsScreen` does not exist.

- [ ] **Step 3: Write the screen**

`src/features/projects/ProjectsScreen.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePersistentChoice } from '../../app/choices';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { ChipGroup } from '../../components/Chip';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectCard } from './ProjectCard';
import { ProjectRow } from './ProjectRow';

const STATUSES = ['active', 'on_hold', 'completed', 'archived', 'all'] as const;
const SORTS = ['updated', 'deadline', 'name'] as const;
const VIEWS = ['grid', 'list'] as const;
const SELECT = 'min-h-11 rounded-full bg-fill px-4 text-subheadline text-label';

/** The home screen: a grid of project cards with filters, sort and a list view (spec 4.3). */
export function ProjectsScreen() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('active');
  const [sort, setSort] = usePersistentChoice('madar.projects.sort', SORTS, 'updated');
  const [view, setView] = usePersistentChoice('madar.projects.view', VIEWS, 'grid');
  const [creating, setCreating] = useState(false);
  const settings = useCall('settings.get', {});
  const stageName = filter.startsWith('stage:') ? filter.slice('stage:'.length) : undefined;
  const list = useCall('projects.list', {
    status,
    sort,
    filter: stageName ? 'all' : (filter as 'all' | 'mine' | 'at_risk'),
    stageName,
  });
  const chips = [
    { value: 'all', label: t('projects.filter.all') },
    { value: 'mine', label: t('projects.filter.mine') },
    { value: 'at_risk', label: t('projects.filter.at_risk') },
    ...(settings.data?.defaultStages ?? []).map((name) => ({ value: `stage:${name}`, label: name })),
  ];
  const showAll = () => {
    setFilter('all');
    setStatus('all');
  };

  let body = null;
  if (list.error) {
    body = <EmptyState title={t('projects.loadFailed')} body={errorMessage(list.error, t)} action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>} />;
  } else if (list.data && list.data.length === 0) {
    body = <EmptyState title={t('projects.emptyTitle')} body={t('projects.empty')} action={<Button onClick={showAll}>{t('projects.showAll')}</Button>} />;
  } else if (list.data && view === 'grid') {
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-4">
        {list.data.map((summary) => <li key={summary.project.id}><ProjectCard summary={summary} /></li>)}
      </ul>
    );
  } else if (list.data) {
    body = <ul className="flex flex-col gap-2">{list.data.map((summary) => <ProjectRow key={summary.project.id} summary={summary} />)}</ul>;
  }

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <ScreenTitle title={t('screens.projects')} />
        <Button variant="primary" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden />
          {t('projects.new')}
        </Button>
      </div>
      <div className="flex flex-col gap-3 pb-5">
        <ChipGroup label={t('projects.filters')} value={filter} options={chips} onChange={setFilter} />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t('projects.statusFilter')} value={status} onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])} className={SELECT}>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
          </select>
          <select aria-label={t('projects.sort')} value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number])} className={SELECT}>
            {SORTS.map((value) => <option key={value} value={value}>{t(`projects.sorts.${value}`)}</option>)}
          </select>
          <div className="ms-auto">
            <SegmentedControl label={t('projects.view')} value={view} onChange={setView} options={VIEWS.map((value) => ({ value, label: t(`projects.views.${value}`) }))} />
          </div>
        </div>
      </div>
      {body}
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
```

In `src/app/routes.tsx`, import `ProjectsScreen` and change the index route to `{ index: true, element: <ProjectsScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS. If a plan 1 shell test expects the Projects placeholder text on `/`, change that assertion to the Projects title (`getByRole('heading', { name: 'Projects' })`), because the placeholder no longer exists there.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects src/app/routes.tsx src/app
git commit -m "feat: add the Projects screen with filters, sort and a list view" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 9: The Project screen and its header

**Files:**
- Create: `src/features/project/tabs.tsx`, `src/features/project/ProjectScreen.tsx`, `src/features/project/ProjectHeader.tsx`, `src/features/project/HealthControl.tsx`, `src/features/project/StageControl.tsx`, `src/features/project/ProjectActions.tsx`, `src/features/projects/EditProjectSheet.tsx`
- Modify: `src/app/routes.tsx`, `src/design/tokens.css`
- Test: `src/features/project/ProjectScreen.test.tsx`

**Interfaces:**
- Consumes: `ProjectCover` (Task 6), `ProjectFields`, `useProjectForm` (Task 7), `Popover`, `Menu`, `Sheet`, `Tabs`, `useUndoable`, `projects.get`, `projects.setStatus`, `projects.setLeader`, `projects.delete`, `projects.setHealthOverride`, `projects.clearHealthOverride`, `projects.setStage`, `projects.update`, `stages.replace`.
- Produces: `PROJECT_TABS`, `ProjectTab`, `TabProps = { detail: ProjectDetail }`, `TAB_BODY: Record<ProjectTab, ComponentType<TabProps> | null>` (later tasks fill it); `ProjectScreen()` at `/projects/:projectId`; `ProjectHeader({ detail, onPost })`; `EditProjectSheet({ detail, open, onOpenChange })`; the CSS class `.glass-media`.

- [ ] **Step 1: Write the failing test**

`src/features/project/ProjectScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';

describe('the Project screen header', () => {
  it('shows the cover, code, name, client, health, stage rail and the main action', async () => {
    await renderApp(PROJECT);
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).toBeInTheDocument();
    expect(screen.getByText('Gulf Crest Holding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Late/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Stage 4 of 7: Construction Documents' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Post update' })).toBeInTheDocument();
  });

  it('shows a project as view only to a person outside it', async () => {
    await renderApp(PROJECT, as('usr_003'));
    await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' });
    expect(screen.getByText('View only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Post update' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Late/ })).toBeNull();
  });

  it('sets the health by hand with a reason', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: /Late/ }));
    const popover = screen.getByRole('dialog', { name: 'Set health' });
    await userEvent.click(within(popover).getByRole('radio', { name: 'At risk' }));
    await userEvent.type(within(popover).getByLabelText('Reason'), 'Client delay');
    await userEvent.click(within(popover).getByRole('button', { name: 'Set health' }));
    expect(await screen.findByText('Set by Faisal Al-Harbi')).toBeInTheDocument();
  });

  it('makes another stage current from the rail', async () => {
    await renderApp(PROJECT, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Permits' }));
    const popover = screen.getByRole('dialog', { name: 'Permits' });
    expect(await within(popover).findByText('Tasks done: 0 of 2')).toBeInTheDocument();
    await userEvent.click(within(popover).getByRole('button', { name: 'Make current stage' }));
    expect(await screen.findByRole('list', { name: 'Stage 5 of 7: Permits' })).toBeInTheDocument();
  });

  it('changes the leader', async () => {
    const { store } = await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change leader' }));
    const sheet = await screen.findByRole('dialog', { name: 'Change leader' });
    await userEvent.selectOptions(within(sheet).getByLabelText('Leader'), 'Sara Al-Qahtani');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.projects.prj_001.leaderId).toBe('usr_005'));
    expect(await screen.findByText('Leader changed.')).toBeInTheDocument();
  });

  it('edits the project name', async () => {
    await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit project' });
    const name = within(sheet).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Corniche Tower');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Corniche Tower' })).toBeInTheDocument();
  });

  it('lets the Admin delete the project after one confirmation', async () => {
    const { store } = await renderApp(PROJECT);
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }));
    const sheet = await screen.findByRole('dialog', { name: 'Delete Corniche Office Tower?' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(store.state.projects.prj_001).toBeUndefined());
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('opens the tab from the link and says when a project does not exist', async () => {
    const first = await renderApp('/projects/prj_001?tab=team');
    expect(await screen.findByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true');
    first.unmount();
    await renderApp('/projects/prj_999');
    expect(await screen.findByText('This project does not exist anymore.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project`
Expected: FAIL: the route still shows the placeholder, so the heading is missing.

- [ ] **Step 3: Write the screen and the header**

Add to the `@layer components` block of `src/design/tokens.css`:

```css
  /* Clear glass on a cover image, with the 35% dark layer behind the buttons (spec 10.1). */
  .glass-media {
    background: rgba(0, 0, 0, 0.35);
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    backdrop-filter: blur(12px) saturate(160%);
    color: #fff;
  }
```

and add `.glass-media { background: rgba(0, 0, 0, 0.6); -webkit-backdrop-filter: none; backdrop-filter: none; }` inside the existing `prefers-reduced-transparency: reduce` block.

`src/features/project/tabs.tsx`:

```tsx
import type { ComponentType } from 'react';
import type { ProjectDetail } from '../../api/contract/views';

export const PROJECT_TABS = ['overview', 'tasks', 'schedule', 'files', 'team'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TabProps = { detail: ProjectDetail };

/** The body of each tab. Each later task of plan 2 fills in its own line. */
export const TAB_BODY: Record<ProjectTab, ComponentType<TabProps> | null> = {
  overview: null,
  tasks: null,
  schedule: null,
  files: null,
  team: null,
};
```

`src/features/project/ProjectScreen.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/errors';
import { errorMessage } from '../../app/errors';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';
import { TabPanel, Tabs } from '../../components/Tabs';
import { ProjectHeader } from './ProjectHeader';
import { PROJECT_TABS, TAB_BODY, type ProjectTab } from './tabs';

/** One project with the tabs Overview, Tasks, Schedule, Files and Team (spec 5). The tab lives in the link. */
export function ProjectScreen() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: ProjectTab = PROJECT_TABS.includes(raw as ProjectTab) ? (raw as ProjectTab) : 'overview';
  const detail = useCall('projects.get', { id: projectId });

  if (detail.error) {
    const gone = detail.error instanceof ApiError && detail.error.code === 'not_found';
    return (
      <>
        <ScreenTitle title={t('project.notFoundTitle')} />
        <EmptyState
          title={t('project.notFoundTitle')}
          body={gone ? t('project.notFound') : errorMessage(detail.error, t)}
          action={gone
            ? <Link to="/" className="pressable inline-flex min-h-11 items-center font-semibold text-accent">{t('project.back')}</Link>
            : <Button onClick={() => void detail.refetch()}>{t('common.retry')}</Button>}
        />
      </>
    );
  }
  if (!detail.data) return null;
  const Body = TAB_BODY[tab];
  return (
    <div className="flex flex-col gap-5">
      <ProjectHeader detail={detail.data} onPost={() => setParams({ tab: 'overview', compose: '1' })} />
      <Tabs
        label={t('project.tabs')}
        value={tab}
        onChange={(next) => setParams({ tab: next })}
        options={PROJECT_TABS.map((value) => ({ value, label: t(`project.tab.${value}`) }))}
      />
      <TabPanel value={tab}>
        {Body ? <Body detail={detail.data} /> : <EmptyState title={t(`project.tab.${tab}`)} body={t('project.comingSoon')} />}
      </TabPanel>
    </div>
  );
}
```

`src/features/project/ProjectHeader.tsx`:

```tsx
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { ProjectCover } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { ProjectActions } from './ProjectActions';
import { StageControl } from './StageControl';

/** Cover, code, name, client, health and stage rail. "Post update" is the one tinted action (spec 5.1). */
export function ProjectHeader({ detail, onPost }: { detail: ProjectDetail; onPost: () => void }) {
  const { t } = useTranslation();
  const { project } = detail;
  const viewOnly = !detail.viewerCan.post && !detail.viewerCan.edit;
  return (
    <header className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-card">
        <ProjectCover summary={detail} className="aspect-[5/2] sm:aspect-[3/1]" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3">
          <Link to="/" className="glass-media pressable inline-flex min-h-11 items-center gap-1 rounded-full pe-4 ps-2 text-subheadline font-semibold">
            <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
            {t('project.back')}
          </Link>
          <ProjectActions detail={detail} />
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-footnote font-semibold text-label-2">{project.code}</span>
            <HealthControl detail={detail} />
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold text-label-2">{t('project.viewOnly')}</span>}
          </div>
          <h1 dir="auto" className="text-large-title [text-wrap:balance]">{project.name}</h1>
          {detail.client && <p dir="auto" className="text-subheadline text-label-2">{detail.client.name}</p>}
        </div>
        {detail.viewerCan.post && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
      </div>
      <StageControl detail={detail} />
    </header>
  );
}
```

`src/features/project/HealthControl.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthValue } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useAction } from '../../app/runtime';
import { Button } from '../../components/Button';
import { TextArea } from '../../components/Fields';
import { HealthPill } from '../../components/HealthPill';
import { Popover } from '../../components/Popover';
import { SegmentedControl } from '../../components/SegmentedControl';

const VALUES: HealthValue[] = ['on_track', 'at_risk', 'late'];

function HealthPopover({ detail, anchor, onClose }: { detail: ProjectDetail; anchor: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation();
  const health = detail.health!;
  const [value, setValue] = useState<HealthValue>(health.value);
  const [reason, setReason] = useState(health.overridden ? (health.reason ?? '') : '');
  const set = useAction('projects.setHealthOverride', { onSuccess: onClose });
  const clear = useAction('projects.clearHealthOverride', { onSuccess: onClose });
  return (
    <Popover anchor={anchor} label={t('health.override')} onClose={onClose}>
      <div>
        <p className="text-headline">{t('health.override')}</p>
        <p className="text-footnote text-label-2">{t('health.overrideHint')}</p>
      </div>
      <SegmentedControl label={t('health.override')} value={value} onChange={setValue} options={VALUES.map((v) => ({ value: v, label: t(`health.${v}`) }))} />
      <TextArea id="health-reason" label={t('health.reason')} value={reason} dir="auto" onChange={(event) => setReason(event.target.value)} />
      <p className="text-footnote text-label-2">{t('health.computed', { value: t(`health.${health.computed}`) })}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {health.overridden && <Button onClick={() => clear.mutate({ id: detail.project.id })}>{t('health.clear')}</Button>}
        <Button variant="primary" disabled={!reason.trim() || set.isPending} onClick={() => set.mutate({ id: detail.project.id, value, reason: reason.trim() })}>
          {t('health.save')}
        </Button>
      </div>
    </Popover>
  );
}

/** The leader or the Admin can set the health by hand with a reason (spec 4.2). Others see the pill only. */
export function HealthControl({ detail }: { detail: ProjectDetail }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const pill = <HealthPill health={detail.health} status={detail.project.status} setBy={detail.healthSetBy} />;
  if (!detail.viewerCan.healthOverride || !detail.health) return pill;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
        className="pressable -my-2 grid min-h-11 place-items-center rounded-full"
      >
        {pill}
      </button>
      {anchor && <HealthPopover detail={detail} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
```

`src/features/project/StageControl.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { StageRail } from '../../components/StageRail';
import { formatDay } from '../../lib/dates';

function StagePopover({ detail, stage, anchor, onClose }: { detail: ProjectDetail; stage: Stage; anchor: HTMLElement; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const tasks = useCall('tasks.list', { projectId: detail.project.id, activeProjectsOnly: false });
  const inStage = (tasks.data ?? []).filter((row) => row.task.stageId === stage.id);
  const done = inStage.filter((row) => row.task.status === 'done').length;
  const setStage = useUndoable('projects.setStage', { message: () => t('project.stageChanged'), onSuccess: onClose });
  const current = stage.id === detail.currentStage.id;
  const dates = stage.startDate && stage.endDate
    ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
    : t('project.noDates');
  return (
    <Popover anchor={anchor} label={stage.name} onClose={onClose}>
      <div>
        <p dir="auto" className="text-headline">{stage.name}</p>
        {current && <p className="text-footnote font-semibold text-accent">{t('project.current')}</p>}
      </div>
      <p className="tabular text-subheadline">{dates}</p>
      {tasks.data && <p className="text-subheadline text-label-2">{t('project.stageTasks', { done, total: inStage.length })}</p>}
      {detail.viewerCan.edit && !current && (
        <Button variant="primary" disabled={setStage.isPending} onClick={() => setStage.mutate({ id: detail.project.id, stageId: stage.id })}>
          {t('project.makeCurrent')}
        </Button>
      )}
    </Popover>
  );
}

/** A click on a stage opens its dates and task count. The leader can make it the current stage (spec 5.1). */
export function StageControl({ detail }: { detail: ProjectDetail }) {
  const [open, setOpen] = useState<{ stage: Stage; anchor: HTMLElement } | null>(null);
  return (
    <>
      <StageRail stages={detail.stages} currentId={detail.currentStage.id} onSelect={(stage, anchor) => setOpen({ stage, anchor })} />
      {open && <StagePopover detail={detail} stage={open.stage} anchor={open.anchor} onClose={() => setOpen(null)} />}
    </>
  );
}
```

`src/features/projects/EditProjectSheet.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../api/contract/views';
import { newStoryId } from '../../app/actions';
import { errorMessage } from '../../app/errors';
import { useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import type { ProjectFormValues } from './projectForm';
import { ProjectFields, useProjectForm } from './ProjectFields';

function valuesOf(detail: ProjectDetail): ProjectFormValues {
  const { project } = detail;
  return {
    name: project.name,
    clientId: project.clientId ?? '',
    leader: 'me',
    location: project.location,
    area: project.areaM2 === null ? '' : String(project.areaM2),
    startDate: project.startDate ?? '',
    targetEndDate: project.targetEndDate ?? '',
    stages: detail.stages.map((stage) => ({ id: stage.id, name: stage.name })),
    teamIds: [],
    modelFolderPath: project.modelFolderPath,
    description: project.description,
  };
}

export function EditProjectSheet({ detail, open, onOpenChange }: { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const form = useProjectForm(valuesOf(detail));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) form.reset(valuesOf(detail));
    // The form starts from the saved project each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.check()) return;
    const v = form.values;
    const meta = { correlationId: newStoryId() };
    setSaving(true);
    try {
      await api.call('projects.update', {
        id: detail.project.id,
        patch: {
          name: v.name.trim(),
          clientId: v.clientId || null,
          location: v.location.trim(),
          areaM2: v.area.trim() ? Number(v.area) : null,
          startDate: v.startDate || null,
          targetEndDate: v.targetEndDate || null,
          modelFolderPath: v.modelFolderPath.trim(),
          description: v.description.trim(),
        },
      }, meta);
      const before = JSON.stringify(detail.stages.map((stage) => [stage.id, stage.name]));
      const after = JSON.stringify(v.stages.map((stage) => [stage.id ?? null, stage.name.trim()]));
      if (before !== after) {
        await api.call('stages.replace', {
          projectId: detail.project.id,
          stages: v.stages.map((stage) => {
            const old = detail.stages.find((s) => s.id === stage.id);
            return { id: stage.id, name: stage.name.trim(), startDate: old?.startDate ?? null, endDate: old?.endDate ?? null };
          }),
        }, meta);
      }
      toast.show({ message: t('projectForm.saved') });
      onOpenChange(false);
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('projectForm.editTitle')}
      wide
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="edit-project" disabled={saving}>{t('projectForm.save')}</Button>
        </>
      )}
    >
      <form id="edit-project" noValidate onSubmit={submit} className="pt-2">
        <ProjectFields form={form} mode="edit" />
      </form>
    </Sheet>
  );
}
```

`src/features/project/ProjectActions.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ProjectStatus } from '../../api/contract/entities';
import type { ProjectDetail } from '../../api/contract/views';
import { useUndoable } from '../../app/actions';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { SelectField } from '../../components/Fields';
import { Menu, type MenuItem } from '../../components/Menu';
import { Sheet } from '../../components/Sheet';
import { EditProjectSheet } from '../projects/EditProjectSheet';

type SheetProps = { detail: ProjectDetail; open: boolean; onOpenChange: (open: boolean) => void };

/** No Undo toast here: the old leader loses the right to undo it (plan clarification 6). */
function LeaderSheet({ detail, open, onOpenChange }: SheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const [leaderId, setLeaderId] = useState(detail.project.leaderId ?? '');
  useEffect(() => {
    if (open) setLeaderId(detail.project.leaderId ?? '');
  }, [open, detail.project.leaderId]);
  const change = useAction('projects.setLeader', {
    onSuccess: () => {
      toast.show({ message: t('project.leaderChanged') });
      onOpenChange(false);
    },
  });
  const people = (users.data ?? []).filter((user) => user.kind === 'human');
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.changeLeader')}
      footer={<Button variant="primary" disabled={change.isPending} onClick={() => change.mutate({ id: detail.project.id, leaderId: leaderId || null })}>{t('common.save')}</Button>}
    >
      <SelectField id="change-leader" label={t('projectForm.leader')} value={leaderId} onChange={(event) => setLeaderId(event.target.value)}>
        <option value="">{t('projectForm.leaderNone')}</option>
        {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </SelectField>
    </Sheet>
  );
}

/** The only confirmation in the app (spec 10.7). */
function DeleteProjectSheet({ detail, open, onOpenChange }: SheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const remove = useAction('projects.delete', {
    onSuccess: () => {
      toast.show({ message: t('project.deleted') });
      onOpenChange(false);
      navigate('/');
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('project.deleteTitle', { name: detail.project.name })}
      description={t('project.deleteBody')}
      footer={(
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate({ id: detail.project.id, confirm: true })}>
            {t('project.delete')}
          </Button>
        </>
      )}
    >
      <p dir="auto" className="tabular text-subheadline text-label-2">{detail.project.code} · {detail.project.name}</p>
    </Sheet>
  );
}

/** The "…" menu over the cover: Edit, Change leader, the status changes and Delete (spec 5.1). */
export function ProjectActions({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<'edit' | 'leader' | 'delete' | null>(null);
  const status = useUndoable('projects.setStatus', { message: () => t('project.statusChanged') });
  const { project, viewerCan } = detail;
  const statusItem = (to: ProjectStatus): MenuItem => ({
    label: t(`project.statusTo.${to}`),
    onSelect: () => status.mutate({ id: project.id, status: to }),
    hidden: !viewerCan.archive || project.status === to,
  });
  const items: MenuItem[] = [
    { label: t('project.edit'), onSelect: () => setSheet('edit'), hidden: !viewerCan.edit },
    { label: t('project.changeLeader'), onSelect: () => setSheet('leader'), hidden: !viewerCan.changeLeader },
    statusItem('active'),
    statusItem('on_hold'),
    statusItem('completed'),
    statusItem('archived'),
    { label: t('project.delete'), onSelect: () => setSheet('delete'), hidden: !viewerCan.delete, destructive: true },
  ];
  const onOpenChange = (open: boolean) => {
    if (!open) setSheet(null);
  };
  return (
    <>
      <Menu label={t('project.more')} items={items} triggerClassName="glass-media" />
      <EditProjectSheet detail={detail} open={sheet === 'edit'} onOpenChange={onOpenChange} />
      <LeaderSheet detail={detail} open={sheet === 'leader'} onOpenChange={onOpenChange} />
      <DeleteProjectSheet detail={detail} open={sheet === 'delete'} onOpenChange={onOpenChange} />
    </>
  );
}
```

In `src/app/routes.tsx`, import `ProjectScreen` and change the project route to `{ path: 'projects/:projectId', element: <ProjectScreen /> }`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features src/app/routes.tsx src/design/tokens.css
git commit -m "feat: add the Project screen header, actions, health and stage controls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 10: The Overview tab

**Files:**
- Create: `src/features/project/overview/OverviewTab.tsx`, `src/features/project/overview/Composer.tsx`, `src/features/project/overview/FeedEntry.tsx`
- Modify: `src/features/project/tabs.tsx`
- Test: `src/features/project/overview/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: `feedText` (Task 6), `activeMention`, `withMentionMarkup`, `normalizeForSearch` (`src/lib/text.ts`), `newStoryId` (Task 5), `RichText`, `Age`, `AgentLabel`, `ChipGroup`, `updates.list`, `updates.create`, `files.list`, `files.upload`, `session.get`.
- Produces: `OverviewTab({ detail })` as `TAB_BODY.overview`; `Composer({ detail })`; `FeedEntry({ item, fileNames })`.

- [ ] **Step 1: Write the failing test**

`src/features/project/overview/OverviewTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const PROJECT = '/projects/prj_001';

describe('the Overview tab', () => {
  it('shows posts with mentions, the agent summary and the side column', async () => {
    await renderApp(PROJECT);
    expect(await screen.findByText(/I uploaded revision B of the ground floor plan/)).toBeInTheDocument();
    expect(screen.getAllByText('@Faisal Al-Harbi').length).toBeGreaterThan(0);
    expect(screen.getByText(/Next deadline: Stage submission, today\./)).toBeInTheDocument();
    const side = screen.getByRole('complementary');
    expect(within(side).getByText('24,500')).toBeInTheDocument();
    expect(within(side).getByText('Coordination workshop')).toBeInTheDocument();
  });

  it('filters the feed to posts', async () => {
    const { api } = await renderApp(PROJECT);
    await screen.findByText(/I uploaded revision B/);
    await api.call('tasks.complete', { id: 'tsk_009' });
    expect(await screen.findByText('completed “Specifications draft”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Posts' }));
    await waitFor(() => expect(screen.queryByText('completed “Specifications draft”')).toBeNull());
    expect(screen.getByText(/I uploaded revision B/)).toBeInTheDocument();
  });

  it('posts an update that mentions a teammate', async () => {
    const { store } = await renderApp(PROJECT, as('usr_002'));
    const box = await screen.findByRole('textbox', { name: 'Post an update' });
    await userEvent.type(box, 'Ready for review @Sa');
    await userEvent.click(screen.getByRole('option', { name: 'Sara Al-Qahtani' }));
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Update posted.')).toBeInTheDocument();
    expect(Object.values(store.state.updates).some((u) => u.body === 'Ready for review @[Sara Al-Qahtani](usr_005)')).toBe(true);
  });

  it('shows no composer to a person outside the project', async () => {
    await renderApp(PROJECT, as('usr_003'));
    expect(await screen.findByText('Only the project team can post here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Post an update' })).toBeNull();
  });

  it('focuses the composer when Post update opens the tab', async () => {
    await renderApp('/projects/prj_001?compose=1', as('usr_002'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Post an update' })).toHaveFocus());
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/overview`
Expected: FAIL: the tab shows the "arrives later" note.

- [ ] **Step 3: Write the tab**

`src/features/project/overview/FeedEntry.tsx`:

```tsx
import { Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FeedItem } from '../../../api/contract/views';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { RichText } from '../../../components/RichText';
import { feedText } from '../../projects/feed';

/** A post as a card, or a system event as one quiet line (spec 5.2). */
export function FeedEntry({ item, fileNames }: { item: FeedItem; fileNames: Map<string, string> }) {
  const { t } = useTranslation();
  if (item.kind === 'event') {
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
  return (
    <li className="surface flex flex-col gap-2 rounded-card p-4">
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
      </div>
      <RichText body={item.body} className="text-body" />
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
      {item.commentCount > 0 && <p className="text-footnote text-label-2">{t('overview.comments', { n: item.commentCount })}</p>}
    </li>
  );
}
```

`src/features/project/overview/Composer.tsx`:

```tsx
import { Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { ProjectDetail, UserCard } from '../../../api/contract/views';
import { newStoryId } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { activeMention, normalizeForSearch, withMentionMarkup } from '../../../lib/text';

/** The box that posts text with files and @mentions (spec 5.2). Type @ to pick a teammate. */
export function Composer({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [params, setParams] = useSearchParams();
  const area = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState<UserCard[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);

  const me = session.data?.authority.id;
  const people = detail.members.map((member) => member.user).filter((person) => person.id !== me);
  const mention = activeMention(text, caret);
  const matches = mention
    ? people.filter((person) => normalizeForSearch(person.name).includes(normalizeForSearch(mention.query))).slice(0, 5)
    : [];
  const open = matches.length > 0 && dismissedAt !== mention?.start;

  useEffect(() => {
    if (params.get('compose') !== '1') return;
    area.current?.focus();
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('compose');
      return next;
    }, { replace: true });
  }, [params, setParams]);

  const pick = (person: UserCard) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const insert = `@${person.name} `;
    const next = before + insert + text.slice(caret);
    const position = before.length + insert.length;
    setText(next);
    setCaret(position);
    setActive(0);
    setPicked((list) => (list.some((p) => p.id === person.id) ? list : [...list, person]));
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
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
      setDismissedAt(mention?.start ?? null);
    }
  };

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
      <div className="relative">
        <label htmlFor="composer" className="sr-only">{t('overview.composer')}</label>
        <textarea
          id="composer"
          ref={area}
          value={text}
          dir="auto"
          rows={3}
          placeholder={t('overview.placeholder')}
          aria-autocomplete="list"
          aria-controls="mention-list"
          aria-activedescendant={open && matches[active] ? `mention-${matches[active].id}` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setDismissedAt(null);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          className="min-h-24 w-full resize-y rounded-control bg-fill px-3 py-2 text-body text-label placeholder:text-label-2"
        />
        {open && (
          <ul id="mention-list" role="listbox" aria-label={t('overview.mentionList')} className="glass absolute inset-x-0 top-full z-30 mt-1 flex flex-col rounded-2xl p-1.5 shadow-float">
            {matches.map((person, i) => (
              <li
                key={person.id}
                id={`mention-${person.id}`}
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

`src/features/project/overview/OverviewTab.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLang } from '../../../app/lang';
import { useCall } from '../../../app/runtime';
import { Avatar } from '../../../components/Avatar';
import { ChipGroup } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { formatDay, formatNumber, todayISO } from '../../../lib/dates';
import type { TabProps } from '../tabs';
import { Composer } from './Composer';
import { FeedEntry } from './FeedEntry';

const FILTERS = ['all', 'posts', 'tasks', 'files'] as const;

function SideColumn({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const today = todayISO();
  const next = detail.deadlines.filter((deadline) => deadline.date >= today).slice(0, 3);
  const none = t('overview.none');
  const facts: [string, ReactNode][] = [
    [t('projectForm.location'), project.location || none],
    [t('projectForm.area'), project.areaM2 === null ? none : formatNumber(project.areaM2, lang)],
    [t('projectForm.startDate'), project.startDate ? formatDay(project.startDate, lang, 'long') : none],
    [t('projectForm.endDate'), project.targetEndDate ? formatDay(project.targetEndDate, lang, 'long') : none],
    [t('projectForm.modelFolder'), project.modelFolderPath ? <bdi dir="ltr" className="break-all text-footnote">{project.modelFolderPath}</bdi> : none],
  ];
  return (
    <aside className="flex flex-col gap-4">
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.facts')}</h2>
        <dl className="mt-2 flex flex-col gap-2">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-footnote text-label-2">{label}</dt>
              <dd dir="auto" className="tabular text-subheadline">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.deadlines')}</h2>
        {next.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('overview.noDeadlines')}</p> : (
          <ul className="mt-2 flex flex-col gap-2">
            {next.map((deadline) => (
              <li key={deadline.id} className="flex items-baseline justify-between gap-3 text-subheadline">
                <bdi className="min-w-0 truncate">{deadline.name}</bdi>
                <span className="tabular shrink-0 text-label-2">{formatDay(deadline.date, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="surface rounded-card p-4">
        <h2 className="text-headline">{t('overview.team')}</h2>
        <ul className="mt-1 flex flex-col">
          {detail.members.map((member) => (
            <li key={member.user.id} className="flex min-h-11 items-center gap-2">
              <Avatar user={member.user} size={28} />
              <bdi className="min-w-0 truncate text-subheadline">{member.user.name}</bdi>
              <span className="ms-auto shrink-0 text-footnote text-label-2">{member.isLeader ? t('team.leader') : member.discipline}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/** Posts and system events with a filter, the composer on top, and the key facts beside (spec 5.2). */
export function OverviewTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const feed = useCall('updates.list', { projectId: detail.project.id, filter });
  const files = useCall('files.list', { projectId: detail.project.id });
  const fileNames = new Map((files.data ?? []).map((view) => [view.file.id, view.file.name]));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label={t('overview.feed')} className="flex min-w-0 flex-col gap-4">
        {detail.viewerCan.post ? <Composer detail={detail} /> : <p className="text-footnote text-label-2">{t('overview.cannotPost')}</p>}
        <ChipGroup label={t('overview.feed')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`overview.feedFilter.${value}`) }))} />
        {feed.data && feed.data.length === 0
          ? <EmptyState title={t('overview.feed')} body={t('overview.emptyFeed')} />
          : <ol className="flex flex-col gap-3">{(feed.data ?? []).map((item) => <FeedEntry key={item.id} item={item} fileNames={fileNames} />)}</ol>}
      </section>
      <SideColumn detail={detail} />
    </div>
  );
}
```

In `src/features/project/tabs.tsx`, add `import { OverviewTab } from './overview/OverviewTab';` and set `overview: OverviewTab,`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/project
git commit -m "feat: add the Overview tab with the feed, the composer and the key facts" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 11: The Tasks tab list

**Files:**
- Create: `src/features/project/tasks/TasksTab.tsx`, `src/features/project/tasks/TaskList.tsx`, `src/features/project/tasks/TaskRowItem.tsx`
- Modify: `src/features/project/tabs.tsx`
- Test: `src/features/project/tasks/TasksTab.test.tsx`

**Interfaces:**
- Consumes: `TaskRow.canMove` (Task 1), `useUndoable`, `ChipGroup`, `Avatar`, `spring`, `tasks.list`, `tasks.create`, `tasks.complete`.
- Produces: `TasksTab({ detail })` as `TAB_BODY.tasks`; `TaskList({ detail, rows, filtered, onOpen })`; `TaskRowItem({ row, onOpen })`. The open task lives in `?task=<id>`.

- [ ] **Step 1: Write the failing test**

`src/features/project/tasks/TasksTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';

describe('the Tasks tab list', () => {
  it('groups open tasks by stage and shows done tasks on request', async () => {
    await renderApp(TASKS);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Stair details')).toBeInTheDocument();
    expect(within(group).queryByText('Door and window schedule')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show done tasks' }));
    expect(await within(group).findByText('Door and window schedule')).toBeInTheDocument();
  });

  it('filters to overdue tasks', async () => {
    await renderApp(TASKS);
    await screen.findByText('Stair details');
    await userEvent.click(screen.getByRole('radio', { name: 'Overdue' }));
    await waitFor(() => expect(screen.queryByText('Specifications draft')).toBeNull());
    expect(screen.getByText('Stair details')).toBeInTheDocument();
  });

  it("sends a member's tick to review, then undoes it", async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Complete Civil Defense drawings' }));
    expect(await screen.findByText('Sent to review. The leader checks it next.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_012.status).toBe('in_review');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_012.status).toBe('todo'));
  });

  it("does not let a member tick another person's task", async () => {
    await renderApp(TASKS, as('usr_005'));
    expect(await screen.findByRole('checkbox', { name: 'Complete Balady submission set' })).toBeDisabled();
  });

  it('adds a task to a stage from its quick add row', async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a task in Permits' }), 'Fire strategy report{Enter}');
    await waitFor(() => expect(Object.values(store.state.tasks)
      .some((task) => task.title === 'Fire strategy report' && task.stageId === 'stg_005' && task.ownerId === 'usr_005')).toBe(true));
    expect(await screen.findByText('Fire strategy report')).toBeInTheDocument();
  });

  it('puts the open task in the link', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    await waitFor(() => expect(window.location.hash).toContain('task=tsk_007'));
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/tasks`
Expected: FAIL: the Tasks tab shows the "arrives later" note.

- [ ] **Step 3: Write the list**

`src/features/project/tasks/TaskRowItem.tsx`:

```tsx
import { Circle, CircleCheck, CircleDot, Flag, MessageCircle, Paperclip } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { spring } from '../../../design/motion';
import { formatDay } from '../../../lib/dates';

/**
 * One task: the tick, the title, the due date (red when overdue), the flag and the counts (spec 5.3).
 * A tick fills the circle at once, and the call runs after 0.5 s, so the row slides away then (spec 5.5).
 */
export function TaskRowItem({ row, onOpen }: { row: TaskRow; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [ticking, setTicking] = useState(false);
  const complete = useUndoable('tasks.complete', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.completed')),
  });
  const { task } = row;
  const done = task.status === 'done';
  const inReview = task.status === 'in_review';
  const canTick = row.canMove && !done && !inReview;
  const tick = () => {
    if (!canTick || ticking) return;
    setTicking(true);
    window.setTimeout(() => complete.mutate({ id: task.id }, { onSettled: () => setTicking(false) }), 500);
  };
  const rtl = document.documentElement.dir === 'rtl';
  return (
    <motion.li layout exit={{ opacity: 0, x: rtl ? -24 : 24 }} transition={spring.standard} className="flex min-h-14 items-center gap-2 px-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done || ticking}
        aria-label={t('tasks.complete', { title: task.title })}
        disabled={!canTick}
        onClick={tick}
        className="pressable grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-60"
      >
        {done || ticking
          ? <CircleCheck size={22} className="text-accent" aria-hidden />
          : inReview ? <CircleDot size={22} className="text-orange" aria-hidden /> : <Circle size={22} className="text-label-3" aria-hidden />}
      </button>
      <button type="button" onClick={() => onOpen(task.id)} className="min-w-0 flex-1 py-2 text-start">
        <span dir="auto" className={`block truncate text-body ${done ? 'text-label-2 line-through' : ''}`}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-label-2">
          {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
          {task.dueDate && (
            <span className={`tabular ${row.overdue ? 'font-medium text-red-text' : ''}`}>
              {formatDay(task.dueDate, lang)}{row.overdue && ` · ${t('tasks.overdue')}`}
            </span>
          )}
          {task.flagged && <span className="inline-flex items-center gap-1 text-orange-text"><Flag size={12} aria-hidden />{t('tasks.flagged')}</span>}
          {row.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={12} aria-hidden />{t('tasks.comments', { n: row.commentCount })}</span>}
          {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden />{t('tasks.files', { n: row.fileCount })}</span>}
        </span>
      </button>
      <Avatar user={row.owner} size={28} />
    </motion.li>
  );
}
```

`src/features/project/tasks/TaskList.tsx`:

```tsx
import { Plus } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail, TaskRow } from '../../../api/contract/views';
import { useAction } from '../../../app/runtime';
import { EmptyState } from '../../../components/EmptyState';
import { TaskRowItem } from './TaskRowItem';

/** "Add a task" at the top of a group. Enter creates it. The owner is the creator and the stage is the group's (spec 5.3). */
function QuickAdd({ projectId, stage }: { projectId: string; stage: Stage }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const create = useAction('tasks.create', { onSuccess: () => setTitle('') });
  return (
    <form
      className="flex items-center gap-3 px-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) create.mutate({ projectId, stageId: stage.id, title: title.trim() });
      }}
    >
      <Plus size={18} className="shrink-0 text-label-3" aria-hidden />
      <input
        aria-label={t('tasks.addTaskIn', { stage: stage.name })}
        placeholder={t('tasks.addTask')}
        value={title}
        dir="auto"
        disabled={create.isPending}
        onChange={(event) => setTitle(event.target.value)}
        className="min-h-11 min-w-0 flex-1 bg-transparent text-body text-label placeholder:text-label-2"
      />
    </form>
  );
}

/** Tasks grouped by stage (spec 5.3). With a filter on, empty groups hide. */
export function TaskList({ detail, rows, filtered, onOpen }: { detail: ProjectDetail; rows: TaskRow[]; filtered: boolean; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();
  const groups = detail.stages
    .map((stage) => ({ stage, rows: rows.filter((row) => row.task.stageId === stage.id) }))
    .filter((group) => !filtered || group.rows.length > 0);
  if (filtered && groups.length === 0) return <EmptyState title={t('project.tab.tasks')} body={t('tasks.emptyFiltered')} />;
  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ stage, rows: stageRows }) => (
        <section key={stage.id} aria-labelledby={`stage-${stage.id}`} className="surface overflow-hidden rounded-card pb-2">
          <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3">
            <h3 id={`stage-${stage.id}`} dir="auto" className="text-headline">{stage.name}</h3>
            <span className="tabular text-footnote text-label-2">{t('tasks.count', { n: stageRows.length })}</span>
          </header>
          {detail.viewerCan.createTaskForSelf && <QuickAdd projectId={detail.project.id} stage={stage} />}
          <ul>
            <AnimatePresence initial={false}>
              {stageRows.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={onOpen} />)}
            </AnimatePresence>
          </ul>
          {stageRows.length === 0 && <p className="px-4 pb-2 text-footnote text-label-2">{t('tasks.empty')}</p>}
        </section>
      ))}
    </div>
  );
}
```

`src/features/project/tasks/TasksTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useCall } from '../../../app/runtime';
import { ChipGroup } from '../../../components/Chip';
import type { TabProps } from '../tabs';
import { TaskList } from './TaskList';

const FILTERS = ['all', 'mine', 'overdue', 'flagged'] as const;

export function TasksTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [, setParams] = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [showDone, setShowDone] = useState(false);
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  const rows = tasks.data ?? [];
  const open = (taskId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    return next;
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label={t('tasks.filters')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`tasks.filter.${value}`) }))} />
        <label className="ms-auto flex min-h-11 items-center gap-2 text-subheadline">
          <input type="checkbox" className="size-5 accent-[var(--c-accent-fill)]" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
          {t('tasks.showDone')}
        </label>
      </div>
      <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={open} />
    </div>
  );
}
```

In `src/features/project/tabs.tsx`, add `import { TasksTab } from './tasks/TasksTab';` and set `tasks: TasksTab,`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/project`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/project
git commit -m "feat: add the Tasks tab list with ticks, filters and quick add" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 12: The task board

**Files:**
- Create: `src/features/project/tasks/TaskBoard.tsx`
- Modify: `src/features/project/tasks/TasksTab.tsx`
- Test: `src/features/project/tasks/TaskBoard.test.tsx`

**Interfaces:**
- Consumes: `BOARD_COLUMNS`, `nextColumn` (Task 2), `Menu`, `useUndoable`, `usePersistentChoice`, `SegmentedControl`, `@dnd-kit/core`.
- Produces: `TaskBoard({ rows, onOpen })`; the Tasks tab gets a List or Board switch that lasts to the next visit.

- [ ] **Step 1: Write the failing test**

`src/features/project/tasks/TaskBoard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASKS = '/projects/prj_001?tab=tasks';

describe('the task board', () => {
  it('shows the four columns with their counts', async () => {
    await renderApp(TASKS);
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }));
    expect(await screen.findByRole('region', { name: 'To do: 4' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In progress: 2' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'In review: 1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Done: 6' })).toBeInTheDocument();
  });

  it("moves a member's card with the Move menu and offers Undo", async () => {
    const { store } = await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Move Civil Defense drawings' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'In progress' }));
    await waitFor(() => expect(store.state.tasks.tsk_012.status).toBe('in_progress'));
    expect(await screen.findByText('Moved to In progress.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In progress: 3' })).getByText('Civil Defense drawings')).toBeInTheDocument();
  });

  it("gives no move controls on another person's card", async () => {
    await renderApp(TASKS, as('usr_005'));
    await userEvent.click(await screen.findByRole('radio', { name: 'Board' }));
    await screen.findByRole('region', { name: 'To do: 4' });
    expect(screen.queryByRole('button', { name: 'Move Balady submission set' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Drag Balady submission set' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/tasks/TaskBoard.test.tsx`
Expected: FAIL: there is no Board option.

- [ ] **Step 3: Write the board**

`src/features/project/tasks/TaskBoard.tsx`:

```tsx
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { Flag, GripVertical } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskStatus } from '../../../api/contract/entities';
import type { TaskRow } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { Menu } from '../../../components/Menu';
import { BOARD_COLUMNS, nextColumn } from '../../../lib/board';
import { formatDay } from '../../../lib/dates';

/** Arrow keys move a lifted card to the next column. The end-side arrow moves forward (spec 10.9). */
const columnKeys: KeyboardCoordinateGetter = (event, { context }) => {
  const current = (context.over?.id ?? context.active?.data.current?.status) as TaskStatus | undefined;
  if (!current) return undefined;
  const target = nextColumn(current, event.code, document.documentElement.dir === 'rtl');
  const rect = target ? context.droppableRects.get(target) : undefined;
  if (!rect) return undefined;
  event.preventDefault();
  const width = context.collisionRect?.width ?? 0;
  return { x: rect.left + rect.width / 2 - width / 2, y: rect.top + 56 }; // rtl-ok: screen coordinates
};

function CardFace({ row, lifted = false }: { row: TaskRow; lifted?: boolean }) {
  const lang = useLang();
  return (
    <div className={`surface flex flex-col gap-2 rounded-2xl p-3 pe-24 ${lifted ? 'scale-[1.03] shadow-float' : ''}`}>
      <p dir="auto" className="text-subheadline font-medium">{row.task.title}</p>
      <div className="flex items-center gap-2 text-footnote text-label-2">
        {row.task.dueDate && <span className={`tabular ${row.overdue ? 'font-medium text-red-text' : ''}`}>{formatDay(row.task.dueDate, lang)}</span>}
        {row.task.flagged && <Flag size={12} className="text-orange-text" aria-hidden />}
        <span className="ms-auto"><Avatar user={row.owner} size={22} /></span>
      </div>
    </div>
  );
}

function Column({ status, count, children }: { status: TaskStatus; count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const label = t(`taskStatus.${status}`);
  return (
    <section ref={setNodeRef} aria-label={t('tasks.column', { status: label, n: count })} className={`flex min-h-48 flex-col gap-2 rounded-card p-2 ${isOver ? 'bg-fill-strong' : 'bg-fill'}`}>
      <h3 className="flex items-center justify-between px-2 pt-1 text-subheadline font-semibold">
        {label}
        <span className="tabular text-footnote text-label-2">{count}</span>
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function BoardCard({ row, dragging, onOpen, onMove }: { row: TaskRow; dragging: boolean; onOpen: () => void; onMove: (status: TaskStatus) => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: row.task.id, data: { status: row.task.status }, disabled: !row.canMove,
  });
  // The whole card follows a pointer drag. Only the grip starts a keyboard drag, so Enter on the title opens the task.
  const pointerOnly = listeners?.onPointerDown ? { onPointerDown: listeners.onPointerDown } : {};
  return (
    <li ref={setNodeRef} {...pointerOnly} className={`relative ${dragging ? 'opacity-40' : ''}`}>
      <button type="button" onClick={onOpen} className="block w-full text-start"><CardFace row={row} /></button>
      {row.canMove && (
        <div className="absolute end-1 top-1 flex" onPointerDown={(event) => event.stopPropagation()}>
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            aria-label={t('tasks.drag', { title: row.task.title })}
            className="grid size-11 cursor-grab place-items-center rounded-full text-label-3 hover:bg-fill"
          >
            <GripVertical size={16} aria-hidden />
          </button>
          <Menu
            label={t('tasks.moveTo', { title: row.task.title })}
            items={BOARD_COLUMNS.filter((status) => status !== row.task.status).map((status) => ({ label: t(`taskStatus.${status}`), onSelect: () => onMove(status) }))}
          />
        </div>
      )}
    </li>
  );
}

/** Columns To do, In progress, In review and Done. A drag, a keyboard drag or the Move menu moves a task (spec 5.3). */
export function TaskBoard({ rows, onOpen }: { rows: TaskRow[]; onOpen: (taskId: string) => void }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  const droppedAt = useRef(0);
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const row = rows.find((r) => r.task.id === active.id);
    if (row && over && over.id !== row.task.status) move.mutate({ id: row.task.id, status: over.id as TaskStatus });
  };
  // The click that ends a pointer drag must not open the task.
  const open = (taskId: string) => {
    if (Date.now() - droppedAt.current > 250) onOpen(taskId);
  };
  const lifted = rows.find((row) => row.task.id === activeId);
  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="-mx-4 grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {BOARD_COLUMNS.map((status) => {
          const columnRows = rows.filter((row) => row.task.status === status);
          return (
            <Column key={status} status={status} count={columnRows.length}>
              {columnRows.map((row) => (
                <BoardCard
                  key={row.task.id}
                  row={row}
                  dragging={row.task.id === activeId}
                  onOpen={() => open(row.task.id)}
                  onMove={(to) => move.mutate({ id: row.task.id, status: to })}
                />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 350, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' }}>
        {lifted ? <CardFace row={lifted} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}
```

Replace `src/features/project/tasks/TasksTab.tsx` with:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePersistentChoice } from '../../../app/choices';
import { useCall } from '../../../app/runtime';
import { ChipGroup } from '../../../components/Chip';
import { SegmentedControl } from '../../../components/SegmentedControl';
import type { TabProps } from '../tabs';
import { TaskBoard } from './TaskBoard';
import { TaskList } from './TaskList';

const FILTERS = ['all', 'mine', 'overdue', 'flagged'] as const;
const VIEWS = ['list', 'board'] as const;

export function TasksTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const [, setParams] = useSearchParams();
  const [view, setView] = usePersistentChoice('madar.tasks.view', VIEWS, 'list');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [showDone, setShowDone] = useState(false);
  const tasks = useCall('tasks.list', { projectId: detail.project.id, filter, activeProjectsOnly: false });
  const rows = tasks.data ?? [];
  const open = (taskId: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    next.set('task', taskId);
    return next;
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label={t('tasks.filters')} value={filter} onChange={setFilter} options={FILTERS.map((value) => ({ value, label: t(`tasks.filter.${value}`) }))} />
        <div className="ms-auto flex flex-wrap items-center gap-3">
          {view === 'list' && (
            <label className="flex min-h-11 items-center gap-2 text-subheadline">
              <input type="checkbox" className="size-5 accent-[var(--c-accent-fill)]" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
              {t('tasks.showDone')}
            </label>
          )}
          <SegmentedControl label={t('tasks.view')} value={view} onChange={setView} options={VIEWS.map((value) => ({ value, label: t(`tasks.views.${value}`) }))} />
        </div>
      </div>
      {view === 'list'
        ? <TaskList detail={detail} rows={showDone ? rows : rows.filter((row) => row.task.status !== 'done')} filtered={filter !== 'all'} onOpen={open} />
        : <TaskBoard rows={rows} onOpen={open} />}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/project/tasks`
Expected: PASS, the Task 11 tests included.

- [ ] **Step 5: Commit**

```bash
git add src/features/project/tasks
git commit -m "feat: add the task board with pointer drag, keyboard drag and a Move menu" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 13: The task sheet

**Files:**
- Create: `src/features/project/tasks/TaskSheet.tsx`, `src/features/project/tasks/history.ts`
- Modify: `src/features/project/tasks/TasksTab.tsx`
- Test: `src/features/project/tasks/TaskSheet.test.tsx`

**Interfaces:**
- Consumes: `TaskDetail` (with `canMove` and `viewerCan`), `Sheet` (non-blocking), fields, `Switch`, `useUndoable`, `useAction`, `tasks.get`, `tasks.update`, `tasks.move`, `tasks.approve`, `tasks.sendBack`, `tasks.delete`, `events.undo`, `files.list`, `session.get`.
- Produces: `TaskSheet({ taskId, detail, onClose })`; `historyText(event, t, lang): string`. The Tasks tab opens the sheet for `?task=<id>` and closes it by removing the param.

- [ ] **Step 1: Write the failing test**

`src/features/project/tasks/TaskSheet.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;

describe('the task sheet', () => {
  it('opens from the row', async () => {
    await renderApp('/projects/prj_001?tab=tasks');
    await userEvent.click(await screen.findByRole('button', { name: /Stair details/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(within(sheet).getByLabelText('Owner')).toHaveDisplayValue('Yousef Saleh');
  });

  it('saves a new title when the person leaves the field, and lists the change', async () => {
    const { store } = await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const title = within(sheet).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stair and ramp details');
    await userEvent.tab();
    await waitFor(() => expect(store.state.tasks.tsk_007.title).toBe('Stair and ramp details'));
    expect(await within(await screen.findByRole('dialog')).findByText('changed the title')).toBeInTheDocument();
  });

  it('lets the leader approve a task in review', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('done'));
  });

  it('asks for a note before a task goes back', async () => {
    const { store } = await renderApp(TASK('tsk_010'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Toilet details' });
    const send = within(sheet).getByRole('button', { name: 'Send back' });
    expect(send).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText('What needs to change?'), 'Add the vanity detail.');
    await userEvent.click(send);
    await waitFor(() => expect(store.state.tasks.tsk_010.status).toBe('in_progress'));
  });

  it("shows another person's task as read only", async () => {
    await renderApp(TASK('tsk_011'), as('usr_005'));
    const sheet = await screen.findByRole('dialog', { name: 'Balady submission set' });
    expect(within(sheet).getByText('You can view this task. Only its owner and the project leader can change it.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Title')).toHaveAttribute('readonly');
    expect(within(sheet).queryByRole('button', { name: 'Delete task' })).toBeNull();
  });

  it('deletes a task, then brings it back with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_013'), as('usr_002'));
    const sheet = await screen.findByRole('dialog', { name: 'Coordination meeting notes' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete task' }));
    expect(await screen.findByText('Task deleted.')).toBeInTheDocument();
    expect(store.state.tasks.tsk_013).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.tasks.tsk_013).toBeDefined());
  });

  it('adds and ticks a checklist item', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add an item' }), 'Handrail height{Enter}');
    await userEvent.click(await within(sheet).findByRole('checkbox', { name: 'Handrail height' }));
    await waitFor(() => expect(store.state.tasks.tsk_007.checklist).toEqual([expect.objectContaining({ text: 'Handrail height', done: true })]));
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/tasks/TaskSheet.test.tsx`
Expected: FAIL: no dialog opens for `?task=`.

- [ ] **Step 3: Write the sheet**

`src/features/project/tasks/history.ts`:

```ts
import type { TFunction } from 'i18next';
import type { Event } from '../../../api/contract/entities';
import { localeFor, type Lang } from '../../../lib/dates';

/** One line for a task history entry (spec 5.4), without the actor's name. */
export function historyText(event: Event, t: TFunction, lang: Lang): string {
  switch (event.verb) {
    case 'task.created': return t('taskHistory.created');
    case 'task.deleted': return t('taskHistory.deleted');
    case 'task.reassigned': return t('taskHistory.reassigned');
    case 'task.approved': return t('taskHistory.approved');
    case 'task.sent_back': return t('taskHistory.sent_back');
    case 'undo': return t('taskHistory.undo');
    case 'task.status_changed': {
      const status = (event.after as { status?: string } | null)?.status ?? 'todo';
      return t('taskHistory.status', { status: t(`taskStatus.${status}`) });
    }
    case 'task.updated': {
      const fields = [...new Set(Object.keys((event.after ?? {}) as object).map((field) => t(`taskHistory.fields.${field}`)))];
      return t('taskHistory.updated', { fields: new Intl.ListFormat(localeFor(lang), { type: 'conjunction' }).format(fields) });
    }
    default: return t('feed.other');
  }
}
```

`src/features/project/tasks/TaskSheet.tsx`:

```tsx
import { Flag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ChecklistItem, Task, TaskStatus } from '../../../api/contract/entities';
import type { ProjectDetail, TaskDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextArea, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { Sheet } from '../../../components/Sheet';
import { Switch } from '../../../components/Switch';
import { BOARD_COLUMNS } from '../../../lib/board';
import { formatNumber } from '../../../lib/dates';
import { historyText } from './history';

type Patch = Partial<Pick<Task, 'title' | 'description' | 'dueDate' | 'stageId' | 'ownerId' | 'flagged' | 'needsReview' | 'checklist'>>;

function Checklist({ task, edit, onChange }: { task: Task; edit: boolean; onChange: (items: ChecklistItem[]) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const items = task.checklist;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-headline">{t('taskSheet.checklist')}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              aria-label={item.text}
              className="size-5 shrink-0 accent-[var(--c-accent-fill)]"
              checked={item.done}
              disabled={!edit}
              onChange={(event) => onChange(items.map((i) => (i.id === item.id ? { ...i, done: event.target.checked } : i)))}
            />
            <span dir="auto" className={`min-w-0 flex-1 ${item.done ? 'text-label-2 line-through' : ''}`}>{item.text}</span>
            {edit && (
              <IconButton label={t('taskSheet.removeItem', { text: item.text })} onClick={() => onChange(items.filter((i) => i.id !== item.id))}>
                <X size={16} aria-hidden />
              </IconButton>
            )}
          </li>
        ))}
      </ul>
      {edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = text.trim();
            if (!value) return;
            const id = `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            onChange([...items, { id, text: value, done: false }]);
            setText('');
          }}
        >
          <input
            aria-label={t('taskSheet.addItem')}
            placeholder={t('taskSheet.addItem')}
            value={text}
            dir="auto"
            onChange={(event) => setText(event.target.value)}
            className="min-h-11 w-full rounded-control bg-fill px-3 text-body text-label placeholder:text-label-2"
          />
        </form>
      )}
    </section>
  );
}

function History({ data, canUndoAgent }: { data: TaskDetail; canUndoAgent: (actingForId: string) => boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const undo = useAction('events.undo', { onSuccess: () => toast.show({ message: t('taskSheet.undone') }) });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-headline">{t('taskSheet.history')}</h3>
      {data.history.length === 0 ? <p className="text-footnote text-label-2">{t('taskSheet.noHistory')}</p> : (
        <ol className="flex flex-col gap-2">
          {data.history.map(({ event, actor }) => (
            <li key={event.id} className="flex items-center gap-2 text-footnote">
              <Avatar user={actor} size={24} />
              <p className="min-w-0 flex-1">
                <bdi className="font-semibold">{actor.name}</bdi>{' '}
                {actor.kind === 'agent' && <><AgentLabel />{' '}</>}
                <span className="text-label-2">{historyText(event, t, lang)}</span>
              </p>
              <span className="shrink-0 text-caption text-label-2"><Age stamp={event.createdAt} /></span>
              {event.actorKind === 'agent' && !event.undoneBy && event.verb !== 'undo' && canUndoAgent(event.actingForId) && (
                <Button variant="plain" onClick={() => undo.mutate({ eventId: event.id })}>{t('taskSheet.undoAgent')}</Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TaskBody({ detail, data, onClose }: { detail: ProjectDetail; data: TaskDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const toast = useToast();
  const session = useCall('session.get', {});
  const files = useCall('files.list', { projectId: detail.project.id, taskId: data.task.id });
  const { task, viewerCan } = data;
  const update = useAction('tasks.update');
  const move = useUndoable('tasks.move', {
    message: (output) => (output.result === 'in_review' ? t('tasks.sentToReview') : t('tasks.moved', { status: t(`taskStatus.${output.result}`) })),
  });
  const approve = useAction('tasks.approve', { onSuccess: () => toast.show({ message: t('taskSheet.approved') }) });
  const sendBack = useAction('tasks.sendBack', {
    onSuccess: () => {
      setNote('');
      toast.show({ message: t('taskSheet.sentBack') });
    },
  });
  const remove = useUndoable('tasks.delete', { message: () => t('taskSheet.deleted'), onSuccess: onClose });
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [note, setNote] = useState('');
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
  }, [task.title, task.description]);

  const patch = (changes: Patch) => update.mutate({ id: task.id, patch: changes });
  const edit = viewerCan.edit;
  const people = detail.members.map((member) => member.user);
  if (!people.some((person) => person.id === data.owner.id)) people.push(data.owner);
  const me = session.data?.authority.id;
  const canUndoAgent = (actingForId: string) => detail.viewerCan.review || actingForId === me;

  return (
    <div className="flex flex-col gap-5 pt-1">
      {!edit && <p className="rounded-2xl bg-fill p-3 text-footnote text-label-2">{t('taskSheet.readOnly')}</p>}
      <TextField
        id="task-title"
        label={t('taskSheet.title')}
        value={title}
        dir="auto"
        readOnly={!edit}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          if (edit && title.trim() && title.trim() !== task.title) patch({ title: title.trim() });
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="task-status" label={t('taskSheet.status')} value={task.status} disabled={!data.canMove} onChange={(event) => move.mutate({ id: task.id, status: event.target.value as TaskStatus })}>
          {BOARD_COLUMNS.map((status) => <option key={status} value={status}>{t(`taskStatus.${status}`)}</option>)}
        </SelectField>
        <SelectField id="task-owner" label={t('taskSheet.owner')} value={task.ownerId} disabled={!viewerCan.editAll} onChange={(event) => patch({ ownerId: event.target.value })}>
          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </SelectField>
        <TextField id="task-due" type="date" label={t('taskSheet.dueDate')} value={task.dueDate ?? ''} readOnly={!edit} onChange={(event) => patch({ dueDate: event.target.value || null })} />
        <SelectField id="task-stage" label={t('taskSheet.stage')} value={task.stageId} disabled={!edit} onChange={(event) => patch({ stageId: event.target.value })}>
          {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </SelectField>
      </div>
      {edit
        ? <Switch id="task-flag" label={t('taskSheet.flag')} description={t('taskSheet.flagHint')} checked={task.flagged} onChange={(on) => patch({ flagged: on })} />
        : task.flagged && <p className="inline-flex items-center gap-2 text-subheadline text-orange-text"><Flag size={14} aria-hidden />{t('tasks.flagged')}</p>}
      {viewerCan.editAll && (
        <Switch id="task-review" label={t('taskSheet.needsReview')} description={t('taskSheet.needsReviewHint')} checked={task.needsReview} onChange={(on) => patch({ needsReview: on })} />
      )}
      {viewerCan.review && (
        <section aria-label={t('taskSheet.review')} className="flex flex-col gap-3 rounded-2xl bg-fill p-3">
          <Button variant="primary" disabled={approve.isPending} onClick={() => approve.mutate({ id: task.id })}>{t('taskSheet.approve')}</Button>
          <TextArea id="task-note" label={t('taskSheet.sendBackNote')} value={note} dir="auto" onChange={(event) => setNote(event.target.value)} />
          <Button disabled={!note.trim() || sendBack.isPending} onClick={() => sendBack.mutate({ id: task.id, note: note.trim() })}>{t('taskSheet.sendBack')}</Button>
        </section>
      )}
      <TextArea
        id="task-description"
        label={t('taskSheet.description')}
        value={description}
        dir="auto"
        readOnly={!edit}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          if (edit && description !== task.description) patch({ description });
        }}
      />
      <Checklist task={task} edit={edit} onChange={(checklist) => patch({ checklist })} />
      <section className="flex flex-col gap-1">
        <h3 className="text-headline">{t('taskSheet.files')}</h3>
        {(files.data ?? []).length === 0
          ? <p className="text-footnote text-label-2">{t('taskSheet.noFiles')}</p>
          : <ul>{(files.data ?? []).map((view) => <li key={view.file.id} className="text-subheadline"><bdi>{view.file.name}</bdi></li>)}</ul>}
      </section>
      <section className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-headline">{t('taskSheet.hours')}</h3>
          <p className="tabular text-subheadline text-label-2">{t('taskSheet.hoursValue', { n: formatNumber(data.hours, lang, 1) })}</p>
        </div>
        {detail.viewerCan.logTime && <Button onClick={() => navigate('/work')}>{t('taskSheet.logTime')}</Button>}
      </section>
      <p className="text-footnote text-label-2">{t('taskSheet.comments', { n: data.commentCount })}</p>
      <History data={data} canUndoAgent={canUndoAgent} />
      {viewerCan.delete && (
        <Button variant="destructive" className="self-start" disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>{t('taskSheet.delete')}</Button>
      )}
    </div>
  );
}

/** The task panel: a side panel with no dim layer on desktop, a sheet on a phone (spec 5.4). */
export function TaskSheet({ taskId, detail, onClose }: { taskId: string; detail: ProjectDetail; onClose: () => void }) {
  const task = useCall('tasks.get', { id: taskId });
  useEffect(() => {
    if (task.error) onClose();
  }, [task.error, onClose]);
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={task.data?.task.title ?? ''}
      blocking={false}
    >
      {task.data && <TaskBody detail={detail} data={task.data} onClose={onClose} />}
    </Sheet>
  );
}
```

In `src/features/project/tasks/TasksTab.tsx`, add `import { useCallback } from 'react';` next to `useState`, `import { TaskSheet } from './TaskSheet';`, read the params with `const [params, setParams] = useSearchParams();`, and add before the closing `</div>`:

```tsx
      {params.get('task') && <TaskSheet key={params.get('task')} taskId={params.get('task') as string} detail={detail} onClose={closeTask} />}
```

with this function next to `open`:

```tsx
  const closeTask = useCallback(() => setParams((current) => {
    const next = new URLSearchParams(current);
    next.delete('task');
    return next;
  }), [setParams]);
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/project/tasks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/project/tasks
git commit -m "feat: add the task sheet with review, checklist, history and delete with Undo" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---
### Task 14: The Schedule tab

**Files:**
- Create: `src/features/project/schedule/ScheduleTab.tsx`
- Modify: `src/lib/dates.ts` (add `formatMonth`), `src/features/project/tabs.tsx`
- Test: `src/lib/dates.test.ts`, `src/features/project/schedule/ScheduleTab.test.tsx`

**Interfaces:**
- Consumes: `chartRange`, `spanDays`, `offsetPct`, `widthPct`, `monthStarts`, `dayDelta`, `moveEdge`, `Span` (Task 2), `useIsPhone`, `useUndoable`, `stages.setDates`, `deadlines.create`, `deadlines.delete`.
- Produces: `formatMonth(day, lang): string`; `ScheduleTab({ detail })` as `TAB_BODY.schedule`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/dates.test.ts` (add `formatMonth` to its import):

```ts
describe('formatMonth', () => {
  it('gives the short month name with the Gregorian calendar in both languages', () => {
    expect(formatMonth('2026-10-01', 'en')).toBe('Oct');
    expect(formatMonth('2026-10-01', 'ar')).toBe('أكتوبر');
  });
});
```

`src/features/project/schedule/ScheduleTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const SCHEDULE = '/projects/prj_001?tab=schedule';

describe('the Schedule tab', () => {
  it('draws the stages, today and the deadlines', async () => {
    await renderApp(SCHEDULE);
    const chart = await screen.findByRole('region', { name: 'Stage timeline' });
    expect(within(chart).getByText('Construction Documents')).toBeInTheDocument();
    expect(within(chart).getByText('Today')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Deadlines' })).getByText('Balady submission')).toBeInTheDocument();
  });

  it('moves a stage end by one day with the arrow key, then undoes it', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'));
    const end = await screen.findByRole('slider', { name: 'End of Permits' });
    end.focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe('2026-11-02'));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.stages.stg_005.endDate).toBe('2026-11-01'));
  });

  it('shows no drag handles to a team member', async () => {
    await renderApp(SCHEDULE, as('usr_005'));
    await screen.findByRole('region', { name: 'Stage timeline' });
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('adds a deadline, deletes it, and brings it back with Undo', async () => {
    const { store } = await renderApp(SCHEDULE, as('usr_002'));
    await userEvent.type(await screen.findByLabelText('Deadline name'), 'Client meeting');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-20' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add deadline' }));
    const deadlines = screen.getByRole('region', { name: 'Deadlines' });
    expect(await within(deadlines).findByText('Client meeting')).toBeInTheDocument();
    await userEvent.click(within(deadlines).getByRole('button', { name: 'Delete Client meeting' }));
    const exists = () => Object.values(store.state.deadlines).some((d) => d.name === 'Client meeting');
    await waitFor(() => expect(exists()).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(exists()).toBe(true));
  });

  it('says when there are no dates yet', async () => {
    await renderApp(SCHEDULE, (state) => {
      for (const stage of Object.values(state.stages)) {
        if (stage.projectId !== 'prj_001') continue;
        stage.startDate = null;
        stage.endDate = null;
      }
      for (const [id, deadline] of Object.entries(state.deadlines)) if (deadline.projectId === 'prj_001') delete state.deadlines[id];
    });
    expect(await screen.findByText('Add stage dates or a deadline to see the timeline.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib/dates.test.ts src/features/project/schedule`
Expected: FAIL: `formatMonth` is not exported, and the tab shows the "arrives later" note.

- [ ] **Step 3: Write the tab**

Add to `src/lib/dates.ts`, after `formatDay`:

```ts
/** The short month name, for the month scale of a schedule. */
export function formatMonth(day: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { month: 'short', timeZone: 'UTC' }).format(new Date(toMs(day)));
}
```

`src/features/project/schedule/ScheduleTab.tsx`:

```tsx
import { Trash } from 'lucide-react';
import { Fragment, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Stage } from '../../../api/contract/entities';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { useIsPhone } from '../../../app/useIsPhone';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { SelectField, TextField } from '../../../components/Fields';
import { IconButton } from '../../../components/IconButton';
import { diffDays, formatDay, formatMonth, todayISO } from '../../../lib/dates';
import { chartRange, dayDelta, monthStarts, moveEdge, offsetPct, spanDays, widthPct, type Span } from '../../../lib/schedule';
import type { TabProps } from '../tabs';

type Edge = 'start' | 'end';

function StageBar({
  stage, span, range, current, editable, width, onPreview, onCommit,
}: {
  stage: Stage;
  span: Span;
  range: Span;
  current: boolean;
  editable: boolean;
  width: () => number;
  onPreview: (span: Span | null) => void;
  onCommit: (span: Span) => void;
}) {
  const { t } = useTranslation();
  const lang = useLang();
  const drag = useRef<{ edge: Edge; x: number; origin: Span } | null>(null);
  const rtl = document.documentElement.dir === 'rtl';
  const total = spanDays(range);
  const daysFor = (event: PointerEvent) => dayDelta(event.clientX - (drag.current?.x ?? event.clientX), width(), total, rtl);

  const handle = (edge: Edge) => {
    const day = edge === 'start' ? span.start : span.end;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      onCommit(moveEdge(span, edge, step));
    };
    return (
      <span
        role="slider"
        tabIndex={0}
        aria-label={t(edge === 'start' ? 'schedule.startOf' : 'schedule.endOf', { stage: stage.name })}
        aria-valuemin={0}
        aria-valuemax={total - 1}
        aria-valuenow={diffDays(range.start, day)}
        aria-valuetext={formatDay(day, lang, 'long')}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { edge, x: event.clientX, origin: span };
        }}
        onPointerMove={(event) => {
          if (drag.current) onPreview(moveEdge(drag.current.origin, drag.current.edge, daysFor(event)));
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          const days = daysFor(event);
          const next = moveEdge(drag.current.origin, drag.current.edge, days);
          drag.current = null;
          if (days === 0) onPreview(null);
          else onCommit(next);
        }}
        className={`absolute inset-y-0 z-10 w-6 cursor-ew-resize touch-none rounded-full focus-visible:bg-white/40 ${edge === 'start' ? '-start-2' : '-end-2'}`}
      />
    );
  };

  return (
    <div
      title={`${stage.name}: ${formatDay(span.start, lang)} to ${formatDay(span.end, lang)}`}
      style={{ insetInlineStart: `${offsetPct(range, span.start)}%`, width: `${widthPct(range, span.start, span.end)}%` }}
      className={`absolute top-2 h-7 rounded-full ${current ? 'bg-accent-fill' : 'bg-fill-strong'}`}
    >
      {editable && handle('start')}
      {editable && handle('end')}
    </div>
  );
}

/** Stage bars on a month scale, deadlines as diamonds and a line for today. Time runs toward the end side (spec 5.6). */
function Timeline({ detail, range, today }: { detail: ProjectDetail; range: Span; today: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const scale = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ stageId: string; span: Span } | null>(null);
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  const width = () => scale.current?.getBoundingClientRect().width ?? 0;
  const todayAt = { insetInlineStart: `${offsetPct(range, today)}%` };
  const todayLine = <span aria-hidden style={todayAt} className="absolute inset-y-0 w-px bg-red" />;
  return (
    <section aria-label={t('schedule.chart')} className="surface overflow-x-auto rounded-card p-4">
      <div className="grid min-w-[40rem] grid-cols-[10rem_minmax(0,1fr)] gap-x-3">
        <div />
        <div ref={scale} className="relative h-7">
          {monthStarts(range).map((month) => (
            <span key={month} aria-hidden style={{ insetInlineStart: `${offsetPct(range, month)}%` }} className="absolute top-0 border-s border-separator ps-1 text-caption text-label-2">
              {formatMonth(month, lang)}
            </span>
          ))}
          <span style={todayAt} className="absolute bottom-0 -translate-x-1/2 text-caption font-semibold text-red-text rtl:translate-x-1/2">{t('schedule.today')}</span>
        </div>
        {detail.stages.map((stage) => {
          const saved = stage.startDate && stage.endDate ? { start: stage.startDate, end: stage.endDate } : null;
          const span = preview?.stageId === stage.id ? preview.span : saved;
          return (
            <Fragment key={stage.id}>
              <div dir="auto" className="flex min-h-11 items-center truncate text-subheadline">{stage.name}</div>
              <div className="relative min-h-11">
                {todayLine}
                {span ? (
                  <StageBar
                    stage={stage}
                    span={span}
                    range={range}
                    current={stage.id === detail.currentStage.id}
                    editable={detail.viewerCan.edit}
                    width={width}
                    onPreview={(next) => setPreview(next ? { stageId: stage.id, span: next } : null)}
                    onCommit={(next) => {
                      setPreview(null);
                      setDates.mutate({ stageId: stage.id, startDate: next.start, endDate: next.end });
                    }}
                  />
                ) : <span className="flex h-11 items-center text-footnote text-label-2">{t('project.noDates')}</span>}
              </div>
            </Fragment>
          );
        })}
        <div className="flex min-h-11 items-center text-subheadline text-label-2">{t('schedule.deadlines')}</div>
        <div className="relative min-h-11" aria-hidden>
          {todayLine}
          {detail.deadlines.map((deadline) => (
            <span
              key={deadline.id}
              title={`${deadline.name} · ${formatDay(deadline.date, lang)}`}
              style={{ insetInlineStart: `calc(${offsetPct(range, deadline.date)}% - 6px)` }}
              className="absolute top-4 size-3 rotate-45 rounded-sm bg-orange"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Stage dates as a list: the phone view, and date fields for the leader on every screen size. */
function StageDates({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const setDates = useUndoable('stages.setDates', { message: () => t('schedule.datesChanged') });
  const edit = detail.viewerCan.edit;
  return (
    <section aria-labelledby="schedule-stages" className="surface rounded-card p-4">
      <h2 id="schedule-stages" className="text-headline">{t('schedule.stages')}</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {detail.stages.map((stage) => (
          <li key={stage.id} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <span dir="auto" className="min-w-0 flex-1 text-subheadline font-medium">{stage.name}</span>
            {edit ? (
              <>
                <TextField id={`start-${stage.id}`} type="date" label={t('schedule.startOf', { stage: stage.name })} value={stage.startDate ?? ''}
                  onChange={(event) => setDates.mutate({ stageId: stage.id, startDate: event.target.value || null, endDate: stage.endDate })} />
                <TextField id={`end-${stage.id}`} type="date" label={t('schedule.endOf', { stage: stage.name })} value={stage.endDate ?? ''}
                  onChange={(event) => setDates.mutate({ stageId: stage.id, startDate: stage.startDate, endDate: event.target.value || null })} />
              </>
            ) : (
              <span className="tabular text-footnote text-label-2">
                {stage.startDate && stage.endDate
                  ? t('project.stageDates', { start: formatDay(stage.startDate, lang), end: formatDay(stage.endDate, lang) })
                  : t('project.noDates')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Deadlines({ detail }: TabProps) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [stageId, setStageId] = useState('');
  const add = useAction('deadlines.create', {
    onSuccess: () => {
      setName('');
      setDate('');
      toast.show({ message: t('schedule.deadlineAdded') });
    },
  });
  const remove = useUndoable('deadlines.delete', { message: () => t('schedule.deadlineDeleted') });
  const today = todayISO();
  return (
    <section aria-labelledby="schedule-deadlines" className="surface rounded-card p-4">
      <h2 id="schedule-deadlines" className="text-headline">{t('schedule.deadlines')}</h2>
      {detail.deadlines.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('schedule.noDeadlines')}</p> : (
        <ul className="mt-1">
          {detail.deadlines.map((deadline) => (
            <li key={deadline.id} className="flex min-h-11 items-center gap-3">
              <span aria-hidden className="size-2.5 shrink-0 rotate-45 rounded-sm bg-orange" />
              <bdi className="min-w-0 flex-1 truncate text-subheadline">{deadline.name}</bdi>
              <span className={`tabular text-footnote ${deadline.date < today ? 'text-label-2' : ''}`}>{formatDay(deadline.date, lang)}</span>
              {detail.viewerCan.edit && (
                <IconButton label={t('schedule.deleteDeadline', { name: deadline.name })} onClick={() => remove.mutate({ id: deadline.id })}>
                  <Trash size={16} aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.viewerCan.edit && (
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && date) add.mutate({ projectId: detail.project.id, name: name.trim(), date, stageId: stageId || null });
          }}
        >
          <TextField id="deadline-name" label={t('schedule.deadlineName')} value={name} dir="auto" onChange={(event) => setName(event.target.value)} />
          <TextField id="deadline-date" type="date" label={t('schedule.deadlineDate')} value={date} onChange={(event) => setDate(event.target.value)} />
          <SelectField id="deadline-stage" label={t('schedule.deadlineStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            <option value="">{t('files.noStage')}</option>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </SelectField>
          <Button variant="primary" type="submit" disabled={!name.trim() || !date || add.isPending}>{t('schedule.addDeadline')}</Button>
        </form>
      )}
    </section>
  );
}

export function ScheduleTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const today = todayISO();
  const dated = detail.stages.some((stage) => stage.startDate && stage.endDate) || detail.deadlines.length > 0;
  const range = chartRange([
    detail.project.startDate, detail.project.targetEndDate, today,
    ...detail.stages.flatMap((stage) => [stage.startDate, stage.endDate]),
    ...detail.deadlines.map((deadline) => deadline.date),
  ]);
  return (
    <div className="flex flex-col gap-5">
      {!dated || !range
        ? <EmptyState title={t('schedule.noDatesTitle')} body={t('schedule.noDates')} />
        : !phone && <Timeline detail={detail} range={range} today={today} />}
      {(phone || detail.viewerCan.edit) && <StageDates detail={detail} />}
      <Deadlines detail={detail} />
    </div>
  );
}
```

In `src/features/project/tabs.tsx`, add `import { ScheduleTab } from './schedule/ScheduleTab';` and set `schedule: ScheduleTab,`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/lib src/features/project/schedule`
Expected: PASS. (Checked on this machine: `formatMonth('2026-10-01', 'ar')` gives `أكتوبر`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/features/project
git commit -m "feat: add the Schedule tab with stage bars, drag and keyboard edges, and deadlines" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 15: The Files tab

**Files:**
- Create: `src/features/project/files/FilesTab.tsx`
- Modify: `src/features/project/tabs.tsx`
- Test: `src/features/project/files/FilesTab.test.tsx`

**Interfaces:**
- Consumes: `useFileUrl`, `downloadFile` (Task 5), `newStoryId`, `useUndoable`, `Menu`, `Sheet`, `files.list`, `files.upload`, `files.delete`, `projects.update` with `coverFileId` (Task 1), `session.get`.
- Produces: `FilesTab({ detail })` as `TAB_BODY.files`.

- [ ] **Step 1: Write the failing test**

`src/features/project/files/FilesTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

describe('the Files tab', () => {
  it('groups the files by stage and shows the latest version', async () => {
    await renderApp(FILES);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Ground floor plan.pdf')).toBeInTheDocument();
    expect(within(group).getByText('Version B')).toBeInTheDocument();
  });

  it('uploads a file, and a second upload with the same name becomes version B', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const input = await screen.findByLabelText('Upload files');
    await userEvent.upload(input, new File(['notes'], 'Site notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Files uploaded: 1.')).toBeInTheDocument();
    await userEvent.upload(input, new File(['notes 2'], 'Site notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Site notes.txt')?.versions.map((v) => v.letter)).toEqual(['A', 'B']));
  });

  it('refuses a file over 25 MB before any upload', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const big = new File(['x'], 'Huge model.rvt', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await userEvent.upload(await screen.findByLabelText('Upload files'), big);
    expect(await screen.findByText('Huge model.rvt is larger than 25 MB.')).toBeInTheDocument();
    expect(Object.values(store.state.files).some((f) => f.name === 'Huge model.rvt')).toBe(false);
  });

  it('deletes a file, then brings it back with Undo', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeDefined());
  });

  it('sets an image as the project cover', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Massing view.svg' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set as cover' }));
    await waitFor(() => expect(store.state.projects.prj_001.coverFileId).toBe('fil_002'));
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/files`
Expected: FAIL: the tab shows the "arrives later" note.

- [ ] **Step 3: Write the tab**

`src/features/project/files/FilesTab.tsx`:

```tsx
import { FileText, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_FILE_BYTES } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { newStoryId, useUndoable } from '../../../app/actions';
import { errorMessage } from '../../../app/errors';
import { downloadFile, useFileUrl } from '../../../app/files';
import { useLang } from '../../../app/lang';
import { useCall, useRuntime } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { SelectField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { Sheet } from '../../../components/Sheet';
import { formatDay, formatNumber, stampDay } from '../../../lib/dates';
import type { TabProps } from '../tabs';

function PreviewSheet({ view, onClose }: { view: FileView; onClose: () => void }) {
  const { t } = useTranslation();
  const url = useFileUrl(view.file.id, view.latest.letter);
  const type = view.latest.mimeType;
  let body = <p className="text-subheadline text-label-2">{t('files.noPreview')}</p>;
  if (url && type.startsWith('image/')) body = <img src={url} alt={view.file.name} className="w-full rounded-2xl bg-white" />;
  else if (url && type === 'application/pdf') body = <iframe src={url} title={view.file.name} className="h-[70dvh] w-full rounded-2xl bg-white" />;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={view.file.name} wide>
      {body}
    </Sheet>
  );
}

function FileRow({ view, detail, onPreview }: { view: FileView; detail: ProjectDetail; onPreview: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { api } = useRuntime();
  const toast = useToast();
  const session = useCall('session.get', {});
  const [showVersions, setShowVersions] = useState(false);
  const { file, latest } = view;
  const image = latest.mimeType.startsWith('image/');
  const thumb = useFileUrl(image ? file.id : null, latest.letter);
  const remove = useUndoable('files.delete', { message: () => t('files.deleted') });
  const cover = useUndoable('projects.update', { message: () => t('files.coverSet') });
  const isCover = detail.project.coverFileId === file.id;
  const canDelete = detail.viewerCan.review || file.versions[0].uploadedBy === session.data?.authority.id;
  const size = latest.size < 1024 * 1024
    ? t('files.kb', { n: formatNumber(Math.max(1, Math.round(latest.size / 1024)), lang) })
    : t('files.mb', { n: formatNumber(latest.size / (1024 * 1024), lang, 1) });
  const download = (letter?: string) => {
    downloadFile(api, file.id, letter).catch((error: unknown) => toast.show({ tone: 'error', message: errorMessage(error, t) }));
  };
  const items: MenuItem[] = [
    { label: t('files.preview'), onSelect: onPreview, hidden: !(image || latest.mimeType === 'application/pdf') },
    { label: t('files.download'), onSelect: () => download() },
    { label: t('files.setCover'), onSelect: () => cover.mutate({ id: detail.project.id, patch: { coverFileId: file.id } }), hidden: !image || !detail.viewerCan.edit || isCover },
    { label: t('files.delete'), onSelect: () => remove.mutate({ id: file.id }), hidden: !canDelete, destructive: true },
  ];
  return (
    <li className="flex flex-col">
      <div className="flex min-h-14 items-center gap-3 px-2">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill text-label-2">
          {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <FileText size={20} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <bdi className="truncate text-body">{file.name}</bdi>
            <span className="shrink-0 rounded-full bg-fill px-2 text-caption font-semibold text-label-2">{t('files.version', { letter: latest.letter })}</span>
            {isCover && <span className="shrink-0 rounded-full bg-fill px-2 text-caption text-label-2">{t('files.isCover')}</span>}
          </p>
          <p className="truncate text-footnote text-label-2">
            <bdi>{view.uploader.name}</bdi> · <span className="tabular">{formatDay(stampDay(latest.uploadedAt), lang)} · {size}</span>
          </p>
        </div>
        {file.versions.length > 1 && (
          <Button variant="plain" aria-expanded={showVersions} onClick={() => setShowVersions((open) => !open)}>{t('files.versions')}</Button>
        )}
        <Menu label={t('files.actions', { name: file.name })} items={items} />
      </div>
      {showVersions && (
        <ol className="ms-14 flex flex-col pb-2">
          {[...file.versions].reverse().map((version) => (
            <li key={version.letter} className="flex min-h-11 items-center gap-3 text-footnote">
              <span className="font-semibold">{t('files.version', { letter: version.letter })}</span>
              <span className="tabular text-label-2">{formatDay(stampDay(version.uploadedAt), lang)}</span>
              <Button variant="plain" onClick={() => download(version.letter)}>{t('files.download')}</Button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** Files grouped by stage, with versions A, B, C (spec 5.7). Drop files anywhere on the tab to upload them. */
export function FilesTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const files = useCall('files.list', { projectId: detail.project.id });
  const [stageId, setStageId] = useState(detail.currentStage.id);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<FileView | null>(null);
  const canUpload = detail.viewerCan.post;

  const upload = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    for (const file of chosen.filter((f) => f.size > MAX_FILE_BYTES)) toast.show({ tone: 'error', message: t('files.tooBig', { name: file.name }) });
    const accepted = chosen.filter((f) => f.size <= MAX_FILE_BYTES);
    if (accepted.length === 0) return;
    const meta = { correlationId: newStoryId() };
    setUploading(true);
    try {
      for (const file of accepted) {
        await api.call('files.upload', { projectId: detail.project.id, name: file.name, blob: file, stageId: stageId || null }, meta);
      }
      toast.show({ message: t('files.uploaded', { n: accepted.length }) });
    } catch (error) {
      toast.show({ tone: 'error', message: errorMessage(error, t) });
    } finally {
      setUploading(false);
    }
  };

  const groups = [...detail.stages.map((stage) => ({ id: stage.id as string | null, name: stage.name })), { id: null, name: t('files.noStage') }]
    .map((group) => ({ ...group, files: (files.data ?? []).filter((view) => view.file.stageId === group.id) }))
    .filter((group) => group.files.length > 0);

  return (
    <div
      onDragOver={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
      className={`flex flex-col gap-4 rounded-card ${dragging ? 'outline-2 outline-offset-4 outline-dashed outline-accent' : ''}`}
    >
      {canUpload && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="pressable inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-accent-fill px-5 text-body font-semibold text-on-accent">
            <Upload size={18} aria-hidden />
            {t('files.upload')}
            <input
              type="file"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
          <SelectField id="upload-stage" label={t('files.uploadStage')} value={stageId} onChange={(event) => setStageId(event.target.value)}>
            {detail.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
            <option value="">{t('files.noStage')}</option>
          </SelectField>
          <p className="pb-3 text-footnote text-label-2">{t('files.drop')}</p>
        </div>
      )}
      {files.data && groups.length === 0 && <EmptyState title={t('files.emptyTitle')} body={t('files.empty')} />}
      {groups.map((group) => {
        const id = `files-${group.id ?? 'none'}`;
        return (
          <section key={id} aria-labelledby={id} className="surface rounded-card p-2">
            <h3 id={id} dir="auto" className="px-2 pt-1 text-headline">{group.name}</h3>
            <ul>{group.files.map((view) => <FileRow key={view.file.id} view={view} detail={detail} onPreview={() => setPreview(view)} />)}</ul>
          </section>
        );
      })}
      {preview && <PreviewSheet view={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
```

In `src/features/project/tabs.tsx`, add `import { FilesTab } from './files/FilesTab';` and set `files: FilesTab,`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/features/project/files`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/project
git commit -m "feat: add the Files tab with upload, versions, preview, cover and delete with Undo" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 16: The Team tab

**Files:**
- Create: `src/features/project/team/TeamTab.tsx`
- Modify: `src/features/project/tabs.tsx`
- Test: `src/features/project/team/TeamTab.test.tsx`

**Interfaces:**
- Consumes: `ProjectDetail.members[].hoursThisMonth` (Task 1), `useUndoable`, `Menu`, `members.add`, `members.remove`, `members.update`, `projects.setLeader`, `users.list`.
- Produces: `TeamTab({ detail })` as `TAB_BODY.team`.

- [ ] **Step 1: Write the failing test**

`src/features/project/team/TeamTab.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TEAM = '/projects/prj_001?tab=team';

describe('the Team tab', () => {
  it('shows the leader, the members, their open tasks and, for the leader, their hours', async () => {
    await renderApp(TEAM, as('usr_002'));
    const leader = await screen.findByRole('region', { name: 'Leader' });
    expect(within(leader).getByText('Faisal Al-Harbi')).toBeInTheDocument();
    const members = screen.getByRole('region', { name: 'Members' });
    expect(within(members).getByText('Sara Al-Qahtani')).toBeInTheDocument();
    expect(within(members).getByText('Open tasks: 2')).toBeInTheDocument();
    expect(within(members).getByText('33.5 h this month')).toBeInTheDocument();
  });

  it('shows a member only their own hours', async () => {
    await renderApp(TEAM, as('usr_005'));
    const members = await screen.findByRole('region', { name: 'Members' });
    expect(within(members).getAllByText(/h this month/)).toHaveLength(1);
    expect(within(members).getByText('33.5 h this month')).toBeInTheDocument();
  });

  it('shows a person outside the project no hours and no actions', async () => {
    await renderApp(TEAM, as('usr_003'));
    await screen.findByRole('region', { name: 'Members' });
    expect(screen.queryByText(/h this month/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add member' })).toBeNull();
  });

  it('adds a member, then removes them and brings them back with Undo', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'Lina Mansour');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const members = screen.getByRole('region', { name: 'Members' });
    expect(await within(members).findByText('Lina Mansour')).toBeInTheDocument();
    await userEvent.click(within(members).getByRole('button', { name: 'Actions for Lina Mansour' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from team' }));
    await waitFor(() => expect(store.state.members['prj_001:usr_007']).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.members['prj_001:usr_007']).toBeDefined());
  });

  it('saves a new discipline when the leader leaves the field', async () => {
    const { store } = await renderApp(TEAM, as('usr_002'));
    const field = await screen.findByLabelText('Discipline of Yousef Saleh');
    await userEvent.clear(field);
    await userEvent.type(field, 'MEP lead');
    await userEvent.tab();
    await waitFor(() => expect(store.state.members['prj_001:usr_006'].discipline).toBe('MEP lead'));
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/team`
Expected: FAIL: the tab shows the "arrives later" note.

- [ ] **Step 3: Write the tab**

`src/features/project/team/TeamTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useUndoable } from '../../../app/actions';
import { useLang } from '../../../app/lang';
import { useAction, useCall } from '../../../app/runtime';
import { useToast } from '../../../app/toasts';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { SelectField, TextField } from '../../../components/Fields';
import { Menu, type MenuItem } from '../../../components/Menu';
import { formatNumber } from '../../../lib/dates';
import type { TabProps } from '../tabs';

type Member = ProjectDetail['members'][number];

function MemberRow({ member, detail }: { member: Member; detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const toast = useToast();
  const { user } = member;
  const [discipline, setDiscipline] = useState(member.discipline);
  useEffect(() => setDiscipline(member.discipline), [member.discipline]);
  const save = useAction('members.update', { onSuccess: () => toast.show({ message: t('team.disciplineSaved') }) });
  const lead = useAction('projects.setLeader', { onSuccess: () => toast.show({ message: t('project.leaderChanged') }) });
  const remove = useUndoable('members.remove', { message: () => t('team.removed', { name: user.name }) });
  const edit = detail.viewerCan.edit;
  const items: MenuItem[] = [
    { label: t('team.makeLeader'), onSelect: () => lead.mutate({ id: detail.project.id, leaderId: user.id }), hidden: !detail.viewerCan.changeLeader || member.isLeader },
    {
      label: t('team.remove'),
      onSelect: () => remove.mutate({ projectId: detail.project.id, userId: user.id }),
      hidden: !edit || member.isLeader || member.openTasks > 0,
      destructive: true,
    },
  ];
  return (
    <li className="flex flex-wrap items-center gap-3 px-2 py-2">
      <Avatar user={user} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold"><bdi>{user.name}</bdi></p>
        <p className="flex flex-wrap gap-x-3 text-footnote text-label-2">
          <span>{t('team.openTasks', { n: member.openTasks })}</span>
          {member.hoursThisMonth !== null && <span className="tabular">{t('team.hoursMonth', { n: formatNumber(member.hoursThisMonth, lang, 1) })}</span>}
        </p>
      </div>
      {edit ? (
        <input
          aria-label={t('team.discipline', { name: user.name })}
          value={discipline}
          dir="auto"
          onChange={(event) => setDiscipline(event.target.value)}
          onBlur={() => {
            const value = discipline.trim();
            if (value && value !== member.discipline) save.mutate({ projectId: detail.project.id, userId: user.id, discipline: value });
          }}
          className="min-h-11 w-40 rounded-control bg-fill px-3 text-subheadline text-label"
        />
      ) : <span className="text-subheadline text-label-2">{member.discipline}</span>}
      <Menu label={t('team.actions', { name: user.name })} items={items} />
    </li>
  );
}

function AddMember({ detail }: TabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const users = useCall('users.list', {});
  const onTeam = new Set(detail.members.map((member) => member.user.id));
  const candidates = (users.data ?? []).filter((user) => user.kind === 'human' && !onTeam.has(user.id));
  const [userId, setUserId] = useState('');
  const [discipline, setDiscipline] = useState('');
  const add = useAction('members.add');
  return (
    <section aria-labelledby="team-add" className="surface rounded-card p-4">
      <h2 id="team-add" className="text-headline">{t('team.add')}</h2>
      {candidates.length === 0 ? <p className="mt-2 text-footnote text-label-2">{t('team.noOne')}</p> : (
        <form
          className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const person = candidates.find((user) => user.id === userId);
            if (!person) return;
            add.mutate({ projectId: detail.project.id, userId, discipline: discipline.trim() || undefined }, {
              onSuccess: () => {
                toast.show({ message: t('team.added', { name: person.name }) });
                setUserId('');
                setDiscipline('');
              },
            });
          }}
        >
          <SelectField
            id="add-person"
            label={t('team.person')}
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setDiscipline(candidates.find((user) => user.id === event.target.value)?.discipline ?? '');
            }}
          >
            <option value="" disabled>{t('team.person')}</option>
            {candidates.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </SelectField>
          <TextField id="add-discipline" label={t('team.newDiscipline')} value={discipline} dir="auto" onChange={(event) => setDiscipline(event.target.value)} />
          <Button variant="primary" type="submit" disabled={!userId || add.isPending}>{t('common.add')}</Button>
        </form>
      )}
    </section>
  );
}

/** The leader, then the members, with disciplines, open tasks and, for the leader and the Admin, hours this month (spec 5.8). */
export function TeamTab({ detail }: TabProps) {
  const { t } = useTranslation();
  const leader = detail.members.find((member) => member.isLeader);
  const members = detail.members.filter((member) => !member.isLeader);
  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="team-leader" className="surface rounded-card p-2">
        <h2 id="team-leader" className="px-2 pt-1 text-headline">{t('team.leader')}</h2>
        {leader ? <ul><MemberRow member={leader} detail={detail} /></ul> : <p className="px-2 pb-2 text-footnote text-label-2">{t('team.noLeader')}</p>}
      </section>
      <section aria-labelledby="team-members" className="surface rounded-card p-2">
        <h2 id="team-members" className="px-2 pt-1 text-headline">{t('team.members')}</h2>
        <ul>{members.map((member) => <MemberRow key={member.user.id} member={member} detail={detail} />)}</ul>
      </section>
      {detail.viewerCan.edit && <AddMember detail={detail} />}
    </div>
  );
}
```

In `src/features/project/tabs.tsx`, add `import { TeamTab } from './team/TeamTab';` and set `team: TeamTab,`.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: PASS on all three. The key test from Task 2 now also proves every literal text key in the new screens exists.

- [ ] **Step 5: Commit**

```bash
git add src/features/project
git commit -m "feat: add the Team tab with disciplines, open tasks, month hours and member changes" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 17: Browser sweep and the review link

**Files:**
- Create: `tests/e2e/projects.spec.ts`
- Modify: the review wrapper `index.html` in the session scratchpad (`madar-review/`), and the progress page status

**Interfaces:**
- Consumes: the whole app.
- Produces: a green browser sweep, screenshots, and the review link at https://claude.ai/artifact/QRj6nZQKmu6tBcCRMxtjrY with the Projects screens.

- [ ] **Step 1: Write the browser sweep**

`tests/e2e/projects.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TABS = ['overview', 'tasks', 'schedule', 'files', 'team'];

async function expectNoSeriousA11yIssues(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

for (const width of [390, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    test(`project tabs at ${width}px in ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (lang === 'ar') await useArabic(page);
      for (const tab of TABS) {
        await page.goto(`/#/projects/prj_001?tab=${tab}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `test-results/projects/${width}-${lang}-${tab}.png`, fullPage: true });
        await expectNoSeriousA11yIssues(page);
      }
    });
  }
}

test('the grid shows four columns at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('article').first()).toBeVisible();
  const tops = await page.getByRole('article').evaluateAll((cards) => cards.slice(0, 5).map((card) => Math.round(card.getBoundingClientRect().top)));
  expect(new Set(tops.slice(0, 4)).size).toBe(1);
  expect(tops[4]).toBeGreaterThan(tops[0]);
});

test('a person creates a project and lands on it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New Project' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Project' });
  await sheet.getByLabel('Name', { exact: true }).fill('Harbour Gate Offices');
  await sheet.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Harbour Gate Offices' })).toBeVisible();
});

test('the New Project sheet is a bottom sheet on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await page.getByRole('button', { name: 'New Project' }).click();
  const box = await page.getByRole('dialog', { name: 'New Project' }).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(840);
});

test('the board moves a card with the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('radio', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'Drag Specifications draft' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.getByRole('region', { name: 'In progress: 3' }).getByText('Specifications draft')).toBeVisible();
});

test('the schedule changes a stage end by a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/projects/prj_001?tab=schedule');
  const handle = page.getByRole('slider', { name: 'End of Permits' });
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('Dates changed.')).toBeVisible();
});
```

- [ ] **Step 2: Run the browser sweep in a subagent**

Delegate to one subagent (the owner's rule: Playwright always runs in a subagent). Brief it with: the repo path, the command `npx playwright test tests/e2e/projects.spec.ts tests/e2e/shell.spec.ts --reporter=line`, the instruction to fix only test-side mistakes (a wrong selector or wait) and to report every app defect with the failing assertion, the screenshot folder `test-results/projects/`, and the instruction to return the pass count, each failure with its message, and the paths of four screenshots (1440 English overview, 1440 Arabic schedule, 390 English tasks, 390 Arabic files).
Expected: all tests pass. Fix each reported app defect in the main session with a failing test first when a unit test can show it; a layout-only defect gets a ruling in the ledger and a screenshot as its proof.

- [ ] **Step 3: Look at the screens**

Read the four screenshots from Step 2. Also build (`npm run build`), serve `dist/` on `127.0.0.1` and take CDP screenshots of `/#/` at 1440 px and 390 px, the project overview in Arabic dark mode, and the task board. Check: cards align, nothing clips, Arabic mirrors (the stage rail, the schedule and the back arrow), and dark mode reads well.
Expected: no clipped text, no horizontal page scroll on a phone, the accent only on main actions, the selected chip, the current stage and badges.

- [ ] **Step 4: Publish the review link and the progress page**

Change the script and style file names in the review wrapper `index.html` to the new `dist/assets` names, then publish it to the same path (the same URL), with the new JS file added and the old one set to `null` in `files`. Update `status.json` of the progress page (build step 2 done, the test counts, the link) and publish it.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/projects.spec.ts TASKS.md
git commit -m "test: add the browser sweep for the Projects screens" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```
