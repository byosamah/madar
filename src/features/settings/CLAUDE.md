# Settings and Admin

Settings (desk) and the same sections on the Me tab (phone), and the Admin sections in `admin/`. The Me hub: `src/app/CLAUDE.md`.

## Admin sections
- One registry, `admin/sections.ts`: a new section is one line. A section with `right` (and `alsoRights`) opens for each person who holds
  that right. `sectionsFor` reads the viewer, and `opensAdminPage` (`api/rights.ts`) decides the person menu. A desk opens the first section at
  `/admin`. A phone shows the list there. An unknown or forbidden section goes back to `/admin`. A person who is not the Admin sees "Office"
  as the page title.
- A section draws its shell with `AdminPanel` (`AdminPanel.tsx`): the section tag, then a header row with the title and the `action`
  when the section has one. `AddButton` is the plus button. A tick box with its label is `CheckRow`. Only `admin/`
  files import them. `LinkProjectSheet.tsx` also loads on the project page, so it imports neither. A section asks `useRight` or `useCan`
  (`app/useRight.tsx`) for a right, never the session. The name of a role comes from `roleLabel` and `customRoleName` (`roleSheetLogic.ts`).
- Roles (`RolesSection.tsx`, `RoleSheet.tsx`, `RoleRights.tsx`, `roleSheetLogic.ts`, `RoleToggle.tsx`): the Roles section is the Admin's only.
  The count of rights, powers and sections comes from the catalog and no guide states it (`src/api/rightsCatalog.test.ts` pins it). The add-a-
  switch checklist is in `src/api/CLAUDE.md`. Words: `real/rr2sheet.*` (key tree `roleRights`).
- The sheet holds the list of held ids and saves it with one button. The ids that are not basic go in `rights`. The basic ids that are
  off go in `off` (`saveShape`). A switch brings the switches it needs. Turning a need off turns its dependants off (`withRight`,
  `withSection`). The All control of a section is `role="checkbox"` with `aria-checked="mixed"`, because ARIA allows mixed on a checkbox and
  not on a switch. The Roles list and the person sheet line both read `heldRightsOfRole`. A new role starts as a copy of the Member list.
- Project templates (`ProjectTemplatesSection.tsx`): the row menu has Duplicate (`duplicateDraft`). The update item and the follower count
  are for the Admin and for a role with `templates.updateProjects`. A person with only that right sees the section and a row menu with the
  update item alone.
- The template editor (`ProjectTemplateEditor.tsx`) is a full-screen sheet on a desk. The timeline (`TemplateGantt.tsx`) is the main view.
  `TemplateDetails.tsx` shows the fields beside it (a Sheet on a phone). The editor works on a text draft (`templateDraft.ts`): a stage
  start moves its tasks by the same days (`moveStageStart`, on blur), a new wait that points back moves the part that waits (`addWait`, with an
  Undo toast), and Cancel, Escape and the close button ask "Discard the changes?" when the draft changed. A control with `data-autofocus`
  takes the focus in a sheet. The limits of the editor are `DAYS_MAX` (365 days for a task) and `NAME_MAX` (60 letters) in `templateDraft.ts`: the
  chart and the fields import them. A wait ends with `removeWait`.
- `moveTaskToStage` (`templateDraft.ts`) has one rule: the move changes the stage and nothing else, so the days of a task stay and the waits
  stay true. A note says when the days are outside the new stage (`taskOutsideStage`). The one exception is a task that Add task just made
  and the person has not touched (`DraftTask.fresh`, set by `addTask`, cleared by `touchTask`; a task with a wait is never placed again): it
  goes where Add task would put it in the new stage. `fresh` lives in the draft only: `draftInput` and `draftOf` never carry it.
- The update of linked projects (`TemplateProjectsSheet.tsx`, `SyncSteps.tsx`): pick the projects, then one review screen with one tick for
  each kind of change and a line for each task. The main button runs only the projects that change.
- People (`PeopleSection.tsx`): a turned-off person or agent has "Remove from the list" (`RemoveSheet.tsx`). The sheet asks first (Cancel has
  the focus) and has no Undo. The History keeps the name (`api/CLAUDE.md`).
- Requests and bugs (`FeedbackSection.tsx`): three tabs, Open (the default), Done and Rejected. Each report has one status `Menu` with the
  statuses as radio items. A report signs the links of its screenshots only when its box is near the view (`RowShots`, `useNearView`).
  Done and Rejected offer Undo. Rejected opens `RejectSheet` first, which needs a reason. A sender has no list of
  their own reports: the notice (switch `feedback_done`) is the only place they see the status.
- `OfficeSection.tsx` (`office.settings`) holds the Admin block "Work hours": the default range of a person who chose none, and "Keep
  notifications on". A change of the lock widens the default range at once (`widenToLock` in `workRange.ts`, also used by
  `effectiveWorkHours`), and Save refuses a default that misses the lock.
- A new logo gets a frame step (`LogoFrame.tsx`) and a new profile picture gets `AvatarFrameSheet.tsx`. Both use the shared
  `components/PictureFrame.tsx`. The crop helpers are in `lib/picture.ts` (`PictureCrop`, `cropPlace`, `cropPreview`, `fillCrop`). The avatar
  step starts as the centre square, so a person who presses Save gets what they got before. The welcome step and the Admin forms have no
  picture upload.
- Agents: without `ai.connect`, Settings, Agents shows one line in place of the intro and keeps the list with Remove. The consent screen
  shows the same words when the approval answers `forbidden` with the reason `ai_off`, and takes Approve away.

## What reaches the Admin
- `Preferences.adminReach` (`AdminReachSection.tsx`, saved at once by `me.updatePreferences`). Read it only with `adminReachOf`
  (`chatState.ts`): an absent value means `mixed`, and any person who is not an Admin reads `mixed`. `mine` leaves the project chats with the
  role `other` out of the Inbox list and the badge (`hiddenByReach`); such a chat still opens, and a message that names the Admin still gives the
  bell notice. `all` counts every message of every project chat and makes bell copies (`src/api/CLAUDE.md`). The push of a chat message does not
  follow the choice. The base word tree has no type for the track words, so a test reads `adminReach.*` through a cast.
- `mine` also narrows Home "Your projects" on a desk and the Projects screen to the projects that the Admin leads or works on. The Dashboard,
  the map and the Open space stay office-wide. `lib/projectReach.ts` holds the rules (`homeProjectsInput`, `projectsDefaultShow`). A bare
  Projects link (no key of `PROJECT_FILTER_KEYS`) opens on "My projects". A link with any of these keys keeps "All", so a Dashboard link
  shows what it promises. "All" in the Filter writes `filter=all`, and a first filter key on a bare link writes `filter=mine` first. The
  default "Show" never counts in the Filter badge. The list waits for `known` (the session answered or the device has a hint).

## Quiet hours
- `QuietHoursSection.tsx` is for every role. One switch "Notify me only in my work hours" (on by default), "My work days", and the two times
  in the order of the quiet line: "Quiet from" (the end of work, `to`) and "Until" (the start of work, `from`), `WorkRangeFields order="quiet"`
  (`workRange.ts`). `quietSentence` says when Madar is quiet. While the Admin keeps the lock on, the days of the lock are ticked and locked and
  the times cannot cut the lock. Each change saves at once with a toast. A range that the Admin's later lock no longer holds shows widened.

## Push in the screens
- Real build only. `app/remote/push.ts` (no React, no zod) holds `statusOf`, `turnOn`, `turnOff`, `syncThisDevice`, `syncDeviceOnce` and
  `removeThisDevice`. `PushSync.tsx` runs the check in the shell. Screens call `syncDeviceOnce` (one `push.mine` check for each page, person
  and key), never `syncThisDevice`. A turn on, a turn off and the sign-out call `forgetDeviceChecks`, and `src/test/setup.ts` calls it after
  each test. `PushSection.tsx` has one switch, "Notify me on this device", and a plain note where the browser cannot push.
- The permission question starts inside the click, before any wait (Safari refuses it otherwise): `turnOn` calls
  `Notification.requestPermission()` first. `src/test/pushBrowser.ts` makes a browser for the tests.
- `push.register` takes the browser keys (`keysOf`). `syncThisDevice` saves a listed device again when `push.mine` says `hasKeys: false`. A
  browser that gives no keys never loops. `public/sw.js` is plain JavaScript with no build step: `lineOf` shows the fixed line for an empty push
  or a line it cannot trust, and `safeUrl` keeps every link a path of this site. The prototype build never registers it, `workerOnlyInRemote`
  (`vite.config.ts`) drops it from the prototype dist, and `check-bundles.ts` fails a prototype with it and a remote build without it. The
  bell sentence lives in `lib/noticeSentence.ts`, shared with the server. The service worker rules and the platform facts (focus rule,
  WebKit revoke): `server/push/CLAUDE.md`.
- The public VAPID key comes from `VITE_VAPID_PUBLIC_KEY`. Without it the section says push is not set up. A sign-out unsubscribes the
  browser. `usePushDevice` keeps the choice "off" in localStorage for each person (`madar.pushOff.<user id>`, `isPushOptedOut`,
  `setPushOptOut`): set before the turn off, taken back when it fails, cleared at a turn on. The choice is never on the server.
- Push is on by default. `features/home/PushAskCard.tsx` is one small card under Today with one short line and one button (`canAsk`). Any
  answer ends the ask. After Allow, `syncThisDevice` turns push on again by itself when the permission is granted and the browser holds no
  subscription. On an iPhone or iPad in a browser tab (`needs_install`) the card shows the 3 steps to the Home Screen, with no button. On
  Android it offers "Add to Home Screen" when Chrome offers the install. `app/remote/install.ts` keeps `beforeinstallprompt` (Android only)
  and `main.tsx` starts it before the first screen.

## Google Calendar
- `GoogleCalendarSection.tsx`: the state of `google.status` decides the one control. `none` gives the main button "Connect Google Calendar",
  `ok` and `not_synced` give a quiet "Disconnect", `broken` gives "Connect again". `ready: false` gives one line and no control. The
  prototype gives one line and asks nothing.
- Connect asks `google.connectStart` and leaves only for `https://accounts.google.com`. Google returns through `GET /api/google/callback`
  to `/settings#google=<word>` (a phone goes to `/me/calendar`). The section reads the fragment once and removes it at once with
  `history.replaceState`, so a reload never runs the step again. For the word `finish` it calls `google.connect` once. A refusal shows its
  reason inline, with no toast.
- Disconnect asks first (Keep has the focus) and has no Undo. A change of the Google sync changes `public/privacy.html` in the same commit
  (`app/privacy.test.ts`). Words: `src/i18n/real/gcal.*.json`.
