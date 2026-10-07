# Madar real build: the screens and the client map

**Date:** 2026-10-03
**For:** the engineers of build steps 2 to 5 (spec 2, section 17).
**Sources:** spec 2 (`docs/superpowers/specs/2026-10-03-madar-real-build-design.md`), spec 1, and the code on `main` at `63e8864`. No file under `src/` changed for this report.
**Method:** a read of every file named below, a grep for each touch point, and one trace test (kept outside `src/`) that records which `State` collections each read call reads.

## 0. What this report says

The screens can keep `api.call(name, input, meta)` with almost no change. One new module (`RemoteApi`) replaces the fake API, and four app-layer files change: `runtime.tsx`, `actions.ts`, `bootstrap.ts` and `files.ts`. The screens change in few places: three picture lines, one copied link (section 1), and the prototype controls (section 6). The sign-in screens and the new Settings sections are new code (section 7).

Four calls carry file data (`Blob`) and cannot travel as JSON. They need a new wire form and an adapter in `RemoteApi` (section 5).

The prototype reloads every list after every change and once a minute. The real build must not do that, or it uses about 1,000,000 server calls a month (spec 5.4). Section 3 gives a change signal and a map from each read call to the records it reads, so a screen reloads only what changed.

## 1. Touch points

### 1.1 The seam between the screens and the API

| File:line | What it does today | What changes |
|---|---|---|
| `src/app/runtime.tsx:9` | `Runtime = { store, api }` | `Runtime = { api, changes, auth, mode, store? }`. Keep `store` optional so the 1,640 tests still pass `{ store, api }`. |
| `src/app/runtime.tsx:13-17` | Query defaults: `staleTime: 0`, no retry | Remote mode: `staleTime: Infinity` for `['api']` reads (data changes only on a signal), one retry for a read that got no answer. |
| `src/app/runtime.tsx:20-26` | `store.subscribe` invalidates every `['api']` query after any change | Subscribes to `runtime.changes` and runs the targeted rule of section 3. The fake runtime turns each store change into a "match all" signal, so the prototype and the tests behave as today. |
| `src/app/runtime.tsx:44-46` | `useCall` key `['api', name, input]`, `queryFn: api.call(name, input)` | No change. The key shape must stay: `TaskSheet.tsx:296` and `ProjectScreen.tsx:46` read the cache by this key. |
| `src/app/runtime.tsx:80-81` | `useAction` key `['api', name]` | No change. `HomeScreen.tsx:49-52` reads `mutationKey[1]`. |
| `src/app/actions.ts:10-12` | `newStoryId()` makes `cor_ui_...` in the browser | Stays as a local placeholder. `RemoteApi` maps it to a server story ID (section 2.4). |
| `src/app/actions.ts:32-36` | `useUndoable` sends its own story ID | Calls `api.run(name, input)` and takes `storyId` from the result. |
| `src/app/actions.ts:42-43` | A second call, `events.list({ correlationId, limit: 1 })`, after each action | Uses `changed` from the result. This removes one server call per action. |
| `src/app/actions.ts:50` | `events.undoStory({ correlationId })` | No change. The server checks that the story belongs to the person (spec 5.5). |
| `src/app/bootstrap.ts:13-43` | Opens IndexedDB, builds the sample office, shifts dates, runs triggers, makes the fake API | Fake mode only. Remote mode uses a new `bootstrapRemote()` (section 8). |
| `src/app/bootstrap.ts:40` | `failureRate` reads `session.simulateErrors` | Fake mode only. |
| `src/app/bootstrap.ts:46-53` | `startScheduler`: runs triggers in the browser every 60 s, and so reloads every list every minute | Fake mode only. The `jobs` function does this work (spec 11). |
| `src/main.tsx:19-22` | Reads `runtime.store.state` for the first language, starts the scheduler | Remote mode has no store. The first language comes from a saved choice or the browser language (section 7.4). |
| `src/api/client.ts:10-14` | `CallMeta` and the `Api` type | Adds `run()` (section 2.1). Both APIs implement it. |
| `src/api/client.ts:36` | Waits 120 ms on each call | Fake mode only. |
| `src/api/client.ts:42-53` | Reads the current person from `store.state.session` | Remote: the server reads the person from the sign-in token. |
| `src/api/persist.ts:4-12` | `Persister` with `putBlob`, `getBlob`, `deleteBlob` | Fake mode only. R2 replaces it (section 5). |
| `src/api/registry.ts:17-18` | `prototypeOnly` flag | See section 6. `session.get` carries this flag but the real build needs it. |
| `src/test/render.tsx:21-72`, `src/test/factories.ts:63-74` | Tests build `{ store, api }` with the fake API | No change if `Runtime` keeps `store` optional. |

### 1.2 Direct `api.call` in screens (outside the hooks)

These calls bypass `useCall` and `useAction`. They still go through `RemoteApi`, so they need no change unless the table says so.

| File:line | Call | Note |
|---|---|---|
| `src/features/settings/admin/DeactivateSheet.tsx:24-27` | `projects.list` and `tasks.list` in one `Promise.all` | Goes as one batch (section 4). |
| `src/features/projects/NewProjectSheet.tsx:53` | `files.upload` with `blob` (cover) | Upload adapter (section 5.1). |
| `src/features/projects/NewProjectSheet.tsx:72` | `projects.create` | No change. |
| `src/features/projects/EditProjectSheet.tsx:49-69` | `projects.update` then `stages.replace`, one story | Story placeholder (section 2.4). |
| `src/features/project/files/FilesTab.tsx:122-148` | `files.upload` queue, one story | Upload adapter and story placeholder. |
| `src/features/project/overview/Composer.tsx:46-50` | uploads, then `updates.create`, one story | Same. |
| `src/features/comments/CommentThread.tsx:163` | uploads with a new story | Same. |
| `src/features/inbox/Thread.tsx:147` | uploads with a new story | Same. |
| `src/features/project/tracker/QuickLog.tsx:79` | uploads with a new story | Same. |
| `src/features/files/Attachments.tsx:38-54` | `files.upload` loop with `blob` | Upload adapter. |
| `src/features/dashboard/meeting/MeetingSummary.tsx:177` | `chats.send` in a loop, one at a time | No change. One request for each project. |
| `src/features/dashboard/meeting/MeetingSummary.tsx:90,128` | Groups a reason with its change by `event.correlationId` | Works only if both writes share one server story. The server must keep that. |
| `src/features/comments/markRead.ts:15` | `chats.markRead` on each thread view | Its signal must name only this person (section 3.2), or every screen in the office reloads. |
| `src/features/settings/admin/FeedbackSection.tsx` `Screenshot` | `feedback.screenshot` returns a `Blob` | `useScreenshotLink` in `src/app/files.ts` uses the signed link (section 5.4, built 2026-10-07). |

### 1.3 File data

| File:line | Today | Real build |
|---|---|---|
| `src/app/files.ts:10-31` | `useFileUrl`: `files.get` returns a `Blob`, the hook makes a `blob:` URL; key `['file-blob', ...]`, `staleTime: Infinity` | Calls `files.link`, uses the signed URL; `staleTime` 8 min (links last 10 min); reloads the link when the image fails. |
| `src/app/files.ts:44-52` | `downloadFile`: `files.get` to `Blob` to `<a download>` | Calls `files.link` with `disposition: 'attachment'` (section 5.3). |
| `src/app/files.ts:34-41` | `downloadText` (CSV export) | No change. It makes the file in the browser. |
| `src/features/project/files/FilesTab.tsx:33` | Row picture: full image as a 40 px picture | `useFileUrl(id, letter, 'thumb')`. |
| `src/features/projects/ProjectCard.tsx:15` | Cover: full image | `useFileUrl(id, letter, 'thumb')`. |
| `src/features/dashboard/meeting/DrawingsStrip.tsx:14` | Drawing picture: full image | `useFileUrl(id, letter, 'thumb')`. |
| `src/features/project/files/PreviewSheet.tsx:14-18` | `<img>` or `<iframe>` from a `blob:` URL | No change. The URL is a signed R2 link. |
| `src/features/project/files/FilesTab.tsx:43-45`, `src/features/project/tasks/TaskSheet.tsx:141`, `src/features/files/Attachments.tsx:123` | `downloadFile(api, id, letter)` | No change. |
| `src/features/feedback/FeedbackSheet.tsx:75` | `feedback.send` with `screenshots: File[]` | Feedback adapter. |
| `src/api/handlers/files.ts:39-57` | `files.get` output has `blob: z.instanceof(Blob)` | Wire form (section 5). |
| `src/api/handlers/files.ts:59-79` | `files.upload` input has `blob`, `prepare` calls `putBlob` | Wire form. The server checks the R2 object in place of `prepare`. |
| `src/api/handlers/feedback.ts:31,35-43,74-79` | Screenshot blobs in and out | Wire form. |
| `src/api/handlers/projects.ts:388-396` | Removes file data after a project delete | The server removes R2 objects after the commit (spec 8). |
| `src/app/bootstrap.ts:26`, `src/api/handlers/system.ts:16`, `src/data/seed.ts:614-619` | The sample office stores sample files | Fake mode only. |

### 1.4 Person, session and prototype state

| File:line | Today | Real build |
|---|---|---|
| `src/app/drafts.ts:34-42,60-65` | Drops drafts when another person becomes current (built for Preview as) | Keep. It now protects a sign-out and a sign-in as another person in the same tab. Call `keepDraftsOf('')` on sign-out to drop all. |
| `src/app/AppShell.tsx:61-66,110` | `usePersonTurn` starts the screen again when the person changes | Keep, for the same reason. |
| `src/features/project/tasks/TaskSheet.tsx:288-297` | Saves typed text only as the person who typed it | Keep. |
| `src/app/meeting.tsx:8-19` | Meeting drafts in memory, `startedAt` | No change. The session expiry sheet (section 7.3) keeps the screen mounted, so these drafts stay. |
| `src/app/AppearanceSync.tsx:8,20-26` | Applies language and theme from `session.get` | No change. |
| `src/app/languageTurn.ts:25-42` | `me.updatePreferences` with `mutateAsync` | No change. Its signal must name only this person (section 3.2). |
| `src/app/TabPill.tsx:16,80,102` | `chats.unreadCount` and `notifications.count`, always mounted | Must reload only on signals for this person (section 3.2). |
| `src/features/focus/FocusMode.tsx:118` | `tasks.get`, always mounted while a task is in focus | Project-scoped rule. |
| `src/features/projects/cardMenu.ts:11` | Copies a link with `#` in it | Must use the router's `createHref` if the remote build uses path links (section 7.4). |

### 1.5 Prototype-only controls

See section 6 for the full list with an action for each line.

### 1.6 Optimistic updates

There are none. A grep for `onMutate`, `setQueryData`, `cancelQueries` and `optimistic` finds nothing. Every screen waits for the answer, then the store subscription reloads the lists. Section 9, risk R-14, covers the effect of the real network delay.

## 2. The RemoteApi interface

### 2.1 Types

```ts
// src/api/client.ts: shared by the fake API and RemoteApi
export type CallMeta = { correlationId?: string };
export type CallResult<O> = { output: O; storyId: string; changed: boolean };

export type Api<M extends CallMap> = {
  /** Unchanged. Every screen uses this. */
  call<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<z.output<M[N]['output']>>;
  /** The same call, plus the story ID the server used and whether the call changed a record. Only useUndoable needs it. */
  run<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<CallResult<z.output<M[N]['output']>>>;
};

// src/app/runtime.tsx
export type ChangeSource = { subscribe(listener: (signals: ChangeSignal[]) => void): () => void };
export type Runtime = { api: MadarApi; changes: ChangeSource; auth: AuthPort; mode: 'prototype' | 'remote'; store?: Store };
```

`MadarApi` stays `Api<Calls>`. `RemoteApi` imports `Calls` with `import type`, so the client bundle carries no handler code and no zod rules.

The fake API implements `run()` with the story ID it already makes (`client.ts:54`) and `changed` from the event count of that story.

### 2.2 The wire

`POST {VITE_API_URL}/batch`

Headers: `Authorization: Bearer <access token>`, `Content-Type: application/json`, `X-Madar-Build: <build id>`.

```jsonc
// request
{ "v": 1, "calls": [
  { "i": 0, "name": "projects.get", "input": { "id": "prj_004" } },
  { "i": 1, "name": "files.upload", "input": { "uploadId": "upl_x", "projectId": "prj_004", "name": "A-101.pdf" },
    "story": { "ref": "cor_ui_m1x2ab" }, "key": "7f1c...uuid" }
] }
// response 200
{ "v": 1, "serverTime": "2026-10-03T09:00:00.000+03:00", "results": [
  { "i": 0, "ok": true, "output": { } },
  { "i": 1, "ok": true, "output": { }, "storyId": "sty_8KQ...", "changed": true,
    "signal": { "v": 1, "seq": 4182, "projectId": "prj_004", "kinds": ["files", "events", "projectTouched"], "storyId": "sty_8KQ...", "actorId": "usr_007" } },
  { "i": 2, "ok": false, "error": { "code": "invalid_input", "message": "Some fields are not valid.", "details": { "fields": ["name"] } } }
] }
```

- The client sends the raw input. The server parses it with the zod contract, as `client.ts:38-41` does today. The client does not parse first: the screens already show field errors from the answer.
- Each entry gets its own answer. One refused entry does not refuse the others.
- `key` is an idempotency key on each write (section 2.6).
- `story.ref` is a story placeholder (section 2.4).

### 2.3 Errors

`RemoteApi` rebuilds each error as `new ApiError(code, message, details)` from `src/api/errors.ts`. So `errorMessage`, `canRetry` and `fieldError` (`src/app/errors.ts:5-32`) and the `instanceof ApiError` checks in `ProjectScreen.tsx` and `TaskSheet.tsx:297` work unchanged. The `details` keys (`fields`, `issues`, `reason`, `names`, `id`) must pass through as they are.

| Server answer | Client `ApiError` | Screen effect |
|---|---|---|
| Entry error, any of the 5 codes | Same code, same `details` | Unchanged |
| HTTP 401, after one token refresh and one resend | `unauthenticated` (new code) | Session expiry sheet. No toast. `canRetry` false. |
| HTTP 403, account turned off | `unauthenticated`, `details.reason: 'account_off'` | Signed out, with the reason on the sign-in screen |
| HTTP 409, `client_outdated` | `failed`, `details.reason: 'client_outdated'` | A banner: "Madar has a new version. Reload." |
| HTTP 429 | `failed`, `details.retryAfterMs` | Toast with Retry |
| HTTP 5xx, network failure, 20 s timeout | `failed` | Toast with Retry |

Add `'unauthenticated'` to `ApiErrorCode` (`src/api/errors.ts:1`) and the key `errors.unauthenticated` to both language files.

### 2.4 Story IDs

Spec 5.5 says the server makes every story ID and accepts only its own. The prototype makes them in the browser in seven places (`actions.ts:35` and the six screens in section 1.2).

**Recommended rule (no screen change):**

1. `newStoryId()` keeps its `cor_ui_` form. It never reaches the server as a story ID.
2. A call with a `cor_ui_` value that `RemoteApi` has not seen goes with `story: { ref: "cor_ui_..." }`. The server makes a new story, and the answer returns `storyId`.
3. `RemoteApi` keeps a map from the placeholder to the server story ID for 24 hours. The next calls with the same placeholder go with `story: { id: "sty_..." }`.
4. Two calls with the same new placeholder in one batch get the same new story. The server keeps a map for each batch.
5. A call with no `correlationId` goes with no story. The server makes one and returns it. `useUndoable` takes it from `api.run()`.

This costs no extra request. The other choice is an async `newStoryId()` that calls `story.start`; it changes six screen lines and costs one request for each multi-call action.

### 2.5 Latency

- The fake API waits 120 ms (`client.ts:36`). `RemoteApi` adds no wait.
- Expect 150 to 400 ms for one batch from Khobar to Frankfurt (spec 18 says about 0.1 s of network), plus a cold start of the function now and then.
- Timeout: 20 s for each batch. After that, every entry fails with `failed`.
- Reads: one automatic retry, only when no answer came back.
- Writes: no automatic retry. The person presses Retry (`canRetry`).

### 2.6 Idempotency

A write can succeed on the server while its answer is lost. A Retry then posts a message twice or uploads a file twice. So each write entry carries a `key` (a UUID). The server keeps the answer for each key for 24 hours and returns it again for a repeat.

`useRetryableMutate` (`runtime.tsx:55-67`) sends the same input object on Retry. `RemoteApi` can keep a `WeakMap` from the input object to its key, so a Retry reuses the key with no screen change.

## 3. Reload only what changed

### 3.1 The change signal

After each saved change, the server sends one signal. It also returns the same signal in the answer of the write (section 2.2).

```ts
type ChangeSignal = {
  v: 1;
  seq: number;              // one office counter, +1 for each saved change
  projectId: string | null; // null for office records (people, teams, settings, templates, clients)
  kinds: Kind[];            // the State collections that changed
  people?: string[];        // the persons whose own lists changed
  storyId: string;
  actorId: string;
};
```

`Kind` is a `State` collection name (`src/api/store.ts:20-54`) without `version`, `seededOn`, `session` and `counters`, plus three narrow kinds:

| Narrow kind | When the server uses it | Why |
|---|---|---|
| `projectTouched` | The only project change is `updatedAt`, from `touch()` | `touch()` runs in 35 places (`projects.ts` 18, `tracker.ts` 6, `tasks.ts` 5 and more). Without this kind, almost every write marks `projects` as changed, and almost every list reloads. Only `projects.list` sorts by `updatedAt`. |
| `preferences` | The only user change is `preferences` (theme, language, notice switches) | `users` is read by nearly every call. A theme change of one person must not reload the screens of the whole office. |
| `chatReads` | Already a collection | Must come with `people`, so a read mark reloads only that person's badges. |

The server knows the kinds for free: spec 5.3 compares the `State` before and after a call to save it.

**Channels.** The office channel (private) carries every signal without `people`. Each person in `people` also gets the signal on a private `person:<userId>` channel. So the office channel does not tell everyone who chats with whom.

### 3.2 The read map

The trace test ran every read call over the sample office and recorded the collections it touched. The table is the result. A call can read more on another branch (for example `teamId` adds `teams`), so the build must make this table with a test over several inputs and fail when it drifts (risk R-6).

| Read call | Scope | Kinds it reads (trace) |
|---|---|---|
| `projects.get {id}` | project = `input.id` | clients, comments, deadlines, events, files, members, projects, stages, tasks, updates, users |
| `updates.list {projectId}` | project | comments, events, files, members, projects, stages, tasks, updates, users |
| `tasks.list {projectId}` | project | comments, files, members, projects, stages, tasks, users |
| `tasks.get {id}` | project from `data.task.projectId` | comments, events, files, members, projects, stages, tasks, users |
| `comments.list {targetType, targetId}` | project from the cached answer | comments, tasks (and updates for an update target) |
| `files.list {projectId}` | project | files, members, projects, users |
| `files.link` (new) | none: never reloads on a signal | |
| `payments.list {projectId}` | project | payments, projects, users |
| `tracker.list {projectId}` | project | files, members, projects, tracker, users |
| `tracker.export {projectId}` | project | events, files, projects, users |
| `events.list {projectId}` | project | events, files, projects, stages, tasks, tracker, users |
| `events.list {}` or `{since}` | office | the same |
| `tasks.list {}` (Work, Tasks) | office | comments, files, members, projects, stages, tasks, users |
| `projects.list` | office | clients, comments, deadlines, events, files, members, projects, stages, tasks, updates, users, projectTouched |
| `dashboard.get` | office | deadlines, projects, settings, stages, tasks, tracker, users |
| `deadlines.list` | office | deadlines, projects |
| `search.query` | office | clients, files, projects, tasks, users |
| `users.list`, `users.get` | office | users |
| `clients.list` | office | clients |
| `settings.get` | office | settings |
| `teams.list` | office | teams, users |
| `stageTemplates.list` | office | stageTemplates, users |
| `taskTemplates.list` | office | taskTemplates, users |
| `feedback.list` | office | feedback |
| `feedback.screenshot` | none: never reloads | |
| `session.get` | person | users, preferences |
| `notifications.list`, `notifications.count` | person | notifications, projects, tasks, updates, users |
| `chats.list`, `chats.unreadCount` | person | chatReads, comments, conversations, members, messages, projects, tasks, users |
| `chats.messages {conversationId}` | person | chatReads, conversations, members, messages, projects, users |

### 3.3 The client rule

```ts
function affects(query: Query, s: MergedSignal, me: string): boolean {
  const [, name, input] = query.queryKey as ['api', string, Record<string, unknown>];
  const rule = READS[name];
  if (!rule) return true;                                   // an unknown call: reload, to be safe
  if (!rule.kinds.some((k) => s.kinds.has(k))) return false;
  switch (rule.scope) {
    case 'office':  return true;
    case 'project': {
      const p = rule.projectOf(input, query.state.data);    // undefined when not known yet
      return p === undefined || s.projects.has(p) || s.projects.has(null);
    }
    case 'person':  return s.people.has(me) || s.hasOfficeKindsFor(rule);  // users, projects, tasks changes still count
    case 'none':    return false;
  }
}

queryClient.invalidateQueries({
  queryKey: ['api'],
  predicate: (q) => affects(q, merged, me),
  refetchType: document.hidden ? 'none' : 'active',
});
```

- **Own writes.** `RemoteApi` applies the signal from the answer at once, with no wait. So the person who acts sees the change as fast as today. It keeps the `seq`, and drops the copy that comes back on Realtime.
- **Other people's writes.** The client collects Realtime signals for 1 s (at most 2 s), merges them, and runs one pass. One pass makes one batch (section 4).
- **Hidden tab.** The pass only marks queries as old. On `visibilitychange` to visible, the client reloads the active queries that are marked.
- **Missed signals.** Reload every active `['api']` query once when: the channel comes back after `CHANNEL_ERROR`, `TIMED_OUT` or `CLOSED`; a signal's `seq` skips a number; or the tab was hidden for more than 60 s. These are events, not a timer, so spec 5.4 holds.
- **Fake mode.** The store subscription sends one "match all" signal, so the prototype and the tests keep today's behavior.
- **Keys outside `['api']`** (`file-blob`, `file-link`, `feedback-shot` and `feedback-shot-link`) never reload on a signal.

### 3.4 What it costs

A rough count, with stated guesses: 15 people, 40 writes each a day, about 5 other open screens with a list that matches each write, and 150 screen visits each a day.

| Source | Requests a day |
|---|---|
| Writes | 600 |
| Reloads after signals (1 s merge) | about 3,000 |
| Screen visits (most lists come from the cache) | about 2,250 |
| **Total** | **about 6,000, so about 130,000 a month on 22 work days** |

This fits spec 15 (150,000 expected, 500,000 free). The prototype rule would cost more than the limit: the 60 s scheduler alone adds about 7,200 a day for 15 open tabs, and every write reloads every list on every screen.

## 4. One request for each moment

### 4.1 The batcher

```ts
class Batcher {
  #queue: Entry[] = [];
  #timer = 0;
  add(entry: Entry): void {
    this.#queue.push(entry);
    if (this.#queue.length >= MAX_ENTRIES) this.flush();
    else if (!this.#timer) this.#timer = window.setTimeout(() => this.flush(), 0);
  }
  flush(): void {
    window.clearTimeout(this.#timer);
    this.#timer = 0;
    const entries = this.#queue.splice(0, MAX_ENTRIES);
    // one POST /api/batch; resolve or reject each entry's promise from results[i]
  }
}
```

- **The window is `setTimeout(0)`.** It collects every call that starts in the same task and its microtasks: one React commit, its effects, and a `Promise.all`. It adds 1 to 4 ms, not a fixed delay.
- **Same read, same batch:** one entry, two promises. TanStack Query already merges equal keys, so this case is rare.
- **Cap:** 12 entries for each request (measure at step 2; the free plan gives each request 2 s of CPU).
- **Order:** the server runs the entries in the order sent. Each write is its own transaction under the office lock (spec 5.3). A read after a write in the same batch sees that write. No screen needs two writes to succeed or fail together: today each `api.call` is its own `Store.run`.
- **The server loads the office once for each batch**, not once for each entry. This is the main CPU gain for a screen that asks for six lists.
- **Upload bytes never go in a batch.** They go straight to R2 (section 5).

### 4.2 Where it helps

| Moment | Today | With the batcher |
|---|---|---|
| A project page opens: `session.get`, `chats.unreadCount`, `notifications.count`, `projects.get`, the tab's list | 5 to 6 calls | 1 request |
| A signal reloads 4 lists on the open screen | 4 calls | 1 request |
| The Files tab shows 20 pictures (`files.link` each) | 20 calls | 2 requests (cap 12) |
| `DeactivateSheet.tsx:24-27` | 2 calls | 1 request |
| `Composer.tsx:49-50`: upload, then post | 2 calls (each waits for the one before) | 2 requests (no change, and none needed) |

## 5. Files on R2

### 5.1 Upload

The three steps sit inside `RemoteApi`, so `FilesTab`, `Attachments` and `NewProjectSheet` keep `api.call('files.upload', { blob, ... })`.

1. `files.uploadStart` (new write call). Input: `projectId, name, size, mimeType, stageId, taskId, asCover, receivedFromClient, thumb: { size, mimeType } | null`. The server runs the permission and size checks first (today `files.ts:75,83-86`), so a refusal comes before any bytes move. Answer: `uploadId`, a signed `PUT` link valid 10 min, the headers to send, and an optional second link for the picture.
2. The browser sends the file to R2 with `PUT`. Use `XMLHttpRequest`, so a later version can show progress; `fetch` gives no upload progress.
3. `files.upload` (wire form, no `blob`): `uploadId` and the same fields. The server reads the object head from R2, checks size and type against step 1, then runs today's `run` (`files.ts:80-116`) unchanged.

The `jobs` function deletes unfinished uploads after 1 hour.

### 5.2 Pictures and preview

Today a 40 px row picture loads the full image (`FilesTab.tsx:33`). A drawing on R2 can be 50 MB.

- At upload, the browser makes a small picture of each image (`createImageBitmap`, then a canvas, 960 px on the long side, WebP). It goes up with the second link from step 1. If the browser cannot read the image (for example HEIC outside Safari), there is no picture and the row shows the file icon.
- `FileVersion` gets `thumbKey: string | null` (an added field, so old data stays valid).
- New read call `files.link { id, letter?, variant: 'full' | 'thumb', disposition: 'inline' | 'attachment' }` returns `{ url, expiresAt, name, mimeType, size }`. The server runs `assertCan(ctx, 'project.view')` for the file's project before it signs.
- `useFileUrl(fileId, letter, variant = 'full')` calls `files.link`. Three lines pass `'thumb'` (section 1.3). Its query key stays outside `['api']`, `staleTime` is 8 min, and an `onError` on the `<img>` asks for a new link.
- `PreviewSheet` needs no change. A PDF shows in the `<iframe>` from the signed link, because the upload stored `Content-Type: application/pdf`.

### 5.3 Download

- The upload stores `Content-Disposition: inline; filename*=UTF-8''<name>` on the object, so previews show in the page and Arabic names stay correct.
- For a download, the best way is a signed link with `response-content-disposition=attachment`. The R2 S3 compatibility page does not list this option for `GetObject`. **Test it at step 1.**
- If it works: `downloadFile` opens the link. The browser ignores the `download` attribute on a link to another origin, so the header must do the work.
- If it does not work: `downloadFile` keeps today's way (`files.ts:44-52`): `fetch` the link, make a `blob:` URL, use `<a download>`. This holds the whole file in memory, which can fail for a 250 MB file on a phone.

### 5.4 Feedback screenshots

- `feedback.send` gets the same three steps, with up to three links (`feedback.uploadStart`).
- `feedback.screenshot` answers `{ url, expiresAt }`. A screenshot is at most 10 MB and only the Admin opens it.
- The plan had an adapter that fetched the link and returned `{ blob }`. Nobody built it, so the real build showed grey boxes. The build
  uses the signed link in `useScreenshotLink` (`src/app/files.ts`, spec `2026-10-07-feedback-notices-design.md` 4.3) instead:
  - an adapter needs CORS on `GET` for R2, and it loses the one new link after a picture error;
  - the hook shares its body with `useFileLink`: key `['feedback-shot-link', id, index]`, `staleTime` 8 min, one new link after a
    picture error, then `broken` and the fallback. The prototype keeps the key `['feedback-shot', id, index]` and a `blob:` URL.

### 5.5 Share

`files.share` (`src/api/handlers/sharing.ts:20-50`) posts a file ID into a chat or a task. It moves no data, so it does not change. The person who receives it opens the file with `FileChips` (`Attachments.tsx:123`), which calls `files.link`, and the server checks that person. **Never put a signed link into a message body:** it ends after 10 min, and anyone who has it can open the file until then.

### 5.6 What replaces putBlob and getBlob

| Prototype | Real build |
|---|---|
| `persister.putBlob` in `files.upload` and `feedback.send` `prepare` | Browser `PUT` to a signed R2 link; the server checks the object head |
| `persister.getBlob` in `files.get` and `feedback.screenshot` | `files.link` and a signed `GET` link |
| `persister.deleteBlob` in `projects.delete` `after` | The server deletes the R2 objects after the commit |
| `files.delete` keeps the data (for Undo) | The same. Section 9, risk R-12, covers the space this uses. |
| `blob:` URL from `URL.createObjectURL` | The signed URL itself (no revoke needed) |

### 5.7 Bucket and page settings

- **R2 CORS:** origins = the Madar domain and `http://127.0.0.1:5173`; methods `PUT`, `GET`, `HEAD`; headers `Content-Type`, `Content-Disposition`; expose `ETag`.
- **Content Security Policy** (Cloudflare Pages `_headers`): `connect-src` the Supabase URL, its `wss:` form and the R2 S3 host; `img-src 'self' blob: data:` and the R2 S3 host; `frame-src` the R2 S3 host. Signed links work on the S3 host only, not on a custom domain of the bucket.

## 6. Prototype-only UI and code

"Remove" means: out of the remote build with the build flag of section 8. The fake build keeps it, because the prototype artifact and the tests use it.

| File:line | What | Action |
|---|---|---|
| `src/app/PreviewAs.tsx:1-30` | The Preview as control | Flag |
| `src/app/PersonMenu.tsx:12,56` | Imports and shows Preview as | Flag |
| `src/app/PersonMenu.tsx:19` | Comment names Preview as | Update the comment |
| `src/features/settings/SettingsScreen.tsx:6,127` | Preview as in Settings | Flag |
| `src/features/settings/SettingsScreen.tsx:34,128-134` | Simulate errors switch | Flag |
| `src/features/settings/SettingsScreen.tsx:35-42,135-151` | Reset sample data and its sheet | Flag |
| `src/features/settings/SettingsScreen.tsx:126` | The "Prototype" section | Flag (the whole section) |
| `src/app/StorageBanner.tsx:5-14`, used at `src/app/AppShell.tsx:91` | "Changes will not be saved" banner | Remote: `persistent` is always true, so it shows nothing. Replace it with a "No connection" banner (offline or channel closed). |
| `src/app/bootstrap.ts:13-53`, `src/main.tsx:19-22` | Sample office, date shift, browser scheduler, simulated errors | Fake mode only |
| `src/api/handlers/people.ts:29-33,46-54` | `PreviewUser` and the `previewUsers` list | Server: return `[]` in step 2, remove the field in step 3 |
| `src/api/handlers/people.ts:38,57` | `persistent`, `simulateErrors` in `session.get` | Server: return `true` and `false` in step 2, remove in step 3 |
| `src/api/handlers/people.ts:41` | `session.get` has `prototypeOnly: true` | **Remove the flag.** The screens and agents need this call (risk R-2). |
| `src/api/handlers/people.ts:61-83,316-317` | `session.previewAs`, `session.setSimulateErrors` | Not on the server |
| `src/api/handlers/system.ts:8-30` | `session.resetSampleData` | Not on the server |
| `src/api/client.ts:37,46-53` | Failure rate, the `prototypeOnly` bypass | Fake mode only |
| `src/api/store.ts:23,60` | `session.simulateErrors`, `currentUserId` | Fake mode only. The server reads the person from the token. |
| `src/features/settings/admin/PersonFormSheet.tsx:75-87` | The Admin adds an agent by hand (Kind, Acts for) | **Owner decision.** In the real build an agent exists only after its person approves it (spec 12). Recommend: flag. |
| `src/data/seed.ts`, `src/data/shift.ts`, `src/data/migrate.ts`, `STATE_VERSION` | Sample office and its upkeep | Fake mode only (spec 6: the office starts empty) |
| `src/i18n/en.json:44-58,90-96` and the same keys in `ar.json` | `storage.notSaved`, `preview.*`, `settings.prototype`, `settings.simulateErrors*`, `settings.reset*` | Keep: the fake build uses them |

## 7. Sign-in screens

### 7.1 The screens

All sign-in screens sit outside the shell, as the meeting view does (`routes.tsx:22`). Each one has the language switch, works right-to-left, and fits a phone.

| Screen | Route | What the person does | Supabase step |
|---|---|---|---|
| Sign in | `/sign-in?next=&reason=` | Types email and password. Link to Forgot password. | `signInWithPassword` |
| Accept invitation | `/welcome?token_hash=&type=invite` | Sees name and email, sets a password, goes Home. | `verifyOtp({ token_hash, type: 'invite' })`, then `updateUser({ password })` |
| Forgot password | `/forgot` | Types email. Always sees the same answer. | Server endpoint (7.2) |
| Reset password | `/reset?token_hash=&type=recovery` | Sets a new password. Other devices sign out. | `verifyOtp({ type: 'recovery' })`, `updateUser`, `signOut({ scope: 'others' })` |
| Signed out | `/sign-in?reason=signed_out` or `expired` or `account_off` | Reads one calm line, signs in again. | none |
| Session expiry | A sheet over the current screen | Types the password again. The screen and its drafts stay. A link signs in as another person. | `signInWithPassword` |
| Link no longer valid | inside Welcome and Reset | Reads "This link has ended. Ask the Admin for a new invitation." or "Ask for a new link." | `verifyOtp` error |

Messages that must not tell an outsider which emails exist: the Sign in error is one sentence for a wrong email and for a wrong password; the Forgot answer is the same for every address.

### 7.2 Why the server sends the sign-in emails

Supabase has one email template for each type, for all people. Spec 10 asks for each email in the person's language and direction. So:

- `users.create` (Admin, People) also calls `auth.admin.generateLink({ type: 'invite', email })`, takes the hashed token, and sends a Madar email with Resend in the new person's language.
- `POST /auth/forgot { email }` on the `api` function calls `generateLink({ type: 'recovery' })` and sends with Resend. It is rate-limited for each address and each IP (spec 14).
- Supabase client settings: `flowType: 'pkce'`, `detectSessionInUrl: false` (Madar reads the token itself), `persistSession: true`, `autoRefreshToken: true`, `storageKey: 'madar.auth'`.

The other choice is Supabase's own mail through Resend SMTP, with both languages in one email.

### 7.3 Where they hook in

- **`routes.tsx`:** a new layout route `AuthGate` wraps the meeting route and the shell route. With no session it goes to `/sign-in?next=<path>`. The public routes sit beside it. In fake mode `AuthGate` lets everything through.
- **`AppShell.tsx` and `MeetingView`:** mount `<SessionExpiredSheet />`. It opens when `RemoteApi` reports `unauthenticated` after its one refresh. A write that got 401 never ran on the server, so the toast of that write keeps its Retry.
- **`PersonMenu.tsx`:** a new "Sign out" row after the Feedback row (line 81). Sign-out order: `supabase.auth.signOut()`, remove the Realtime channels, `queryClient.clear()`, `keepDraftsOf('')`, go to `/sign-in?reason=signed_out`. After the cache clear, the next person in this tab cannot see the lists of the person before.
- **`SettingsScreen.tsx`:** new sections for Password (current and new), the email switches next to the in-app switches at lines 113-123 (spec 10), and Agents (spec 12).
- **`PeopleSection.tsx`:** an "Invited" badge until the person sets a password, a "Send the invitation again" menu item, and the toast "Invitation sent to <name>".
- **Realtime:** subscribe after sign-in; call `supabase.realtime.setAuth()` before a private channel subscribes and after each token refresh, or the channel closes when the token ends.

### 7.4 Two details

- **First language.** `main.tsx:20` reads the language from the store before the first screen. Remote mode reads a saved `madar.lang` value, then the browser language. `AppearanceSync` corrects it after `session.get`, and saves it again.
- **Hash links or path links.** The prototype uses hash links (`routes.tsx:18-20`) so it runs on any static host. The real build gets emails with links, and the agent consent page (spec 12) gets a redirect from Supabase with a query string on a real path. Recommend: path links (`createBrowserRouter`) in remote mode, hash links in fake mode. Cloudflare Pages serves `index.html` for unknown paths when the build has no `404.html`. One line builds a hash link by hand: `src/features/projects/cardMenu.ts:11`.

## 8. Fake API or remote API

| Item | Value |
|---|---|
| Flag | `VITE_MADAR_API` = `fake` (default) or `remote` |
| `src/app/mode.ts` (new) | `export const REMOTE = import.meta.env.VITE_MADAR_API === 'remote';` |
| `.env.remote` (in git, public values only) | `VITE_MADAR_API=remote`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL` |
| Secrets | Never in a `VITE_` variable. Vite puts every `VITE_` value into the page. The service key, R2 keys and Resend key stay in the hosts' secret stores (spec 14). |
| Scripts | `build` stays the prototype build. Add `build:remote` = `vite build --mode remote` (the Cloudflare Pages build command) and `dev:remote` = `vite --mode remote`. |
| Tests | Vitest runs in mode `test`, so the fake API stays the default. Add unit tests for `RemoteApi` with a stub `fetch`: batch, errors, story map, signals. |

`main.tsx` chooses with a dynamic import:

```ts
const runtime = REMOTE
  ? await (await import('./app/remote/bootstrap')).bootstrapRemote()
  : await (await import('./app/bootstrap')).bootstrap();
```

Vite replaces `import.meta.env.VITE_MADAR_API` with a fixed string, so the build drops the other branch and its chunk. The remote page then carries no sample office and no handlers, and the prototype page carries no Supabase client. A check after each build must prove it: search `dist/` for `buildSeed` in the remote build and for `supabase` in the prototype build, and fail when the search finds a match. A search that finds nothing must print that it ran.

The prototype flag for section 6 is `PROTOTYPE = !REMOTE`. Write `{PROTOTYPE && <PreviewAs ... />}`, so the build drops the control from the remote page.

## 9. Risks

| ID | Risk | Effect | Action |
|---|---|---|---|
| R-1 | Four calls carry a `Blob` (`files.get`, `files.upload`, `feedback.send`, `feedback.screenshot`) | They cannot go as JSON, and agents (MCP) cannot send them either | Wire forms and adapters (section 5). The zod contract gets a wire schema for each. |
| R-2 | `session.get` has `prototypeOnly: true` (`people.ts:41`) | A server or MCP list that drops prototype calls also drops the call every screen needs | Remove the flag in the server copy |
| R-3 | Seven places make story IDs in the browser | The server refuses them (spec 5.5), so Undo and the story groups fail | Story placeholders (section 2.4) |
| R-4 | `useUndoable` makes a second call after each action (`actions.ts:42`) | Doubles the write requests | `changed` in the answer |
| R-5 | `touch()` and `preferences` changes look like `projects` and `users` changes | Nearly every write reloads nearly every list in the office | `projectTouched` and `preferences` kinds (section 3.1) |
| R-6 | The read map (3.2) comes from one input for each call | A missed kind leaves a list old until the next reload | Make the map with a trace test over several inputs; fail the build when it drifts; an unknown call always reloads |
| R-7 | A lost Realtime message | A screen shows old data | Reload on reconnect, on a `seq` gap, and when a tab comes back |
| R-8 | A lost answer to a write | A Retry posts twice | Idempotency keys (2.6) |
| R-9 | Signed links end after 10 min | A preview open for longer shows a broken image; a reloaded PDF loses its place | `staleTime` 8 min, a new link on image error |
| R-10 | R2 may not support `response-content-disposition` | Downloads open in the page, or Arabic names break | Test at step 1; fallback in 5.3 |
| R-11 | File size: the contract says 25 MB (`entities.ts:469`, message at `files.ts:71`), spec 8 says 250 MB | Screens refuse files the server would take | Owner decision on one number. The 250 MB fallback download in 5.3 can fail on phones. |
| R-12 | `files.delete` keeps the data for Undo | R2 space only grows; the 10 GB free plan fills | The storage meter of spec 8, and a decision on when old deleted data goes |
| R-13 | A batch of heavy reads (Dashboard, Projects, Search) | Over 2 s of CPU, so the request fails | Cap 12 entries, load the office once for each batch, measure at step 2 |
| R-14 | No optimistic updates; the real network adds 150 to 400 ms | Ticks (task done, checklist, reactions) can feel slow next to the prototype | Measure at step 2. If needed, add optimistic updates with rollback to those few calls only |
| R-15 | The sign-in token sits in `localStorage` | A script injection could take it | A strict Content Security Policy (5.7), no inline scripts |
| R-16 | Spec 6 says "no policy for browser roles", but private Realtime channels need read policies on `realtime.messages` | The channel refuses every screen | Add policies only on `realtime.messages`: the office topic for active people, `person:<id>` for that person |
| R-17 | Hash links and auth redirects | Consent and email links need extra code to read them | Path links in remote mode (7.4) |
| R-18 | An old tab after a new server deploy | Calls fail in odd ways | `X-Madar-Build` header and the `client_outdated` banner |
| R-19 | A person turned off while signed in | Their open tab still works | The server checks `users.active` on every call and answers 403; the client signs out with the reason |
| R-20 | The Admin can add an agent by hand (`PersonFormSheet.tsx:75-87`) | An agent with no approval and no token | Owner decision (section 6) |
| R-21 | Supabase now issues publishable keys that are not JWTs | The function gateway's own token check may refuse requests | Check at step 1. If needed, turn the gateway check off and check the user token in the function code. |

## 10. Decisions for the owner

1. The largest file: 25 MB or 250 MB (R-11).
2. The Admin "add an agent by hand" form: keep it or hide it in the real build (R-20).
3. Sign-in emails: Madar sends them in each person's language (recommended), or Supabase sends one email with both languages (7.2).
4. When the data of a deleted file goes for good (R-12).
