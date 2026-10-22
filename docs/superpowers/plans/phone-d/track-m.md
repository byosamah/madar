> Part of `docs/superpowers/plans/2026-10-22-madar-phone-d-plan.md`. Read that file first: its Global Constraints, shared interfaces and Lead amendments win over this file.

## Track M: Me (wave 2, branch rb/phone-d-me)

**Owns:**
- New folder `src/features/me/`: `MeScreen.tsx` and `MeSectionScreen.tsx` (they replace the stubs of track S), `MeRow.tsx`, `meSections.tsx`, `PersonPanels.tsx`, `NoticePanel.tsx`, `OfficeGroup.tsx`, `HomeScreenSheet.tsx`, `useMeSummary.ts`, `meReads.ts`, and the tests of the folder.
- `src/features/settings/`: `SettingsScreen.tsx`, `Section.tsx`, `ProfileSection.tsx`, `NotificationsSection.tsx`, `PasswordSection.tsx`, `PushSection.tsx`, `QuietHoursSection.tsx`, `workRange.ts`, new `bare.tsx`, new `PrototypeTools.tsx`, and their tests.
- `src/app/PersonMenu.tsx` (only the feedback mount moves out), new `src/features/feedback/useFeedbackSheet.tsx`, `src/features/feedback/FeedbackSheet.tsx`.
- Two shared files that only the Me section of the areas file changes: `src/components/PictureFrame.tsx` (one attribute) and `src/components/Switch.tsx` (one new export, `SwitchButton`). The design table does not list them. No other track edits them.
- Words: `src/i18n/real/phoneme.en.json` and `phoneme.ar.json` (key tree `phoneMe`).
- New test helper `src/test/mePhone.ts`. Browser specs of `tests/e2e/` and `tests/e2e-deploy/` that pin the old phone layout of Settings.
- Never edit: `routes.tsx`, `pressReads.ts`, `AppShell.tsx`, `nav.ts`, `SegmentedControl.tsx` (all track S), `features/home/` (track T), `FocusMode.tsx`, the contract, `server/`.

**Reads:** the area section "Me" of the areas file; the design file (lead decisions 12, 13, 15; call 10, 11); the contract parts "Hooks and helpers", "Shared components" (`SegmentedControl` `fill` and `layoutId`) and "Shell parts" (the stubs `MeScreen` and `MeSectionScreen`, the back links "Me" and "Dashboard" are track S).

**Facts that shape the plan:**
- The redirects live in the screens, not in `routes.tsx` (track S owns it). `SettingsScreen` redirects on a phone. `MeScreen` and `MeSectionScreen` redirect on a desk.
- `PhoneTabBar` keeps `data-pill`, so the inert selector of `FocusMode.tsx` needs no edit. Task M9 pins it with a test.
- `AdminScreen.tsx` needs no edit. Its in-page back link stays. The back link "Me" is in the shell (track S).
- A word in a hub row reuses an existing key where one exists (`presence.*`, `push.*`, `settings.*`, `gcal.*`, `adminReach.*`, `auth.signOut`, `feedback.menu`, `whatsNew.*`).

### Task M1: Bare mode and small edits of the Settings parts

**Files:**
- Create: `src/features/settings/bare.tsx`
- Modify: `src/features/settings/Section.tsx` (the `h2` is `sr-only` in bare mode)
- Modify: `src/features/settings/ProfileSection.tsx` (`h2#settings-profile` is `sr-only` in bare mode)
- Modify: `src/features/settings/NotificationsSection.tsx` (bare mode: no Morning summary block; the two column names are `sticky top-0 bg-card`)
- Modify: `src/features/settings/PasswordSection.tsx` (the button gets `max-sm:w-full`; `sm:mt-[1.6rem]` stays for the desk)
- Modify: `src/components/PictureFrame.tsx` (`data-vaul-no-drag` on the round frame `div`)
- Test: `src/features/settings/bare.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function BareProvider(props: { children: ReactNode }): JSX.Element` and `export function useBare(): boolean` (`false` with no provider).

- [ ] **Step 1: Write the failing test** (`bare.test.tsx`, remote mode: `vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }))`, `renderWithRuntime`)
```ts
it('keeps the h2 of a section on the desk and hides it in bare mode', ...)   // PasswordSection: h2 "Password" has no class sr-only; inside BareProvider it has class sr-only and getByRole('heading', { level: 2, name: 'Password' }) still finds it
it('hides the h2 of the profile in bare mode', ...)                          // ProfileSection inside BareProvider: document.getElementById('settings-profile') has class sr-only
it('leaves the Morning summary out of Notifications in bare mode only', ...) // no provider: getByRole('switch', { name: 'Morning summary' }) exists; in BareProvider: queryByRole(...) is null
it('makes the column names sticky in bare mode only', ...)                   // the span "In app" has class sticky in BareProvider, and not without it
it('gives the password button the full width on a phone', ...)               // getByRole('button', { name: 'Change the password' }) has class max-sm:w-full
it('marks the picture frame as no drag area for the sheet', ...)             // stub URL.createObjectURL; render PictureFrame; the element role="img" has attribute data-vaul-no-drag
```

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/settings/bare.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails because `./bare` does not exist.

- [ ] **Step 3: Implement.** `bare.tsx` is a React context with a default of `false`. `SettingsSection`, `ProfileSection` and `NotificationsSection` read `useBare()` before any early return. The desk renders no provider, so nothing changes there.

- [ ] **Step 4: Run the tests and `npm run typecheck`.**
`npx vitest run src/features/settings src/components --no-file-parallelism --testTimeout=60000`. Expected: PASS (all earlier Settings tests stay green).

- [ ] **Step 5: Commit**
`git add src/features/settings src/components/PictureFrame.tsx && git commit -m "Settings: add a bare mode for the Me sub-pages"`

### Task M2: Sub-pages `/me/:section`

**Files:**
- Create: `src/features/me/meSections.tsx`
- Create: `src/test/mePhone.ts`
- Modify: `src/features/me/MeSectionScreen.tsx` (replace the stub of track S)
- Test: `src/features/me/MeSectionScreen.test.tsx`

**Interfaces:**
- Consumes: `BareProvider` (M1), `useIsPhone`, `REMOTE`, `ScreenTitle`, `ProfileSection`, `AdminReachSection`, `NotificationsSection`, `QuietHoursSection`, `GoogleCalendarSection`, `PasswordSection`, `AgentsSection`.
- Produces:
```ts
export type MeSectionId = 'profile' | 'reach' | 'notices' | 'quiet-hours' | 'calendar' | 'password' | 'agents';
export type MeSection = { id: MeSectionId; titleKey: string; Component: ComponentType; allowed(viewer: { systemRole: SystemRole }, remote: boolean): boolean };
export const ME_SECTIONS: readonly MeSection[];
export function meSectionOf(id: string | undefined, viewer: { systemRole: SystemRole }, remote?: boolean): MeSection | undefined;
// src/test/mePhone.ts
export function phoneMedia(options?: { coarse?: boolean }): MockInstance;   // matchMedia answers true for (max-width: 639px), and for (pointer: coarse) with coarse
export function turnablePhone(): { turn(phone: boolean): void };            // like the helper in AdminScreen.test.tsx: listeners fire on turn()
```
Title keys: `settings.profile`, `adminReach.title`, `settings.notifications`, `quietHours.title`, `gcal.title`, `password.title`, `agents.title`. Rules: `reach` needs `systemRole === 'admin'`; `password` and `agents` need `remote`; the others are open.

- [ ] **Step 1: Write the failing test** (`renderApp`, prototype, `phoneMedia()` unless it says desk)
```ts
it('shows one section with its title as h1 and the section h2 hidden', ...)  // /me/quiet-hours: h1 "Quiet hours"; the switch #quiet-hours exists; its h2 has class sr-only
it('shows the profile form', ...)                                            // /me/profile: h1 "Profile"; getByLabelText('Name in English') exists
it('shows the notice switches of the prototype with no Morning summary', ...)// /me/notices: switch "Someone mentions me"; no switch "Morning summary"
it('opens What reaches me for the Admin only', ...)                          // usr_001: h1 "What reaches me" and 3 radios; usr_005: router pathname is /me
it('sends a section of the real build to the hub in the prototype', ...)     // /me/password and /me/agents: pathname /me
it('sends an unknown section to the hub', ...)                               // /me/nonsense: pathname /me
it('sends a desk to the Settings page', ...)                                 // no phoneMedia: /me/profile: pathname /settings; h1 "Settings"
it('goes to the Settings page when the phone turns past 640 px', ...)        // turnablePhone(): open /me/profile, type a name, turn(false): pathname /settings (the unsaved name is lost, by design)
```

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/MeSectionScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails because the stub of track S draws no section.

- [ ] **Step 3: Implement.** `MeSectionScreen` reads the `section` param and `session.get`. A desk returns `<Navigate to="/settings" replace />`. With no session it returns `null`. A section that `meSectionOf` refuses returns `<Navigate to="/me" replace />`. Else it draws `<ScreenTitle title={t(titleKey)} />` and the `Component` inside `<BareProvider>`. The `profile` entry is a small component that reads `session.get` and draws `<ProfileSection user={user} />`.

- [ ] **Step 4: Run the tests and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features/me src/test/mePhone.ts && git commit -m "Me: add the sub-pages of Settings under /me"`

### Task M3: The redirects, the hub shell and the prototype tools

**Files:**
- Create: `src/features/settings/PrototypeTools.tsx` (moved out of `SettingsScreen.tsx`)
- Create: `src/i18n/real/phoneme.en.json`, `src/i18n/real/phoneme.ar.json` (key `phoneMe.title`: "Me" and «أنا»)
- Modify: `src/features/settings/SettingsScreen.tsx` (the guard; the old body becomes `DeskSettings`)
- Modify: `src/features/me/MeScreen.tsx` (replace the stub: the desk guard and the title)
- Test: `src/features/me/redirects.test.tsx`, `src/features/settings/PrototypeTools.test.tsx`

**Interfaces:**
- Consumes: `useIsPhone`, `phoneMedia` (M2).
- Produces: `export function PrototypeTools(): JSX.Element` (the inner content only: `PreviewAs id="preview-as-settings"`, the `Switch` "Simulate errors" with its hint, the button "Reset sample data" and its confirm `Sheet`; it reads `session.get` itself). `export function SettingsScreen()` keeps its name and its place in the loaders.

- [ ] **Step 1: Write the failing test**
```ts
// redirects.test.tsx (renderApp, prototype)
it('sends /settings to /me on a phone with replace', ...)                 // phoneMedia(); pathname /me; router.state.historyAction === 'REPLACE'
it('sends /settings#google=denied to /me/calendar and keeps the hash', ...) // pathname /me/calendar; hash '#google=denied'
it('keeps the desk Settings page on a desk', ...)                          // no phoneMedia: /settings stays; h1 "Settings"; h2 "Profile"
it('sends /me and /me/profile to /settings on a desk', ...)                // pathname /settings for both
it('draws the hub title on a phone', ...)                                  // phoneMedia(); /me: h1 "Me"
// PrototypeTools.test.tsx
it('draws Preview as, Simulate errors and Reset sample data', ...)         // the three controls exist; Reset opens the sheet "Reset the sample data?"
```
The old tests of `SettingsScreen.test.tsx` and `prototypeControls.test.tsx` stay as they are and must pass.

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/redirects.test.tsx src/features/settings/PrototypeTools.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails (no redirect, no `PrototypeTools`).

- [ ] **Step 3: Implement.** `SettingsScreen` reads `useIsPhone()` and `useLocation()`. On a phone it returns `<Navigate replace to={{ pathname, hash }} />`: `/me/calendar` and the hash when `hash.startsWith('#google=')`, else `/me` and no hash. A desk draws `DeskSettings`, which wraps `<PrototypeTools />` in `<Section title={t('settings.prototype')}>` (`PROTOTYPE` only). `MeScreen` returns `<Navigate to="/settings" replace />` on a desk, else the title (it draws only the title while `session.get` has no answer). Move the code of the old Prototype block unchanged.

- [ ] **Step 4: Run the tests and `npm run typecheck`.**
`npx vitest run src/features/me src/features/settings --no-file-parallelism --testTimeout=60000`. Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features src/i18n/real/phoneme.en.json src/i18n/real/phoneme.ar.json && git commit -m "Me: redirect Settings to the Me hub on a phone"`

### Task M4: The row parts of the hub

**Files:**
- Modify: `src/components/Switch.tsx` (extract the button of `Switch` into `SwitchButton`; `Switch` calls it; the look does not change)
- Create: `src/features/me/MeRow.tsx`
- Test: `src/features/me/MeRow.test.tsx`

**Interfaces:**
- Consumes: `AnimatedIcon`, `ChevronRightIcon`, `SegmentedControl` with `fill` and `layoutId` (track S).
- Produces:
```ts
export function SwitchButton(props: { id: string; checked: boolean; onChange: (next: boolean) => void; describedBy?: string }): JSX.Element
type RowBase = { icon?: AnimatedIconComponent; lead?: ReactNode; title: string; lines?: string[] };
export function MeRow(props: RowBase & ({ to: string; value?: string } | { onPress: () => void; value?: string; buttonRef?: Ref<HTMLButtonElement> })): JSX.Element   // an <li>
export function MeSwitchRow(props: RowBase & { id: string; checked: boolean; onChange(next: boolean): void; note?: ReactNode }): JSX.Element   // an <li>
export function MeChoiceRow<T extends string>(props: { icon?: AnimatedIconComponent; title: string; layoutId: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void }): JSX.Element   // an <li>
export function MePanel(props: { label?: string; children: ReactNode }): JSX.Element   // <ul class="panel hairline overflow-hidden">
export function MeGroup(props: { title?: string; children: ReactNode }): JSX.Element   // <section> with the group word (text-footnote font-medium text-ink-2, aria-hidden) and its panels
```
Row look: `min-h-14`, the whole row is the press area (44 px or more), `.pressable`, icon 20 px `text-ink-2`, title `text-subheadline font-medium`, lines `text-footnote text-ink-2`, value at the end `text-footnote text-ink-2`, `ChevronRightIcon` with `rtl:-scale-x-100` only on a link row. No coloured tile. A title wraps (`break-words`, never `truncate`). `MeChoiceRow` draws the title on top and `<SegmentedControl fill layoutId={layoutId} label={title} .../>` under it.

- [ ] **Step 1: Write the failing test** (`render` inside `MemoryRouter`, English)
```ts
it('draws a link row with its lines, its value and a flipping chevron', ...)   // link "Quiet hours" has href /me/quiet-hours; shows "Off"; the chevron svg wrapper has class rtl:-scale-x-100
it('draws a press row as a button with no chevron', ...)                       // click calls onPress once; no chevron
it('lets a long title wrap to two lines', ...)                                 // the title element has class break-words and no class truncate (a 40-letter Arabic name and an English one)
it('draws a switch row that names its switch and its line', ...)               // getByRole('switch', { name: 'Show me as Away' }) has aria-describedby of the line; click calls onChange(true)
it('draws a choice row as a radio group', ...)                                 // radiogroup "Language" with radios English and العربية; click on the second calls onChange('ar')
```
The existing tests that use `Switch` stay green: `npx vitest run src/features/settings src/features/project src/features/work src/features/meetings`.

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/MeRow.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails because `MeRow` does not exist.

- [ ] **Step 3: Implement.** `SwitchButton` carries the exact classes of today. `MeSwitchRow` links its `<label htmlFor={id}>` and the line `id={`${id}-hint`}` to the switch.

- [ ] **Step 4: Run the tests and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/components/Switch.tsx src/features/me/MeRow.tsx src/features/me/MeRow.test.tsx && git commit -m "Me: add the row parts of the hub"`

### Task M5: The lines under the titles, and the reads of the Me tab

**Files:**
- Modify: `src/features/settings/workRange.ts` (add `effectiveWorkHours`)
- Modify: `src/features/settings/QuietHoursSection.tsx` (use it; the `shown` expression moves out unchanged)
- Create: `src/features/me/useMeSummary.ts`
- Create: `src/features/me/meReads.ts`
- Modify: `src/i18n/real/phoneme.en.json` and `.ar.json` (`disciplineRole`, `quietOn`, `quietOff`, `noticesApp`, `noticesAppEmail`, `gcalOn`, `gcalBroken`)
- Test: `src/features/me/useMeSummary.test.tsx`, `src/features/me/meReads.test.ts`

**Interfaces:**
- Consumes: `workHoursOf`, `officeWorkHoursOf`, `daysPhrase`, `clockLabel`, `adminReachOf`, `useLang`, `settings.get`, `google.status`.
- Produces:
```ts
// workRange.ts
export function effectiveWorkHours(person: PersonLike, settings: SettingsLike): WorkHours
// useMeSummary.ts
export type MeSummary = { role: string; quiet: string | null; notices: string; reach: string | null; gcal: string | null };
export function useMeSummary(): MeSummary
// meReads.ts
export function meReads(remote?: boolean): GuardRead[]   // settings.get {} and, when remote, google.status {}
```
`quiet` is `null` until `settings.get` answers; "Sunday to Thursday, outside 9:00 AM to 5:00 PM" with the defaults; `phoneMe.quietOff` when the person turned quiet hours off. `role` is `admin.roles.<systemRole>`, or the custom role name in the language of the screen. `notices` is `phoneMe.noticesAppEmail` in the real build, else `phoneMe.noticesApp`. `reach` is `adminReach.<choice>.label` for the Admin role, else `null`. `gcal` is `phoneMe.gcalOn` for `ok` and `not_synced`, `phoneMe.gcalBroken` for `broken`, else `null`.

- [ ] **Step 1: Write the failing test**
```ts
it('names the role and the quiet range of an Admin with the defaults', ...)     // quiet 'Sunday to Thursday, outside 9:00 AM to 5:00 PM'; role 'Admin'; reach 'My work, and the rest in the list'
it('says Off when the person turned quiet hours off', ...)                      // preferences.workHours.quiet = false: quiet 'Off'
it('widens the range to the office lock', ...)                                  // the lock holds Saturday: the phrase names it, as the Quiet hours page does
it('gives the name of a custom role in Arabic', ...)                            // custom role nameAr; language ar
it('gives no reach to a Member', ...)                                           // usr_005: reach null
it('reads the Google state in the real build only', ...)                        // gcal null in the prototype
// meReads.test.ts
it('lists settings.get, and google.status only for the real build', ...)        // meReads(false) has 1 read, meReads(true) has 2 (run each with a spy prefetch function)
```
Wire note for the lead (not this track): `PRESS_READS['/me'] = meReads` in `pressReads.ts` and one new case in `PressReads.test.tsx`.

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/useMeSummary.test.tsx src/features/me/meReads.test.ts --no-file-parallelism --testTimeout=60000`. Expected: it fails (files missing).

- [ ] **Step 3: Implement.** `effectiveWorkHours` is the `shown` expression of `QuietHoursSection`, moved as it is. Both words files get the seven keys: for example `quietOn` is "{{days}}, outside {{from}} to {{to}}" and «{{days}}، خارج {{from}} إلى {{to}}»; `quietOff` is "Off" and «متوقفة»; `gcalOn` is "Connected" and «مربوط»; `gcalBroken` is "Connect again" and «اربطه من جديد»; `disciplineRole` is "{{discipline}}, {{role}}" and «{{discipline}}، {{role}}».

- [ ] **Step 4: Run the tests and `npm run typecheck`.**
`npx vitest run src/features/me src/features/settings/QuietHoursSection.test.tsx src/i18n --no-file-parallelism --testTimeout=60000`. Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features src/i18n/real/phoneme.en.json src/i18n/real/phoneme.ar.json && git commit -m "Me: add the lines under the hub titles and the reads of the tab"`

### Task M6: The top of the hub (Profile, Away, Language, Theme)

**Files:**
- Create: `src/features/me/PersonPanels.tsx`
- Modify: `src/features/me/MeScreen.tsx` (draw panel 1 and the group "Settings" with panel 2)
- Modify: `src/i18n/real/phoneme.en.json` and `.ar.json` (`groupSettings`: "Settings" and «الإعدادات»; `profileLine`: "Picture, names, discipline" and «الصورة والأسماء والتخصص»)
- Test: `src/features/me/MeScreen.test.tsx` (prototype; this file grows in M7 and M8)

**Interfaces:**
- Consumes: `MeRow`, `MeSwitchRow`, `MeChoiceRow`, `MePanel`, `MeGroup` (M4), `useMeSummary` (M5), `PersonFace`, `usePersonName`, `useSwitchLanguage`, `useRuntime().live`, `useMyState`.
- Produces: `export function ProfilePanel(): JSX.Element` (Profile row, and the Away row when the runtime has a `live` port) and `export function LookPanel(): JSX.Element` (Language and Theme rows).

Pinned values: the Profile row is a link to `/me/profile` with `PersonFace` (`size={56}`, `mine`), the name, the line `phoneMe.disciplineRole` and the line `phoneMe.profileLine`. The Away row has id `away-by-hand`, title `presence.showAway` with `context: actorContext(user)`, line `presence.awayByYou` when `awayByHand` is on else `presence.<myState>`, and saves `me.updatePreferences({ awayByHand })`. Language options `settings.languages.en|ar` call `useSwitchLanguage()`, `layoutId="me-language"`. Theme options `settings.themes.system|light|dark` save `me.updatePreferences({ theme })`, `layoutId="me-theme"`.

- [ ] **Step 1: Write the failing test** (`renderApp('/me')`, `phoneMedia()`, prototype)
```ts
it('draws the profile row with the name, the role and the picture line', ...)   // link name contains "Hala Nasser"; href #/me/profile; text "Admin" and "Picture, names, discipline"
it('has no Away row without a live port, and one with it', ...)                 // fakeLive({ usr_001: 'online' }): switch "Show me as Away" with line "Online"; click saves awayByHand
it('puts Language and Theme under the group word Settings', ...)                // list "Settings" holds radiogroups Language and Theme
it('switches the theme in place', ...)                                          // click Dark: document.documentElement.dataset.theme === 'dark'
it('switches the language and turns the page', ...)                             // click العربية: html dir is rtl
it('draws only the title while the session has no answer', ...)                 // hold session.get: h1 "Me" and no row
```

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/MeScreen.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails (no rows).

- [ ] **Step 3: Implement.** The panels are plain compositions of the M4 parts. Icons (`AnimatedIcon`, 20 px): Away `circle-dashed`, Language `languages`, Theme `palette`.

- [ ] **Step 4: Run the tests and `npm run typecheck`.** Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features/me src/i18n/real/phoneme.en.json src/i18n/real/phoneme.ar.json && git commit -m "Me: draw the profile, Away, Language and Theme rows"`

### Task M7: The settings rows of the hub

**Files:**
- Create: `src/features/me/NoticePanel.tsx` (`NoticePanel` and `AccountPanel`)
- Create: `src/features/me/HomeScreenSheet.tsx`
- Modify: `src/features/settings/PushSection.tsx` (export the `NOTE` map as `PUSH_NOTE`; the desk section keeps using it)
- Modify: `src/features/me/MeScreen.tsx` (draw both panels under the group "Settings")
- Modify: `src/i18n/real/phoneme.en.json` and `.ar.json` (`homeScreenRow`: "Add Madar to the Home Screen" and «أضف مدار إلى الشاشة الرئيسية»)
- Test: `src/features/me/MeScreen.test.tsx` (prototype part), `src/features/me/MeScreen.remote.test.tsx` (new; `vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }))`, `renderRemoteApp` from `features/auth/renderAuth`, `pushBrowser` helpers)

**Interfaces:**
- Consumes: M4 parts, `useMeSummary`, `usePushDevice`, `canInstall`, `onInstallChange`, `promptInstall`, `morningSummaryOn`, `Sheet`.
- Produces: `export function NoticePanel(): JSX.Element`, `export function AccountPanel(): JSX.Element`, `export function HomeScreenSheet(props: { open: boolean; onOpenChange(open: boolean): void }): JSX.Element` (a `Sheet` titled `phoneMe.homeScreenRow` with `push.homeScreenLine` and the three steps `push.homeScreenStep1` to `3` in an `ol`; it does not import `PushAskCard`, which track T owns).

Pinned rows, in order. `NoticePanel`: (1) real build only, id `push-device`, title `push.switch`; a switch only when `status` is `off` or `on`; a `role="status"` line from `PUSH_NOTE` for `unsupported`, `not_set` and `blocked`; no line for `needs_install`; `FormError` for `push.error` and `push.offError`; while `status` is `null` the row has no switch and no line. (2) real build only, the Home Screen row: shown when `status === 'needs_install'` (a press opens `HomeScreenSheet`) or when `canInstall()` and `status !== null` (a press calls `promptInstall()`), else absent. (3) "Quiet hours" link to `/me/quiet-hours`, line from `summary.quiet`. (4) `settings.notifications` link to `/me/notices`, line `summary.notices`. (5) real build only, id `morning-summary`, title `notices.summary`, saves `notifications.updateSettings({ morningSummary })`. (6) Admin role only, `adminReach.title`, link to `/me/reach`, value `summary.reach`. `AccountPanel`: `gcal.title` link to `/me/calendar` with value `summary.gcal`; real build only: `password.title` link to `/me/password`, `agents.title` link to `/me/agents` (also without the right `ai.connect`). Icons: push `bell`, Home Screen `home`, Quiet hours `timer`, notices `sliders-horizontal`, Morning summary `sun`, reach `users`, Google `calendar-days`, Password `shield-check`, Agents `waypoints`.

- [ ] **Step 1: Write the failing test**
```ts
// MeScreen.test.tsx (prototype)
it('has the Quiet hours, Notifications and Google Calendar rows and no real-build rows', ...) // links to /me/quiet-hours, /me/notices, /me/calendar; no switch "Morning summary", no push row, no Password, no Agents
it('shows the quiet range and the notice line', ...)                                          // "Sunday to Thursday, outside 9:00 AM to 5:00 PM"; "In the app"
it('shows What reaches me to the Admin only', ...)                                            // usr_001 yes with its value; usr_005 no
// MeScreen.remote.test.tsx
it('shows the push switch, off, with no status line', ...)                                    // pushBrowser(): switch "Notify me on this device" aria-checked false; no role=status
it('shows no switch while the first check runs', ...)                                         // first render: no push switch; after findBy: the switch exists
it('shows the blocked reason and no switch', ...)                                             // pushBrowser({ permission: 'denied' }): role=status with push.blocked; no switch
it('on an iPhone tab shows the Home Screen row and no push line', ...)                        // pushBrowser({ none: true }); iphoneBrowser(): row exists; no role=status; no push switch
it('opens the three steps from that row', ...)                                                // press: dialog with the 3 steps in order; Close
it('on Android calls the install box from the same row', ...)                                 // androidBrowser(); watchInstall(); dispatch installEvent(): press calls event.prompt once; the row leaves
it('turns the Morning summary on and off and saves it', ...)                                  // click: notifications.updateSettings called with { morningSummary: false }
it('shows Password and Agents rows, also for a person without ai.connect', ...)               // links to /me/password and /me/agents
it('shows the Google value Connected', ...)                                                   // google.status answers ok: "Connected" at the end of the row
```

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me/MeScreen.test.tsx src/features/me/MeScreen.remote.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: it fails (no rows).

- [ ] **Step 3: Implement.** Reuse `usePushDevice` as it is. Read `canInstall` with `useSyncExternalStore(onInstallChange, canInstall, () => false)`, as `PushAskCard` does. Mount `HomeScreenSheet` only after the first press.

- [ ] **Step 4: Run the tests and `npm run typecheck`.**
`npx vitest run src/features/me src/features/settings src/features/home/PushAskCard.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features/me src/features/settings/PushSection.tsx src/i18n/real/phoneme.en.json src/i18n/real/phoneme.ar.json && git commit -m "Me: draw the notice, device and account rows"`

### Task M8: The Office group, the Prototype group, Sign out and the feedback sheet

**Files:**
- Create: `src/features/me/OfficeGroup.tsx` (`OfficeGroup`, `PrototypeGroup`, `SignOutButton`)
- Create: `src/features/feedback/useFeedbackSheet.tsx`
- Modify: `src/app/PersonMenu.tsx` (use the hook; the desk menu behaves as before)
- Modify: `src/features/feedback/FeedbackSheet.tsx` (remove button gets a 44 px press area; the paste hint hides on a coarse pointer)
- Modify: `src/features/me/MeScreen.tsx` (draw the three parts)
- Modify: `src/i18n/real/phoneme.en.json` and `.ar.json` (`groupOffice`: "Office" and «المكتب»; `dashboardLine`: "The numbers and what needs attention" and «الأرقام وما يحتاج إلى انتباهك»; `adminLine`: "Best on a computer" and «الأفضل على الكمبيوتر»)
- Test: `src/features/me/MeScreen.test.tsx`, `src/features/me/MeScreen.remote.test.tsx`, `src/features/feedback/FeedbackSheet.test.tsx`

**Interfaces:**
- Consumes: M4 parts, `opensAdminPage`, `can`, `useRight`, `WHATS_NEW`, `hasNew`, `readSeen`, `useSignOut`, `PrototypeTools` (M3), `usePointerCoarse`.
- Produces: `export function useFeedbackSheet(returnFocus?: RefObject<HTMLElement | null>): { open(): void; sheet: ReactNode }` (mounts `LazyFeedbackSheet` at the first open with `useOnceOn`, gives the focus back to `returnFocus` when the sheet closes). `OfficeGroup` rows in order: "Dashboard" (right `dashboard.view`; link `/dashboard`; line `phoneMe.dashboardLine`), "Admin" for the Admin role or "Office" for another role (only when `opensAdminPage`; link `/admin`; line `phoneMe.adminLine`), "What's new" (link `/whats-new`; value `whatsNew.newMark` while `hasNew(WHATS_NEW, readSeen(user.id))`), `feedback.menu` (right `feedback.send`; a press row that opens the sheet). `PrototypeGroup` (prototype only): group word `settings.prototype` over a panel that holds `<PrototypeTools />`. `SignOutButton` (real build only): a full-width secondary `Button`, `min-h-12`, last on the page, disabled while `useSignOut()` runs, enabled again when it ends or fails, no confirm.

- [ ] **Step 1: Write the failing test**
```ts
// MeScreen.test.tsx (prototype, phone)
it('shows Dashboard, Admin, What\'s new and the feedback row to the Admin', ...)       // Admin row line "Best on a computer", link /admin; no Sign out, no Password
it('draws the Prototype group with Preview as at the end', ...)                       // group word "Prototype" after the Office group; combobox "Preview as" present
it('shows the word New on the What\'s new row until the page is seen', ...)           // localStorage seen older than the newest entry: "New" at the end; after the visit it is gone
it('opens the feedback sheet from its row and gives the focus back', ...)             // press: dialog "Request a feature or report a bug"; Cancel: the row has focus
// MeScreen.remote.test.tsx
it('shows the Admin row as "Office" for Management and no What reaches me', ...)       // Management person: row title "Office"; no "What reaches me"
it('shows a Member no Admin row and no reach row', ...)                               // usr_005: no link /admin; Dashboard row shows exactly when can(authority, 'dashboard.view') is true
it('has no Prototype group in the real build', ...)                                   // no "Prototype", no "Preview as"
it('signs out with one press and ignores a second press while it runs', ...)          // vi.mock('../auth/signOut'): a promise that stays open; two clicks: one call; button disabled
it('enables Sign out again when the call fails', ...)                                 // the promise rejects: button enabled
// FeedbackSheet.test.tsx
it('gives the remove button of a screenshot a 44 px press area', ...)                 // class after:-inset-2 on the button
it('hides the paste hint on a coarse pointer and shows it on a mouse', ...)           // phoneMedia({ coarse: true }): no "Cmd+V" hint; default: the hint shows
```
`PersonMenu` tests (`rr2Shell.test.tsx`, `prototypeControls.test.tsx`, `AppShell.test.tsx`) must stay green.

- [ ] **Step 2: Run it and see it fail**
`npx vitest run src/features/me src/features/feedback --no-file-parallelism --testTimeout=60000`. Expected: it fails (no groups, no hook).

- [ ] **Step 3: Implement.** The hook holds the two lines `useState(false)` and `useOnceOn(open)` that `PersonMenu` has today. `PersonMenu` calls `feedback.open()` after its own `close()` and draws `feedback.sheet`. The remove button keeps `size-7` and adds `after:absolute after:-inset-2 after:content-['']`. The hub puts a ref on the feedback row (`buttonRef`) and passes it to the hook. The screen order is: panel 1, group "Settings", group "Office", group "Prototype", Sign out.

- [ ] **Step 4: Run the tests and `npm run typecheck`.**
`npx vitest run src/features/me src/features/feedback src/features/settings src/app/rr2Shell.test.tsx src/app/AppShell.test.tsx src/features/auth/signOut.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS.

- [ ] **Step 5: Commit**
`git add src/features src/app/PersonMenu.tsx src/i18n/real/phoneme.en.json src/i18n/real/phoneme.ar.json && git commit -m "Me: draw the Office group, the Prototype group and Sign out"`

### Task M9: The Focus pin, the browser specs and the doc lines

**Files:**
- Test: `src/features/me/focusInert.test.tsx`
- Modify (browser specs; the builder edits them, the Playwright agent of the lead runs them): `tests/e2e/calm.spec.ts`, `tests/e2e/shell.spec.ts`, `tests/e2e/work.spec.ts`, `tests/e2e/full.spec.ts`, `tests/e2e/dashboard.spec.ts`, `tests/e2e/owner.spec.ts`, `tests/e2e/acceptance.spec.ts`, `tests/e2e-deploy/settings.spec.ts`, `tests/e2e-deploy/account.spec.ts`, `tests/e2e-deploy/walk.spec.ts`, `tests/e2e-deploy/agents.spec.ts`, `tests/e2e-deploy/menus.spec.ts`, `tests/e2e-deploy/owner.spec.ts`, `tests/e2e-deploy/acceptance.spec.ts`, `tests/e2e-deploy/dashboard.spec.ts`, `tests/e2e-deploy/steps.ts`
- Create (outside the repo gate): the builder report file, with the doc lines for the lead.

**Interfaces:**
- Consumes: the finished hub. A trick that keeps one path for both widths: on a desk `/me/<section>` redirects to `/settings`, so a spec may open `/me/notices` at 390 and at 1440.

- [ ] **Step 1: Write the failing test** (`focusInert.test.tsx`, `renderApp` with `phoneMedia()`)
```ts
it('makes the phone tab bar and the page inert while Focus mode is open', ...)   // open /projects/prj_001?tab=tasks&focus=tsk_012 as usr_005: nav[data-pill] has inert === true, and .app-page too; after Escape both are false
```
This test pins the contract line "PhoneTabBar keeps data-pill". It may pass at once, because `FocusMode.tsx` needs no edit.

- [ ] **Step 2: Run it.**
`npx vitest run src/features/me/focusInert.test.tsx --no-file-parallelism --testTimeout=60000`. Expected: PASS at once. If it fails, `PhoneTabBar` lost `data-pill`: report it to the lead, do not edit `FocusMode.tsx`.

- [ ] **Step 3: Edit the browser specs.**
  - `tests/e2e/calm.spec.ts` lines 171 to 180: open `/#/me` at 390, press the radio «العربية», keep the checks.
  - `tests/e2e/shell.spec.ts` line 4 and `tests/e2e-deploy/shell.spec.ts` line 7: add `/me` and `/me/profile` to `ROUTES`.
  - `tests/e2e/work.spec.ts` line 80, `tests/e2e/full.spec.ts` line 6 and `tests/e2e-deploy/full.spec.ts` line 10: add `/#/me` and `/#/me/profile`.
  - `tests/e2e/dashboard.spec.ts` and `tests/e2e-deploy/dashboard.spec.ts`: add `me` and `me-profile` to the 390 px screen loops.
  - `tests/e2e/owner.spec.ts` line 11, `tests/e2e/acceptance.spec.ts` line 17, `tests/e2e-deploy/owner.spec.ts` line 10 and `tests/e2e-deploy/acceptance.spec.ts` line 21 (`previewAs`): when the viewport is under 640 px, wait for the link of the profile row (`getByRole('link', { name: new RegExp(`^${person}`) })`) in place of the picture button.
  - `tests/e2e-deploy/settings.spec.ts` lines 13 to 26 and 60 to 73: open `/me/notices` and `/me/password` (headings by name, with no level), and the Morning summary switch on `/me`. Run the screenshots of the hub at 360 and 390 px too.
  - `tests/e2e-deploy/account.spec.ts` lines 26 and 98 to 137: open `/me/password`; the heading by name; `#password-current` stays.
  - `tests/e2e-deploy/walk.spec.ts` lines 563 to 573 and 667: open `/me/notices` and `/me/agents` (heading by name, no level; the `section` locator stays).
  - `tests/e2e-deploy/agents.spec.ts` lines 101 and 160: line 160 opens `/me/agents`; line 101 stays (the redirect works).
  - `tests/e2e-deploy/menus.spec.ts` lines 117 to 121 and `tests/e2e/menus.spec.ts` line 87: open `/me`; the visible "Preview as" is on the hub.
  - `tests/e2e-deploy/steps.ts` line 67, `signOut(page, person, lang)`: under 640 px press the Me tab, then the button `auth.signOut` of the hub. From 640 px the person menu path stays.
  - No change: `fixtures.ts` (the two radio groups of the hub keep the order Language, Theme), `tests/e2e-deploy/calm.spec.ts` line 185, `tests/e2e/projects.spec.ts`, `tests/e2e/acceptance.spec.ts` line 18 (`/settings` redirects).

- [ ] **Step 4: Run `npm run typecheck`** (the specs are in the tsconfig of the tests) **and the unit files of the whole track:**
`npx vitest run src/features/me src/features/settings src/features/feedback --no-file-parallelism --testTimeout=60000`. Expected: PASS. The builder does not run Playwright.

- [ ] **Step 5: Write the doc lines to the report file, then commit.** The lead owns `src/CLAUDE.md`, `DESIGN.md`, `src/design/CLAUDE.md` and the What's new entry. The report lists, line by line: (a) `DESIGN.md`: the picture opens the person menu on a desk only; on a phone the Me tab holds it; (b) `src/CLAUDE.md`: the paragraphs on What's new, Google Calendar (`/settings#google=` redirects to `/me/calendar` on a phone), the Today ask card, Quiet hours and What reaches me ("Settings has the section" becomes "Settings or Me has the section"); the folder `features/me/`; the bare mode; (c) `src/design/CLAUDE.md`: no coloured tile behind a hub icon; (d) the wire note of M5 for `pressReads.ts`.
`git add src/features/me tests && git commit -m "Me: update the browser specs for the phone hub"`

**Review focus candidates:**
- A long name on a 360 px phone, in English and in Arabic (a 40-letter name, a custom role name): the Profile row and the Away line wrap and clip nothing. Covered by the wrap test in M4.
- The push check has not ended when the hub opens (a slow phone): the row shows no switch and no line, then the switch appears with no jump of the rows around it. Covered in M7.
- Sign out on a slow or offline phone (the push device leaves first, up to 4 seconds): a second press does nothing, and the button works again if the call fails. Covered in M8.
- The phone turns sideways on `/me/profile` with an unsaved name: the page goes to `/settings` and the name is lost. The owner accepted this. Covered in M2.
