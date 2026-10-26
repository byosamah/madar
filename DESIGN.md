---
version: alpha
name: Madar
description: >-
  The calm daily board of an architecture office in Al Khobar. White panels on a soft grey page, one navy ink for the single
  next step, English and Arabic with full right-to-left. Built for a team that includes people with ADHD.
colors:
  # The signature: solid blueprint navy. Only the one main button of a screen, the open tab, the day ring and the timer.
  primary: "#1F2A55"
  on-primary: "#FFFFFF"
  primary-dark: "#C9D4FF"
  on-primary-dark: "#10183A"
  # The page, the panels and the ink.
  neutral: "#F4F4F7"
  page-top: "#F7F7F9"
  page-bottom: "#F1F1F4"
  surface: "#FFFFFF"
  on-surface: "#1D1D1F"
  on-surface-variant: "#636366"
  outline: "#F0F0F2"
  icon-muted: "#A1A1A6"
  # On a white panel. The code keeps them translucent, rgba(120, 120, 128, 0.12) and 0.2, so they sit on any surface.
  fill: "#EFEFF0"
  fill-strong: "#E4E4E6"
  link: "#0066CC"
  neutral-dark: "#0D0D10"
  surface-dark: "#1A1A1E"
  on-surface-dark: "#F5F5F7"
  on-surface-variant-dark: "#A1A1A6"
  outline-dark: "#26262B"
  link-dark: "#4DA3FF"
  # A chat message or a comment that names the reader: a soft lilac tint with a 3 px bar on its start side. Only the reader sees it.
  mention: "#F4EDFF"
  mention-bar: "#7E22CE"
  mention-dark: "#2D2442"
  mention-bar-dark: "#C29BFF"
  # State words. Red is only for Late and for errors.
  error: "#B42318"
  error-container: "#FDECEC"
  attention: "#B54708"
  attention-container: "#FFF4E5"
  success: "#067647"
  badge: "#D70015"
  on-badge: "#FFFFFF"
  status-on-track: "#1E7A34"
  status-at-risk: "#C93400"
  status-late: "#D70015"
  error-dark: "#FF8A80"
  error-container-dark: "#3B1D1B"
  attention-dark: "#FFB65C"
  attention-container-dark: "#3A2A12"
  # The glow: three soft lights, only behind "Next for you" and inside the Madar mark.
  glow-blue: "#CCE0FF"
  glow-lilac: "#EAD5FF"
  glow-mint: "#CFF2E2"
  # Project hues: a stable hash of the project id picks one. Text keeps 4.5:1 on its tile; the line keeps 3:1 on a panel.
  project-blue: "#E8F0FE"
  on-project-blue: "#1A56DB"
  project-orange: "#FDF2E9"
  on-project-orange: "#C2410C"
  project-green: "#E7F6EE"
  on-project-green: "#047857"
  project-purple: "#F3E8FF"
  on-project-purple: "#7E22CE"
  project-pink: "#FCE7F3"
  on-project-pink: "#BE185D"
  project-teal: "#E0F5F5"
  on-project-teal: "#0F766E"
  project-amber: "#FEF6E1"
  on-project-amber: "#A16207"
  project-indigo: "#EAEBFF"
  on-project-indigo: "#4338CA"
typography:
  page-title:
    fontFamily: Thmanyah Sans
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: -0.025em
  section-title:
    fontFamily: Thmanyah Sans
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.015em
  title-lg:
    fontFamily: Thmanyah Sans
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.015em
  title-md:
    fontFamily: Thmanyah Sans
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Thmanyah Sans
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.25
  headline:
    fontFamily: Thmanyah Sans
    fontSize: 17px
    fontWeight: 700
    lineHeight: 1.3
  body-md:
    fontFamily: Thmanyah Sans
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.45
  body-md-desktop:
    fontFamily: Thmanyah Sans
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.45
  label-lg:
    fontFamily: Thmanyah Sans
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.35
  body-sm:
    fontFamily: Thmanyah Sans
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.35
  label-md:
    fontFamily: Thmanyah Sans
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.35
  label-sm:
    fontFamily: Thmanyah Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.01em
  number:
    fontFamily: Inter Variable
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.2
    fontFeature: '"tnum" 1'
  body-ar:
    fontFamily: Thmanyah Sans
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: 0px
  control: 8px
  field: 12px
  card: 20px
  sheet: 28px
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  panel: 20px
  xl: 24px
  2xl: 32px
  gutter-phone: 16px
  gutter-desktop: 32px
  page-max: 1152px
  touch-target: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 20px
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary-dark}"
  button-secondary:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
    padding: 20px
  button-secondary-hover:
    backgroundColor: "{colors.fill-strong}"
  button-plain:
    textColor: "{colors.link}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.full}"
    height: 44px
  button-destructive:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.error}"
    rounded: "{rounded.full}"
    height: 44px
  button-destructive-hover:
    backgroundColor: "{colors.error-container}"
  field:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.field}"
    height: 44px
    padding: 14px
  field-label:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-md}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.panel}"
  panel-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.on-surface-dark}"
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
  page-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.on-surface-dark}"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sheet}"
  tab-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-variant}"
    rounded: "{rounded.full}"
    height: 52px
  tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
  next-for-you:
    backgroundColor: "{colors.glow-blue}"
    textColor: "{colors.primary}"
    rounded: "{rounded.card}"
    padding: "{spacing.xl}"
  attention-note:
    backgroundColor: "{colors.attention-container}"
    textColor: "{colors.attention}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
  late-note:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.error}"
    typography: "{typography.label-md}"
    rounded: "{rounded.control}"
  attention-note-dark:
    backgroundColor: "{colors.attention-container-dark}"
    textColor: "{colors.attention-dark}"
  late-note-dark:
    backgroundColor: "{colors.error-container-dark}"
    textColor: "{colors.error-dark}"
  status-on-track:
    textColor: "{colors.status-on-track}"
    typography: "{typography.label-md}"
  status-at-risk:
    textColor: "{colors.status-at-risk}"
    typography: "{typography.label-md}"
  status-late:
    textColor: "{colors.status-late}"
    typography: "{typography.label-md}"
  status-done:
    textColor: "{colors.success}"
    typography: "{typography.label-md}"
  badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.on-badge}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  link:
    textColor: "{colors.link}"
  link-dark:
    textColor: "{colors.link-dark}"
  message-names-you:
    backgroundColor: "{colors.mention}"
    textColor: "{colors.on-surface}"
  message-names-you-bar:
    backgroundColor: "{colors.mention-bar}"
    width: 3px
  message-names-you-dark:
    backgroundColor: "{colors.mention-dark}"
    textColor: "{colors.on-surface-dark}"
  message-names-you-bar-dark:
    backgroundColor: "{colors.mention-bar-dark}"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.outline-dark}"
    height: 1px
  icon-disabled:
    textColor: "{colors.icon-muted}"
  page-gradient:
    backgroundColor: "{colors.page-top}"
  page-gradient-end:
    backgroundColor: "{colors.page-bottom}"
  text-secondary-dark:
    textColor: "{colors.on-surface-variant-dark}"
  madar-mark:
    backgroundColor: "{colors.glow-lilac}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.control}"
    size: 36px
  madar-mark-light-2:
    backgroundColor: "{colors.glow-mint}"
  project-tile-blue:
    backgroundColor: "{colors.project-blue}"
    textColor: "{colors.on-project-blue}"
    rounded: "{rounded.field}"
    size: 40px
  project-tile-orange:
    backgroundColor: "{colors.project-orange}"
    textColor: "{colors.on-project-orange}"
  project-tile-green:
    backgroundColor: "{colors.project-green}"
    textColor: "{colors.on-project-green}"
  project-tile-purple:
    backgroundColor: "{colors.project-purple}"
    textColor: "{colors.on-project-purple}"
  project-tile-pink:
    backgroundColor: "{colors.project-pink}"
    textColor: "{colors.on-project-pink}"
  project-tile-teal:
    backgroundColor: "{colors.project-teal}"
    textColor: "{colors.on-project-teal}"
  project-tile-amber:
    backgroundColor: "{colors.project-amber}"
    textColor: "{colors.on-project-amber}"
  project-tile-indigo:
    backgroundColor: "{colors.project-indigo}"
    textColor: "{colors.on-project-indigo}"
  page-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.page-title}"
  section-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.section-title}"
  sheet-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title-md}"
  dialog-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title-sm}"
  meeting-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.title-lg}"
  row-title:
    textColor: "{colors.on-surface}"
    typography: "{typography.headline}"
  body:
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  body-desktop:
    typography: "{typography.body-md-desktop}"
  body-arabic:
    typography: "{typography.body-ar}"
  meta:
    textColor: "{colors.on-surface-variant}"
    typography: "{typography.label-sm}"
  count:
    textColor: "{colors.on-surface}"
    typography: "{typography.number}"
---

# Madar

## Overview

Madar (مدار, "orbit") is the daily board of a small architecture office in Al Khobar: about fifteen architects and
engineers, their projects, stages, tasks, files and client meetings. Think of the one clean drawing sheet that the office
pins at the end of the day: a white sheet on a grey table, one line in blueprint ink that says what to do next, and small
pencil notes for the rest. The screen has the same job. It answers "what do I do now?" before anything else.

The office includes people with ADHD, and that decides the design. A screen gives one next step, the fewest controls,
and no motion or colour that asks for attention without a reason. When a choice is open, take the calmer one.

- **Audience:** office staff on a laptop at the desk and on a phone on site; the Admin and Management run people,
  payments and settings; the meeting view runs on a big screen in the meeting room.
- **Two languages:** English and Arabic, both first class. Arabic is full right-to-left, never a mirror added later.
  In the Arabic screens, English text (a name, a note) also sits on the right; it keeps only its own letter order and
  punctuation. In the English screens, Arabic text sits on the left.
- **Two themes:** light by default, dark on request. Each token with a `-dark` pair takes that value in the dark theme.
- **Source of truth for values:** `src/design/tokens.css`. This file explains them. If the two disagree, the code wins and
  this file gets a fix.

## Colors

One ink, one signature, quiet states. Colour carries meaning, never decoration.

- **Signature navy** {colors.primary} is blueprint ink. It appears in exactly four places: the one main button of a
  screen, the open tab of the tab pill, the day ring on Home, and the Focus timer. Text on it is {colors.on-primary}.
  In the dark theme it turns to pale periwinkle {colors.primary-dark} with deep navy text {colors.on-primary-dark}.
  It is always a solid fill, never a gradient.
- **The page** is a soft vertical gradient from {colors.page-top} to {colors.page-bottom} (base {colors.neutral}).
  Content sits on white panels {colors.surface}. In the dark theme the page is {colors.neutral-dark} and panels are
  {colors.surface-dark}.
- **Ink** {colors.on-surface} carries titles and body text. Secondary text is {colors.on-surface-variant}, tuned to keep
  4.5:1 on the grey field fill, on a panel and on the page. {colors.icon-muted} is for icons and disabled states only,
  never for text.
- **Hairlines** {colors.outline} separate rows inside a panel. Controls sit on the grey fill {colors.fill}, which deepens to
  {colors.fill-strong} on hover. In code both fills are translucent grey (12% and 20%), so they read the same on a
  panel, on the page and in the dark theme; the token values are their result on a white panel.
- **Links** use {colors.link} ({colors.link-dark} in dark). The focus ring uses the same blue.
- **Names you:** a chat message or a comment that names the reader sits on {colors.mention} with a 3 px {colors.mention-bar} bar on its start side ({colors.mention-dark} and {colors.mention-bar-dark} in dark). Only the reader sees it. No motion, no red.
- **State words:** "past due" and "at risk" use the attention orange {colors.attention} on {colors.attention-container}.
  "Late" and errors use {colors.error} on {colors.error-container}. Done uses {colors.success}. Red appears for Late and
  for errors only; a date that slipped is a fact to handle, not an alarm.
- **Status signs** colour only a small shape, never the word or a pill: on track {colors.status-on-track}, at risk
  {colors.status-at-risk}, late {colors.status-late}. Paused, waiting for the client, stale, completed and archived use
  the secondary ink.
- **The glow:** three soft lights, {colors.glow-blue}, {colors.glow-lilac} and {colors.glow-mint}. They drift slowly behind
  the "Next for you" card on Home, and they fill the Madar mark tile. Nowhere else.
- **Project hues:** eight soft tile colours (blue, orange, green, purple, pink, teal, amber, indigo), each with its own
  darker ink, for example {colors.project-blue} with {colors.on-project-blue}. A stable hash of the project id picks the
  hue, so a project keeps its colour everywhere. The hue identifies a project; it never means good or bad.
- **Unread badge:** {colors.badge} with {colors.on-badge}, on the Inbox and the bell only. On a phone it shows on the Inbox tab
  and on the two Inbox segments (the Chats segment counts unread chats, the Notifications segment counts bell items). The chat row
  keeps the `signature` count.

## Typography

One family per script, a short scale, and weight instead of size for emphasis.

- **Family:** Thmanyah Sans (font.thmanyah.com, free, the owner's choice of 2026-10-05) for Latin and Arabic, in the
  weights 400, 500 and 700. Inter Variable and IBM Plex Sans Arabic stay in the stack as the fallback. The middle dot
  "·" comes from Inter, because the Thmanyah dot reads like an Arabic zero.
- **Weights:** Bold (700) for titles and headings only. Medium (500) for the emphasis inside a row, a label, a button or
  a tab. Regular (400) for body text and secondary lines. The font has no 600, so `font-semibold` renders Medium. Arabic text renders one step larger: every size is multiplied by 1.08 when the page language
  is Arabic.
- **The font files** stay as Thmanyah ships them (OTF). The licence forbids any change, so never convert them to woff2,
  subset them or rename the family inside them. They load only through the built bundle, never from `public/`.
- **Scale (phone sizes):** page title 30/700, section title 18/700, titles 28, 22 and 20, headline 17/700, body 17/400,
  subheadline 15, footnote 13, caption 12. From 1024 px wide the scale steps down (body 15), because a desk screen sits
  closer to the eye and holds more.
- **Numbers** use tabular figures ({typography.number}) wherever digits line up: counts, dates in columns, money, timers.
  Thmanyah Sans has no tabular figures, so these spots (the `.tabular` class) take only the digits 0 to 9 from Inter.
  Both languages use Western digits (0 to 9) and the Gregorian calendar
  (`ar-SA-u-ca-gregory-nu-latn`, `en-GB-u-ca-gregory-nu-latn`).
- **Labels** of fields are 13/500 in secondary ink ({typography.label-md}). Nothing on screen is smaller than 12 px.
- **Titles** get slight negative tracking; body text keeps the default. Use at most two weights in one block of text.

## Layout

A calm single column on a phone, a centred column with side panels on a desk, and generous space between groups.

- **Width:** content centres at a maximum of {spacing.page-max}. The side gutter is {spacing.gutter-phone} on a phone and
  {spacing.gutter-desktop} from 640 px.
- **Spacing:** a 4 px base ({spacing.base}); groups separate with {spacing.lg} to {spacing.xl}; a panel has
  {spacing.panel} of padding. Lay out sibling groups with flex or grid gaps, not with margins on each element.
- **The shell:** no sidebar. From 640 px a floating tab pill holds Home, Projects, Tasks, Dashboard and Inbox, plus Search and the
  bell, at the top centre. The Madar mark sits at the top start of every screen and opens Home; the person's picture sits at the top
  end and opens the person menu (Away, mode and language as quick choices, then Settings, Admin and the other places, then sign out alone). The picture and the person menu exist from 640 px only.
  On a phone the bar sits at the bottom centre with four tabs that show only their icon: Today, Inbox, Work and Me. The bar
  is 60 px high, and it hides in an open chat, with the keyboard open and in Focus mode. The top row of a phone holds the Madar
  mark (or the back link of its screen) and one Search icon, and nothing else: no bell and no person picture. The Me tab holds
  Profile, Away, Language, Theme, the Notifications rows, the Office rows, What's new, the feedback sheet and Sign out.
- **Home** reads in this order: a greeting with the date, the "Next for you" card (the single next step), Today, then Your
  projects. Never add a fourth kind of block above "Next for you". On a phone Home is one column of five blocks with a 16 px
  gap (the title, "Next for you", Today, Meetings and the push ask line) and has no Your projects block.
- **Touch targets** are at least {spacing.touch-target}.
- **Direction:** every rule uses logical sides (start and end). Never write left or right in styles; a build check refuses
  them.

## Elevation & Depth

Depth comes from white panels on a grey page, not from layers of shadow.

- **Panels:** white with a soft two-part shadow in light (`0 1px 2px` at 4%, `0 6px 20px` at 5%). In dark there is no
  shadow, only a 1 px edge in {colors.outline-dark}.
- **Floating layers** (sheets, popovers, menus, toasts): a solid panel with a deeper shadow. No blur, no glass.
- **The tab pill** is the only translucent surface: the panel colour at 92% with a 16 px blur. With "reduce transparency"
  or "increase contrast" it becomes solid.
- **A modal sheet** scales the page behind it to 97% and dims it with a scrim, so the open task is the one thing in focus.
- **The main button** lifts 1 px on hover with a navy-tinted shadow. Other buttons darken their fill instead.

## Shapes

Soft, consistent corners that grow with the size of the surface.

- Controls such as small chips: {rounded.control}. Fields, dropdowns and text areas: {rounded.field}. Panels and cards:
  {rounded.card}. Sheets: {rounded.sheet}. Buttons, the tab pill, badges and avatars: {rounded.full}.
- **The Madar mark** ("Turning doors"): the quarter-disc "door" form of the project pictures in four turns, as a pinwheel,
  on a glow tile with 30% corners. It appears in the sign-in frame, at the top start of the app, as the app icon and in
  the email header. Never inside a project list, so nobody reads it as a project.
- **Project pictures** ("glow forms"): a tile with the project's light, a second light, and one ink drawing symbol (arch,
  door swing, wedge, dome, stair, slab, column, each in turns). Each project stores a unique mark. No letters.
- **Status signs** are small shapes, so the meaning never rests on colour alone: a full circle (on track), a half circle
  (at risk), a triangle (late), two bars (paused), an hourglass (waiting for the client), a dashed ring (stale), a check in
  a ring (completed), a square (archived).
- **Stage steps:** one short bar for each design stage. Finished stages are soft, the current stage is full with a soft
  glow, future stages are grey. The line takes the status colour, not the project hue.

## Components

Every component exists to make the next step obvious. All live in `src/components/` and `src/app/`.

- **Buttons** ({components.button-primary}): pills, 44 px high, 15/600 labels. `primary` is the signature and appears once
  per screen at most. `secondary` sits on the grey fill, `plain` is a link-coloured text button, `destructive` keeps the
  grey fill with red text and turns pale red on hover. Press feedback scales to 97% on pointer down.
- **Fields** ({components.field}): one look for every input, dropdown and text area: 44 px, the grey fill, 12 px corners,
  14 px side padding, a 2 px blue focus ring. A read-only field drops the fill and shows a thin frame, with a hint that
  says why it cannot change. An invalid field gets a red edge and one sentence below it.
- **Dates** (stage dates, task dates, and the dates in forms): a quiet button, not a full field. Empty: "Set date…" in
  secondary ink. Set: the short date and a small clear mark (none on a date that the form always needs). The quiet button
  has the box of a field without the fill, at most 12rem wide, so its text lines up with the text of the fields around it.
  A press opens the date picker of the browser; the keyboard gets the full field to type in. A date that saves itself
  saves the pick at once; a date in a form waits for the Save button. Two dates of one pair sit in two equal columns. The
  stage dates line up in Start and End columns with the column names once at the top. The quick log of the Tracker keeps
  the full field: its date is never empty and has no label.
- **Panels** ({components.panel}): the white card for every group of content. Rows inside a panel separate with hairlines.
- **Sheets** ({components.sheet}): a bottom sheet on a phone and a side or centred sheet on a desk; one title, one main
  action.
- **The tab pill** ({components.tab-pill}): the open tab carries the signature fill ({components.tab-active}) and glides
  between tabs. The phone bar has four tabs, each 48 px high with a 24 px icon in its middle and no visible word (owner, 2026-10-22; screen
  readers still read the word); the open tab is a round pill, and the bar keeps the 16 px edge of the page (owner, 2026-10-20 and 2026-10-22). The Inbox count (chats plus
  bell items) sits on the corner of its icon. A press on the open tab scrolls the page to the top.
- **Work header on a phone:** the title, the main button of the view, then the switch with the View toggle. The navy is only on the
  main button. The View toggle is a round 44 px button with `aria-pressed`: it has `bg-fill-strong` and a 1 px ink ring when Board is
  on, and the kanban icon in both states. The Board dots are 44 px buttons with an 8 px dot: the open one is `bg-ink`, the rest
  `bg-fill-strong`, and the open dot slides. A held row or card lifts with `scale(1.02)`, and with no scale under reduced motion. The
  meeting card has a sign plus an ink word for Now, Done and Cancelled, and Join is not navy.
- **Home on a phone:** the bell before the ask line is `text-ink-2`, not coloured. The Join button is secondary (`bg-fill text-ink`,
  never navy). The row chevron is `text-ink-2` and mirrors in Arabic. Home keeps one navy button, the main button of "Next for you".
- **Project page on a phone:** five equal tabs in a sticky solid row, with no side scroll, one navy button for each tab, and panels
  instead of cards. The More rows are plain link rows with a chevron and no icon tiles. The sub-page slides in from the end side, and
  reduced motion removes the slide. The stage list, the health form and the More actions are bottom sheets.
- **Task panel on a phone:** the grouped rows are `rounded-2xl bg-fill` with hairline dividers and a title in `text-caption` capitals.
  A row is at least 48 px high. The pill switch has a 44 px grey track with a `bg-card` thumb that slides. The next step slot is the
  only navy in the panel: a 52 px button, and the slot changes with `fade`. In the Conversation view the button is secondary, so Send
  is the one navy button. Timing opens in place. The X, the grip and Remove are 44 px, and the tick area of a checklist item is the
  whole row. The docked comment box has a hairline above it and sits at the bottom of the sheet.
- **Chat page on a phone:** the header is 56 px. Send is the one navy item. "Not sent" stays `text-late`. Leave group, Delete and
  Remove keep the destructive look. The rows of the options sheet are 56 px, in ink, with an icon in ink.
- **Me rows:** a row is at least 56 px high, its icon is plain `text-ink-2` at 20 px with no coloured tile behind it, and a state is a
  word in ink (New, Connected, Off), never a dot. A switch is never shown disabled.
- **"Next for you"** ({components.next-for-you}): the one card with the glow. It names one task and one action.
- **Filter button:** one button with a count opens a sheet or a popover. Never a row of filter chips. The one exception is the four
  kind chips of the phone Inbox: the open chip is a white card and never navy.
- **Status sign:** the shape plus an ink word, for example "At risk". "On track" never shows in lists; a sign shows only
  when something needs attention.
- **Notes** ({components.attention-note}, {components.late-note}): a soft tinted line for "3 days past due" or "Late".
- **Avatars:** the person's profile picture when there is one (a 128 px square that the browser makes, Settings), else a
  "Glow" picture: two soft lights in one colour with ink letters (two Arabic letters, apart, for an Arabic name); no stacks
  of faces in lists. Where a short stack of people stays (project row, to-do row), the leader first has a 2 px ring in the ink colour
  with a 2 px surface gap inside it (never navy, never red), so one meaning has one look.
- **Toasts:** solid, short, with Undo when the action can be undone. Ctrl or Cmd + Z runs the newest Undo.
- **Empty states:** one sentence that says what will appear here and, at most, one action.

## Motion

| Moment | Value | Where in code |
|---|---|---|
| Press feedback | 100 ms, scale to 97% | `.pressable` |
| Standard spring | 350 ms, no bounce | `spring.standard` in `src/design/motion.ts` |
| Expand spring | 450 ms, no bounce | `spring.expand` |
| Flick and drop | 350 to 400 ms, bounce 0.15 | `spring.flick`, `spring.drop` |
| Fade | 200 ms, ease-out | `fade` |
| Screen entrance | 520 ms, then 60 ms between panels | `.screen-enter` |
| Page steps back | 520 ms to 97% | `.app-page` |
| Curve of entrances | `cubic-bezier(0.2, 0.9, 0.25, 1)` | `tokens.css` |
| Glow drift | 8 s loop, transform only | `.glow` |

Motion explains where a thing came from; it never decorates. Springs have no bounce for layout (`bounce: 0`), and a small
bounce (0.15) only for a flick or a drop.

- The eight moments: a project row grows into its header; a tick squeezes; the next item hands over; numbers count up;
  panels step back behind a sheet; lists glide; the Arabic page turns when the language changes; Undo slides back.
- A screen enters once per visit: its first panels rise 10 px and fade in, 60 ms apart. A change of tab slides the new
  screen in from the side of that tab.
- With "reduce motion", every movement becomes a fade or nothing, and the glow stops drifting.

## Iconography

Lucide icons in the animated versions from lucide-animated.com, through `AnimatedIcon`. Each icon rests at its first frame
and plays once on hover or on its moment. Icons are 18 to 24 px, in ink or secondary ink, with 2 px strokes. An icon never
stands alone without a label or an accessible name.

## Writing

- Gentle words for dates: "3 days past due", "Due today", "In 4 days", never a red "Overdue".
- Sentence case for every title and button. A button names its result: "Send the invitation again", not "Submit".
- English and Arabic keys for every word. An Arabic verb after a person's name agrees with the person (a feminine form
  for a woman).
- No em-dash in any visible word.

## Accessibility

- Text keeps 4.5:1 against its background in both themes; chart marks and lines keep 3:1. `tokens.test.ts` checks the
  pairs.
- "Increase contrast" strengthens every hairline and edge; "reduce transparency" makes the pill solid; "reduce motion"
  removes movement.
- Every control is reachable by keyboard, with the visible blue focus ring.
- Meaning never rests on colour alone: a shape, a word or a pattern carries it too (overlapping stages use a hatch).
  Each person can turn the hatch off with the small switch beside its legend; the words about the overlap stay.

## Do's and Don'ts

- **Do** give each screen one title and at most one signature button. If two actions feel equal, one of them is secondary.
- **Do** put the single next step first, and let everything else wait below it.
- **Do** keep the signature navy for its four places. Its scarcity is what makes it mean "this one".
- **Do** let panels breathe: white space is part of the calm, not unused room.
- **Do** design the Arabic screen at the same time as the English one, with logical sides only.
- **Don't** use gradients on buttons, and never a blue-to-violet gradient anywhere. The owner reads it as generic AI style.
- **Don't** bring back glass panels, cover images in lists, grid views of projects or rows of filter chips (the four kind chips of the
  phone Inbox are the one exception).
- **Don't** use red for anything except Late and errors.
- **Don't** show "On track" in a list, or a status word when nothing needs attention.
- **Don't** add a badge, a pulse or a moving element to get attention. One unread count on the Inbox and the bell (on a phone, the Inbox tab and its two segments) is
  enough.
- **Don't** stack avatars or show more than one picture style in one list.
- **Don't** put the Madar mark inside a project list, or a project picture in the app frame.
- **Don't** add a font file or a new font family. The stack stays Thmanyah Sans, then Inter and IBM Plex Sans Arabic. The digits and the middle dot come from a small subset of the same Inter file (`src/design/inter/`).
