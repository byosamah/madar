# Skeptic verdicts for the render audit (RN-1 to RN-17), commit 1d45aae5

Method: I re-read the cited code in deploy-test. I made my own copy (scratchpad/copies/render-skeptic) and re-ran the auditor's
jsdom tests on the baseline code. All render counts reproduce exactly: Inbox 167 rows / 4,444 nodes; chat 203 li / 3,741 nodes;
new message at 200 messages renders 200 bubbles (why: prop "bubble" changed on 199); Projects 122 rows / 122 tiles / 4,190 nodes;
Notices 100 rows / 1,740 nodes, one read gives 100 Age calls; Emoji 1,878 cells / 3,807 nodes.

What I found is not wrong counts. It is that the millisecond and "who feels it" claims are too high:
- jsdom milliseconds include the fake API (it runs in the test page). With 150 groups and no old messages, opening a small chat
  already takes 740 ms against 197 ms with none. So the jsdom time is not all render time. Chrome is 3 to 5 times faster.
- The stress data (150 groups, 200-message chats, 157 tasks, 122 projects, 100 notices) is a late-first-year office. The office
  went live on 2026-10-04, so today most chats hold fewer than 200 messages.
- A list reload that returns equal data does not render the parent at all (structural sharing). A row memo helps only when one row changes.

Verdicts:
- RN-1 weakened to 3. Real above about 100 messages. About 2 ms a bubble in jsdom gives about 0.5 ms in Chrome: about 100 to 190 ms
  on a laptop and 500 to 700 ms on a phone. Fix as written is not safe: content-visibility with estimated sizes breaks the New line and
  the ?at= scroll targets, and a late prepend of old bubbles needs the re-anchor of the Earlier button. Safe form: mount the newest 60
  at once and the rest in an idle pass, with the same anchor step as askEarlier.
- RN-2 weakened to 3. Counts hold. Row total is 17 to 150 now, 100 to 250 after months. The mount time in jsdom (751 vs 305 ms) includes
  the fake API for 150 groups. content-visibility adds paint containment on each li, which can clip the focus ring and the swipe reveal: not a safe fix as written.
  Safe form: staged mount (first 40 rows, then the rest at idle). Part of the cost is the hidden row menu (RN-3).
- RN-3 weakened to 2. Real and cheap to fix. It is a third of the nodes of a bubble, only on touch screens, and display:none costs no layout.
  Keep the case actions.inSheet (the menu must show in the sheet). Tests pin the classes (InboxScreen.test.tsx:531).
- RN-4 weakened to 2. Real, only when a chat holds 200 or more messages (below that a new message adds 1 bubble: measured 1 render at
  the 6-message chat). Fix is safe: bubbleOfMessage depends only on the view; the replaceEqualDeep check keeps the old bubble only when the view is equal.
- RN-5 weakened to 2. Real. But onOpen is already stable in the two screens (useStableHandler at TaskListScreen.tsx:123 and
  WorkTasks.tsx:97), so the stale closure risk is gone, and a teammate save re-renders the rows only when a visible row changes.
  A person has 20 to 50 rows, not 157. TaskRowItem reads todayISO() inside the row (line 94): a memo must pass `today` as a prop or the
  "Today" word freezes across midnight.
- RN-6 weakened to 2. Real; Home of an Admin and Projects list all live projects. About 1 ms a row in Chrome, so 40 to 120 ms. Safe fix.
- RN-7 weakened to 2. Real (list limit is 100, so it is full after a few weeks). Mount about 60 ms in Chrome. memo(InboxItem) alone
  freezes the Age text of each row: wrap the list in AgeRefresh.Provider with a new object per render, as the guide says for every memo list.
- RN-8 weakened to 2. Real (the panel builds nameOf for 1,878 items per render, a focus move renders it all). About 40 to 50 ms a
  mount in Chrome on a laptop, about 150 ms or more on a phone, at the open animation. It opens on demand only. Fix safe if the sections exist
  (heights) before they fill, so the group buttons keep scrolling.
- RN-9 weakened to 2. The size is wrong: the map files are 478 KB gzip (brotli about 397 KB), not 1.7 MB (281+144+43+10 KB gzip),
  one time, then cached for a year. The IntersectionObserver fix gives nothing: the map sits at the top of About, the first tab. The real
  waste is the new WebGL map at each About visit. Keep-alive (hide, not remove) holds a WebGL context and memory on a phone: not a safe fix as written.
- RN-10 weakened to 1. It is a true regression of the RND-8 rule, but one label (2 t calls) costs 4.8 microseconds (measured in node with i18next).
  150 faces cost 0.7 ms a full render. Fix is safe and tiny.
- RN-11 weakened to 1. Rare screen, tens of cards in a real office, and the auditor used a mocked React Flow. The memo fix is safe.
- RN-12 weakened to 1. Rare Admin screen, about 40 rows in a real office, 1 ms or less a row in Chrome.
- RN-13 weakened to 1. Inferred, compositor-only transform animations on two layers; Chrome pauses them in a hidden tab. Behavior changes, as the finding says.
- RN-14 weakened to 1. True (no near-view gate on the Files rows). Cost is 10 requests for 120 pictures, once per 8 minutes (LINK_STALE_MS),
  against 500,000 calls a month. Safe fix with useNearView.
- RN-15 weakened to 1 (negligible: one cheap render of the pill per query change).
- RN-16 weakened to 1. The Age refresh object is deliberate and written in src/CLAUDE.md. A once-a-minute tick would render 167 rows
  every minute at rest, which is more work and a behavior change. matchMedia calls (58 at mount) cost under 1 ms. Not worth changing.
- RN-17 weakened to 1. A localStorage setItem of a short string is a few microseconds. A 300 ms debounce can lose a draft when a phone
  kills the tab (pagehide does not always fire), and the guide promises the draft stays after the tab closes: not a safe fix.
