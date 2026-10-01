# Madar Redesign Step A: Calm Look, Pill, Home and Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the busy Liquid Glass look with the calm design of the redesign spec: new tokens and shared parts, a floating tab pill with a person menu, the new Home screen (Next for you, day ring, Today, Your projects), the Projects list with one filter button, a calm project header and tabs, and calm task rows with gentle due words.

**Architecture:** Redesign in place. The fake API, the rules and their tests stay. New pure helpers in `src/lib` (project color, progress value, due words, Next for you, day ring) carry the unit tests. New shared parts in `src/components` (ProjectTile, ProgressLine, StateWord, FilterButton, Panel). The shell loses the sidebar, the toolbar and the tab bar, and gets `TabPill` and `PersonMenu`. Home moves to `/`, and Projects moves to `/projects` with a redirect for old links.

**Tech Stack:** as the first build (TypeScript 7, React 19, Vite 8, React Router 8, Tailwind 4, TanStack Query 5, Motion 13, Vitest 5, Playwright 1.63). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-madar-calm-redesign-design.md` (it amends `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`).

**Base:** branch `redesign-a-calm`, cut from `main` at the end of the first build (489af23 plus the redesign spec). The owner approved this plan in advance ("go all tell me when u finish all", 2026-10-01).

## Global Constraints

- Every rule of the first build still applies: logical CSS only (`npm run check:rtl`), all text in both language files, WCAG 2.2 AA, 44 px targets, screens never decide permissions, changes with an Undo toast go through `useUndoable`, Simplified Technical English with no em-dash, commits end with the `Claude-Session` line and never carry Co-Authored-By.
- Spec 2.1: no glass panels, no blur, no background images, except the tab pill.
- Spec 2.3: color has one job. The signature gradient `#5B6CFF` to `#8B5CF6` marks only the one main button of a screen, the open pill tab and the day ring. The glow sits only behind "Next for you". Red appears only for a Late project and for errors.
- Spec 2.4: lists show no rows of filter chips; one filter button per list.
- Spec 2.2: nothing smaller than 12 px; digits tabular in number columns.
- Only `transform` and `opacity` animate.

## Review Focus

1. **A person with nothing to do.** No tasks, no review queue, hours at target. Expected: Next for you says "You are all caught up." with no button, the Today panel says so in one line, and the day ring hides. Test: Task 6.
2. **The Admin on Home.** The Admin leads no project. Expected: Your projects lists all active projects, and Next for you offers tasks waiting for review on any project. Test: Task 6.
3. **Old saved links.** `#/?filter=at_risk` and `#/?stage=Permits` from the first build. Expected: they open the Projects screen with that filter. Test: Task 4.
4. **A long project name and Arabic text in a row.** Expected: the name truncates with an ellipsis; the tile, line and deadline stay in place; Arabic rows mirror. Test: Task 5 (unit) and Task 9 (browser).
5. **Keyboard use of the pill and the filter button.** Expected: Tab reaches every pill tab, the search button and the person picture; the filter popover takes focus and Escape closes it and returns focus. Test: Task 4 and Task 5.

## File Map

| File | Responsibility |
|---|---|
| `src/design/tokens.css` | New page, panel, ink, signature, glow, attention and late colors, project hues |
| `src/lib/projectColor.ts` | Project hue from id, tile initials, progress value |
| `src/lib/due.ts` | Gentle due words |
| `src/lib/home.ts` | Next for you, day ring, greeting |
| `src/components/ProjectTile.tsx`, `ProgressLine.tsx`, `StateWord.tsx`, `FilterButton.tsx`, `Panel.tsx` | Shared calm parts |
| `src/components/Button.tsx`, `ScreenTitle.tsx`, `Tabs.tsx` | Restyled shared parts |
| `src/app/TabPill.tsx`, `PersonMenu.tsx`, `AppShell.tsx`, `nav.ts`, `routes.tsx` | The new shell and routes |
| `src/features/home/*` | Home screen |
| `src/features/projects/ProjectsScreen.tsx`, `ProjectListRow.tsx` | Projects list |
| `src/features/project/ProjectHeader.tsx`, `overview/AboutPanel.tsx` | Calm project header, cover in About |
| `src/features/project/tasks/TaskRowItem.tsx`, `TasksTab.tsx` | Calm rows, filter button |

---

### Task 1: Tokens and project colors

**Files:**
- Modify: `src/design/tokens.css`
- Create: `src/lib/projectColor.ts`
- Test: `src/lib/projectColor.test.ts`, `src/design/tokens.test.ts`

**Interfaces:**
- Produces: `HUES` (8 names), `projectHue(id: string): Hue`, `projectInitials(name: string): string`, `stageProgress(summary: { stages: { id: string }[]; currentStage: { id: string }; project: { status: string } }): number` (0 to 1); CSS variables `--c-page-top`, `--c-page-bottom`, `--c-panel`, `--c-ink`, `--c-ink-2`, `--c-attn-bg`, `--c-attn-text`, `--c-late-bg`, `--c-late-text`, `--c-done`, `--sig-from`, `--sig-to`, `--p-<hue>-bg`, `--p-<hue>-fg`; Tailwind classes `bg-panel`, `text-ink`, `text-ink-2`, `bg-attn`, `text-attn`, `bg-late`, `text-late`, utility classes `.signature`, `.glow`, `.panel`.

- [ ] **Step 1: Write the failing tests**

`src/lib/projectColor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HUES, projectHue, projectInitials, stageProgress } from './projectColor';

describe('project colors', () => {
  it('gives each project one stable hue from its id', () => {
    expect(projectHue('prj_001')).toBe(projectHue('prj_001'));
    expect(HUES).toContain(projectHue('prj_002'));
    expect(new Set(['prj_001', 'prj_002', 'prj_003', 'prj_004', 'prj_005', 'prj_006'].map(projectHue)).size).toBeGreaterThan(3);
  });

  it('takes two letters for the tile', () => {
    expect(projectInitials('Corniche Office Tower')).toBe('CO');
    expect(projectInitials('Tamr')).toBe('TA');
    expect(projectInitials('مجمع النخلة')).toBe('من');
    expect(projectInitials('  ')).toBe('?');
  });

  it('moves the progress line one step per stage, and fills it for a completed project', () => {
    const stages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(stageProgress({ stages, currentStage: { id: 'a' }, project: { status: 'active' } })).toBeCloseTo(0.25);
    expect(stageProgress({ stages, currentStage: { id: 'c' }, project: { status: 'active' } })).toBeCloseTo(0.75);
    expect(stageProgress({ stages, currentStage: { id: 'c' }, project: { status: 'completed' } })).toBe(1);
  });
});
```

Append to `src/design/tokens.test.ts`:

```ts
describe('calm palette', () => {
  it('keeps every project tile text at 4.5:1 and every line at 3:1, in light and dark', () => {
    for (const block of [':root', '[data-theme="dark"]']) {
      const panel = hex(token(block, '--c-panel'));
      for (const hue of ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'amber', 'indigo']) {
        const bg = hex(token(block, `--p-${hue}-bg`));
        const fg = hex(token(block, `--p-${hue}-fg`));
        expect(contrast(fg, bg), `${hue} tile in ${block}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, panel), `${hue} line in ${block}`).toBeGreaterThanOrEqual(3);
      }
      for (const [text, bg] of [['--c-attn-text', '--c-attn-bg'], ['--c-late-text', '--c-late-bg'], ['--c-ink-2', '--c-panel']]) {
        expect(contrast(hex(token(block, text)), hex(token(block, bg))), `${text} in ${block}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib/projectColor.test.ts src/design/tokens.test.ts`
Expected: FAIL: `./projectColor` does not exist, and `--c-panel` is missing in `:root`.

- [ ] **Step 3: Write the helper and the tokens**

`src/lib/projectColor.ts`:

```ts
export const HUES = ['blue', 'orange', 'green', 'purple', 'pink', 'teal', 'amber', 'indigo'] as const;
export type Hue = (typeof HUES)[number];

/** One soft hue per project, for life: a stable hash of its id (redesign spec 2.3). */
export function projectHue(id: string): Hue {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length];
}

/** Two letters for the project tile: the first letters of the first two words, or the first two letters of one word. */
export function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join('').toUpperCase();
}

/** The progress line (redesign spec 2.4): (current stage index + 1) / (stage count + 1); a completed project is full. */
export function stageProgress(summary: { stages: { id: string }[]; currentStage: { id: string }; project: { status: string } }): number {
  if (summary.project.status === 'completed') return 1;
  const index = Math.max(0, summary.stages.findIndex((stage) => stage.id === summary.currentStage.id));
  return (index + 1) / (summary.stages.length + 1);
}
```

In `src/design/tokens.css`, add to the bare `:root` block (light values) after `--c-chart-muted`:

```css
  --c-page-top: #F7F7F9;
  --c-page-bottom: #F1F1F4;
  --c-panel: #FFFFFF;
  --c-ink: #1D1D1F;
  --c-ink-2: #6E6E73;
  --c-hairline: #F0F0F2;
  --c-attn-bg: #FFF4E5;
  --c-attn-text: #B54708;
  --c-late-bg: #FDECEC;
  --c-late-text: #B42318;
  --c-done: #067647;
  --c-link: #0066CC;
  --sig-from: #5B6CFF;
  --sig-to: #8B5CF6;
  --sh-panel: 0 1px 2px rgba(0, 0, 0, 0.04), 0 6px 20px rgba(0, 0, 0, 0.05);
  --panel-edge: transparent;
  --glow-a: #DCEBFF;
  --glow-b: #F3E3FF;
  --glow-c: #DFF7EC;
  --p-blue-bg: #E8F0FE; --p-blue-fg: #1A56DB;
  --p-orange-bg: #FDF2E9; --p-orange-fg: #C2410C;
  --p-green-bg: #E7F6EE; --p-green-fg: #047857;
  --p-purple-bg: #F3E8FF; --p-purple-fg: #7E22CE;
  --p-pink-bg: #FCE7F3; --p-pink-fg: #BE185D;
  --p-teal-bg: #E0F5F5; --p-teal-fg: #0F766E;
  --p-amber-bg: #FEF6E1; --p-amber-fg: #A16207;
  --p-indigo-bg: #EAEBFF; --p-indigo-fg: #4338CA;
```

Set the existing radius `--r-card: 20px;` and `--sh-card: var(--sh-panel);` in the same block, and `--c-bg: #F4F4F7;`.

In the `[data-theme="dark"]` block add:

```css
  --c-page-top: #0F0F12;
  --c-page-bottom: #0B0B0D;
  --c-panel: #1A1A1E;
  --c-ink: #F5F5F7;
  --c-ink-2: #A1A1A6;
  --c-hairline: #26262B;
  --c-attn-bg: #3A2A12;
  --c-attn-text: #FFB65C;
  --c-late-bg: #3B1D1B;
  --c-late-text: #FF8A80;
  --c-done: #4ADE80;
  --c-link: #4DA3FF;
  --sh-panel: none;
  --panel-edge: #26262B;
  --glow-a: rgba(220, 235, 255, 0.18);
  --glow-b: rgba(243, 227, 255, 0.18);
  --glow-c: rgba(223, 247, 236, 0.18);
  --p-blue-bg: #1B2A44; --p-blue-fg: #7EA8FF;
  --p-orange-bg: #3A2618; --p-orange-fg: #FF9E6B;
  --p-green-bg: #14301F; --p-green-fg: #5FD3A0;
  --p-purple-bg: #2C1D44; --p-purple-fg: #C29BFF;
  --p-pink-bg: #3A1A2B; --p-pink-fg: #FF8CC6;
  --p-teal-bg: #123236; --p-teal-fg: #5ED6CB;
  --p-amber-bg: #3A2E12; --p-amber-fg: #F5C451;
  --p-indigo-bg: #20234A; --p-indigo-fg: #A5ABFF;
  --c-bg: #0D0D10;
  --c-card: #1A1A1E;
```

In `@theme inline` add:

```css
  --color-panel: var(--c-panel);
  --color-ink: var(--c-ink);
  --color-ink-2: var(--c-ink-2);
  --color-hairline: var(--c-hairline);
  --color-attn: var(--c-attn-text);
  --color-attn-bg: var(--c-attn-bg);
  --color-late: var(--c-late-text);
  --color-late-bg: var(--c-late-bg);
  --color-done: var(--c-done);
  --color-link: var(--c-link);
```

In `@layer base`, change the `html` background to `background: linear-gradient(180deg, var(--c-page-top), var(--c-page-bottom)) fixed, var(--c-page-bottom);` and the `:focus-visible` outline color to `var(--c-link)`.

In `@layer components` add (and replace `.surface` with the panel look):

```css
  .surface,
  .panel {
    background: var(--c-panel);
    box-shadow: var(--sh-panel);
    border: 1px solid var(--panel-edge);
    border-radius: var(--r-card);
  }
  .signature {
    background: linear-gradient(90deg, var(--sig-from), var(--sig-to));
    color: #FFFFFF;
  }
  .glow {
    background:
      radial-gradient(120% 140% at 0% 0%, var(--glow-a) 0%, transparent 55%),
      radial-gradient(120% 140% at 100% 0%, var(--glow-b) 0%, transparent 55%),
      radial-gradient(140% 120% at 50% 120%, var(--glow-c) 0%, transparent 60%),
      var(--c-panel);
    border-radius: var(--r-card);
    border: 1px solid var(--panel-edge);
  }
  .hairline > * + * {
    border-top: 1px solid var(--c-hairline);
  }
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/lib/projectColor.test.ts src/design/tokens.test.ts && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/design src/lib/projectColor.ts src/lib/projectColor.test.ts
git commit -m "feat: add the calm palette, project hues and the progress value" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 2: Gentle due words

**Files:**
- Create: `src/lib/due.ts`
- Modify: `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/lib/due.test.ts`

**Interfaces:**
- Consumes: `diffDays` (lib/dates), `counted` (lib/grammar).
- Produces: `dueWord(dueDate: string | null, today: string, status: TaskStatus): DueWord | null` where `DueWord = { key: 'pastDue' | 'dueToday' | 'dueIn' | 'dueOn'; n: number; tone: 'attn' | 'quiet' }`; `dueText(word, t, lang, dueDate)`; text keys `due.pastDue` (with Arabic plural forms), `due.today`, `due.in` (plural forms), `due.on`.

- [ ] **Step 1: Write the failing test**

`src/lib/due.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import { initI18n } from '../i18n';
import { dueText, dueWord } from './due';

const TODAY = '2026-09-30';

describe('gentle due words', () => {
  it('names past, today, soon and later dates calmly', () => {
    expect(dueWord('2026-09-27', TODAY, 'in_progress')).toEqual({ key: 'pastDue', n: 3, tone: 'attn' });
    expect(dueWord('2026-09-30', TODAY, 'todo')).toEqual({ key: 'dueToday', n: 0, tone: 'quiet' });
    expect(dueWord('2026-10-03', TODAY, 'todo')).toEqual({ key: 'dueIn', n: 3, tone: 'quiet' });
    expect(dueWord('2026-10-20', TODAY, 'todo')).toEqual({ key: 'dueOn', n: 20, tone: 'quiet' });
    expect(dueWord(null, TODAY, 'todo')).toBeNull();
    expect(dueWord('2026-09-20', TODAY, 'done')).toBeNull();
    expect(dueWord('2026-09-20', TODAY, 'in_review')).toEqual({ key: 'dueOn', n: -10, tone: 'quiet' });
  });

  it('writes the words in English and Arabic', () => {
    initI18n('en');
    const t = i18n.t.bind(i18n);
    expect(dueText(dueWord('2026-09-29', TODAY, 'todo')!, t, 'en', '2026-09-29')).toBe('1 day past due');
    expect(dueText(dueWord('2026-09-27', TODAY, 'todo')!, t, 'en', '2026-09-27')).toBe('3 days past due');
    expect(dueText(dueWord('2026-09-30', TODAY, 'todo')!, t, 'en', '2026-09-30')).toBe('Due today');
    expect(dueText(dueWord('2026-10-02', TODAY, 'todo')!, t, 'en', '2026-10-02')).toBe('In 2 days');
    initI18n('ar');
    expect(dueText(dueWord('2026-09-27', TODAY, 'todo')!, i18n.t.bind(i18n), 'ar', '2026-09-27')).toBe('متأخرة 3 أيام');
    initI18n('en');
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/lib/due.test.ts`
Expected: FAIL: `./due` does not exist.

- [ ] **Step 3: Write the helper and the text**

`src/lib/due.ts`:

```ts
import type { TFunction } from 'i18next';
import type { TaskStatus } from '../api/contract/entities';
import { diffDays, formatDay, type Lang } from './dates';
import { counted } from './grammar';

export type DueWord = { key: 'pastDue' | 'dueToday' | 'dueIn' | 'dueOn'; n: number; tone: 'attn' | 'quiet' };

/**
 * Gentle words for a due date (redesign spec 5.4): "3 days past due" in the attention color, never a red "Overdue".
 * A done task needs no word. A task in review is never past due (spec 4.2), so it shows its date.
 */
export function dueWord(dueDate: string | null, today: string, status: TaskStatus): DueWord | null {
  if (!dueDate || status === 'done') return null;
  const days = diffDays(today, dueDate);
  if (status === 'in_review') return { key: 'dueOn', n: days, tone: 'quiet' };
  if (days < 0) return { key: 'pastDue', n: -days, tone: 'attn' };
  if (days === 0) return { key: 'dueToday', n: 0, tone: 'quiet' };
  if (days <= 6) return { key: 'dueIn', n: days, tone: 'quiet' };
  return { key: 'dueOn', n: days, tone: 'quiet' };
}

export function dueText(word: DueWord, t: TFunction, lang: Lang, dueDate: string): string {
  if (word.key === 'pastDue') return counted(t, 'due.pastDue', word.n);
  if (word.key === 'dueToday') return t('due.today');
  if (word.key === 'dueIn') return counted(t, 'due.in', word.n);
  return t('due.on', { date: formatDay(dueDate, lang) });
}
```

Merge into `src/i18n/en.json`:

```json
{ "due": { "pastDue": "{{n}} days past due", "pastDue_one": "1 day past due", "pastDue_other": "{{n}} days past due", "today": "Due today", "in": "In {{n}} days", "in_one": "Tomorrow", "in_other": "In {{n}} days", "on": "Due {{date}}" } }
```

Merge into `src/i18n/ar.json`:

```json
{ "due": { "pastDue": "متأخرة {{n}} يوم", "pastDue_one": "متأخرة يومًا", "pastDue_two": "متأخرة يومين", "pastDue_few": "متأخرة {{count}} أيام", "pastDue_many": "متأخرة {{count}} يومًا", "pastDue_other": "متأخرة {{count}} يوم", "today": "مستحقة اليوم", "in": "بعد {{n}} يوم", "in_one": "غدًا", "in_two": "بعد يومين", "in_few": "بعد {{count}} أيام", "in_many": "بعد {{count}} يومًا", "in_other": "بعد {{count}} يوم", "on": "مستحقة {{date}}" } }
```

English plural keys `_one` and `_other` exist in English too, so the key test sees them in both files. In `src/i18n/i18n.test.ts`, the plural allowance already covers `_one`, `_two`, `_few`, `_many`, `_other` in Arabic; extend the same filter to English keys (`englishBase = Object.keys(english).filter((key) => !plural.test(key))`) and compare `arabicBase` against `englishBase`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/lib/due.test.ts src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/due.ts src/lib/due.test.ts src/i18n
git commit -m "feat: add gentle due words in English and Arabic" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 3: Calm shared parts

**Files:**
- Create: `src/components/ProjectTile.tsx`, `src/components/ProgressLine.tsx`, `src/components/StateWord.tsx`, `src/components/FilterButton.tsx`
- Modify: `src/components/Button.tsx`, `src/components/ScreenTitle.tsx`, `src/components/Tabs.tsx`
- Test: `src/components/calm.test.tsx`

**Interfaces:**
- Consumes: `projectHue`, `projectInitials`, `stageProgress` (Task 1), `Popover`, `Sheet`, `useIsPhone`.
- Produces: `ProjectTile({ id, name, size? })`; `ProgressLine({ value, hue, label })`; `StateWord({ tone, children })` with `tone: 'attn' | 'late' | 'quiet'`; `FilterButton({ label, count, children })` (opens a popover on desktop, a sheet on phones; `children` is the choices); `Button` variant `primary` uses `.signature`; `ScreenTitle({ title, action?, children? })`; `Tabs` with an ink underline that glides (Motion `layoutId`).

- [ ] **Step 1: Write the failing test**

`src/components/calm.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '../i18n';
import { FilterButton } from './FilterButton';
import { ProgressLine } from './ProgressLine';
import { ProjectTile } from './ProjectTile';
import { StateWord } from './StateWord';

initI18n('en');

describe('calm parts', () => {
  it('draws a project tile with two letters in the project hue', () => {
    render(<ProjectTile id="prj_001" name="Corniche Office Tower" />);
    const tile = screen.getByText('CO');
    expect(tile.getAttribute('style')).toMatch(/--p-\w+-bg/);
    expect(tile).toHaveAttribute('aria-hidden', 'true');
  });

  it('reports the progress line value to screen readers', () => {
    render(<ProgressLine value={0.5} hue="blue" label="Stage 3 of 7" />);
    expect(screen.getByRole('progressbar', { name: 'Stage 3 of 7' })).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows a state word with its tone', () => {
    render(<StateWord tone="late">Late</StateWord>);
    expect(screen.getByText('Late')).toHaveClass('text-late');
  });

  it('opens the filter choices, counts the active ones and returns focus on Escape', async () => {
    render(<FilterButton label="Filter" count={2}><p>Choices</p></FilterButton>);
    const button = screen.getByRole('button', { name: 'Filter, 2 active' });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Filter' })).toHaveTextContent('Choices');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Filter' })).toBeNull();
    expect(button).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/components/calm.test.tsx`
Expected: FAIL: the modules do not exist.

- [ ] **Step 3: Write the parts**

`src/components/ProjectTile.tsx`:

```tsx
import { projectHue, projectInitials } from '../lib/projectColor';

/** The project's color tile with two letters (redesign spec 2.4). Decorative: the project name sits next to it. */
export function ProjectTile({ id, name, size = 34 }: { id: string; name: string; size?: number }) {
  const hue = projectHue(id);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: `var(--p-${hue}-bg)`, color: `var(--p-${hue}-fg)`, fontSize: Math.round(size * 0.33) }}
      className="grid shrink-0 place-items-center rounded-[10px] font-bold"
    >
      {projectInitials(name)}
    </span>
  );
}
```

`src/components/ProgressLine.tsx`:

```tsx
import type { Hue } from '../lib/projectColor';

/** A 4 px line in the project hue (redesign spec 2.4). */
export function ProgressLine({ value, hue, label, className = '' }: { value: number; hue: Hue; label: string; className?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={`block h-1 overflow-hidden rounded-full bg-fill ${className}`}>
      <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: `var(--p-${hue}-fg)` }} />
    </span>
  );
}
```

`src/components/StateWord.tsx`:

```tsx
import type { ReactNode } from 'react';

const TONES = { attn: 'bg-attn-bg text-attn', late: 'bg-late-bg text-late', quiet: 'text-ink-2' } as const;

/** A small soft word that shows only when there is something to say (redesign spec 2.4). */
export function StateWord({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex min-h-6 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-caption font-semibold ${TONES[tone]}`}>{children}</span>;
}
```

`src/components/FilterButton.tsx`:

```tsx
import { SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsPhone } from '../app/useIsPhone';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

/** One button for every choice of a list (redesign spec 2.4). A popover on a computer, a sheet on a phone. */
export function FilterButton({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    ref.current?.focus();
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={count > 0 ? t('filter.withCount', { label, n: count }) : label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="pressable panel inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-subheadline font-semibold text-ink"
      >
        <SlidersHorizontal size={16} aria-hidden />
        {label}
        {count > 0 && <span className="tabular rounded-full bg-fill px-2 text-caption">{count}</span>}
      </button>
      {open && !phone && ref.current && <Popover anchor={ref.current} label={label} onClose={close}>{children}</Popover>}
      {phone && <Sheet open={open} onOpenChange={(value) => (value ? setOpen(true) : close())} title={label}>{children}</Sheet>}
    </>
  );
}
```

Add text keys: en `"filter": { "label": "Filter", "withCount": "{{label}}, {{n}} active" }`, ar `"filter": { "label": "تصفية", "withCount": "{{label}}، {{n}} نشطة" }`.

`src/components/Button.tsx`: change the primary variant to `'signature shadow-[0_6px_16px_rgba(91,108,255,0.25)]'`, the secondary to `'panel text-ink'`, and plain to `'text-link'`.

`src/components/ScreenTitle.tsx`:

```tsx
import type { ReactNode } from 'react';

/** The page title (30 px) with an optional line under it and one optional action at the end (redesign spec 2.2). */
export function ScreenTitle({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="text-[calc(30px*var(--boost))] font-bold leading-tight tracking-[-0.025em] text-ink [text-wrap:balance]">{title}</h1>
        {children && <div className="mt-1.5 text-subheadline text-ink-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}
```

`src/components/Tabs.tsx`: keep the keyboard rules; replace the button look with a quiet text tab and an underline that glides:

```tsx
            className={`pressable relative min-h-11 shrink-0 px-3 text-subheadline font-semibold ${selected ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}
          >
            {option.label}
            {selected && <motion.span layoutId={`${idPrefix}-underline`} transition={spring.standard} className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink" />}
```

and import `motion` from `motion/react` and `spring` from `../design/motion`. Give the tab list `border-b border-hairline`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src/components && npm run check:rtl`
Expected: PASS. Existing kit tests that read the old chip or tab classes change only where they assert class names; keep their behavior assertions.

- [ ] **Step 5: Commit**

```bash
git add src/components src/i18n
git commit -m "feat: add calm shared parts: project tile, progress line, state word and filter button" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 4: The tab pill, the person menu and the routes

**Files:**
- Create: `src/app/TabPill.tsx`, `src/app/PersonMenu.tsx`
- Modify: `src/app/AppShell.tsx`, `src/app/nav.ts`, `src/app/routes.tsx`, `src/app/lastList.ts`, every link to the old Projects route (`ProjectActions.tsx`, `ProjectScreen.tsx`, `dashboard/Charts.tsx`, `dashboard/Tiles.tsx`)
- Delete: `src/app/Sidebar.tsx`, `src/app/Toolbar.tsx`, `src/app/TabBar.tsx` (after their last use is gone)
- Test: `src/app/AppShell.test.tsx`

**Interfaces:**
- Produces: `NAV` = Home `/`, Projects `/projects`, Dashboard `/dashboard`, Inbox `/inbox`; `TabPill()`; `PersonMenu()`; the `/projects` route; a redirect from `/` with `filter`, `stage`, `status` or `health` values to `/projects` with the same values; `projectsListLink()` defaults to `/projects`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/app/AppShell.test.tsx` with:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

describe('app shell', () => {
  it('shows the floating pill with four tabs and search', async () => {
    await renderApp('/dashboard');
    const pill = await screen.findByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Home', 'Projects', 'Dashboard', 'Inbox']) expect(within(pill).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(within(pill).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    expect(within(pill).getByRole('link', { name: 'Search' })).toBeInTheDocument();
  });

  it('moves between screens', async () => {
    await renderApp('/');
    await userEvent.click(within(await screen.findByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/projects');
  });

  it('opens old Projects links on the new route', async () => {
    await renderApp('/?filter=at_risk');
    await waitFor(() => expect(window.location.hash).toBe('#/projects?filter=at_risk'));
  });

  it('opens the person menu with Preview as, My hours and Settings', async () => {
    await renderApp('/');
    await userEvent.click(await screen.findByRole('button', { name: /Hala Nasser/ }));
    const menu = screen.getByRole('dialog', { name: 'Hala Nasser' });
    expect(within(menu).getByLabelText(/Preview as/)).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'My hours' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/app/AppShell.test.tsx`
Expected: FAIL: there is no Home tab, and `/projects` is not a route.

- [ ] **Step 3: Write the shell**

`src/app/nav.ts`:

```ts
import { FolderKanban, Home, Inbox, LayoutDashboard, Search } from 'lucide-react';

export type NavItem = { to: string; key: string; icon: typeof Home; badge?: boolean };

/** The four tabs of the floating pill (redesign spec 2.5). My tasks and hours open from Home and the person menu. */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', icon: Home },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname === '/work';
  return pathname === to || pathname.startsWith(`${to}/`);
}
```

`src/app/TabPill.tsx`:

```tsx
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { Badge } from '../components/Badge';
import { spring } from '../design/motion';
import { NAV, SEARCH_ITEM, isNavActive } from './nav';
import { useCall } from './runtime';
import { useCompactBars } from './useCompactBars';

/** The floating pill (redesign spec 2.5): top center from 640 px, bottom center on a phone. The open tab carries the signature. */
export function TabPill() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  const compact = useCompactBars();
  const Search = SEARCH_ITEM.icon;
  return (
    <nav
      aria-label={t('nav.main')}
      data-compact={compact || undefined}
      className="pill fixed inset-x-0 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 mx-auto flex w-max items-center gap-1 rounded-full p-1.5 sm:bottom-auto sm:top-4"
    >
      {NAV.map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 rounded-full px-3 text-caption font-semibold sm:flex-row sm:px-4 sm:text-subheadline ${active ? 'text-white' : 'text-ink-2 hover:text-ink'}`}
          >
            {active && <motion.span layoutId="pill-active" transition={spring.standard} className="signature absolute inset-0 -z-10 rounded-full" />}
            <Icon size={20} className="sm:hidden" aria-hidden />
            <span className={`whitespace-nowrap ${compact ? 'max-sm:sr-only' : ''}`}>{t(item.key)}</span>
            {item.badge && badge > 0 && <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className="absolute -top-0.5 end-1" />}
          </Link>
        );
      })}
      <Link to={SEARCH_ITEM.to} aria-label={t(SEARCH_ITEM.key)} aria-current={pathname === '/search' ? 'page' : undefined} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:text-ink">
        <Search size={20} aria-hidden />
      </Link>
    </nav>
  );
}
```

Add to `src/design/tokens.css` (`@layer components`):

```css
  .pill {
    background: color-mix(in srgb, var(--c-panel) 92%, transparent);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    backdrop-filter: blur(16px) saturate(160%);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08);
    border: 1px solid var(--panel-edge);
  }
```

and in the `prefers-reduced-transparency` and `[data-contrast="more"]` rules: `.pill { background: var(--c-panel); backdrop-filter: none; -webkit-backdrop-filter: none; border-color: var(--c-ink-2); }`.

`src/app/PersonMenu.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar';
import { Popover } from '../components/Popover';
import { PreviewAs } from './PreviewAs';
import { useCall } from './runtime';

/** The person's picture opens their name, Preview as (prototype), My hours and Settings (redesign spec 2.5). */
export function PersonMenu() {
  const { t } = useTranslation();
  const user = useCall('session.get', {}).data?.user;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const close = () => setOpen(false);
  return (
    <>
      <button ref={ref} type="button" aria-label={user.name} aria-expanded={open} onClick={() => setOpen((value) => !value)} className="pressable grid size-11 place-items-center rounded-full">
        <Avatar user={user} size={34} />
      </button>
      {open && ref.current && (
        <Popover anchor={ref.current} label={user.name} onClose={() => { close(); ref.current?.focus(); }}>
          <p className="text-headline text-ink">{user.name}</p>
          <PreviewAs id="preview-as-menu" />
          <nav className="hairline flex flex-col">
            <Link to="/work?tab=hours" onClick={close} className="flex min-h-11 items-center text-body text-ink">{t('nav.myHours')}</Link>
            <Link to="/settings" onClick={close} className="flex min-h-11 items-center text-body text-ink">{t('nav.settings')}</Link>
          </nav>
        </Popover>
      )}
    </>
  );
}
```

`src/app/AppShell.tsx`: remove the sidebar, the tablet tabs, the toolbar and the tab bar and their storage flags. Keep the ⌘K handler, the storage banner and `ScrollRestoration`. The new body:

```tsx
  return (
    <div className="min-h-dvh text-ink">
      <StorageBanner />
      <TabPill />
      <div className="fixed end-4 top-4 z-30 hidden sm:block"><PersonMenu /></div>
      <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-8 sm:pb-12 sm:pt-24">
        <div className="flex justify-end pb-2 sm:hidden"><PersonMenu /></div>
        <Outlet />
        <ScrollRestoration getKey={(location) => location.pathname} />
      </main>
    </div>
  );
```

`src/app/routes.tsx`: the index route becomes `<HomeOrRedirect />` (Task 6 replaces its body with Home), add `{ path: 'projects', element: <ProjectsScreen /> }`. Write `HomeOrRedirect` in `src/features/home/HomeOrRedirect.tsx`:

```tsx
import { Navigate, useSearchParams } from 'react-router';
import { HomeScreen } from './HomeScreen';

const OLD_PROJECTS_KEYS = ['filter', 'stage', 'status', 'health'];

/** Links saved before the redesign opened the Projects list at "/" with values. They still open it (redesign spec 3.1). */
export function HomeOrRedirect() {
  const [params] = useSearchParams();
  if (OLD_PROJECTS_KEYS.some((key) => params.has(key))) return <Navigate replace to={`/projects?${params.toString()}`} />;
  return <HomeScreen />;
}
```

For this task, `src/features/home/HomeScreen.tsx` holds a first version: `export function HomeScreen() { const { t } = useTranslation(); return <ScreenTitle title={t('screens.home')} />; }` (Task 6 builds it).

`src/app/lastList.ts`: `let last = '/projects';` and `last = \`/projects${search}\`;`.

Change the old links: `ProjectActions.tsx` `navigate('/projects')`; `ProjectScreen.tsx` back link `to="/projects"`; `dashboard/Charts.tsx` `/?stage=` → `/projects?stage=`, `/?health=` → `/projects?health=`; `dashboard/Tiles.tsx` `/?status=active` → `/projects?status=active`, `/?filter=at_risk` → `/projects?filter=at_risk`.

Text keys: en `nav.home` "Home", `nav.myHours` "My hours", `screens.home` "Home"; ar `nav.home` "الرئيسية", `nav.myHours` "ساعاتي", `screens.home` "الرئيسية".

Delete `Sidebar.tsx`, `Toolbar.tsx` and `TabBar.tsx`, and their imports.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: the shell tests pass. Tests that open the Projects list at `/` change their path to `/projects` (ProjectsScreen, ProjectScreen Back, Dashboard tile and chart links, actions after delete); each change is a path change only.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: add the floating tab pill and person menu, move Projects to /projects" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 5: The Projects list

**Files:**
- Create: `src/features/projects/ProjectListRow.tsx`
- Modify: `src/features/projects/ProjectsScreen.tsx`, `src/features/projects/ProjectCard.tsx` (keep `ProjectCover` and `NextDeadlineLabel`; remove the card and `People`), `src/features/projects/ProjectRow.tsx` (delete)
- Test: `src/features/projects/ProjectsScreen.test.tsx`

**Interfaces:**
- Consumes: `ProjectTile`, `ProgressLine`, `StateWord`, `FilterButton`, `ScreenTitle`, `projectHue`, `stageProgress`.
- Produces: `ProjectListRow({ summary })` (also used by Home); the Projects screen at `/projects` with Show, Stage, Status and Sort inside the filter button.

- [ ] **Step 1: Write the failing tests**

In `src/features/projects/ProjectsScreen.test.tsx`, change every `renderApp('/...')` that opens the list to `/projects...`, change `cards()` to count list rows (`screen.queryAllByRole('listitem')` inside the projects list, named "Projects"), and replace the chip tests with:

```tsx
  it('keeps every choice inside one filter button', async () => {
    await renderApp('/projects');
    expect(await screen.findByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Needs attention' }));
    await waitFor(() => expect(window.location.hash).toContain('filter=at_risk'));
    expect(screen.getByRole('button', { name: 'Filter, 1 active' })).toBeInTheDocument();
  });

  it('shows five things per row and a state word only when needed', async () => {
    await renderApp('/projects');
    const row = (await screen.findByRole('link', { name: /Corniche Office Tower/ })).closest('li') as HTMLElement;
    expect(within(row).getByRole('progressbar')).toBeInTheDocument();
    expect(within(row).getByText('Late')).toBeInTheDocument();
    const calm = (await screen.findByRole('link', { name: /Eastern Shore Primary School/ })).closest('li') as HTMLElement;
    expect(within(calm).queryByText('On track')).toBeNull();
  });
```

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/projects/ProjectsScreen.test.tsx`
Expected: FAIL: the chips still show, and there is no filter button.

- [ ] **Step 3: Write the list**

`src/features/projects/ProjectListRow.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ProjectSummary } from '../../api/contract/views';
import { ContextMenu, useContextMenu } from '../../components/Menu';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { StateWord } from '../../components/StateWord';
import { projectHue, stageProgress } from '../../lib/projectColor';
import { useCardMenu } from './cardMenu';
import { NextDeadlineLabel } from './ProjectCard';

/** One project as one calm row: tile, name, stage, progress line, next deadline, and a state word only when needed (redesign spec 3.3). */
export function ProjectListRow({ summary }: { summary: ProjectSummary }) {
  const { t } = useTranslation();
  const { project, health } = summary;
  const menu = useContextMenu();
  const items = useCardMenu(summary);
  const index = summary.stages.findIndex((stage) => stage.id === summary.currentStage.id);
  return (
    <li {...menu.handlers}>
      <Link to={`/projects/${project.id}`} className="pressable grid grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[34px_minmax(0,1fr)_120px_150px]">
        <ProjectTile id={project.id} name={project.name} />
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span dir="auto" className="truncate text-[15px] font-semibold text-ink">{project.name}</span>
            {health?.value === 'late' && <StateWord tone="late">{t('health.late')}</StateWord>}
            {health?.value === 'at_risk' && <StateWord tone="attn">{t('health.at_risk')}</StateWord>}
          </span>
          <span dir="auto" className="block truncate text-footnote text-ink-2">{summary.currentStage.name}{summary.client ? ` · ${summary.client.name}` : ''}</span>
        </span>
        <ProgressLine value={stageProgress(summary)} hue={projectHue(project.id)} label={t('projects.stageOf', { n: index + 1, total: summary.stages.length, name: summary.currentStage.name })} className="col-start-2 sm:col-start-auto" />
        <span className="col-start-2 sm:col-start-auto sm:text-end"><NextDeadlineLabel deadline={summary.nextDeadline} /></span>
      </Link>
      <ContextMenu label={t('projects.menu', { name: project.name })} items={items} point={menu.point} onClose={menu.close} />
    </li>
  );
}
```

`src/features/projects/ProjectsScreen.tsx`: remove the chips, the two selects, the view switch and the grid; keep the link values, `rememberProjectsList`, the health note, the empty and error states and the New project sheet. The body:

```tsx
  const active = [filterParam !== 'all' || stageName, status !== 'active', sort !== 'updated'].filter(Boolean).length;
  ...
  } else if (list.data) {
    body = <ul aria-label={t('screens.projects')} className="panel hairline overflow-hidden">{list.data.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} />)}</ul>;
  }
  return (
    <>
      <ScreenTitle title={t('screens.projects')} action={<Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden />{t('projects.new')}</Button>} />
      <div className="flex flex-wrap items-center gap-3 pb-4">
        <FilterButton label={t('filter.label')} count={active}>
          <fieldset className="flex flex-col gap-1">
            <legend className="pb-1 text-footnote font-semibold text-ink-2">{t('projects.show')}</legend>
            {(['all', 'mine', 'at_risk'] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3 text-body">
                <input type="radio" name="show" checked={!stageName && filterParam === value} onChange={() => setFilter(value)} className="size-5 accent-[var(--sig-from)]" />
                {t(`projects.filter.${value}`)}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-footnote font-semibold text-ink-2">{t('projects.stage')}
            <select value={stageName ?? ''} onChange={(event) => setFilter(event.target.value ? `stage:${event.target.value}` : 'all')} className="min-h-11 rounded-control bg-fill px-3 text-body font-normal text-ink">
              <option value="">{t('projects.anyStage')}</option>
              {(settings.data?.defaultStages ?? []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-footnote font-semibold text-ink-2">{t('projects.statusFilter')}
            <select value={status} onChange={(event) => setStatus(event.target.value as (typeof STATUSES)[number])} className="min-h-11 rounded-control bg-fill px-3 text-body font-normal text-ink">
              {STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-footnote font-semibold text-ink-2">{t('projects.sort')}
            <select value={sort} onChange={(event) => setSort(event.target.value as (typeof SORTS)[number])} className="min-h-11 rounded-control bg-fill px-3 text-body font-normal text-ink">
              {SORTS.map((value) => <option key={value} value={value}>{t(`projects.sorts.${value}`)}</option>)}
            </select>
          </label>
        </FilterButton>
        {health && (... the existing health note ...)}
      </div>
      {body}
      <NewProjectSheet open={creating} onOpenChange={setCreating} />
    </>
  );
```

Text keys: en `projects.show` "Show", `projects.stage` "Stage", `projects.anyStage` "Any stage", and change `projects.filter.at_risk` to "Needs attention"; ar `projects.show` "إظهار", `projects.stage` "المرحلة", `projects.anyStage` "أي مرحلة", `projects.filter.at_risk` "تحتاج انتباهًا".

`src/features/projects/ProjectCard.tsx`: delete `ProjectCard` and `People`; keep `ProjectCover` and `NextDeadlineLabel`, and make `NextDeadlineLabel` use the calm colors (`text-ink-2`, the late text `text-attn`). Delete `ProjectRow.tsx` and the card tests that test the removed card (keep the cover and deadline tests).

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: show Projects as one calm list with one filter button" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 6: Home

**Files:**
- Create: `src/lib/home.ts`, `src/features/home/HomeScreen.tsx`, `src/features/home/NextCard.tsx`, `src/features/home/DayRing.tsx`, `src/features/home/TodayPanel.tsx`
- Test: `src/lib/home.test.ts`, `src/features/home/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: `tasks.list` (`filter: 'mine'` and `'review_for_me'`), `projects.list` (`filter: 'mine'`, or all active for the Admin), `time.week`, `session.get`, `TaskRowItem`, `ProjectListRow`, `ProjectTaskSheet`.
- Produces: `nextForYou(input: { review: TaskRow[]; mine: TaskRow[]; today: string; hoursUnderTarget: boolean; workday: boolean }): NextItem`, where `NextItem = { kind: 'review' | 'pastDue' | 'dueToday' | 'continue'; row: TaskRow } | { kind: 'hours' } | { kind: 'clear' }`; `dayRing(mine: TaskRow[], today: string): { done: number; total: number }`; `greetingKey(hour: number): 'morning' | 'afternoon' | 'evening'`; `HomeScreen()` at `/`.

- [ ] **Step 1: Write the failing tests**

`src/lib/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask, STAMP } from '../test/factories';
import { dayRing, greetingKey, nextForYou } from './home';

const TODAY = '2026-09-30';
const row = (id: string, patch: Partial<TaskRow['task']>, overdue = false): TaskRow => ({
  task: makeTask({ id, ...patch }),
  owner: { id: 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower' },
  stage: { id: 'stg_002', name: 'Schematic Design' },
  commentCount: 0, fileCount: 0, overdue, canMove: true,
});

describe('Next for you', () => {
  const base = { review: [], mine: [], today: TODAY, hoursUnderTarget: false, workday: true };
  it('puts a review first, then the oldest past-due task, then today, then work in progress, then hours', () => {
    const late1 = row('tsk_001', { dueDate: '2026-09-25', status: 'todo' }, true);
    const late2 = row('tsk_002', { dueDate: '2026-09-20', status: 'in_progress' }, true);
    const today = row('tsk_003', { dueDate: TODAY, status: 'todo' });
    const doing = row('tsk_004', { dueDate: '2026-10-05', status: 'in_progress' });
    const waiting = row('tsk_005', { status: 'in_review' });
    expect(nextForYou({ ...base, review: [waiting], mine: [late1, today] })).toMatchObject({ kind: 'review', row: waiting });
    expect(nextForYou({ ...base, mine: [late1, late2, today] })).toMatchObject({ kind: 'pastDue', row: late2 });
    expect(nextForYou({ ...base, mine: [doing, today] })).toMatchObject({ kind: 'dueToday', row: today });
    expect(nextForYou({ ...base, mine: [doing] })).toMatchObject({ kind: 'continue', row: doing });
    expect(nextForYou({ ...base, hoursUnderTarget: true })).toEqual({ kind: 'hours' });
    expect(nextForYou({ ...base, hoursUnderTarget: true, workday: false })).toEqual({ kind: 'clear' });
    expect(nextForYou(base)).toEqual({ kind: 'clear' });
  });
});

describe('day ring', () => {
  it('counts what I finished today against what today asks of me', () => {
    const doneToday = row('tsk_001', { status: 'done', completedAt: `${TODAY}T09:00:00.000+03:00` });
    const doneBefore = row('tsk_002', { status: 'done', completedAt: STAMP });
    const dueToday = row('tsk_003', { dueDate: TODAY, status: 'todo' });
    const late = row('tsk_004', { dueDate: '2026-09-28', status: 'todo' }, true);
    const later = row('tsk_005', { dueDate: '2026-10-08', status: 'todo' });
    expect(dayRing([doneToday, doneBefore, dueToday, late, later], TODAY)).toEqual({ done: 1, total: 3 });
    expect(dayRing([later], TODAY)).toEqual({ done: 0, total: 0 });
  });
});

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greetingKey(8)).toBe('morning');
    expect(greetingKey(13)).toBe('afternoon');
    expect(greetingKey(19)).toBe('evening');
  });
});
```

`src/features/home/HomeScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};

describe('Home', () => {
  it('greets the person and shows the day ring', async () => {
    await renderApp('/', as('usr_005'));
    expect(await screen.findByRole('heading', { level: 1, name: /Sara/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /done today/ })).toBeInTheDocument();
  });

  it('offers a leader the review that waits for them', async () => {
    await renderApp('/', as('usr_002'));
    const next = await screen.findByRole('region', { name: 'Next for you' });
    expect(within(next).getByText(/Approve “Toilet details”/)).toBeInTheDocument();
    await userEvent.click(within(next).getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: 'Toilet details' })).toBeInTheDocument();
  });

  it("lists today's tasks and the person's projects", async () => {
    await renderApp('/', as('usr_006'));
    const today = await screen.findByRole('region', { name: 'Today' });
    expect(within(today).getByText('Stair details')).toBeInTheDocument();
    const projects = screen.getByRole('region', { name: 'Your projects' });
    expect(within(projects).getByRole('link', { name: /Corniche Office Tower/ })).toBeInTheDocument();
    await userEvent.click(within(projects).getByRole('link', { name: 'All projects' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects'));
  });

  it('says so when there is nothing to do', async () => {
    await renderApp('/', (state) => {
      as('usr_005')(state);
      for (const task of Object.values(state.tasks)) task.status = 'done';
      state.users.usr_005.weeklyHourTarget = 0;
    });
    const next = await screen.findByRole('region', { name: 'Next for you' });
    expect(within(next).getByText('You are all caught up.')).toBeInTheDocument();
    expect(within(next).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('progressbar', { name: /done today/ })).toBeNull();
  });

  it('shows the Admin every active project', async () => {
    await renderApp('/');
    const projects = await screen.findByRole('region', { name: 'Your projects' });
    await waitFor(() => expect(within(projects).getAllByRole('progressbar').length).toBeGreaterThanOrEqual(10));
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/lib/home.test.ts src/features/home`
Expected: FAIL: `./home` does not exist and Home shows only its title.

- [ ] **Step 3: Write the helpers and the screen**

`src/lib/home.ts`:

```ts
import type { TaskRow } from '../api/contract/views';
import { stampDay } from './dates';

export type NextItem =
  | { kind: 'review' | 'pastDue' | 'dueToday' | 'continue'; row: TaskRow }
  | { kind: 'hours' }
  | { kind: 'clear' };

const open = (row: TaskRow) => row.task.status !== 'done' && row.task.status !== 'in_review';
const byDue = (a: TaskRow, b: TaskRow) => (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999');

/** The one thing for Home's card (redesign spec 3.2), first match wins. */
export function nextForYou(input: { review: TaskRow[]; mine: TaskRow[]; today: string; hoursUnderTarget: boolean; workday: boolean }): NextItem {
  const { review, mine, today } = input;
  if (review.length > 0) return { kind: 'review', row: review[0] };
  const pastDue = mine.filter((row) => open(row) && row.overdue).sort(byDue);
  if (pastDue.length > 0) return { kind: 'pastDue', row: pastDue[0] };
  const dueToday = mine.filter((row) => open(row) && row.task.dueDate === today);
  if (dueToday.length > 0) return { kind: 'dueToday', row: dueToday[0] };
  const doing = mine.filter((row) => row.task.status === 'in_progress').sort(byDue);
  if (doing.length > 0) return { kind: 'continue', row: doing[0] };
  if (input.hoursUnderTarget && input.workday) return { kind: 'hours' };
  return { kind: 'clear' };
}

/** The day ring (redesign spec 5.2): done today against done today plus what is due today or past due. */
export function dayRing(mine: TaskRow[], today: string): { done: number; total: number } {
  const done = mine.filter((row) => row.task.status === 'done' && row.task.completedAt && stampDay(row.task.completedAt) === today).length;
  const waiting = mine.filter((row) => open(row) && row.task.dueDate !== null && row.task.dueDate <= today).length;
  return { done, total: done + waiting };
}

export function greetingKey(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  return hour < 17 ? 'afternoon' : 'evening';
}
```

`src/features/home/DayRing.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

/** A 36 px ring in the signature gradient (redesign spec 5.2). */
export function DayRing({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  if (total === 0) return null;
  const r = 15;
  const length = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="36" height="36" viewBox="0 0 36 36" role="progressbar" aria-label={t('home.ringLabel', { done, total })} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="-rotate-90">
        <defs><linearGradient id="ring" x1="0" x2="1"><stop offset="0" stopColor="var(--sig-from)" /><stop offset="1" stopColor="var(--sig-to)" /></linearGradient></defs>
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--c-fill)" strokeWidth="4" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="url(#ring)" strokeWidth="4" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - done / total)} />
      </svg>
      <span className="tabular text-subheadline font-semibold text-ink">{t('home.ringText', { done, total })}</span>
    </span>
  );
}
```

`src/features/home/NextCard.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import type { NextItem } from '../../lib/home';

/** "Next for you": one thing, on the glow (redesign spec 3.2). */
export function NextCard({ item, onOpen }: { item: NextItem; onOpen: (projectId: string, taskId: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  let line = t('home.next.clear');
  let context = '';
  let action: { label: string; run: () => void } | null = null;
  if (item.kind === 'hours') {
    line = t('home.next.hours');
    action = { label: t('home.next.logHours'), run: () => navigate('/work?tab=hours') };
  } else if (item.kind !== 'clear') {
    const { task, project } = item.row;
    line = t(`home.next.${item.kind}`, { title: task.title });
    context = project.name;
    action = { label: t(item.kind === 'review' ? 'home.next.review' : 'home.next.open'), run: () => onOpen(project.id, task.id) };
  }
  return (
    <section aria-labelledby="next-title" className="glow flex flex-col gap-2 p-5">
      <h2 id="next-title" className="text-caption font-semibold uppercase tracking-[0.06em] text-[var(--sig-from)]">{t('home.next.title')}</h2>
      <p dir="auto" className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{line}</p>
      {context && <p dir="auto" className="text-subheadline text-ink-2">{context}</p>}
      {action && <Button variant="primary" className="mt-1 self-start" onClick={action.run}>{action.label}</Button>}
    </section>
  );
}
```

`src/features/home/TodayPanel.tsx`:

```tsx
import { AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TaskRow } from '../../api/contract/views';
import { TaskRowItem } from '../project/tasks/TaskRowItem';

/** My open tasks that are due today or past due, and a reminder to log hours (redesign spec 3.2). */
export function TodayPanel({ rows, today, logHours, onOpen }: { rows: TaskRow[]; today: string; logHours: boolean; onOpen: (row: TaskRow) => void }) {
  const { t } = useTranslation();
  const due = rows.filter((row) => row.task.status !== 'done' && row.task.dueDate !== null && row.task.dueDate <= today);
  return (
    <section aria-labelledby="today-title" className="panel flex flex-col px-2 py-3">
      <h2 id="today-title" className="px-2 pb-1 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2">{t('home.today')}</h2>
      {due.length === 0 && !logHours && <p className="px-2 py-2 text-subheadline text-ink-2">{t('home.todayClear')}</p>}
      <ul className="hairline">
        <AnimatePresence initial={false}>
          {due.map((row) => <TaskRowItem key={row.task.id} row={row} onOpen={() => onOpen(row)} showProject />)}
        </AnimatePresence>
      </ul>
      {logHours && <Link to="/work?tab=hours" className="flex min-h-11 items-center px-2 text-body text-link">{t('home.logToday')}</Link>}
      <Link to="/work" className="flex min-h-11 items-center px-2 text-subheadline font-semibold text-link">{t('home.allTasks')}</Link>
    </section>
  );
}
```

`src/features/home/HomeScreen.tsx`:

```tsx
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useLang } from '../../app/lang';
import { useCall } from '../../app/runtime';
import { ScreenTitle } from '../../components/ScreenTitle';
import { formatDay, now, todayISO, weekStartOf } from '../../lib/dates';
import { dayRing, greetingKey, nextForYou } from '../../lib/home';
import { ProjectTaskSheet } from '../project/tasks/TaskSheet';
import { ProjectListRow } from '../projects/ProjectListRow';
import { DayRing } from './DayRing';
import { NextCard } from './NextCard';
import { TodayPanel } from './TodayPanel';

/** Home (redesign spec 3.2): your day on the start side, your projects on the end side; one column on a phone. */
export function HomeScreen() {
  const { t } = useTranslation();
  const lang = useLang();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const session = useCall('session.get', {});
  const mine = useCall('tasks.list', { filter: 'mine' });
  const review = useCall('tasks.list', { filter: 'review_for_me' });
  const week = useCall('time.week', { weekStart: weekStartOf(today) });
  const admin = session.data?.authority.systemRole === 'admin';
  const projects = useCall('projects.list', { filter: admin ? 'all' : 'mine', sort: 'deadline' });
  const open = (projectId: string, taskId: string) => setParams({ project: projectId, task: taskId });
  const close = useCallback(() => setParams({}), [setParams]);
  const user = session.data?.user;
  if (!user || !mine.data || !review.data || !week.data) return null;
  const dayIndex = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${week.data.weekStart}T00:00:00Z`)) / 86_400_000);
  const workday = dayIndex <= 4;
  const loggedToday = week.data.dayTotals[dayIndex] ?? 0;
  const next = nextForYou({ review: review.data, mine: mine.data, today, hoursUnderTarget: week.data.weekTotal < week.data.target, workday });
  const ring = dayRing(mine.data, today);
  const firstName = user.name.split(' ')[0];
  const taskId = params.get('task');
  const projectId = params.get('project');
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        <ScreenTitle title={t(`home.greeting.${greetingKey(now().getHours())}`, { name: firstName })}>
          <span className="flex flex-wrap items-center gap-3">
            <span>{formatDay(today, lang, 'long')}</span>
            <DayRing done={ring.done} total={ring.total} />
          </span>
        </ScreenTitle>
        <NextCard item={next} onOpen={open} />
        <TodayPanel rows={mine.data} today={today} logHours={workday && loggedToday === 0 && week.data.target > 0} onOpen={(row) => open(row.project.id, row.task.id)} />
      </div>
      <section aria-labelledby="your-projects" className="flex min-w-0 flex-col gap-3 lg:pt-[3.25rem]">
        <div className="flex items-baseline justify-between">
          <h2 id="your-projects" className="text-[18px] font-bold tracking-[-0.015em] text-ink">{t('home.projects')}</h2>
          {projects.data && <span className="text-subheadline text-ink-2">{t('home.projectCount', { n: projects.data.length })}</span>}
        </div>
        {projects.data && (
          <ul className="panel hairline overflow-hidden">
            {projects.data.map((summary) => <ProjectListRow key={summary.project.id} summary={summary} />)}
          </ul>
        )}
        <Link to="/projects" className="self-start text-subheadline font-semibold text-link">{t('home.allProjects')}</Link>
      </section>
      {taskId && projectId && <ProjectTaskSheet key={taskId} projectId={projectId} taskId={taskId} onClose={close} />}
    </div>
  );
}
```

Text keys, en:

```json
{ "home": {
  "greeting": { "morning": "Good morning, {{name}}", "afternoon": "Good afternoon, {{name}}", "evening": "Good evening, {{name}}" },
  "ringLabel": "{{done}} of {{total}} done today", "ringText": "{{done}} of {{total}}",
  "next": { "title": "Next for you", "review": "Review", "open": "Open task", "logHours": "Log hours",
    "pastDue": "Finish “{{title}}”", "dueToday": "Finish “{{title}}”", "continue": "Continue “{{title}}”", "hours": "Log today's hours", "clear": "You are all caught up." },
  "today": "Today", "todayClear": "Nothing is due today.", "logToday": "Log hours for today", "allTasks": "See all my tasks",
  "projects": "Your projects", "projectCount": "{{n}} active", "allProjects": "All projects" } }
```

Add `"review": "Approve “{{title}}”"` under `home.next` as the line for a review (`home.next.review` is the button; use the key `home.next.reviewLine` for the line and use it when `item.kind === 'review'`).

Arabic:

```json
{ "home": {
  "greeting": { "morning": "صباح الخير يا {{name}}", "afternoon": "مساء الخير يا {{name}}", "evening": "مساء الخير يا {{name}}" },
  "ringLabel": "أُنجز {{done}} من {{total}} اليوم", "ringText": "{{done}} من {{total}}",
  "next": { "title": "التالي لك", "review": "مراجعة", "open": "فتح المهمة", "logHours": "تسجيل الساعات",
    "reviewLine": "اعتماد «{{title}}»", "pastDue": "إنهاء «{{title}}»", "dueToday": "إنهاء «{{title}}»", "continue": "متابعة «{{title}}»", "hours": "سجّل ساعات اليوم", "clear": "لا شيء بانتظارك." },
  "today": "اليوم", "todayClear": "لا شيء مستحق اليوم.", "logToday": "سجّل ساعات اليوم", "allTasks": "كل مهامي",
  "projects": "مشاريعك", "projectCount": "{{n}} نشطة", "allProjects": "كل المشاريع" } }
```

In `NextCard`, the line key is `home.next.reviewLine` for a review and `home.next.<kind>` otherwise; English `home.next.reviewLine` is "Approve “{{title}}”".

`src/features/home/HomeOrRedirect.tsx` already renders `HomeScreen`.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: add Home with Next for you, the day ring, Today and your projects" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 7: A calm project header and the About panel

**Files:**
- Create: `src/features/project/overview/AboutPanel.tsx`
- Modify: `src/features/project/ProjectHeader.tsx`, `src/features/project/ProjectScreen.tsx`, `src/features/project/overview/OverviewTab.tsx`
- Test: `src/features/project/ProjectScreen.test.tsx`

**Interfaces:**
- Consumes: `ProjectTile`, `ProgressLine`, `StateWord`, `StageControl` (kept, restyled to open from the stage line), `ProjectCover`.
- Produces: the header with back link, 44 px tile, name, client, a stage line (stage name button that opens the stage popover, progress line, next deadline, state word), the primary "Post update" and the "…" menu; `AboutPanel({ detail })` holding the cover, the key facts, the next 3 deadlines and the team.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/project/ProjectScreen.test.tsx`:

```tsx
  it('shows a calm header: tile, name, stage line, one main button', async () => {
    await renderApp('/projects/prj_001', as('usr_002'));
    const header = (await screen.findByRole('heading', { level: 1, name: 'Corniche Office Tower' })).closest('header') as HTMLElement;
    expect(within(header).getByRole('progressbar')).toBeInTheDocument();
    expect(within(header).getByText('Late')).toBeInTheDocument();
    expect(within(header).queryByRole('img', { name: /Cover image/ })).toBeNull();
    expect(within(header).getByRole('button', { name: 'Post update' })).toHaveClass('signature');
  });

  it('moves the cover into the About panel', async () => {
    await renderApp('/projects/prj_001');
    const about = await screen.findByRole('region', { name: 'About' });
    expect(within(about).getByRole('img', { name: /Cover image of Corniche Office Tower/ })).toBeInTheDocument();
  });
```

Change the existing tests that look for the stage rail buttons to open the stage popover from the stage name button (`getByRole('button', { name: /Construction Documents/ })`), and drop assertions about the cover in the header and the loading cover (the shared row motion comes in step B).

- [ ] **Step 2: Run the test to watch it fail**

Run: `npx vitest run src/features/project/ProjectScreen.test.tsx`
Expected: FAIL: the header still shows the cover, and there is no About panel.

- [ ] **Step 3: Write the header and the panel**

`src/features/project/ProjectHeader.tsx` (whole file):

```tsx
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { projectsListLink } from '../../app/lastList';
import type { ProjectDetail } from '../../api/contract/views';
import { Button } from '../../components/Button';
import { ProgressLine } from '../../components/ProgressLine';
import { ProjectTile } from '../../components/ProjectTile';
import { StateWord } from '../../components/StateWord';
import { projectHue, stageProgress } from '../../lib/projectColor';
import { NextDeadlineLabel } from '../projects/ProjectCard';
import { HealthControl } from './HealthControl';
import { ProjectActions } from './ProjectActions';
import { StageControl } from './StageControl';

/** The calm header (redesign spec 3.4): back, tile, name, client, one stage line, one main button and the "…" menu. */
export function ProjectHeader({ detail, onPost }: { detail: ProjectDetail; onPost: () => void }) {
  const { t } = useTranslation();
  const { project } = detail;
  const viewOnly = !detail.viewerCan.post && !detail.viewerCan.edit;
  const index = detail.stages.findIndex((stage) => stage.id === detail.currentStage.id);
  return (
    <header className="flex flex-col gap-4 pb-2">
      <Link to={projectsListLink()} className="pressable -ms-2 inline-flex min-h-11 items-center gap-1 self-start rounded-full pe-3 ps-1 text-subheadline font-semibold text-link">
        <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        {t('project.back')}
      </Link>
      <div className="flex flex-wrap items-start gap-4">
        <ProjectTile id={project.id} name={project.name} size={44} />
        <div className="min-w-0 flex-1">
          <h1 dir="auto" className="text-[calc(30px*var(--boost))] font-bold leading-tight tracking-[-0.025em] text-ink [text-wrap:balance]">{project.name}</h1>
          <p className="flex flex-wrap items-center gap-2 pt-1 text-subheadline text-ink-2">
            <span className="tabular">{project.code}</span>
            {detail.client && <span dir="auto">· {detail.client.name}</span>}
            {viewOnly && <span className="rounded-full bg-fill px-2.5 text-caption font-semibold">{t('project.viewOnly')}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {detail.viewerCan.post && <Button variant="primary" onClick={onPost}>{t('projects.postUpdate')}</Button>}
          <ProjectActions detail={detail} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StageControl detail={detail} />
        <ProgressLine value={stageProgress(detail)} hue={projectHue(project.id)} label={t('projects.stageOf', { n: index + 1, total: detail.stages.length, name: detail.currentStage.name })} className="w-32" />
        <NextDeadlineLabel deadline={detail.nextDeadline} />
        <HealthControl detail={detail} />
      </div>
    </header>
  );
}
```

`HealthControl` keeps its rules and popover but renders `StateWord` (late tone for Late, attention tone for At risk, nothing visible for On track except, for a person who may override, a quiet "On track" button). `ProjectActions`' "…" button loses `glass-media` and becomes a quiet round `panel` button.

`StageControl`: replace the rail with one button showing the current stage name (`text-subheadline font-semibold text-ink` with a chevron down); a click opens the existing stage popover listing every stage (the popover gains a list of stages to pick from when the person may change it; the existing "Make current" button stays).

`src/features/project/overview/AboutPanel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { ProjectDetail } from '../../../api/contract/views';
import { useLang } from '../../../app/lang';
import { Avatar } from '../../../components/Avatar';
import { formatDay, formatNumber, todayISO } from '../../../lib/dates';
import { ProjectCover } from '../../projects/ProjectCard';

/** The project's facts in one quiet panel; the cover lives here now (redesign spec 3.4). */
export function AboutPanel({ detail }: { detail: ProjectDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { project } = detail;
  const upcoming = detail.deadlines.filter((d) => d.date >= todayISO()).slice(0, 3);
  return (
    <section aria-labelledby="about-title" className="panel flex flex-col gap-4 p-5">
      <h2 id="about-title" className="text-headline text-ink">{t('project.about')}</h2>
      {project.coverFileId && <div className="overflow-hidden rounded-2xl"><ProjectCover summary={detail} className="aspect-video" /></div>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-subheadline">
        ... the existing facts of the Overview side column (location, area, start, target end, model folder), with dt in text-ink-2 and dd in text-ink ...
      </dl>
      ... the existing next-3-deadlines list and team list, restyled with text-ink and text-ink-2 ...
    </section>
  );
}
```

Move the facts, deadlines and team markup from `OverviewTab.tsx`'s side column into `AboutPanel` without changing their content, then render `<AboutPanel detail={detail} />` in the Overview's side column. Text key: en `project.about` "About", ar `project.about` "عن المشروع".

`ProjectScreen.tsx`: the loading branch returns `null` again (the row-to-header motion is step B); remove the `HEADER_COVER` import.

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: give the project a calm header and move the cover into About" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 8: Calm task rows and one filter button for tasks and the feed

**Files:**
- Modify: `src/features/project/tasks/TaskRowItem.tsx`, `src/features/project/tasks/TasksTab.tsx`, `src/features/project/tasks/TaskList.tsx`, `src/features/project/overview/OverviewTab.tsx`
- Test: `src/features/project/tasks/TasksTab.test.tsx`, `src/features/project/overview/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: `dueWord`, `dueText` (Task 2), `StateWord`, `ProjectTile`, `FilterButton`.
- Produces: task rows with a round check, the title, the gentle due word, the owner's small avatar (or, with `showProject`, the small project tile), counts only when not zero, the flag only when flagged; the Tasks tab filter button (Show, Show done tasks, View); the Overview feed filter button.

- [ ] **Step 1: Write the failing tests**

In `TasksTab.test.tsx`, replace the chip and view-switch tests with:

```tsx
  it('keeps the task choices in one filter button', async () => {
    await renderApp(TASKS);
    await screen.findByText('Stair details');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Board' }));
    expect(await screen.findByRole('region', { name: 'In review' })).toBeInTheDocument();
  });

  it('says how late a task is, gently', async () => {
    await renderApp(TASKS);
    const row = (await screen.findByText('Stair details')).closest('li') as HTMLElement;
    expect(within(row).getByText('5 days past due')).toHaveClass('text-attn');
    expect(within(row).queryByText('Overdue')).toBeNull();
  });
```

(Stair details is due 25 Sept; today is 30 Sept, so it is 5 days past due.)

In `OverviewTab.test.tsx`, change the feed filter tests from chips to the filter button (`Filter` → radio `Posts`).

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run src/features/project/tasks/TasksTab.test.tsx src/features/project/overview/OverviewTab.test.tsx`
Expected: FAIL: the chips still show and the row says "Overdue".

- [ ] **Step 3: Write the rows and the buttons**

In `TaskRowItem.tsx`, replace the meta line with:

```tsx
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-ink-2">
          {(task.status === 'in_progress' || inReview) && <span>{t(`taskStatus.${task.status}`)}</span>}
          {word && (word.tone === 'attn'
            ? <StateWord tone="attn">{dueText(word, t, lang, task.dueDate as string)}</StateWord>
            : <span className="tabular">{dueText(word, t, lang, task.dueDate as string)}</span>)}
          {task.flagged && <span className="inline-flex items-center gap-1 text-attn"><Flag size={12} aria-hidden />{t('tasks.flagged')}</span>}
          {row.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageCircle size={12} aria-hidden />{row.commentCount}</span>}
          {row.fileCount > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={12} aria-hidden />{row.fileCount}</span>}
        </span>
```

with `const word = dueWord(task.dueDate, todayISO(), task.status);` above, the check icons in `text-ink-2` (open), `text-[var(--sig-from)]` (done) and `text-attn` (in review), and the end slot `showProject ? <ProjectTile id={row.project.id} name={row.project.name} size={22} /> : <Avatar user={row.owner} size={24} />`. Keep the aria labels of the counts by adding `aria-label={t('tasks.comments', { n: row.commentCount })}` and the same for files on their spans.

In `TasksTab.tsx`, replace the chips, the "Show done tasks" checkbox and the view switch with one `FilterButton` holding: Show (radios All, Mine, Past due, Flagged), a "Show done tasks" switch, and View (radios List, Board). The active count is `(filter !== 'all') + showDone + (view === 'board')`. Text: change `tasks.filter.overdue` to "Past due" (ar "متأخرة").

In `TaskList.tsx`, the group panels use `panel` and `hairline`, the group title `text-headline text-ink`, the count `text-ink-2`.

In `OverviewTab.tsx`, replace the feed chips with a `FilterButton` holding the four radios (All, Posts, Tasks, Files).

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npx vitest run src && npm run typecheck && npm run check:rtl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: calm task rows with gentle due words, and one filter button for tasks and the feed" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

### Task 9: Browser sweep and the review link

**Files:**
- Modify: `tests/e2e/*.spec.ts` (routes and the removed chips, grid and sidebar)
- Create: `tests/e2e/calm.spec.ts`

- [ ] **Step 1: Update and add the browser checks**

Update the existing specs: the Projects list is at `/#/projects`; cards become rows (`getByRole('list', { name: 'Projects' })` and its `listitem`s); chips become the filter button; the sidebar "Preview as" becomes the person menu's; the phone-width test adds `/#/` (Home) to its paths. `tests/e2e/calm.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('Home shows one glow, one main button and the pill on every size', async ({ page }) => {
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.glow')).toHaveCount(1);
    await expect(page.locator('main .signature')).toHaveCount(1);
    const pill = page.getByRole('navigation', { name: 'Main navigation' });
    const box = await pill.boundingBox();
    if (width < 640) expect(box!.y).toBeGreaterThan(700);
    else expect(box!.y).toBeLessThan(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('no glass and no cover images in lists', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of ['/#/', '/#/projects']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main .glass')).toHaveCount(0);
    await expect(page.locator('main ul img')).toHaveCount(0);
  }
});
```

- [ ] **Step 2: Run the sweep in a subagent**

Delegate to one subagent: `npx playwright test tests/e2e --reporter=line`, twice at the end; test-side fixes only, listed; app defects reported with the assertion or axe rule and target; screenshots: 1440 en light Home, 1440 en dark Home, 390 ar light Home, 1440 en light Projects, 1440 en light Project (prj_001), 390 en light Project tasks.

- [ ] **Step 3: Look at the screens**

Read the six screenshots against the spec: one glow, one main button, project tiles in their hues, no chips, no glass, gentle words, the pill top center on desktop and bottom on the phone, Arabic mirrored.

- [ ] **Step 4: Publish the review link and the progress page**

Build, point the review wrapper at the new asset names and publish it to the same path (old assets set to null). Update the progress page (redesign step A on the link).

- [ ] **Step 5: Commit**

```bash
git add tests/e2e TASKS.md
git commit -m "test: browser checks for the calm redesign step A" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```
