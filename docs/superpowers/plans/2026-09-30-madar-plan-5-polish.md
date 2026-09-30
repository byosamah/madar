# Madar Plan 5 of 5: Polish and team review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the prototype for the team review: the card-to-project motion, bars that go compact on scroll, the last screen fixes, an Arabic text pass, a full sweep of every screen in both languages, both themes and three widths with the system settings for motion, transparency and contrast, a keyboard pass through the three acceptance flows, and a review guide for the office team.

**Architecture:** No new data. Motion uses the Motion library's shared layout (`layoutId`) for the cover, so the card grows into the project header and shrinks back. A small pure function decides when the bars go compact. Everything else is tests, text and a published guide.

**Tech Stack:** as plan 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-madar-prototype-design.md` (sections 1.2, 3.2, 4.1, 10.6, 10.8, 10.9, 13 and 14).

**Base:** branch `plan-5-polish`, cut from `plan-4-dashboard` after its review fixes. The owner approved this plan in advance (2026-09-30).

## Global Constraints

- Every rule in the Global Constraints of plans 1 to 4 still applies.
- Motion animates only `transform` and `opacity`, and "Reduce motion" turns it into short fades (`MotionConfig reducedMotion="user"` is already on the app root).
- The Arabic text stays a draft for the native-speaker review (spec 15). This plan fixes clear mistakes and lists doubtful strings; it does not replace the human review.
- The team review itself is the owner's step (spec 1.2, "Team sign-off"). This plan prepares it and does not claim it.

**Clarifications of the spec made in this plan.** Tell the owner about these at handoff.

1. Only the cover image makes the shared-element move between the card and the project screen. The rest of the screen fades in.
2. "The toolbar and tab bar shrink" (spec 3.2): the tab bar hides its labels and shrinks a little; the toolbar lifts a little and hides its shadow line. Both come back as soon as the content moves up. Neither disappears.
3. A stage whose tasks are all done says "All tasks in this stage are done." instead of "No tasks here yet."

## Review Focus

1. **Reduce motion on.** Expected: no card growth and no bar shrink movement, only fades. Test: Task 5 (sweep with `reducedMotion: 'reduce'`).
2. **Back from a project.** Expected: the cover shrinks back into its card, and the grid keeps its scroll place. Test: Task 1 (browser check).
3. **Arabic strings with English words.** Expected: only real names (Revit, KH, Escape) and placeholders stay in Latin letters. Test: Task 4.
4. **The three acceptance flows with the keyboard only.** Expected: each passes within its click budget (spec 1.2). Test: Task 5.
5. **High contrast and reduced transparency.** Expected: glass turns solid with borders, text stays readable. Test: Task 5 (screenshots and axe with those settings).

---

### Task 1: The card grows into the project screen

**Files:**
- Modify: `src/features/projects/ProjectCard.tsx`, `src/features/project/ProjectHeader.tsx`
- Test: `src/features/projects/ProjectCard.test.tsx`, `tests/e2e/polish.spec.ts` (created here, run in Task 5)

**Interfaces:**
- Consumes: `spring.expand` (plan 1), Motion `layoutId`.
- Produces: `ProjectCover({ summary, className?, layoutId? })`; the card and the header use `layoutId="cover-<project id>"` and mark the wrapper with `data-layout-id`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/projects/ProjectCard.test.tsx`, inside its `describe`:

```tsx
  it('shares its cover with the project header, so the card can grow into the screen', async () => {
    await renderWithRuntime(<Card id="prj_005" />, undefined, { path: '/' });
    const cover = await screen.findByRole('img', { name: 'Cover image of Tamr Boutique Hotel' });
    expect(cover.closest('[data-layout-id]')).toHaveAttribute('data-layout-id', 'cover-prj_005');
  });
```

Create `tests/e2e/polish.spec.ts` with its first test:

```ts
import { expect, test } from '@playwright/test';

test('the card cover grows into the project header and shrinks back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  const card = page.getByRole('article').first();
  await expect(card).toBeVisible();
  const cardBox = await card.locator('[data-layout-id]').boundingBox();
  await card.getByRole('link').click();
  const header = page.locator('header [data-layout-id]');
  await expect(header).toBeVisible();
  const early = await header.boundingBox();
  await page.waitForTimeout(700);
  const settled = await header.boundingBox();
  expect(cardBox && early && settled).toBeTruthy();
  // Mid-move, the cover is still smaller than its settled size: it grew out of the card.
  expect(early!.width).toBeLessThan(settled!.width);
  await page.goBack();
  await expect(page.getByRole('article').first()).toBeVisible();
});
```

- [ ] **Step 2: Run the unit test to watch it fail**

Run: `npx vitest run src/features/projects/ProjectCard.test.tsx`
Expected: FAIL: the cover has no `data-layout-id`.

- [ ] **Step 3: Share the cover**

In `src/features/projects/ProjectCard.tsx`, add `import { motion } from 'motion/react';` and `import { spring } from '../../design/motion';`, and replace `ProjectCover` with:

```tsx
/**
 * The latest render at 16:9, or a tinted panel with the project code when there is no cover (spec 4.1).
 * With a layoutId, the card and the project header share the cover, so the card grows into the screen and shrinks back (spec 10.6).
 */
export function ProjectCover({ summary, className = 'aspect-video', layoutId }: { summary: ProjectSummary; className?: string; layoutId?: string }) {
  const { t } = useTranslation();
  const url = useFileUrl(summary.project.coverFileId);
  const label = t('projects.cover', { name: summary.project.name });
  const inner = url
    ? <img src={url} alt={label} className={`w-full object-cover ${className}`} />
    : (
      <div role="img" aria-label={label} style={{ background: tintOf(summary.project.id) }} className={`grid w-full place-items-center ${className}`}>
        <span className="tabular text-title-2 font-bold text-white">{summary.project.code}</span>
      </div>
    );
  if (!layoutId) return inner;
  return (
    <motion.div layoutId={layoutId} data-layout-id={layoutId} transition={spring.expand} className="overflow-hidden">
      {inner}
    </motion.div>
  );
}
```

In `ProjectCard`, change `<ProjectCover summary={summary} />` to `<ProjectCover summary={summary} layoutId={`cover-${project.id}`} />`.

In `src/features/project/ProjectHeader.tsx`, add `layoutId={`cover-${project.id}`}` to its `ProjectCover`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS. (The browser test runs in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src tests/e2e/polish.spec.ts
git commit -m "feat: let the card cover grow into the project header and back" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 2: Bars go compact on scroll

**Files:**
- Create: `src/lib/scroll.ts`, `src/app/useCompactBars.ts`
- Modify: `src/app/TabBar.tsx`, `src/app/Toolbar.tsx`
- Test: `src/lib/scroll.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `nextCompact(compact, previousY, y): boolean`; `useCompactBars(): boolean`; the tab bar and the toolbar carry `data-compact` when compact.

- [ ] **Step 1: Write the failing test**

`src/lib/scroll.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nextCompact } from './scroll';

describe('compact bars', () => {
  it('goes compact when the content moves down past 64 px, and back when it moves up', () => {
    expect(nextCompact(false, 0, 40)).toBe(false);
    expect(nextCompact(false, 80, 120)).toBe(true);
    expect(nextCompact(true, 300, 250)).toBe(false);
    expect(nextCompact(true, 300, 302)).toBe(true);
    expect(nextCompact(true, 300, 20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/lib/scroll.test.ts`
Expected: FAIL: `./scroll` does not exist.

- [ ] **Step 3: Write the rule and the bars**

`src/lib/scroll.ts`:

```ts
/** Bars go compact once the content moves down past 64 px, and come back as soon as it moves up (spec 3.2). Small moves change nothing. */
export function nextCompact(compact: boolean, previousY: number, y: number): boolean {
  if (y <= 64) return false;
  if (y > previousY + 4) return true;
  if (y < previousY - 4) return false;
  return compact;
}
```

`src/app/useCompactBars.ts`:

```ts
import { useEffect, useState } from 'react';
import { nextCompact } from '../lib/scroll';

/** True while the page scrolls down. One reading per frame. */
export function useCompactBars(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let previous = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setCompact((current) => nextCompact(current, previous, y));
        previous = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return compact;
}
```

In `src/app/TabBar.tsx`, import `useCompactBars` from `./useCompactBars`, read `const compact = useCompactBars();`, add `data-compact={compact || undefined}` to the `nav`, append ` origin-bottom transition-transform duration-300 ${compact ? 'scale-[0.92] translate-y-1' : ''}` to its class, and change the label span class to `` `whitespace-nowrap text-caption font-medium transition-opacity duration-200 ${compact ? 'opacity-0' : ''}` ``.

In `src/app/Toolbar.tsx`, import `useCompactBars`, read `const compact = useCompactBars();`, add `data-compact={compact || undefined}` to the `header`, and append ` transition-transform duration-300 ${compact ? '-translate-y-1' : ''}` to its class.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: make the tab bar and toolbar compact while the page scrolls down" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 3: Done stages say so

**Files:**
- Modify: `src/features/project/tasks/TaskList.tsx`, `src/features/project/tasks/TasksTab.tsx`, `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/features/project/tasks/TasksTab.test.tsx`

**Interfaces:**
- Consumes: `tasks.list`.
- Produces: `TaskList({ detail, rows, filtered, onOpen, doneCounts })` with `doneCounts: Record<stageId, number>`; the text key `tasks.allDone`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/project/tasks/TasksTab.test.tsx`, inside its `describe`:

```tsx
  it('says so when every task of a stage is done', async () => {
    await renderApp(TASKS);
    expect(await within(await screen.findByRole('region', { name: 'Schematic Design' })).findByText('All tasks in this stage are done.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Concept' })).getByText('No tasks here yet.')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/tasks/TasksTab.test.tsx`
Expected: FAIL: the Schematic Design group says "No tasks here yet."

- [ ] **Step 3: Count the hidden done tasks**

Add the key `"allDone": "All tasks in this stage are done."` to `tasks` in `src/i18n/en.json`, and `"allDone": "أُنجزت كل مهام هذه المرحلة."` to `tasks` in `src/i18n/ar.json`.

In `src/features/project/tasks/TaskList.tsx`, add `doneCounts: Record<string, number>` to the props, and replace the empty line with:

```tsx
          {stageRows.length === 0 && (
            <p className="px-4 pb-2 text-footnote text-label-2">{(doneCounts[stage.id] ?? 0) > 0 ? t('tasks.allDone') : t('tasks.empty')}</p>
          )}
```

In `src/features/project/tasks/TasksTab.tsx`, compute before the return:

```tsx
  const doneCounts: Record<string, number> = {};
  for (const row of rows) if (row.task.status === 'done') doneCounts[row.task.stageId] = (doneCounts[row.task.stageId] ?? 0) + 1;
```

and pass `doneCounts={showDone ? {} : doneCounts}` to `TaskList`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "fix: say when every task of a stage is done" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 4: Arabic text pass

**Files:**
- Modify: `src/i18n/ar.json`
- Test: `src/i18n/arabic.test.ts`

**Interfaces:**
- Consumes: `src/i18n/ar.json`.
- Produces: a guard test for Latin letters in Arabic text, fixed Arabic strings, and a list of doubtful strings for the native-speaker review in the ledger.

- [ ] **Step 1: Write the failing test**

`src/i18n/arabic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import ar from './ar.json';

/** Real names that stay in Latin letters in Arabic text. */
const ALLOWED = ['Revit', 'KH', 'Escape', 'English'];

function values(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => values(child, path ? `${path}.${key}` : key));
}

describe('Arabic text', () => {
  it('uses Arabic script, except placeholders and real names', () => {
    const latin = values(ar).filter(([, text]) => {
      let rest = text.replace(/\{\{[^}]+\}\}/g, '');
      for (const word of ALLOWED) rest = rest.split(word).join('');
      return /[A-Za-z]/.test(rest);
    });
    expect(latin).toEqual([]);
  });

  it('never uses the plain ar-SA calendar words for dates', () => {
    const hijri = values(ar).filter(([, text]) => /هـ|هجري/.test(text));
    expect(hijri).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to watch it fail, or pass**

Run: `npx vitest run src/i18n/arabic.test.ts`
Expected: FAIL if any Arabic value still holds English words; PASS otherwise. When it passes at once, write a ledger line saying so: the guard stays for future text.

- [ ] **Step 3: Read and fix the Arabic text**

Read all of `src/i18n/ar.json`. Fix: English words left in Arabic values, one term for one meaning (for example "المهمة" for task everywhere, "المرحلة" for stage, "القائد" for leader, "مدير النظام" for Admin), missing hamza and taa marbuta mistakes, and verbs that do not agree with their subject. Keep Western digits. Write each doubtful string (a phrase that works but may read stiff to an office reader) into the ledger as `Task 4: Arabic doubt: <key>: <text>: <why>`, for the native-speaker review.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src`
Expected: PASS, the language check from plan 1 included.

- [ ] **Step 5: Commit**

```bash
git add src/i18n
git commit -m "fix: correct the Arabic interface text and guard it against English words" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 5: The full sweep and the acceptance flows

**Files:**
- Create: `tests/e2e/full.spec.ts`, `tests/e2e/acceptance.spec.ts`
- Modify: `tests/e2e/polish.spec.ts`

**Interfaces:**
- Consumes: the whole app.
- Produces: screenshots of every screen in English and Arabic, light and dark, at 390, 820 and 1440 px; axe checks with "Reduce transparency" and "Increase contrast"; a reduce-motion check; the three acceptance flows with the keyboard only.

- [ ] **Step 1: Write the sweeps**

`tests/e2e/full.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = [
  '/', '/projects/prj_001', '/projects/prj_001?tab=tasks', '/projects/prj_001?tab=schedule', '/projects/prj_001?tab=files',
  '/projects/prj_001?tab=team', '/work', '/work?tab=hours', '/dashboard', '/tasks?filter=overdue', '/inbox', '/search', '/settings',
];

async function useArabic(page: Page): Promise<void> {
  await page.goto('/#/settings');
  await page.getByRole('radio', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

async function sweep(page: Page, folder: string): Promise<void> {
  for (const route of ROUTES) {
    await page.goto(`/#${route}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400);
    const name = route === '/' ? 'projects' : route.slice(1).replace(/[/?=&]/g, '-');
    await page.screenshot({ path: `test-results/full/${folder}/${name}.png`, fullPage: true });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect.soft(serious.map((v) => `${route}: ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
}

for (const width of [390, 820, 1440]) {
  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`every screen at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        test.setTimeout(240_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        if (lang === 'ar') await useArabic(page);
        await sweep(page, `${width}-${lang}-${theme}`);
      });
    }
  }
}

test('every screen with reduced transparency and more contrast', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes('prefers-reduced-transparency')
      ? ({ ...original(query), matches: true, media: query } as MediaQueryList)
      : original(query));
  });
  await sweep(page, 'high-contrast');
  await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
});

test('reduce motion stops the card from growing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await page.getByRole('article').first().getByRole('link').click();
  const header = page.locator('header [data-layout-id]');
  await expect(header).toBeVisible();
  const early = await header.boundingBox();
  await page.waitForTimeout(700);
  const settled = await header.boundingBox();
  expect(Math.round(early!.width)).toBe(Math.round(settled!.width));
});
```

`tests/e2e/acceptance.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

/** Presses Tab until the focused element matches, like a keyboard-only person. */
async function tabTo(page: Page, matches: (text: string, role: string | null) => boolean, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { text: (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim(), role: el?.getAttribute('role') ?? el?.tagName.toLowerCase() ?? null };
    });
    if (matches(found.text, found.role)) return;
  }
  throw new Error('The keyboard did not reach the control.');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('Admin overview: the at-risk and late projects in one step from the first screen', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByRole('article').first()).toBeVisible();
  await tabTo(page, (text, role) => role === 'radio' && text === 'At risk');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article')).toHaveCount(5);
});

test("Member daily work: today's tasks with one step from any screen", async ({ page }) => {
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await tabTo(page, (text) => text === 'My Work');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible();
  await expect(page.getByRole('region').first()).toBeVisible();
});

test('Leader review: approve from the Inbox with two steps', async ({ page }) => {
  // Setup: Sara sends a task to review, which puts a review notice in Faisal's Inbox.
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label: 'Sara Al-Qahtani · Member' });
  await page.goto('/#/projects/prj_001?tab=tasks');
  await page.getByRole('checkbox', { name: 'Complete Civil Defense drawings' }).click();
  await expect(page.getByText('Sent to review. The leader checks it next.')).toBeVisible();
  await page.goto('/#/settings');
  await page.getByRole('combobox', { name: /Preview as/ }).first().selectOption({ label: 'Faisal Al-Harbi · Leader' });
  // The two steps: reach Approve, press Enter.
  await page.goto('/#/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  const before = await page.getByRole('button', { name: 'Approve' }).count();
  expect(before).toBeGreaterThan(0);
  await tabTo(page, (text) => text === 'Approve');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(before - 1);
});
```

- [ ] **Step 2: Run the sweeps in a subagent**

Delegate to one subagent: `npx playwright test tests/e2e --reporter=line`, twice at the end. Test-side fixes only, listed; every app defect with its assertion or axe rule and target; the paths of eight screenshots: 390 Arabic dark projects, 820 English light dashboard, 1440 Arabic light project schedule, 1440 English dark hours, 390 English light inbox, and three from `high-contrast`.
Expected: all pass. Fix each app defect in the main session, with a failing unit test first when a unit test can show it.

- [ ] **Step 3: Look at the screens**

Read the eight screenshots. Check dark mode surfaces, Arabic mirroring, phone layouts and the high-contrast borders. Fix what the eye finds, with a ledger ruling and a screenshot as proof for layout-only fixes.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e src
git commit -m "test: add the full sweep and the keyboard acceptance flows" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 6: The team review guide and the final link

**Files:**
- Create: the review guide page in the session scratchpad (`madar-guide/index.html`), published as a private artifact
- Modify: the review wrapper and the progress page status

**Interfaces:**
- Consumes: the finished prototype.
- Produces: the final review link, a review guide for the office team, and the progress page at "ready for team review".

- [ ] **Step 1: Write the guide**

Write a one-page guide (HTML artifact, English with the key steps also in Arabic) for the office team: what Madar is, the link, how "Preview as" switches between the Admin, a leader, a member and the agent, the three acceptance flows to try with their pass conditions (spec 1.2), five more things to try (create a project, tick a task and undo it, log hours, comment with a mention, switch to Arabic and dark mode), what to report and how, and the known limits (sample data only, data stays in each browser, downloads do not work inside the review link, Arabic text is a draft, glass may stutter on weak Windows graphics).

- [ ] **Step 2: Publish the final build, the guide and the progress page**

Build, publish the review wrapper with the new asset names to the same path, publish the guide as a new private artifact, and update the progress page (all five build steps done, next: team review by the owner).

- [ ] **Step 3: Commit**

```bash
git add TASKS.md
git commit -m "chore: mark plan 5 done" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```
