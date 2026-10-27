# Shared components

The shared parts in `src/components/`. The rules for all screens are in `src/CLAUDE.md`. Sheet, Menu, Tabs and SegmentedControl options for the
phone are in `src/app/CLAUDE.md`.

## Rules
- `AvatarStack`: one hidden person shows as a picture, never as "+1". "+N" names the hidden people on hover and in `aria-label`. When a leader
  is passed, the leader picture gets a ring in the ink color (never the navy, never red) with a gap in the surface color inside it. The ring
  draws outside the box (`-m-0.5`), so a row never grows. Every stack with a leader has the ring (Projects list, to-do rows, the Board, Open
  space). A stack with no leader (Admin Teams) has none. The leader name reads "Leader: <name>" (`people.leaderName`).
- Each avatar box is `flex shrink-0`. A photo (an inline img) in a plain box sits on a text line, the box grows a gap under it, and the ring
  draws an oval. Initials have no gap, so the prototype hides the fault. Check a stack with a real photo (`AvatarStackLeader.test.tsx`).
- `ProjectTile`: the sub-company badge is 18 px at least and has a `title` with the name. The tile loses a circle 2 px wider than the badge
  (`tile-cut` in `tokens.css`, a mask), so no ring of one color draws an edge. The badge box is a flex box. A sub-company logo sits on a
  white plate (`LOGO_PLATE`, `SubCompanyLogo.tsx`) in both themes. The badge shows wherever a project picture shows and the data has
  `subCompanyId`.
- A project can hold its own `shape`: one SVG path in the box `0 0 18 18` (`src/lib/projectShape.ts` holds the allowed characters and the
  length limit). `ProjectTile` and `MarkForm` draw it in ink in place of the random form, with `fill-rule="evenodd"` and no turn. Every
  project ref (`projectRef`, `projectTile`, `ProjectRef`, `ReportRef`, the Dashboard `Ref`, the notice tile) carries `shape` only when the
  project has one. Every screen that draws a tile passes `shape={project.shape}`: grep `<ProjectTile` when you add one. An AI agent sets it
  with `projects.update`; no screen control exists.
- The glow lights of a person and a project tile come from one rule (`src/lib/glow.ts`, `markLights`). `src/lib/pictureLook.ts` draws the
  same lights for AI agent pictures. `glow.test.ts` and `pictureLook.test.ts` pin both.
- `MadarMark` ("Turning doors") shows only in the sign-in frame, the app frame and the office card of the Open space. Never put it in a
  project list (`MadarMark.test.tsx` lists the files).
- Icons: animated Lucide icons through `icons/AnimatedIcon.tsx`. An animated icon is an inline svg in a div, so it sits on the text line and
  rises about 2 px. Where it must sit in the middle of a box, give the holder `[&_svg]:block` (`PhoneTabBar`). `icons/animatedIcons.test.tsx`
  tests every file in `icons/animated/` by a glob: the export name must end in `Icon`, and no attribute or style may hold `undefined` or `NaN`.
- A required field: `required` on `TextField`, `SelectField`, `TextArea` or `DateField` shows an asterisk after the label and a hidden
  "required" word in the description. The browser never checks the field.
- Dates: a date that saves itself uses `DateDraftField`. A date in a form with its own save button uses `DateField`. Both show "Set date..."
  when empty. Only the Tracker quick log keeps a full date field. A date that cannot come before or after another takes `min` and `max`.
  `CalendarPopover.tsx` has a solid ink circle for the chosen day, a month grid and a Today button.
  Tests: a `DateDraftField` change event with no focus counts as a pick and saves at once. To test typing, focus the field first (inside
  `act`). `DateField` gives every change to the form at once, so `fireEvent.change` by label works.
- `Popover` draws inside the closest `[role="dialog"]` of its anchor, as `Menu` does, and turns its place into the units of that dialog
  (`fixedFrame`, `inFrame`). A sheet that blocks traps the focus, so a panel outside it would lose the focus at once.
- A person has an English name (`name`) and maybe an Arabic name (`nameAr`). Every spot that shows a person name uses `usePersonName()`
  (`app/personName.ts`), and lists of people sort with `useByPersonName()`. A name that the server writes into a detail has an `Ar` twin: read
  it with `localName`. A person card (`UserCard`) carries no picture data: `Avatar` takes the picture from `users.list` through
  `app/pictures.tsx`.
- Lists that stop their rows with `React.memo` wrap them in `AgeRefresh.Provider` (`Age.tsx`) with a new object on each render, so each
  `Age` still reads the clock in the same renders.
