# Madar Plan 1 of 5: Foundation (data layer and app shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Madar foundation: the fake API that all screens and future AI agents use, the sample data, and the Apple-style app shell in English and Arabic, published as a private review link.

**Architecture:** One React app (Vite, TypeScript). All data lives in one `State` object in memory, saved to IndexedDB. Screens reach data only through `api.call(name, input)`. Each call validates its input with zod, checks one permission function, changes the state in one step that rolls back on an error, writes an event log entry, creates notifications, and validates its output. The shell (sidebar, tab bar, toolbar, settings) sits on top, with design tokens for Liquid Glass, light and dark mode, and right-to-left Arabic.

**Tech Stack:** TypeScript 7.0.2, React 19.3.0, Vite 8.3.1, React Router 8.4.0, Tailwind CSS 4.3.3, zod 4.6.5, TanStack Query 5.104.0, i18next 26.4.2 with react-i18next 17.0.15, Motion 13.4.6, idb-keyval 6.3.0, lucide-react 1.49.0, Vitest 5.0.2 with jsdom 30.1.1 and Testing Library, Playwright 1.63.0 with axe-core 4.13.0.

**Spec:** `docs/superpowers/specs/2026-09-30-madar-prototype-design.md`

**Plan series.** This is plan 1 of 5, one per build step in spec section 14. Each later plan is written after the review of the step before it, against the code that exists then.

| Plan | Build step | Contents |
|---|---|---|
| 1 (this plan) | Shell | Fake API with every call, permissions, event log, notifications, sample data, design tokens, navigation shell, Settings, review link |
| 2 | Projects | Projects grid, project card, New Project sheet, Project screen with the five tabs |
| 3 | Personal work | My Work (Tasks and Hours), Inbox, comments and reactions, search panel |
| 4 | Dashboard | Tiles, charts, workload grid, office schedule, Task list screen, Admin settings (People, Office settings, week unlock) |
| 5 | Polish | Shared-element card motion, toolbar shrink on scroll, Arabic review, dark mode, accessibility, full Playwright sweep, team review |

The library versions were checked on 2026-09-30 with a throwaway install: TypeScript 7 compiles, Vitest 5 runs jsdom tests, React Router 8 `createHashRouter` works, zod 4 `z.iso.date()` works, and the Arabic locale below gives Western digits.

## Global Constraints

- Node 22.18 or later (the machine has 22.23.1, which runs `.ts` scripts directly). `package.json` has `"type": "module"`.
- Exact dependency versions, no `^` or `~`. The list is in Task 1.
- Days are `YYYY-MM-DD` strings. Timestamps are ISO strings in office time with the `+03:00` offset, made only by `nowStamp()`. "Today" is always `todayISO()` (Asia/Riyadh, UTC+3, no daylight saving). Never use `new Date().toISOString().slice(0, 10)`.
- Only `formatDay` and `formatNumber` in `src/lib/dates.ts` format dates and numbers for people. Arabic uses the locale `ar-SA-u-ca-gregory-nu-latn`. English uses `en-GB-u-ca-gregory-nu-latn`. The plain `ar-SA` locale is forbidden.
- IDs are a prefix, an underscore and at least three digits (`prj_001`), made only by `nextId()`.
- Screens reach data only through `api.call`, by the hooks `useCall` and `useAction`. No file under `src/features` or `src/components`, and no shell component in `src/app`, imports from `src/api/store.ts` or `src/api/handlers/`. Only `src/app/bootstrap.ts` builds the store and the API.
- Every call that only reads has `readOnly: true`. Names that end in `.list`, `.get`, `.week`, `.count` or `.query` are read-only. All other calls write. A test in Task 16 enforces this rule, because a write call marked read-only would lose its rollback, and a read call marked as a write would refresh every screen in a loop.
- Styles use logical properties only (`ms-`, `pe-`, `start-`, `end-`, `text-start`, `margin-inline-start`). `npm run check:rtl` fails on physical left or right. A line with the comment `rtl-ok` is skipped. Use it only for a real direction, such as an SVG coordinate.
- All text that people see lives in `src/i18n/en.json` and `src/i18n/ar.json`. Components use `t()`. The Arabic text is a draft for a native speaker to review (spec 10.8).
- Only `transform` and `opacity` animate.
- Text contrast follows WCAG 2.2 AA (4.5:1). Secondary text uses `text-label-2`. `text-label-3` is for icons and disabled states only, never for text.
- Comments, UI text and commit messages follow ASD-STE100 Simplified Technical English (active voice, short sentences) and never contain the em-dash character.
- Commit command: `git commit -m "<type>: <summary>" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"`. Never add a Co-Authored-By line.
- Keep `TASKS.md` at the repository root in step with this plan: one line per task, ticked when the task is done.

**Clarifications of the spec made in this plan.** Tell the owner about these at handoff.

1. The dashboard "Period" filter (spec 8.1) applies to the "Hours per project" chart only. The other tiles and charts keep the fixed windows in their spec definitions (this week, the next 14 days, 12 weeks), because those definitions contradict a period filter.
2. A tick or a drag to Done by the project leader or the Admin always lands on Done, because they are the reviewers. A team member's tick with "Needs review" on lands on In review (spec 5.5).
3. New internal fields and calls: `User.ownerId`, `Event.actingForId`, `Event.correlationId`, `Event.seq`, `Notification.dedupeKey`, `State.version`, `State.seededOn`, `State.session`, `State.timeRows`, and the calls `session.setSimulateErrors`, `session.resetSampleData`, `me.updateProfile`, `notifications.count`, `time.addRow` and `time.removeRow`.
4. Undo is refused for `project.created`, `project.deleted`, `project.stages_changed` and settings changes.
5. A stage with no tasks never triggers the "less than 70% done" At risk rule.
6. Reviews on a project with no leader go to every Admin.
7. Colors: Apple blue `#007AFF` with white text measures 4.0:1, below AA. Light mode uses `#0066CC` for accent text and `#0071E3` for filled buttons (both from apple.com, 5.6:1 and 4.7:1). Dark mode uses `#0A84FF` for accent text and `#0071E3` for filled buttons. Badges use Apple's accessible red `#D70015`. Status text uses Apple's accessible green, orange and red.
8. The creator of a project always joins its team, also when they pick another person as leader.
9. Agent rules adopted from Scitter (spec section 17, approved by the owner on 2026-09-30): an agent acts for one person (`User.ownerId`) with that person's rights. `Ctx.authority` is the user whose rights apply, and `Ctx.actor` is who acts. Every event records `actingForId` and a `correlationId`. Agents are never project members. The person an agent acted for can undo its changes. Nobody is notified about their own agent's actions.

## Review Focus

1. **Midnight in Al Khobar.** A person opens the app at 00:30 office time (21:30 UTC on the day before). Expected: "today", due dates and the Thursday reminder use the office day, not the UTC day. Tests: Task 2 (`todayISO` near midnight) and Task 8 (no Thursday reminder at 02:30 office time).
2. **Scheduled checks that run again and again.** The app runs the time-based triggers at start and every minute, and reviewers reload often. Expected: one "due tomorrow" and one "overdue" notification per task and due date, and one reminder per person per week. Test: Task 8.
3. **Stage removal with work in it.** A leader removes a stage that has tasks or logged hours. Expected: a clear refusal that names the stage, and no data loss. Test: Task 11.
4. **No browser storage.** The review link opens in a sandbox or a private window where IndexedDB fails. Expected: the app runs from memory and shows "Changes will not be saved in this window." Tests: Task 4 (fallback) and Task 20 (banner).
5. **Search with other letter forms.** A person types "CORNICHE", or Arabic with diacritics or another alef form. Expected: the match ignores case, diacritics and alef forms. Tests: Task 8 (`normalizeForSearch`) and Task 15 (`search.query`).

## File Map

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | Build, type check and test setup |
| `scripts/check-rtl.ts` | Command-line check for physical left and right styles |
| `src/lib/rtl-check.ts` | The pure function behind the RTL check |
| `src/lib/dates.ts` | Office clock, day arithmetic, weeks, formatting |
| `src/lib/text.ts` | Mentions, project links, search normalization |
| `src/api/contract/entities.ts` | zod schemas and types for every stored entity |
| `src/api/contract/views.ts` | zod schemas for call outputs (cards, rows, details) |
| `src/api/errors.ts` | `ApiError` and its codes |
| `src/api/store.ts` | `State`, `Store` (rollback, save, listeners), `nextId` |
| `src/api/persist.ts` | IndexedDB and memory persisters |
| `src/api/permissions.ts` | `can()`: the permission table from spec 2.3 |
| `src/api/health.ts` | `computeHealth()`: the health rule from spec 4.2 |
| `src/api/events.ts` | Event log writer, patch helper, undo |
| `src/api/notify.ts` | Notification creation and time-based triggers |
| `src/api/registry.ts` | `defineCall` and the call contract types |
| `src/api/client.ts` | `createApi`: the dispatcher |
| `src/api/views.ts` | Builders for call outputs |
| `src/api/handlers/*.ts` | One file per area of calls |
| `src/api/calls.ts` | The full call map and its types |
| `src/data/seed.ts`, `src/data/assets.ts`, `src/data/shift.ts` | Sample data, generated files, date shift |
| `src/i18n/*` | i18next setup, English and Arabic text |
| `src/design/tokens.css`, `src/design/motion.ts` | Design tokens, glass, type scale, spring presets |
| `src/app/*` | Bootstrap, runtime hooks, appearance, shell, routes, toasts |
| `src/components/*` | Small shared UI parts |
| `src/features/*` | Screens (Settings and placeholders in this plan) |
| `src/test/*` | Test setup, factories, render helper |
| `tests/e2e/*`, `playwright.config.ts` | Browser sweep (run by a subagent) |

---

### Task 1: Project setup and the RTL check

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `TASKS.md`
- Create: `src/main.tsx` (temporary), `src/test/setup.ts`
- Create: `src/lib/rtl-check.ts`, `scripts/check-rtl.ts`
- Test: `src/lib/rtl-check.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `findPhysicalDirection(source: string): RtlFinding[]` where `RtlFinding = { line: number; rule: string; match: string }`. The npm scripts `dev`, `build`, `preview`, `test`, `typecheck`, `check:rtl`.

- [ ] **Step 1: Write the project files**

`package.json`:

```json
{
  "name": "madar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "node scripts/check-rtl.ts && tsc -p tsconfig.json && vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json",
    "check:rtl": "node scripts/check-rtl.ts"
  },
  "dependencies": {
    "@dnd-kit/core": "6.3.1",
    "@fontsource-variable/inter": "5.3.0",
    "@fontsource/ibm-plex-sans-arabic": "5.3.0",
    "@tanstack/react-query": "5.104.0",
    "cmdk": "1.1.1",
    "i18next": "26.4.2",
    "idb-keyval": "6.3.0",
    "lucide-react": "1.49.0",
    "motion": "13.4.6",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-i18next": "17.0.15",
    "react-router": "8.4.0",
    "recharts": "3.10.1",
    "vaul": "1.1.2",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/node": "22.20.4",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "fake-indexeddb": "6.2.5",
    "jsdom": "30.1.1",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vite": "8.3.1",
    "vitest": "5.0.2"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

`vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
```

`index.html`:

```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#F5F5F7" />
    <title>Madar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:

```
node_modules
dist
test-results
playwright-report
.DS_Store
```

`src/main.tsx` (temporary, Task 20 replaces it):

```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p>Madar</p>);
```

`src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

`TASKS.md`:

```markdown
# Madar plan 1 tasks

- [ ] 1. Project setup and the RTL check
- [ ] 2. Office dates
- [ ] 3. Entity schemas and API errors
- [ ] 4. Store and persisters
- [ ] 5. Permissions and test factories
- [ ] 6. Health rule
- [ ] 7. Event log and undo
- [ ] 8. Text helpers and notifications
- [ ] 9. Call registry and dispatcher
- [ ] 10. People, session, clients and settings calls
- [ ] 11. Project, member, stage and deadline calls
- [ ] 12. Task calls
- [ ] 13. Update, comment, file and event calls
- [ ] 14. Time and notification calls
- [ ] 15. Dashboard and search calls
- [ ] 16. The call map
- [ ] 17. Sample data, date shift and reset
- [ ] 18. Languages
- [ ] 19. Design tokens and appearance
- [ ] 20. Runtime, bootstrap and toasts
- [ ] 21. App shell and Settings screen
- [ ] 22. Verify, browser sweep and review link
```

- [ ] **Step 2: Install the dependencies**

Run: `npm install`
Expected: `added ... packages`, no `ERESOLVE` error.

- [ ] **Step 3: Write the failing test**

`src/lib/rtl-check.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findPhysicalDirection } from './rtl-check';

const flagged = [
  'ml-4', 'mr-2', 'pl-3', 'pr-1', 'left-0', 'right-4', '-left-2', 'text-left', 'text-right', 'float-left',
  'border-l', 'border-r-2', 'rounded-tl-lg', 'rounded-r-xl', 'margin-left: 4px;', 'padding-right: 8px;',
  'left: 0;', 'right: 12px;', 'text-align: right;', 'style={{ marginLeft: 8 }}',
];
const allowed = [
  'ms-4', 'me-2', 'ps-3', 'pe-1', 'start-0', 'end-4', 'text-start', 'text-end', 'border-s', 'border-e-2',
  'rounded-ss-lg', 'rounded-e-xl', 'margin-inline-start: 4px;', 'inset-inline-start: 0;', 'text-align: start;',
  'paddingInlineStart', 'top-left', 'highlight', 'copyright: 2026', 'left: number;', 'px-4', 'mx-auto',
];

describe('findPhysicalDirection', () => {
  it.each(flagged)('flags %s', (text) => {
    expect(findPhysicalDirection(`<div className="${text}">`)).not.toEqual([]);
  });

  it.each(allowed)('allows %s', (text) => {
    expect(findPhysicalDirection(`<div className="${text}">`)).toEqual([]);
  });

  it('reports the line number', () => {
    expect(findPhysicalDirection('a\nb ml-2')[0]).toMatchObject({ line: 2, match: 'ml-2' });
  });

  it('skips a line marked rtl-ok', () => {
    expect(findPhysicalDirection('<rect style={{ left: 0 }} /> // rtl-ok')).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the test to see it fail**

Run: `npx vitest run src/lib/rtl-check.test.ts`
Expected: FAIL, "Failed to resolve import ./rtl-check".

- [ ] **Step 5: Write the implementation**

`src/lib/rtl-check.ts`:

```ts
// Finds physical left and right styles. The app uses logical start and end styles, so Arabic mirrors correctly.
const RULES: { rule: string; pattern: RegExp }[] = [
  {
    rule: 'Tailwind physical class',
    pattern:
      /(?<![\w-])-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w[\].\/%-]+/g,
  },
  { rule: 'Tailwind physical class', pattern: /(?<![\w-])(?:text|float|clear)-(?:left|right)(?![\w-])/g },
  { rule: 'Tailwind physical class', pattern: /(?<![\w-])border-[lr](?![\w-])/g },
  { rule: 'CSS physical property', pattern: /(?<![\w-])(?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?\s*:/g },
  { rule: 'CSS physical property', pattern: /(?<![\w-])(?:left|right)\s*:\s*[-\d.]/g },
  { rule: 'CSS physical value', pattern: /(?:text-align|float|clear)\s*:\s*(?:left|right)\b/g },
  { rule: 'JS physical style', pattern: /(?<![\w-])(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b/g },
];

export type RtlFinding = { line: number; rule: string; match: string };

export function findPhysicalDirection(source: string): RtlFinding[] {
  const findings: RtlFinding[] = [];
  source.split('\n').forEach((text, index) => {
    if (text.includes('rtl-ok')) return;
    for (const { rule, pattern } of RULES) {
      for (const match of text.matchAll(pattern)) findings.push({ line: index + 1, rule, match: match[0] });
    }
  });
  return findings;
}
```

`scripts/check-rtl.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPhysicalDirection } from '../src/lib/rtl-check.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXTENSIONS = ['.ts', '.tsx', '.css'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    const scanned = EXTENSIONS.some((ext) => name.endsWith(ext)) && !name.includes('.test.') && !path.endsWith('rtl-check.ts');
    return scanned ? [path] : [];
  });
}

const findings = walk(join(root, 'src')).flatMap((file) =>
  findPhysicalDirection(readFileSync(file, 'utf8')).map((f) => `${relative(root, file)}:${f.line}  ${f.rule}  "${f.match}"`),
);

if (findings.length > 0) {
  console.error(`Physical left or right styles found. Use start and end instead:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('RTL check passed.');
```

- [ ] **Step 6: Run the checks**

Run: `npx vitest run src/lib/rtl-check.test.ts`
Expected: PASS (44 tests).

Run: `npm run check:rtl`
Expected: `RTL check passed.` (Node can print an "ExperimentalWarning" about type stripping. Ignore it.)

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: set up the Madar project and the RTL check" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 2: Office dates

**Files:**
- Create: `src/lib/dates.ts`
- Modify: `src/test/setup.ts`
- Test: `src/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `OFFICE_TZ`, `setNow(value: Date | null): void`, `now(): Date`, `nowStamp(at?: Date): string`, `todayISO(at?: Date): string`, `addDays(day: string, n: number): string`, `diffDays(from: string, to: string): number`, `dayOfWeek(day: string): number` (0 = Sunday), `weekStartOf(day: string): string`, `officeClock(at?: Date): { day: string; weekday: number; hour: number }`, `stampDay(stamp: string): string`, `type Lang = 'en' | 'ar'`, `localeFor(lang: Lang): string`, `formatDay(day: string, lang: Lang, style?: 'short' | 'long'): string`, `formatNumber(value: number, lang: Lang, fractionDigits?: number): string`, `minDay(a: string, b: string): string`, `maxDay(a: string, b: string): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/dates.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays, dayOfWeek, diffDays, formatDay, formatNumber, maxDay, minDay, now, nowStamp, officeClock,
  setNow, stampDay, todayISO, weekStartOf,
} from './dates';

describe('office dates', () => {
  afterEach(() => setNow(null));

  it('pins and releases the clock', () => {
    setNow(new Date('2026-09-30T05:00:00Z'));
    expect(now().toISOString()).toBe('2026-09-30T05:00:00.000Z');
    setNow(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('writes stamps in office time', () => {
    expect(nowStamp(new Date('2026-09-30T05:00:00Z'))).toBe('2026-09-30T08:00:00.000+03:00');
  });

  it('uses the office day near midnight', () => {
    expect(todayISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(todayISO(new Date('2026-09-30T20:59:00Z'))).toBe('2026-09-30');
  });

  it('does day arithmetic', () => {
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-09-30', '2026-10-12')).toBe(12);
    expect(diffDays('2026-10-12', '2026-09-30')).toBe(-12);
    expect(minDay('2026-09-30', '2026-10-01')).toBe('2026-09-30');
    expect(maxDay('2026-09-30', '2026-10-01')).toBe('2026-10-01');
  });

  it('starts weeks on Sunday', () => {
    expect(dayOfWeek('2026-09-27')).toBe(0);
    expect(weekStartOf('2026-10-01')).toBe('2026-09-27');
    expect(weekStartOf('2026-09-27')).toBe('2026-09-27');
    expect(weekStartOf('2026-10-03')).toBe('2026-09-27');
  });

  it('reads the office clock', () => {
    expect(officeClock(new Date('2026-10-01T12:30:00Z'))).toEqual({ day: '2026-10-01', weekday: 4, hour: 15 });
  });

  it('turns a stamp into its office day', () => {
    expect(stampDay('2026-09-30T23:30:00.000+03:00')).toBe('2026-09-30');
    expect(stampDay('2026-09-30T22:30:00.000Z')).toBe('2026-10-01');
  });

  it('formats with Western digits and the Gregorian calendar', () => {
    expect(formatDay('2026-10-12', 'en')).toBe('12 Oct');
    const arabic = formatDay('2026-10-12', 'ar');
    expect(arabic).toContain('12');
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(formatNumber(48300.5, 'ar', 1)).toBe('48,300.5');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL, "Failed to resolve import ./dates".

- [ ] **Step 3: Write the implementation**

`src/lib/dates.ts`:

```ts
// Office time helpers. The office runs on Arabia Standard Time (UTC+3, no daylight saving).
export const OFFICE_TZ = 'Asia/Riyadh';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

let fixedNow: Date | null = null;

/** Tests and the prototype can pin "now". Pass null to use the real clock. */
export function setNow(value: Date | null): void {
  fixedNow = value ? new Date(value.getTime()) : null;
}

export function now(): Date {
  return fixedNow ? new Date(fixedNow.getTime()) : new Date();
}

/** An ISO timestamp in office time, for example 2026-09-30T08:00:00.000+03:00. */
export function nowStamp(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().replace('Z', '+03:00');
}

/** The office calendar day (YYYY-MM-DD) for a moment. */
export function todayISO(at: Date = now()): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

function toMs(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromMs(toMs(day) + n * DAY_MS);
}

/** The number of days from "from" to "to". Negative when "to" is earlier. */
export function diffDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / DAY_MS);
}

export function minDay(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

/** 0 is Sunday, 6 is Saturday. */
export function dayOfWeek(day: string): number {
  return new Date(toMs(day)).getUTCDay();
}

/** The office week starts on Sunday. */
export function weekStartOf(day: string): string {
  return addDays(day, -dayOfWeek(day));
}

export function officeClock(at: Date = now()): { day: string; weekday: number; hour: number } {
  const shifted = new Date(at.getTime() + OFFSET_MS);
  return { day: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}

export function stampDay(stamp: string): string {
  return todayISO(new Date(stamp));
}

export type Lang = 'en' | 'ar';

const LOCALES: Record<Lang, string> = {
  en: 'en-GB-u-ca-gregory-nu-latn',
  ar: 'ar-SA-u-ca-gregory-nu-latn',
};

export function localeFor(lang: Lang): string {
  return LOCALES[lang];
}

export function formatDay(day: string, lang: Lang, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: 'numeric', month: 'short', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(LOCALES[lang], options).format(new Date(toMs(day)));
}

export function formatNumber(value: number, lang: Lang, fractionDigits = 0): string {
  return new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: fractionDigits }).format(value);
}
```

Replace `src/test/setup.ts` with:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setNow } from '../lib/dates';

afterEach(() => {
  cleanup();
  setNow(null);
});
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dates.ts src/lib/dates.test.ts src/test/setup.ts
git commit -m "feat: add office date helpers" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 3: Entity schemas and API errors

**Files:**
- Create: `src/api/contract/entities.ts`, `src/api/errors.ts`
- Test: `src/api/contract/entities.test.ts`, `src/api/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: zod schemas and same-name types for `User`, `Client`, `Project`, `ProjectMember`, `Stage`, `Deadline`, `ChecklistItem`, `Task`, `Update`, `Comment`, `FileVersion`, `FileRec`, `TimeEntry`, `TimeRow`, `Notification`, `Event`, `Settings`, `WeekUnlock`, `HealthOverride`, `Preferences`. ID schemas `UserId`, `ClientId`, `ProjectId`, `StageId`, `DeadlineId`, `TaskId`, `UpdateId`, `CommentId`, `FileId`, `TimeId`, `NotificationId`, `EventId`. Value schemas `Day`, `Stamp`, `ProjectStatus`, `TaskStatus`, `HealthValue`, `Language`, `Theme`, `Glass`, `Trigger`, `Reaction`, `EventTarget`, `NotificationTarget`. Constants `TRIGGERS`, `REACTIONS`, `MAX_FILE_BYTES`. Functions `defaultPreferences(): Preferences`, `emptyReactions(): Record<Reaction, string[]>`. `class ApiError { code: ApiErrorCode; details: Record<string, unknown> }`, `type ApiErrorCode = 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'failed'`, `invalid(field, message)`, `notFound(what, id)`, `forbidden(message, details?)`.

- [ ] **Step 1: Write the failing tests**

`src/api/contract/entities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Comment, Project, Stamp, TRIGGERS, TimeEntry, User, defaultPreferences, emptyReactions } from './entities';

const user = {
  id: 'usr_001', name: 'Hala Nasser', email: 'hala@madar.test', avatarUrl: null, kind: 'human',
  systemRole: 'admin', discipline: 'Architect', weeklyHourTarget: 40, active: true, ownerId: null, preferences: defaultPreferences(),
};

const project = {
  id: 'prj_001', code: 'KH-26-014', name: 'Corniche Office Tower', clientId: null, status: 'active',
  leaderId: 'usr_002', currentStageId: 'stg_001', location: 'Al Khobar', areaM2: 24500, startDate: '2026-01-01',
  targetEndDate: '2027-06-30', coverFileId: null, modelFolderPath: '', description: '', healthOverride: null,
  createdBy: 'usr_001', createdAt: '2026-01-01T09:00:00.000+03:00', updatedAt: '2026-01-01T09:00:00.000+03:00',
};

describe('entity schemas', () => {
  it('accepts a valid user', () => {
    expect(User.parse(user)).toEqual(user);
  });

  it('checks id prefixes and digits', () => {
    expect(User.safeParse({ ...user, id: 'user_001' }).success).toBe(false);
    expect(User.safeParse({ ...user, id: 'usr_01' }).success).toBe(false);
    expect(User.safeParse({ ...user, id: 'usr_1234' }).success).toBe(true);
  });

  it('accepts office stamps in ISO form only', () => {
    expect(Stamp.safeParse('2026-09-30T08:00:00.000+03:00').success).toBe(true);
    expect(Stamp.safeParse('2026-09-30 08:00').success).toBe(false);
  });

  it('takes hours in half-hour steps', () => {
    const entry = { id: 'tim_001', userId: 'usr_001', projectId: 'prj_001', stageId: 'stg_001', taskId: null, date: '2026-09-30' };
    expect(TimeEntry.safeParse({ ...entry, hours: 7.5 }).success).toBe(true);
    expect(TimeEntry.safeParse({ ...entry, hours: 0.3 }).success).toBe(false);
    expect(TimeEntry.safeParse({ ...entry, hours: 0 }).success).toBe(false);
  });

  it('turns on every notification trigger by default', () => {
    const prefs = defaultPreferences();
    expect(Object.keys(prefs.notifications).sort()).toEqual([...TRIGGERS].sort());
    expect(Object.values(prefs.notifications).every(Boolean)).toBe(true);
    expect(prefs.glass).toBe('frosted');
  });

  it('needs all three reaction lists on a comment', () => {
    const comment = {
      id: 'cmt_001', targetType: 'task', targetId: 'tsk_001', authorId: 'usr_001', body: 'Looks good',
      reactions: emptyReactions(), createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
    };
    expect(Comment.safeParse(comment).success).toBe(true);
    expect(Comment.safeParse({ ...comment, reactions: { '👍': [] } }).success).toBe(false);
  });

  it('checks project codes', () => {
    expect(Project.safeParse(project).success).toBe(true);
    expect(Project.safeParse({ ...project, code: 'kh-26-014' }).success).toBe(false);
  });
});
```

`src/api/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError, forbidden, invalid, notFound } from './errors';

describe('ApiError', () => {
  it('carries a code, a message and details', () => {
    const error = invalid('email', 'This email is already in use.');
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('invalid_input');
    expect(error.details).toEqual({ fields: ['email'] });
    expect(error.message).toBe('This email is already in use.');
  });

  it('has helpers for missing items and refusals', () => {
    expect(notFound('Task', 'tsk_009')).toMatchObject({ code: 'not_found', details: { id: 'tsk_009' } });
    expect(forbidden('This week is locked.', { reason: 'week_locked' })).toMatchObject({ code: 'forbidden', details: { reason: 'week_locked' } });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/api`
Expected: FAIL, "Failed to resolve import ./entities" and "./errors".

- [ ] **Step 3: Write the implementation**

`src/api/errors.ts`:

```ts
export type ApiErrorCode = 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'failed';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function invalid(field: string, message: string): ApiError {
  return new ApiError('invalid_input', message, { fields: [field] });
}

export function notFound(what: string, id: string): ApiError {
  return new ApiError('not_found', `${what} ${id} does not exist.`, { id });
}

export function forbidden(message = 'You cannot do this.', details: Record<string, unknown> = {}): ApiError {
  return new ApiError('forbidden', message, details);
}
```

`src/api/contract/entities.ts`:

```ts
import { z } from 'zod';

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_\\d{3,}$`), `Expected an id like ${prefix}_001.`);

export const UserId = id('usr');
export const ClientId = id('cli');
export const ProjectId = id('prj');
export const StageId = id('stg');
export const DeadlineId = id('ddl');
export const TaskId = id('tsk');
export const UpdateId = id('upd');
export const CommentId = id('cmt');
export const FileId = id('fil');
export const TimeId = id('tim');
export const NotificationId = id('ntf');
export const EventId = id('evt');

export const Day = z.iso.date();
export const Stamp = z.iso.datetime({ offset: true });

export const ProjectStatus = z.enum(['active', 'on_hold', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;
export const TaskStatus = z.enum(['todo', 'in_progress', 'in_review', 'done']);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const HealthValue = z.enum(['on_track', 'at_risk', 'late']);
export type HealthValue = z.infer<typeof HealthValue>;
export const Language = z.enum(['en', 'ar']);
export type Language = z.infer<typeof Language>;
export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;
export const Glass = z.enum(['clear', 'frosted', 'solid']);
export type Glass = z.infer<typeof Glass>;

export const TRIGGERS = [
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested',
  'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'week_under_target',
] as const;
export const Trigger = z.enum(TRIGGERS);
export type Trigger = z.infer<typeof Trigger>;

export const REACTIONS = ['👍', '✅', '👀'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

export const EventTarget = z.enum([
  'project', 'member', 'stage', 'deadline', 'task', 'update', 'comment', 'file', 'time', 'client', 'user', 'settings',
]);
export type EventTarget = z.infer<typeof EventTarget>;
export const NotificationTarget = z.enum(['project', 'task', 'update', 'week']);
export type NotificationTarget = z.infer<typeof NotificationTarget>;

export const Preferences = z.object({
  language: Language,
  theme: Theme,
  glass: Glass,
  notifications: z.record(Trigger, z.boolean()),
});
export type Preferences = z.infer<typeof Preferences>;

export function defaultPreferences(): Preferences {
  const notifications = Object.fromEntries(TRIGGERS.map((trigger) => [trigger, true])) as Record<Trigger, boolean>;
  return { language: 'en', theme: 'system', glass: 'frosted', notifications };
}

export const User = z.object({
  id: UserId,
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  avatarUrl: z.string().max(2000).nullable(),
  kind: z.enum(['human', 'agent']),
  systemRole: z.enum(['admin', 'member']),
  discipline: z.string().trim().min(1).max(40),
  weeklyHourTarget: z.number().min(0).max(80),
  active: z.boolean(),
  // For an agent: the person it acts for (spec 17). For a person: null.
  ownerId: UserId.nullable(),
  preferences: Preferences,
});
export type User = z.infer<typeof User>;

export const Client = z.object({
  id: ClientId,
  name: z.string().trim().min(1).max(120),
  contactName: z.string().max(80),
  phone: z.string().max(40),
  email: z.union([z.email(), z.literal('')]),
});
export type Client = z.infer<typeof Client>;

export const HealthOverride = z.object({
  value: HealthValue,
  reason: z.string().trim().min(1).max(280),
  setBy: UserId,
  setAt: Stamp,
});
export type HealthOverride = z.infer<typeof HealthOverride>;

export const Project = z.object({
  id: ProjectId,
  code: z.string().regex(/^[A-Z]{1,4}-\d{2}-\d{3,}$/),
  name: z.string().trim().min(1).max(120),
  clientId: ClientId.nullable(),
  status: ProjectStatus,
  leaderId: UserId.nullable(),
  currentStageId: StageId,
  location: z.string().max(120),
  areaM2: z.number().nonnegative().nullable(),
  startDate: Day.nullable(),
  targetEndDate: Day.nullable(),
  coverFileId: FileId.nullable(),
  modelFolderPath: z.string().max(260),
  description: z.string().max(5000),
  healthOverride: HealthOverride.nullable(),
  createdBy: UserId,
  createdAt: Stamp,
  updatedAt: Stamp,
});
export type Project = z.infer<typeof Project>;

export const ProjectMember = z.object({
  projectId: ProjectId,
  userId: UserId,
  discipline: z.string().trim().min(1).max(40),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

export const Stage = z.object({
  id: StageId,
  projectId: ProjectId,
  name: z.string().trim().min(1).max(60),
  order: z.number().int().min(0),
  startDate: Day.nullable(),
  endDate: Day.nullable(),
});
export type Stage = z.infer<typeof Stage>;

export const Deadline = z.object({
  id: DeadlineId,
  projectId: ProjectId,
  stageId: StageId.nullable(),
  name: z.string().trim().min(1).max(120),
  date: Day,
});
export type Deadline = z.infer<typeof Deadline>;

export const ChecklistItem = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(200),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const Task = z.object({
  id: TaskId,
  projectId: ProjectId,
  stageId: StageId,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000),
  ownerId: UserId,
  status: TaskStatus,
  dueDate: Day.nullable(),
  flagged: z.boolean(),
  needsReview: z.boolean(),
  checklist: z.array(ChecklistItem).max(100),
  createdBy: UserId,
  createdAt: Stamp,
  completedAt: Stamp.nullable(),
});
export type Task = z.infer<typeof Task>;

export const Update = z.object({
  id: UpdateId,
  projectId: ProjectId,
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  fileIds: z.array(FileId).max(20),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Update = z.infer<typeof Update>;

export function emptyReactions(): Record<Reaction, string[]> {
  return { '👍': [], '✅': [], '👀': [] };
}

export const Comment = z.object({
  id: CommentId,
  targetType: z.enum(['task', 'update']),
  targetId: z.union([TaskId, UpdateId]),
  authorId: UserId,
  body: z.string().trim().min(1).max(5000),
  reactions: z.record(Reaction, z.array(UserId)),
  createdAt: Stamp,
  editedAt: Stamp.nullable(),
});
export type Comment = z.infer<typeof Comment>;

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const FileVersion = z.object({
  letter: z.string().regex(/^[A-Z]+$/),
  blobKey: z.string().min(1),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  uploadedBy: UserId,
  uploadedAt: Stamp,
});
export type FileVersion = z.infer<typeof FileVersion>;

export const FileRec = z.object({
  id: FileId,
  projectId: ProjectId,
  stageId: StageId.nullable(),
  taskId: TaskId.nullable(),
  name: z.string().trim().min(1).max(200),
  versions: z.array(FileVersion).min(1),
});
export type FileRec = z.infer<typeof FileRec>;

export const TimeEntry = z.object({
  id: TimeId,
  userId: UserId,
  projectId: ProjectId,
  stageId: StageId,
  taskId: TaskId.nullable(),
  date: Day,
  hours: z.number().min(0.5).max(24).multipleOf(0.5),
});
export type TimeEntry = z.infer<typeof TimeEntry>;

export const TimeRow = z.object({
  key: z.string().min(1),
  userId: UserId,
  weekStart: Day,
  projectId: ProjectId,
  stageId: StageId,
  taskId: TaskId.nullable(),
});
export type TimeRow = z.infer<typeof TimeRow>;

export const Notification = z.object({
  id: NotificationId,
  userId: UserId,
  trigger: Trigger,
  actorId: UserId.nullable(),
  targetType: NotificationTarget,
  targetId: z.string().min(1),
  read: z.boolean(),
  createdAt: Stamp,
  dedupeKey: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const Event = z.object({
  id: EventId,
  seq: z.number().int().min(1),
  projectId: ProjectId.nullable(),
  actorId: UserId,
  actorKind: z.enum(['human', 'agent']),
  actingForId: UserId,
  correlationId: z.string().min(1).max(80),
  verb: z.string().min(1).max(60),
  targetType: EventTarget,
  targetId: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: Stamp,
  undoneBy: EventId.nullable(),
});
export type Event = z.infer<typeof Event>;

export const Settings = z.object({
  defaultStages: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  codePrefix: z.string().regex(/^[A-Z]{1,4}$/),
  workloadLimit: z.number().int().min(1).max(100),
});
export type Settings = z.infer<typeof Settings>;

export const WeekUnlock = z.object({ userId: UserId, weekStart: Day });
export type WeekUnlock = z.infer<typeof WeekUnlock>;
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/api`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api
git commit -m "feat: add entity schemas and API errors" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 4: Store and persisters

**Files:**
- Create: `src/api/store.ts`, `src/api/persist.ts`
- Test: `src/api/store.test.ts`, `src/api/persist.test.ts`

**Interfaces:**
- Consumes: entity types from Task 3.
- Produces: `STATE_VERSION = 1`, `DEFAULT_STAGES`, `type State`, `emptyState(today: string): State`, `memberKey(projectId: string, userId: string): string`, `nextId(state: State, prefix: string): string`, `class Store { constructor(state, persister); state; persistent; persister; run<T>(fn: (s: State) => T): T; read<T>(fn: (s: State) => T): T; replace(next: State): void; subscribe(listener: () => void): () => void; flush(): Promise<void> }`. `interface Persister { persistent; load(); save(state); putBlob(key, blob); getBlob(key); deleteBlob(key); clear() }`, `memoryPersister(): Persister`, `idbPersister(dbName?: string): Promise<Persister>`, `openPersister(): Promise<Persister>`.

- [ ] **Step 1: Write the failing tests**

`src/api/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Store, emptyState, memberKey, nextId } from './store';
import { memoryPersister } from './persist';

describe('Store', () => {
  it('gives ids with a prefix and three digits', () => {
    const state = emptyState('2026-09-30');
    expect(nextId(state, 'prj')).toBe('prj_001');
    expect(nextId(state, 'prj')).toBe('prj_002');
    expect(nextId(state, 'tsk')).toBe('tsk_001');
  });

  it('keys members by project and user', () => {
    expect(memberKey('prj_001', 'usr_002')).toBe('prj_001:usr_002');
  });

  it('rolls back a failed change', () => {
    const store = new Store(emptyState('2026-09-30'), memoryPersister());
    expect(() =>
      store.run((state) => {
        nextId(state, 'prj');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.state.counters.prj).toBeUndefined();
  });

  it('saves a good change', async () => {
    const persister = memoryPersister();
    const store = new Store(emptyState('2026-09-30'), persister);
    store.run((state) => {
      state.settings.workloadLimit = 12;
    });
    await store.flush();
    expect((await persister.load())?.settings.workloadLimit).toBe(12);
  });

  it('tells listeners about changes but not about reads', () => {
    const store = new Store(emptyState('2026-09-30'), memoryPersister());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.read((state) => state.version);
    expect(calls).toBe(0);
    store.run((state) => {
      state.settings.workloadLimit = 11;
    });
    expect(calls).toBe(1);
  });

  it('marks storage as not persistent when a save fails', async () => {
    const persister = {
      ...memoryPersister(),
      persistent: true,
      save: async () => {
        throw new Error('quota');
      },
    };
    const store = new Store(emptyState('2026-09-30'), persister);
    expect(store.persistent).toBe(true);
    store.run((state) => {
      state.settings.workloadLimit = 9;
    });
    await store.flush();
    expect(store.persistent).toBe(false);
  });
});
```

`src/api/persist.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { idbPersister, memoryPersister, openPersister } from './persist';
import { emptyState } from './store';

describe('persisters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps state and blobs in memory', async () => {
    const persister = memoryPersister();
    expect(persister.persistent).toBe(false);
    await persister.save(emptyState('2026-09-30'));
    expect((await persister.load())?.seededOn).toBe('2026-09-30');
    await persister.putBlob('blob_1', new Blob(['hello'], { type: 'text/plain' }));
    expect((await persister.getBlob('blob_1'))?.size).toBe(5);
    await persister.clear();
    expect(await persister.load()).toBeNull();
    expect(await persister.getBlob('blob_1')).toBeNull();
  });

  it('keeps state in IndexedDB across opens', async () => {
    const first = await idbPersister('madar-test-state');
    expect(first.persistent).toBe(true);
    await first.save(emptyState('2026-09-30'));
    const second = await idbPersister('madar-test-state');
    expect((await second.load())?.seededOn).toBe('2026-09-30');
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const persister = await openPersister();
    expect(persister.persistent).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/api/store.test.ts src/api/persist.test.ts`
Expected: FAIL, "Failed to resolve import ./store".

- [ ] **Step 3: Write the implementation**

`src/api/persist.ts`:

```ts
import { clear, createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { State } from './store';

export interface Persister {
  readonly persistent: boolean;
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryPersister(): Persister {
  let saved: State | null = null;
  const blobs = new Map<string, Blob>();
  return {
    persistent: false,
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async save(state) {
      saved = structuredClone(state);
    },
    async putBlob(key, blob) {
      blobs.set(key, blob);
    },
    async getBlob(key) {
      return blobs.get(key) ?? null;
    },
    async deleteBlob(key) {
      blobs.delete(key);
    },
    async clear() {
      saved = null;
      blobs.clear();
    },
  };
}

const STATE_KEY = 'state';
type StoredBlob = { type: string; bytes: ArrayBuffer };

/** Throws when IndexedDB is missing or blocked, for example in some sandboxes and private windows. */
export async function idbPersister(dbName = 'madar'): Promise<Persister> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) throw new Error('IndexedDB is not available.');
  const data: UseStore = createStore(dbName, 'data');
  const blobs: UseStore = createStore(`${dbName}-blobs`, 'blobs');
  await set('probe', 1, data);
  await del('probe', data);
  return {
    persistent: true,
    async load() {
      return (await get<State>(STATE_KEY, data)) ?? null;
    },
    async save(state) {
      await set(STATE_KEY, state, data);
    },
    async putBlob(key, blob) {
      const stored: StoredBlob = { type: blob.type, bytes: await blob.arrayBuffer() };
      await set(key, stored, blobs);
    },
    async getBlob(key) {
      const stored = await get<StoredBlob>(key, blobs);
      return stored ? new Blob([stored.bytes], { type: stored.type }) : null;
    },
    async deleteBlob(key) {
      await del(key, blobs);
    },
    async clear() {
      await clear(data);
      await clear(blobs);
    },
  };
}

export async function openPersister(): Promise<Persister> {
  try {
    return await idbPersister();
  } catch {
    return memoryPersister();
  }
}
```

`src/api/store.ts`:

```ts
import type {
  Client, Comment, Deadline, Event, FileRec, Notification, Project, ProjectMember, Settings, Stage, Task,
  TimeEntry, TimeRow, Update, User, WeekUnlock,
} from './contract/entities';
import type { Persister } from './persist';

export const STATE_VERSION = 1;

export const DEFAULT_STAGES = [
  'Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision',
] as const;

export type State = {
  version: number;
  seededOn: string;
  session: { currentUserId: string; simulateErrors: boolean };
  users: Record<string, User>;
  clients: Record<string, Client>;
  projects: Record<string, Project>;
  members: Record<string, ProjectMember>;
  stages: Record<string, Stage>;
  deadlines: Record<string, Deadline>;
  tasks: Record<string, Task>;
  updates: Record<string, Update>;
  comments: Record<string, Comment>;
  files: Record<string, FileRec>;
  time: Record<string, TimeEntry>;
  timeRows: Record<string, TimeRow>;
  notifications: Record<string, Notification>;
  events: Record<string, Event>;
  settings: Settings;
  weekUnlocks: WeekUnlock[];
  counters: Record<string, number>;
};

export function emptyState(today: string): State {
  return {
    version: STATE_VERSION,
    seededOn: today,
    session: { currentUserId: '', simulateErrors: false },
    users: {},
    clients: {},
    projects: {},
    members: {},
    stages: {},
    deadlines: {},
    tasks: {},
    updates: {},
    comments: {},
    files: {},
    time: {},
    timeRows: {},
    notifications: {},
    events: {},
    settings: { defaultStages: [...DEFAULT_STAGES], codePrefix: 'KH', workloadLimit: 10 },
    weekUnlocks: [],
    counters: {},
  };
}

export function memberKey(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

export function nextId(state: State, prefix: string): string {
  const n = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = n;
  return `${prefix}_${String(n).padStart(3, '0')}`;
}

export class Store {
  #state: State;
  #persistent: boolean;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #listeners = new Set<() => void>();
  readonly persister: Persister;

  constructor(state: State, persister: Persister) {
    this.#state = state;
    this.persister = persister;
    this.#persistent = persister.persistent;
  }

  get state(): State {
    return this.#state;
  }

  get persistent(): boolean {
    return this.#persistent;
  }

  /** Runs a change. The function must be synchronous. On an error, the state goes back to its value before the call. */
  run<T>(fn: (state: State) => T): T {
    const snapshot = structuredClone(this.#state);
    try {
      const result = fn(this.#state);
      this.#changed();
      return result;
    } catch (error) {
      this.#state = snapshot;
      throw error;
    }
  }

  /** Runs a read. A read does not save and does not tell the listeners. */
  read<T>(fn: (state: State) => T): T {
    return fn(this.#state);
  }

  replace(next: State): void {
    this.#state = next;
    this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async flush(): Promise<void> {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    await this.#save();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#save();
    }, 200);
  }

  async #save(): Promise<void> {
    try {
      await this.persister.save(this.#state);
    } catch {
      this.#persistent = false;
    }
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/api/store.test.ts src/api/persist.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/store.ts src/api/persist.ts src/api/store.test.ts src/api/persist.test.ts
git commit -m "feat: add the store with rollback and the persisters" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 5: Permissions and test factories

**Files:**
- Create: `src/api/permissions.ts`, `src/test/factories.ts`
- Test: `src/api/permissions.test.ts`

**Interfaces:**
- Consumes: `User` (Task 3), `State`, `emptyState`, `memberKey` (Task 4).
- Produces: `type Action` (19 actions), `type ProjectRole = 'leader' | 'team' | 'other'`, `type Resource = { projectRole?: ProjectRole; ownerId?: string; authorId?: string; targetUserId?: string }`, `can(actor: User, action: Action, resource?: Resource): boolean` (handlers pass the authority, see Task 9), `projectRoleOf(state: State, projectId: string, userId: string): ProjectRole`, `principalOf(state: State, userId: string): string` (an agent's person, or the person). Test helpers `TODAY`, `NOW`, `STAMP`, `makeUser`, `makeProject`, `makeStage`, `makeTask`, `makeWorld`.

The world from `makeWorld()`: `usr_001` Admin, `usr_002` leader of `prj_001`, `usr_003` team member, `usr_004` outsider, `usr_005` an agent that acts for `usr_003` (agents are never project members: they reach what their person reaches). `prj_001` has `stg_001` (Concept, past) and `stg_002` (Schematic Design, current, ends 2026-10-31). The current user is `usr_001`. The clock value `NOW` is Wednesday 2026-09-30, 09:00 office time.

- [ ] **Step 1: Write the test factories**

`src/test/factories.ts`:

```ts
import { defaultPreferences, type Project, type Stage, type Task, type User } from '../api/contract/entities';
import { emptyState, memberKey, type State } from '../api/store';

export const TODAY = '2026-09-30';
export const NOW = new Date('2026-09-30T06:00:00Z');
export const STAMP = '2026-09-30T09:00:00.000+03:00';

export function makeUser(id: string, overrides: Partial<User> = {}): User {
  return {
    id, name: id, email: `${id}@madar.test`, avatarUrl: null, kind: 'human', systemRole: 'member',
    discipline: 'Architect', weeklyHourTarget: 40, active: true, ownerId: null, preferences: defaultPreferences(), ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'prj_001', code: 'KH-26-001', name: 'Test Tower', clientId: null, status: 'active', leaderId: 'usr_002',
    currentStageId: 'stg_002', location: 'Al Khobar', areaM2: 1000, startDate: '2026-08-01', targetEndDate: '2027-06-30',
    coverFileId: null, modelFolderPath: '', description: '', healthOverride: null, createdBy: 'usr_001',
    createdAt: STAMP, updatedAt: STAMP, ...overrides,
  };
}

export function makeStage(overrides: Partial<Stage> = {}): Stage {
  return { id: 'stg_001', projectId: 'prj_001', name: 'Concept', order: 0, startDate: null, endDate: null, ...overrides };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_001', projectId: 'prj_001', stageId: 'stg_002', title: 'Ground floor plan', description: '', ownerId: 'usr_003',
    status: 'todo', dueDate: null, flagged: false, needsReview: true, checklist: [], createdBy: 'usr_002',
    createdAt: STAMP, completedAt: null, ...overrides,
  };
}

/** A small office: an Admin, a leader, a team member, an outsider and an agent, with one project. */
export function makeWorld(): State {
  const state = emptyState(TODAY);
  const users = [
    makeUser('usr_001', { name: 'Hala Admin', systemRole: 'admin' }),
    makeUser('usr_002', { name: 'Faisal Leader' }),
    makeUser('usr_003', { name: 'Sara Team' }),
    makeUser('usr_004', { name: 'Omar Other' }),
    makeUser('usr_005', { name: 'Madar Assistant', kind: 'agent', discipline: 'Agent', weeklyHourTarget: 0, ownerId: 'usr_003' }),
  ];
  for (const user of users) state.users[user.id] = user;
  state.projects.prj_001 = makeProject();
  state.stages.stg_001 = makeStage({ startDate: '2026-08-01', endDate: '2026-08-31' });
  state.stages.stg_002 = makeStage({ id: 'stg_002', name: 'Schematic Design', order: 1, startDate: '2026-09-01', endDate: '2026-10-31' });
  for (const [userId, discipline] of [['usr_002', 'Architect'], ['usr_003', 'Architect']]) {
    state.members[memberKey('prj_001', userId)] = { projectId: 'prj_001', userId, discipline };
  }
  state.session.currentUserId = 'usr_001';
  state.counters = { usr: 5, prj: 1, stg: 2 };
  return state;
}
```

- [ ] **Step 2: Write the failing test**

`src/api/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { can, principalOf, projectRoleOf, type Action, type ProjectRole } from './permissions';
import type { User } from './contract/entities';
import { makeUser, makeWorld } from '../test/factories';

const admin = makeUser('usr_001', { systemRole: 'admin' });
const leader = makeUser('usr_002');
const team = makeUser('usr_003');
const other = makeUser('usr_004');
const actors: [string, User, ProjectRole][] = [
  ['admin', admin, 'other'],
  ['leader', leader, 'leader'],
  ['team', team, 'team'],
  ['other', other, 'other'],
];

const none = () => ({});
const own = (u: User) => ({ ownerId: u.id, authorId: u.id });
const someoneElse = () => ({ targetUserId: 'usr_099' });

// Expected results for admin, leader, team, other. Copied from spec section 2.3.
const TABLE: [Action, [boolean, boolean, boolean, boolean], (u: User) => Record<string, string>][] = [
  ['project.view', [true, true, true, true], none],
  ['project.create', [true, true, true, true], none],
  ['project.edit', [true, true, false, false], none],
  ['project.changeLeader', [true, true, false, false], none],
  ['project.archive', [true, true, false, false], none],
  ['project.delete', [true, false, false, false], none],
  ['project.healthOverride', [true, true, false, false], none],
  ['task.createForAnyone', [true, true, false, false], none],
  ['task.createForSelf', [true, true, true, false], none],
  ['task.updateOwn', [true, true, true, false], own],
  ['task.updateAny', [true, true, false, false], none],
  ['task.review', [true, true, false, false], none],
  ['task.delete', [true, true, false, false], none],
  ['content.post', [true, true, true, false], none],
  ['content.editOwn', [true, true, true, false], own],
  ['time.logOnProject', [true, true, true, false], none],
  ['time.viewPerson', [true, true, false, false], someoneElse],
  ['event.undoAgent', [true, true, false, false], none],
  ['admin.manage', [true, false, false, false], none],
];

describe('permission table (spec 2.3)', () => {
  for (const [action, expected, extra] of TABLE) {
    actors.forEach(([label, actor, role], i) => {
      it(`${action} for ${label} is ${expected[i]}`, () => {
        expect(can(actor, action, { projectRole: role, ...extra(actor) })).toBe(expected[i]);
      });
    });
  }
});

describe('permission details', () => {
  it('stops a team member from changing a task they do not own', () => {
    expect(can(team, 'task.updateOwn', { projectRole: 'team', ownerId: 'usr_002' })).toBe(false);
  });

  it('stops a team member from editing a comment they did not write', () => {
    expect(can(team, 'content.editOwn', { projectRole: 'team', authorId: 'usr_002' })).toBe(false);
  });

  it('lets everyone see their own hours', () => {
    expect(can(other, 'time.viewPerson', { targetUserId: other.id })).toBe(true);
  });

  it('lets an inactive person only view', () => {
    const gone = makeUser('usr_009', { active: false, systemRole: 'admin' });
    expect(can(gone, 'project.view')).toBe(true);
    expect(can(gone, 'project.create')).toBe(false);
    expect(can(gone, 'admin.manage')).toBe(false);
  });

  it('reads the project role from the state', () => {
    const state = makeWorld();
    expect(projectRoleOf(state, 'prj_001', 'usr_002')).toBe('leader');
    expect(projectRoleOf(state, 'prj_001', 'usr_003')).toBe('team');
    expect(projectRoleOf(state, 'prj_001', 'usr_004')).toBe('other');
    expect(projectRoleOf(state, 'prj_404', 'usr_002')).toBe('other');
  });

  it('finds the person behind an agent', () => {
    const state = makeWorld();
    expect(principalOf(state, 'usr_005')).toBe('usr_003');
    expect(principalOf(state, 'usr_002')).toBe('usr_002');
  });
});
```

- [ ] **Step 3: Run the test to see it fail**

Run: `npx vitest run src/api/permissions.test.ts`
Expected: FAIL, "Failed to resolve import ./permissions".

- [ ] **Step 4: Write the implementation**

`src/api/permissions.ts`:

```ts
import type { User } from './contract/entities';
import { memberKey, type State } from './store';

export type Action =
  | 'project.view' | 'project.create' | 'project.edit' | 'project.changeLeader' | 'project.archive'
  | 'project.delete' | 'project.healthOverride'
  | 'task.createForAnyone' | 'task.createForSelf' | 'task.updateOwn' | 'task.updateAny' | 'task.review' | 'task.delete'
  | 'content.post' | 'content.editOwn'
  | 'time.logOnProject' | 'time.viewPerson'
  | 'event.undoAgent' | 'admin.manage';

export type ProjectRole = 'leader' | 'team' | 'other';

export type Resource = { projectRole?: ProjectRole; ownerId?: string; authorId?: string; targetUserId?: string };

export function projectRoleOf(state: State, projectId: string, userId: string): ProjectRole {
  const project = state.projects[projectId];
  if (!project) return 'other';
  if (project.leaderId === userId) return 'leader';
  return state.members[memberKey(projectId, userId)] ? 'team' : 'other';
}

/** The person behind a user: an agent's owner, or the person. */
export function principalOf(state: State, userId: string): string {
  const user = state.users[userId];
  return user?.kind === 'agent' && user.ownerId ? user.ownerId : userId;
}

/** The permission table from spec section 2.3. No screen checks permissions in another way. */
export function can(actor: User, action: Action, resource: Resource = {}): boolean {
  if (!actor.active) return action === 'project.view';
  const admin = actor.systemRole === 'admin';
  const role = resource.projectRole ?? 'other';
  const leads = admin || role === 'leader';
  const onProject = leads || role === 'team';
  switch (action) {
    case 'project.view':
    case 'project.create':
      return true;
    case 'project.edit':
    case 'project.changeLeader':
    case 'project.archive':
    case 'project.healthOverride':
    case 'task.createForAnyone':
    case 'task.updateAny':
    case 'task.review':
    case 'task.delete':
    case 'event.undoAgent':
      return leads;
    case 'project.delete':
    case 'admin.manage':
      return admin;
    case 'task.createForSelf':
    case 'content.post':
    case 'time.logOnProject':
      return onProject;
    case 'task.updateOwn':
      return leads || (onProject && resource.ownerId === actor.id);
    case 'content.editOwn':
      return onProject && resource.authorId === actor.id;
    case 'time.viewPerson':
      return resource.targetUserId === actor.id || admin || role === 'leader';
    default:
      return false;
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/api/permissions.test.ts`
Expected: PASS (82 tests).

- [ ] **Step 6: Commit**

```bash
git add src/api/permissions.ts src/api/permissions.test.ts src/test/factories.ts
git commit -m "feat: add the permission table and test factories" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 6: Health rule

**Files:**
- Create: `src/api/health.ts`
- Test: `src/api/health.test.ts`

**Interfaces:**
- Consumes: `Project`, `Stage`, `Task`, `HealthValue` (Task 3), `diffDays` (Task 2).
- Produces: `type HealthResult = { value: HealthValue; computed: HealthValue; overridden: boolean; reason: string | null; setBy: string | null }`, `isOverdue(task: Task, today: string): boolean`, `computeHealth(input: { project: Project; stages: Stage[]; tasks: Task[] }, today: string): HealthResult | null`.

- [ ] **Step 1: Write the failing test**

`src/api/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeHealth, isOverdue } from './health';
import { makeProject, makeStage, makeTask, STAMP, TODAY } from '../test/factories';

const past = makeStage();
const current = makeStage({ id: 'stg_002', name: 'Schematic Design', order: 1, startDate: '2026-09-01', endDate: '2026-10-31' });
const withEnd = (endDate: string) => [past, { ...current, endDate }];
const base = { project: makeProject(), stages: [past, current], tasks: [] as ReturnType<typeof makeTask>[] };

describe('computeHealth (spec 4.2)', () => {
  it('is on track with no problems', () => {
    expect(computeHealth(base, TODAY)?.value).toBe('on_track');
  });

  it('is late after the current stage end date', () => {
    expect(computeHealth({ ...base, stages: withEnd('2026-09-29') }, TODAY)?.value).toBe('late');
  });

  it('is not late on the end date itself', () => {
    expect(computeHealth({ ...base, stages: withEnd(TODAY) }, TODAY)?.value).toBe('on_track');
  });

  it('is at risk with an overdue task', () => {
    const tasks = [makeTask({ dueDate: '2026-09-29', status: 'in_progress' })];
    expect(computeHealth({ ...base, tasks }, TODAY)?.value).toBe('at_risk');
  });

  it('does not count tasks in review or done as overdue', () => {
    const inReview = makeTask({ dueDate: '2026-09-29', status: 'in_review' });
    const done = makeTask({ id: 'tsk_002', dueDate: '2026-09-29', status: 'done' });
    expect(isOverdue(inReview, TODAY)).toBe(false);
    expect(isOverdue(done, TODAY)).toBe(false);
    expect(computeHealth({ ...base, tasks: [inReview, done] }, TODAY)?.value).toBe('on_track');
  });

  it('is at risk when the stage ends within 7 days and less than 70% is done', () => {
    const tasks = [
      makeTask({ id: 'tsk_001', status: 'done' }),
      makeTask({ id: 'tsk_002', status: 'done' }),
      makeTask({ id: 'tsk_003', dueDate: '2026-10-05' }),
      makeTask({ id: 'tsk_004', dueDate: '2026-10-06' }),
    ];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-07'), tasks }, TODAY)?.value).toBe('at_risk');
  });

  it('stays on track at 70% or more done', () => {
    const tasks = [
      makeTask({ id: 'tsk_001', status: 'done' }),
      makeTask({ id: 'tsk_002', status: 'done' }),
      makeTask({ id: 'tsk_003', status: 'done' }),
      makeTask({ id: 'tsk_004', dueDate: '2026-10-06' }),
    ];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-07'), tasks }, TODAY)?.value).toBe('on_track');
  });

  it('ignores the 70% rule 8 days before the end', () => {
    const tasks = [makeTask({ id: 'tsk_001', dueDate: '2026-10-07' }), makeTask({ id: 'tsk_002', dueDate: '2026-10-07' })];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-08'), tasks }, TODAY)?.value).toBe('on_track');
  });

  it('ignores the 70% rule for a stage with no tasks', () => {
    expect(computeHealth({ ...base, stages: withEnd('2026-10-03') }, TODAY)?.value).toBe('on_track');
  });

  it('uses the override and keeps the computed value', () => {
    const project = makeProject({ healthOverride: { value: 'at_risk', reason: 'Client delay', setBy: 'usr_002', setAt: STAMP } });
    expect(computeHealth({ ...base, project }, TODAY)).toEqual({
      value: 'at_risk', computed: 'on_track', overridden: true, reason: 'Client delay', setBy: 'usr_002',
    });
  });

  it('has no health for a project that is not active', () => {
    expect(computeHealth({ ...base, project: makeProject({ status: 'on_hold' }) }, TODAY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/health.test.ts`
Expected: FAIL, "Failed to resolve import ./health".

- [ ] **Step 3: Write the implementation**

`src/api/health.ts`:

```ts
import type { HealthValue, Project, Stage, Task } from './contract/entities';
import { diffDays } from '../lib/dates';

export type HealthResult = {
  value: HealthValue;
  computed: HealthValue;
  overridden: boolean;
  reason: string | null;
  setBy: string | null;
};

/** A task in review is not overdue: the owner finished it. */
export function isOverdue(task: Task, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today && (task.status === 'todo' || task.status === 'in_progress');
}

function computeRaw(project: Project, stages: Stage[], tasks: Task[], today: string): HealthValue {
  const current = stages.find((stage) => stage.id === project.currentStageId) ?? null;
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  if (current?.endDate && today > current.endDate) return 'late';
  if (projectTasks.some((task) => isOverdue(task, today))) return 'at_risk';
  if (current?.endDate && diffDays(today, current.endDate) <= 7) {
    const stageTasks = projectTasks.filter((task) => task.stageId === current.id);
    const done = stageTasks.filter((task) => task.status === 'done').length;
    if (stageTasks.length > 0 && done / stageTasks.length < 0.7) return 'at_risk';
  }
  return 'on_track';
}

/** The health rule from spec section 4.2. Returns null for projects that are not active. */
export function computeHealth(input: { project: Project; stages: Stage[]; tasks: Task[] }, today: string): HealthResult | null {
  const { project, stages, tasks } = input;
  if (project.status !== 'active') return null;
  const computed = computeRaw(project, stages, tasks, today);
  const override = project.healthOverride;
  if (override) return { value: override.value, computed, overridden: true, reason: override.reason, setBy: override.setBy };
  return { value: computed, computed, overridden: false, reason: null, setBy: null };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/api/health.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/health.ts src/api/health.test.ts
git commit -m "feat: add the project health rule" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 7: Event log and undo

**Files:**
- Create: `src/api/events.ts`
- Test: `src/api/events.test.ts`

**Interfaces:**
- Consumes: `Event`, `EventTarget`, `User` (Task 3), `ApiError`, `notFound` (Task 3), `State`, `nextId` (Task 4).
- Produces: `type EventContext = { state: State; actor: User; stamp: string; authority?: User; correlationId?: string }`, `type EventMeta = { projectId: string | null; verb: string; targetType: EventTarget; targetId: string }`, `NOT_UNDOABLE: Set<string>`, `writeEvent(ec, input: EventMeta & { before: unknown; after: unknown }): Event`, `recordCreate(ec, meta: EventMeta & { entity: unknown }): Event`, `recordDelete(ec, meta: EventMeta & { entity: unknown }): Event`, `applyPatch<T extends object>(ec, target: T, changes: Partial<T>, meta: EventMeta): Event | null`, `undoEvent(ec, eventId: string): Event`.

Every call context (`Ctx`, Task 9) has `state`, `actor` and `stamp`, so handlers pass their context as the `EventContext`.

- [ ] **Step 1: Write the failing test**

`src/api/events.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPatch, recordCreate, recordDelete, undoEvent, writeEvent, type EventContext } from './events';
import type { ApiError } from './errors';
import { makeTask, makeWorld, STAMP } from '../test/factories';

let ec: EventContext;
const meta = { projectId: 'prj_001', verb: 'task.updated', targetType: 'task' as const, targetId: 'tsk_001' };

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return (error as ApiError).code;
  }
}

beforeEach(() => {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask();
  ec = { state, actor: state.users.usr_002, stamp: STAMP };
});

describe('event log', () => {
  it('numbers events in order', () => {
    const a = writeEvent(ec, { ...meta, before: null, after: null });
    const b = writeEvent(ec, { ...meta, before: null, after: null });
    expect([a.id, a.seq, b.id, b.seq]).toEqual(['evt_001', 1, 'evt_002', 2]);
    expect(a.actorKind).toBe('human');
    expect(a.createdAt).toBe(STAMP);
  });

  it('records only the fields that change', () => {
    const task = ec.state.tasks.tsk_001;
    const event = applyPatch(ec, task, { status: 'in_progress', title: task.title }, meta);
    expect(event?.before).toEqual({ status: 'todo' });
    expect(event?.after).toEqual({ status: 'in_progress' });
    expect(task.status).toBe('in_progress');
    expect(applyPatch(ec, task, { status: 'in_progress' }, meta)).toBeNull();
  });

  it('records the person an agent acted for, and the story id', () => {
    const agent = ec.state.users.usr_005;
    const event = writeEvent({ ...ec, actor: agent, correlationId: 'cor_weekly' }, { ...meta, before: null, after: null });
    expect(event).toMatchObject({ actorId: 'usr_005', actorKind: 'agent', actingForId: 'usr_003', correlationId: 'cor_weekly' });
    expect(writeEvent(ec, { ...meta, before: null, after: null }).actingForId).toBe('usr_002');
  });
});

describe('undo', () => {
  it('puts the old values back and marks the event', () => {
    const task = ec.state.tasks.tsk_001;
    const event = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    const undo = undoEvent(ec, event.id);
    expect(task.status).toBe('todo');
    expect(undo.verb).toBe('undo');
    expect(ec.state.events[event.id].undoneBy).toBe(undo.id);
  });

  it('refuses after a later change to the same field', () => {
    const task = ec.state.tasks.tsk_001;
    const first = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    applyPatch(ec, task, { status: 'done' }, meta);
    expect(codeOf(() => undoEvent(ec, first.id))).toBe('conflict');
  });

  it('allows an undo after a later change to another field', () => {
    const task = ec.state.tasks.tsk_001;
    const first = applyPatch(ec, task, { status: 'in_progress' }, meta)!;
    applyPatch(ec, task, { flagged: true }, meta);
    undoEvent(ec, first.id);
    expect(task.status).toBe('todo');
    expect(task.flagged).toBe(true);
  });

  it('undoes a create and a delete', () => {
    const extra = makeTask({ id: 'tsk_002' });
    ec.state.tasks.tsk_002 = extra;
    const created = recordCreate(ec, { ...meta, targetId: 'tsk_002', entity: extra });
    undoEvent(ec, created.id);
    expect(ec.state.tasks.tsk_002).toBeUndefined();

    const deleted = recordDelete(ec, { ...meta, entity: ec.state.tasks.tsk_001 });
    delete ec.state.tasks.tsk_001;
    undoEvent(ec, deleted.id);
    expect(ec.state.tasks.tsk_001.title).toBe('Ground floor plan');
  });

  it('refuses to undo twice and refuses some verbs', () => {
    const event = applyPatch(ec, ec.state.tasks.tsk_001, { status: 'in_progress' }, meta)!;
    undoEvent(ec, event.id);
    expect(codeOf(() => undoEvent(ec, event.id))).toBe('conflict');
    const created = writeEvent(ec, { projectId: 'prj_001', verb: 'project.created', targetType: 'project', targetId: 'prj_001', before: null, after: {} });
    expect(codeOf(() => undoEvent(ec, created.id))).toBe('conflict');
    expect(codeOf(() => undoEvent(ec, 'evt_999'))).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/events.test.ts`
Expected: FAIL, "Failed to resolve import ./events".

- [ ] **Step 3: Write the implementation**

`src/api/events.ts`:

```ts
import type { Event, EventTarget, User } from './contract/entities';
import { ApiError, notFound } from './errors';
import { nextId, type State } from './store';

export type EventContext = { state: State; actor: User; stamp: string; authority?: User; correlationId?: string };
export type EventMeta = { projectId: string | null; verb: string; targetType: EventTarget; targetId: string };

const COLLECTION: Record<EventTarget, keyof State | null> = {
  project: 'projects', member: 'members', stage: 'stages', deadline: 'deadlines', task: 'tasks', update: 'updates',
  comment: 'comments', file: 'files', time: 'time', client: 'clients', user: 'users', settings: null,
};

export const NOT_UNDOABLE = new Set(['project.created', 'project.deleted', 'project.stages_changed', 'undo']);

export function writeEvent(ec: EventContext, input: EventMeta & { before: unknown; after: unknown }): Event {
  const id = nextId(ec.state, 'evt');
  const event: Event = {
    id, seq: ec.state.counters.evt, projectId: input.projectId, actorId: ec.actor.id, actorKind: ec.actor.kind,
    // Two names on every change (spec 17): who acted, and the person they acted for.
    actingForId: ec.authority?.id ?? ec.actor.ownerId ?? ec.actor.id,
    correlationId: ec.correlationId ?? `cor_${id}`,
    verb: input.verb, targetType: input.targetType, targetId: input.targetId, before: input.before, after: input.after,
    createdAt: ec.stamp, undoneBy: null,
  };
  ec.state.events[id] = event;
  return event;
}

export function recordCreate(ec: EventContext, meta: EventMeta & { entity: unknown }): Event {
  return writeEvent(ec, { ...meta, before: null, after: structuredClone(meta.entity) });
}

export function recordDelete(ec: EventContext, meta: EventMeta & { entity: unknown }): Event {
  return writeEvent(ec, { ...meta, before: structuredClone(meta.entity), after: null });
}

/** Applies the changed fields to the target and records one event. Returns null when nothing changes. */
export function applyPatch<T extends object>(ec: EventContext, target: T, changes: Partial<T>, meta: EventMeta): Event | null {
  const record = target as unknown as Record<string, unknown>;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, next] of Object.entries(changes)) {
    if (next === undefined) continue;
    if (JSON.stringify(record[key]) === JSON.stringify(next)) continue;
    before[key] = structuredClone(record[key]);
    after[key] = structuredClone(next);
    record[key] = structuredClone(next);
  }
  if (Object.keys(after).length === 0) return null;
  return writeEvent(ec, { ...meta, before, after });
}

function conflict(): ApiError {
  return new ApiError('conflict', 'This item changed after that edit. Undo is not available.');
}

export function undoEvent(ec: EventContext, eventId: string): Event {
  const event = ec.state.events[eventId];
  if (!event) throw notFound('Event', eventId);
  if (event.undoneBy) throw new ApiError('conflict', 'This change is already undone.');
  const key = COLLECTION[event.targetType];
  if (!key || NOT_UNDOABLE.has(event.verb)) throw new ApiError('conflict', 'This change cannot be undone.');
  const collection = ec.state[key] as unknown as Record<string, Record<string, unknown>>;
  const current = collection[event.targetId];
  const later = Object.values(ec.state.events).filter(
    (e) => e.seq > event.seq && e.targetType === event.targetType && e.targetId === event.targetId && e.undoneBy === null && e.verb !== 'undo',
  );
  const meta: EventMeta = { projectId: event.projectId, verb: 'undo', targetType: event.targetType, targetId: event.targetId };
  let undo: Event;
  if (event.before === null) {
    if (!current || later.length > 0) throw conflict();
    delete collection[event.targetId];
    undo = writeEvent(ec, { ...meta, before: structuredClone(current), after: null });
  } else if (event.after === null) {
    if (current) throw conflict();
    collection[event.targetId] = structuredClone(event.before) as Record<string, unknown>;
    undo = writeEvent(ec, { ...meta, before: null, after: structuredClone(event.before) });
  } else {
    const restore = event.before as Record<string, unknown>;
    const keys = Object.keys(event.after as Record<string, unknown>);
    const clash = later.some((e) => e.after === null || Object.keys((e.after ?? {}) as object).some((k) => keys.includes(k)));
    if (!current || clash) throw conflict();
    const before: Record<string, unknown> = {};
    for (const field of Object.keys(restore)) {
      before[field] = structuredClone(current[field]);
      current[field] = structuredClone(restore[field]);
    }
    undo = writeEvent(ec, { ...meta, before, after: structuredClone(restore) });
  }
  event.undoneBy = undo.id;
  return undo;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/api/events.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/events.ts src/api/events.test.ts
git commit -m "feat: add the event log and undo" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 8: Text helpers and notifications

**Files:**
- Create: `src/lib/text.ts`, `src/api/notify.ts`
- Test: `src/lib/text.test.ts`, `src/api/notify.test.ts`

**Interfaces:**
- Consumes: `Notification`, `NotificationTarget`, `Trigger`, `User` (Task 3), `State`, `nextId` (Task 4), `addDays`, `nowStamp`, `officeClock`, `weekStartOf` (Task 2).
- Produces: `mentionedUserIds(body: string): string[]`, `mentionMarkup(name: string, userId: string): string`, `linkedProjectCodes(body: string): string[]`, `normalizeForSearch(text: string): string`. `type NotifyInput = { userIds: string[]; trigger: Trigger; targetType: NotificationTarget; targetId: string; dedupeKey?: string }`, `notify(state, actor: User | null, stamp: string, input: NotifyInput): Notification[]`, `reviewersOf(state, projectId): string[]`, `projectPeople(state, projectId): string[]`, `runScheduledTriggers(state, at: Date): number`.

A mention is stored as `@[Name](usr_005)`. The composer in plan 3 inserts this markup. The screen shows only the name.

- [ ] **Step 1: Write the failing tests**

`src/lib/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { linkedProjectCodes, mentionMarkup, mentionedUserIds, normalizeForSearch } from './text';

describe('text helpers', () => {
  it('reads mentions once each', () => {
    const body = 'Hi @[Sara Al-Qahtani](usr_005) and @[Omar](usr_004), and again @[Sara Al-Qahtani](usr_005).';
    expect(mentionedUserIds(body)).toEqual(['usr_005', 'usr_004']);
  });

  it('writes mention markup', () => {
    expect(mentionMarkup('Sara', 'usr_005')).toBe('@[Sara](usr_005)');
  });

  it('reads project links', () => {
    expect(linkedProjectCodes('See #KH-26-014 and #KH-26-015.')).toEqual(['KH-26-014', 'KH-26-015']);
  });

  it('ignores case, spaces, diacritics and letter forms in search', () => {
    expect(normalizeForSearch('  CORNICHE   Tower ')).toBe('corniche tower');
    expect(normalizeForSearch('أَحْمَد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إبراهيم')).toBe(normalizeForSearch('ابراهيم'));
    expect(normalizeForSearch('مدرسة')).toBe(normalizeForSearch('مدرسه'));
    expect(normalizeForSearch('مستشفى')).toBe(normalizeForSearch('مستشفي'));
  });
});
```

`src/api/notify.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { notify, projectPeople, reviewersOf, runScheduledTriggers } from './notify';
import type { State } from './store';
import { makeTask, makeWorld, NOW, STAMP } from '../test/factories';

let state: State;
beforeEach(() => {
  state = makeWorld();
});

const byTrigger = (trigger: string) => Object.values(state.notifications).filter((n) => n.trigger === trigger);

describe('notify', () => {
  it('skips the actor, agents, inactive people and turned-off triggers', () => {
    state.users.usr_004.active = false;
    state.users.usr_003.preferences.notifications.mention = false;
    const made = notify(state, state.users.usr_002, STAMP, {
      userIds: ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001',
    });
    expect(made.map((n) => n.userId)).toEqual(['usr_001']);
    expect(made[0].actorId).toBe('usr_002');
    expect(made[0].read).toBe(false);
  });

  it('creates one notification per dedupe key', () => {
    for (let i = 0; i < 3; i += 1) {
      notify(state, null, STAMP, { userIds: ['usr_003'], trigger: 'overdue', targetType: 'task', targetId: 'tsk_001', dedupeKey: 'overdue:tsk_001:2026-09-28' });
    }
    expect(Object.values(state.notifications)).toHaveLength(1);
  });

  it('sends reviews to the leader, or to every Admin with no leader', () => {
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_002']);
    state.projects.prj_001.leaderId = null;
    expect(reviewersOf(state, 'prj_001')).toEqual(['usr_001']);
  });

  it('lists the people on a project', () => {
    expect(projectPeople(state, 'prj_001').sort()).toEqual(['usr_002', 'usr_003']);
  });

  it('does not tell a person about their own agent', () => {
    const made = notify(state, state.users.usr_005, STAMP, { userIds: ['usr_002', 'usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
    expect(made.map((n) => n.userId)).toEqual(['usr_002']);
  });
});

describe('runScheduledTriggers', () => {
  beforeEach(() => {
    state.tasks.tsk_001 = makeTask({ id: 'tsk_001', dueDate: '2026-10-01' });
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', dueDate: '2026-09-28', status: 'in_progress' });
    state.tasks.tsk_003 = makeTask({ id: 'tsk_003', dueDate: '2026-09-28', status: 'in_review' });
  });

  it('creates the due-tomorrow and overdue notices once', () => {
    expect(runScheduledTriggers(state, NOW)).toBe(2);
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    expect(byTrigger('due_tomorrow').map((n) => n.targetId)).toEqual(['tsk_001']);
    expect(byTrigger('overdue').map((n) => n.targetId)).toEqual(['tsk_002']);
  });

  it('reminds people under target on Thursday afternoon, once a week', () => {
    state.tasks = {};
    runScheduledTriggers(state, new Date('2026-10-01T12:30:00Z'));
    expect(byTrigger('week_under_target').map((n) => n.userId).sort()).toEqual(['usr_001', 'usr_002', 'usr_003', 'usr_004']);
    runScheduledTriggers(state, new Date('2026-10-01T13:30:00Z'));
    expect(byTrigger('week_under_target')).toHaveLength(4);
  });

  it('does not remind a person at their target', () => {
    state.tasks = {};
    ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'].forEach((date, i) => {
      const id = `tim_00${i + 1}`;
      state.time[id] = { id, userId: 'usr_003', projectId: 'prj_001', stageId: 'stg_002', taskId: null, date, hours: 8 };
    });
    runScheduledTriggers(state, new Date('2026-10-01T12:30:00Z'));
    expect(byTrigger('week_under_target').map((n) => n.userId)).not.toContain('usr_003');
  });

  it('uses the office day near midnight', () => {
    state.tasks = {};
    runScheduledTriggers(state, new Date('2026-09-30T23:30:00Z'));
    expect(Object.values(state.notifications)).toHaveLength(0);
  });

  it('ignores tasks in projects that are not active', () => {
    state.projects.prj_001.status = 'on_hold';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/lib/text.test.ts src/api/notify.test.ts`
Expected: FAIL, "Failed to resolve import ./text" and "./notify".

- [ ] **Step 3: Write the implementation**

`src/lib/text.ts`:

```ts
const MENTION = /@\[([^\]]{1,80})\]\((usr_\d{3,})\)/g;
const PROJECT_LINK = /#([A-Z]{1,4}-\d{2}-\d{3,})\b/g;

export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))];
}

export function mentionMarkup(name: string, userId: string): string {
  return `@[${name}](${userId})`;
}

export function linkedProjectCodes(body: string): string[] {
  return [...new Set([...body.matchAll(PROJECT_LINK)].map((match) => match[1]))];
}

/** Lower case, one space, no Arabic diacritics or tatweel, one alef form, taa marbuta as haa, alef maqsura as yaa. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}
```

`src/api/notify.ts`:

```ts
import type { Notification, NotificationTarget, Trigger, User } from './contract/entities';
import { nextId, type State } from './store';
import { addDays, nowStamp, officeClock, weekStartOf } from '../lib/dates';

export type NotifyInput = {
  userIds: string[];
  trigger: Trigger;
  targetType: NotificationTarget;
  targetId: string;
  dedupeKey?: string;
};

/** Skips the actor and the person an agent actor works for, agents, inactive people, people who turned the trigger off, and repeats of a dedupe key. */
export function notify(state: State, actor: User | null, stamp: string, input: NotifyInput): Notification[] {
  const created: Notification[] = [];
  for (const userId of new Set(input.userIds)) {
    const user = state.users[userId];
    if (!user || !user.active || user.kind === 'agent') continue;
    if (actor && (user.id === actor.id || user.id === actor.ownerId)) continue;
    if (!user.preferences.notifications[input.trigger]) continue;
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${userId}` : null;
    if (dedupeKey && Object.values(state.notifications).some((n) => n.dedupeKey === dedupeKey)) continue;
    const id = nextId(state, 'ntf');
    const notification: Notification = {
      id, userId, trigger: input.trigger, actorId: actor?.id ?? null, targetType: input.targetType,
      targetId: input.targetId, read: false, createdAt: stamp, dedupeKey,
    };
    state.notifications[id] = notification;
    created.push(notification);
  }
  return created;
}

/** The leader reviews. A project with no leader goes to every active Admin. */
export function reviewersOf(state: State, projectId: string): string[] {
  const project = state.projects[projectId];
  if (project?.leaderId) return [project.leaderId];
  return Object.values(state.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id);
}

export function projectPeople(state: State, projectId: string): string[] {
  const ids = Object.values(state.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = state.projects[projectId]?.leaderId;
  if (leaderId) ids.push(leaderId);
  return [...new Set(ids)];
}

/** Time-based triggers. The app runs them at start and every minute. Dedupe keys stop repeats. */
export function runScheduledTriggers(state: State, at: Date): number {
  const clock = officeClock(at);
  const today = clock.day;
  const tomorrow = addDays(today, 1);
  const stamp = nowStamp(at);
  let count = 0;
  for (const task of Object.values(state.tasks)) {
    if (state.projects[task.projectId]?.status !== 'active') continue;
    if (!task.dueDate || (task.status !== 'todo' && task.status !== 'in_progress')) continue;
    if (task.dueDate === tomorrow) {
      count += notify(state, null, stamp, {
        userIds: [task.ownerId], trigger: 'due_tomorrow', targetType: 'task', targetId: task.id, dedupeKey: `due_tomorrow:${task.id}:${task.dueDate}`,
      }).length;
    }
    if (task.dueDate < today) {
      count += notify(state, null, stamp, {
        userIds: [task.ownerId], trigger: 'overdue', targetType: 'task', targetId: task.id, dedupeKey: `overdue:${task.id}:${task.dueDate}`,
      }).length;
    }
  }
  if (clock.weekday === 4 && clock.hour >= 15) {
    const weekStart = weekStartOf(today);
    for (const user of Object.values(state.users)) {
      if (user.kind !== 'human' || !user.active) continue;
      const total = Object.values(state.time)
        .filter((entry) => entry.userId === user.id && entry.date >= weekStart && entry.date <= today)
        .reduce((sum, entry) => sum + entry.hours, 0);
      if (total < user.weeklyHourTarget) {
        count += notify(state, null, stamp, {
          userIds: [user.id], trigger: 'week_under_target', targetType: 'week', targetId: weekStart, dedupeKey: `week_under_target:${weekStart}`,
        }).length;
      }
    }
  }
  return count;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/lib/text.test.ts src/api/notify.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/text.ts src/lib/text.test.ts src/api/notify.ts src/api/notify.test.ts
git commit -m "feat: add mentions, search normalization and notifications" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 9: Call registry and dispatcher

**Files:**
- Create: `src/api/registry.ts`, `src/api/client.ts`
- Modify: `src/test/factories.ts` (add `testApi`)
- Test: `src/api/client.test.ts`

**Interfaces:**
- Consumes: `Store`, `State` (Task 4), `Persister` (Task 4), `User` (Task 3), `ApiError` (Task 3), `now`, `nowStamp`, `todayISO` (Task 2).
- Produces: `type Ctx = { state: State; actor: User; authority: User; correlationId: string; stamp: string; today: string; now: Date; persistent: boolean }` (`actor` is who acts; `authority` is whose rights apply: the person, or the person an agent acts for), `type PrepareCtx = { state: State; persister: Persister; actor: User; now: Date }`, `interface CallDef<I, O, P>` with `input`, `output`, `readOnly?`, `prepare?(input, ctx): Promise<P>`, `run(input, ctx, prepared: P)`, `type AnyCall`, `defineCall(def)`. `type CallMap = Record<string, AnyCall>`, `type CallMeta = { correlationId?: string }`, `type Api<M>` with `call(name, input, meta?)`, `createApi<M>(calls: M, options: { store: Store; latencyMs?: number; failureRate?: () => number; random?: () => number }): Api<M>`. Test helper `testApi(calls, state?)` returning `{ store, api, as(userId) }`.

How a call runs (spec 11.3): wait for the latency, maybe fail on purpose, validate the input, find the current user, run `prepare` (the only async step, for file data), run `run` inside one store transaction (or a plain read when `readOnly`), then validate the output. The output parse returns new objects, so screens never hold live state.

- [ ] **Step 1: Write the failing test**

`src/api/client.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApi } from './client';
import { defineCall } from './registry';
import { invalid } from './errors';
import { Store } from './store';
import { memoryPersister } from './persist';
import { makeWorld } from '../test/factories';

const echo = defineCall({
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string(), actor: z.string() }),
  readOnly: true,
  run: (input, ctx) => ({ text: input.text, actor: ctx.actor.id }),
});
const bump = defineCall({
  input: z.object({ by: z.number().int() }),
  output: z.object({ limit: z.number() }),
  run(input, ctx) {
    ctx.state.settings.workloadLimit += input.by;
    if (ctx.state.settings.workloadLimit > 50) throw invalid('by', 'The limit is too high.');
    return { limit: ctx.state.settings.workloadLimit };
  },
});
const settings = defineCall({
  input: z.object({}),
  output: z.object({ workloadLimit: z.number(), codePrefix: z.string(), defaultStages: z.array(z.string()) }),
  readOnly: true,
  run: (_input, ctx) => ctx.state.settings,
});
const prepared = defineCall({
  input: z.object({}),
  output: z.object({ got: z.string() }),
  prepare: async () => 'from prepare',
  run: (_input, _ctx, value) => ({ got: value }),
});
const ping = defineCall({ input: z.object({}), output: z.object({ ok: z.boolean() }), run: () => ({ ok: true }) });
const whoami = defineCall({
  input: z.object({}),
  output: z.object({ actor: z.string(), authority: z.string(), correlationId: z.string() }),
  readOnly: true,
  run: (_input, ctx) => ({ actor: ctx.actor.id, authority: ctx.authority.id, correlationId: ctx.correlationId }),
});
const CALLS = { 'test.echo': echo, 'test.bump': bump, 'test.settings': settings, 'test.prepared': prepared, 'test.whoami': whoami, 'session.ping': ping };

let store: Store;
beforeEach(() => {
  store = new Store(makeWorld(), memoryPersister());
});
const apiWith = (failureRate = 0) => createApi(CALLS, { store, latencyMs: 0, failureRate: () => failureRate });

describe('createApi', () => {
  it('passes the current user to the call', async () => {
    expect(await apiWith().call('test.echo', { text: 'hi' })).toEqual({ text: 'hi', actor: 'usr_001' });
  });

  it('rejects bad input with the field names', async () => {
    await expect(apiWith().call('test.echo', { text: '' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['text'] } });
  });

  it('rolls back a call that fails', async () => {
    await expect(apiWith().call('test.bump', { by: 100 })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(store.state.settings.workloadLimit).toBe(10);
    expect(await apiWith().call('test.bump', { by: 2 })).toEqual({ limit: 12 });
  });

  it('returns a copy, not the live state', async () => {
    const out = await apiWith().call('test.settings', {});
    out.workloadLimit = 99;
    expect(store.state.settings.workloadLimit).toBe(10);
  });

  it('passes the prepared value to run', async () => {
    expect(await apiWith().call('test.prepared', {})).toEqual({ got: 'from prepare' });
  });

  it('fails calls on purpose when errors are simulated, except session calls', async () => {
    await expect(apiWith(1).call('test.echo', { text: 'x' })).rejects.toMatchObject({ code: 'failed' });
    await expect(apiWith(1).call('session.ping', {})).resolves.toEqual({ ok: true });
  });

  it('refuses a call with no current user', async () => {
    store.state.session.currentUserId = 'usr_404';
    await expect(apiWith().call('test.echo', { text: 'x' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an unknown call', async () => {
    await expect(apiWith().call('test.missing' as never, {} as never)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('does not tell listeners about reads', async () => {
    let changes = 0;
    store.subscribe(() => {
      changes += 1;
    });
    await apiWith().call('test.echo', { text: 'x' });
    expect(changes).toBe(0);
    await apiWith().call('test.bump', { by: 1 });
    expect(changes).toBe(1);
  });

  it('runs an agent with the rights of the person it acts for', async () => {
    store.state.session.currentUserId = 'usr_005';
    expect(await apiWith().call('test.whoami', {})).toMatchObject({ actor: 'usr_005', authority: 'usr_003' });
  });

  it('refuses an agent whose person is not active', async () => {
    store.state.session.currentUserId = 'usr_005';
    store.state.users.usr_003.active = false;
    await expect(apiWith().call('test.whoami', {})).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps one story id when the caller passes it, and makes a new one otherwise', async () => {
    const api = apiWith();
    expect((await api.call('test.whoami', {}, { correlationId: 'cor_weekly' })).correlationId).toBe('cor_weekly');
    const a = await api.call('test.whoami', {});
    const b = await api.call('test.whoami', {});
    expect(a.correlationId).not.toBe(b.correlationId);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL, "Failed to resolve import ./client".

- [ ] **Step 3: Write the implementation**

`src/api/registry.ts`:

```ts
import type { z } from 'zod';
import type { User } from './contract/entities';
import type { Persister } from './persist';
import type { State } from './store';

/** "actor" is who acts (a person or an agent). "authority" is whose rights apply: the person, or the person an agent acts for (spec 17). */
export type Ctx = {
  state: State; actor: User; authority: User; correlationId: string; stamp: string; today: string; now: Date; persistent: boolean;
};
export type PrepareCtx = { state: State; persister: Persister; actor: User; now: Date };

/** One API call. "run" must be synchronous. Only "prepare" may wait, for example for file data. */
export interface CallDef<I extends z.ZodType, O extends z.ZodType, P = undefined> {
  input: I;
  output: O;
  readOnly?: boolean;
  prepare?(input: z.output<I>, ctx: PrepareCtx): Promise<P>;
  run(input: z.output<I>, ctx: Ctx, prepared: P): z.input<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCall = CallDef<z.ZodType, z.ZodType, any>;

export function defineCall<I extends z.ZodType, O extends z.ZodType, P = undefined>(def: CallDef<I, O, P>): CallDef<I, O, P> {
  return def;
}
```

`src/api/client.ts`:

```ts
import type { z } from 'zod';
import { ApiError } from './errors';
import type { AnyCall } from './registry';
import type { State, Store } from './store';
import { now as clockNow, nowStamp, todayISO } from '../lib/dates';

export type CallMap = Record<string, AnyCall>;

/** One story ID for several calls, so one agent request reads as one story in the log. */
export type CallMeta = { correlationId?: string };

export type Api<M extends CallMap> = {
  call<N extends keyof M & string>(name: N, input: z.input<M[N]['input']>, meta?: CallMeta): Promise<z.output<M[N]['output']>>;
};

export type ApiOptions = {
  store: Store;
  latencyMs?: number;
  failureRate?: () => number;
  random?: () => number;
};

export function createApi<M extends CallMap>(calls: M, options: ApiOptions): Api<M> {
  const { store, latencyMs = 120, failureRate = () => 0, random = Math.random } = options;
  return {
    async call<N extends keyof M & string>(name: N, rawInput: z.input<M[N]['input']>, meta: CallMeta = {}): Promise<z.output<M[N]['output']>> {
      const def: AnyCall | undefined = calls[name];
      if (!def) throw new ApiError('not_found', `There is no call named ${name}.`);
      if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
      if (!name.startsWith('session.') && random() < failureRate()) throw new ApiError('failed', 'The call failed. Try again.');
      const parsed = def.input.safeParse(rawInput);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
        throw new ApiError('invalid_input', 'Some fields are not valid.', { fields: [...new Set(issues.map((i) => i.path))], issues });
      }
      const actorId = store.state.session.currentUserId;
      const actor = store.state.users[actorId];
      if (!actor) throw new ApiError('forbidden', 'There is no current user.');
      // An agent acts with the rights of its person, never with rights of its own (spec 17).
      let authority = actor;
      if (actor.kind === 'agent') {
        const owner = actor.ownerId ? store.state.users[actor.ownerId] : undefined;
        if (!owner || owner.kind !== 'human' || !owner.active) throw new ApiError('forbidden', 'This agent has no active person to act for.');
        authority = owner;
      }
      const correlationId = meta.correlationId ?? `cor_${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`;
      const at = clockNow();
      const prepared = def.prepare
        ? await def.prepare(parsed.data, { state: store.state, persister: store.persister, actor, now: at })
        : undefined;
      const execute = (state: State) =>
        def.run(parsed.data, {
          state, actor: state.users[actorId], authority: state.users[authority.id], correlationId,
          stamp: nowStamp(at), today: todayISO(at), now: at, persistent: store.persistent,
        }, prepared);
      const result = def.readOnly ? store.read(execute) : store.run(execute);
      return def.output.parse(result) as z.output<M[N]['output']>;
    },
  };
}
```

Append to `src/test/factories.ts`:

```ts
import { createApi, type CallMap } from '../api/client';
import { Store } from '../api/store';
import { memoryPersister } from '../api/persist';

/** An API over a test world with no latency. "as" changes the current user. */
export function testApi<M extends CallMap>(calls: M, state: State = makeWorld()) {
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  return {
    store,
    api,
    as(userId: string): void {
      store.state.session.currentUserId = userId;
    },
  };
}
```

Move the three new imports to the top of `src/test/factories.ts`, next to the other imports.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/api/client.test.ts`
Expected: PASS (12 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/api/registry.ts src/api/client.ts src/api/client.test.ts src/test/factories.ts
git commit -m "feat: add the call registry and the dispatcher" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 10: People, session, clients and settings calls

**Files:**
- Create: `src/api/contract/views.ts`, `src/api/views.ts`, `src/api/handlers/shared.ts`, `src/api/handlers/people.ts`
- Test: `src/api/handlers/people.test.ts`

**Interfaces:**
- Consumes: `defineCall`, `Ctx` (Task 9), entities (Task 3), `applyPatch`, `recordCreate` (Task 7), `notify` (Task 8), `mentionedUserIds` (Task 8), `can`, `projectRoleOf` (Task 5), `nextId` (Task 4).
- Produces: schema and type `UserCard`. Builders `userCard(user)`, `cardOf(state, userId)`. Handler helpers `assertCan(ctx, action, resource?)`, `roleIn(ctx, projectId)`, `requireUser`, `requireProject`, `requireTask`, `requireStage(ctx, projectId, stageId)`, `touch(ctx, projectId)`, `byName`, `activeMentions(state, body)`, `insertComment(ctx, targetType, targetId, projectId, body): Comment`. The call map `peopleCalls` with `session.get`, `session.previewAs`, `session.setSimulateErrors`, `users.list`, `users.get`, `users.create`, `users.update`, `users.deactivate`, `me.updateProfile`, `me.updatePreferences`, `clients.list`, `clients.create`, `clients.update`, `settings.get`, `settings.update`.

- [ ] **Step 1: Write the failing test**

`src/api/handlers/people.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { peopleCalls } from './people';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

describe('session calls', () => {
  it('returns the current user and the preview list', async () => {
    const { api } = testApi(peopleCalls);
    const session = await api.call('session.get', {});
    expect(session.user.id).toBe('usr_001');
    expect(session.persistent).toBe(false);
    expect(session.simulateErrors).toBe(false);
    const hints = Object.fromEntries(session.previewUsers.map((u) => [u.id, u.hint]));
    expect(hints).toEqual({ usr_001: 'admin', usr_002: 'leader', usr_003: 'member', usr_004: 'member', usr_005: 'agent' });
  });

  it('switches the current user', async () => {
    const { api } = testApi(peopleCalls);
    await api.call('session.previewAs', { userId: 'usr_003' });
    expect((await api.call('session.get', {})).user.id).toBe('usr_003');
  });

  it('refuses to preview an inactive person', async () => {
    const t = testApi(peopleCalls);
    t.store.state.users.usr_004.active = false;
    await expect(t.api.call('session.previewAs', { userId: 'usr_004' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('turns simulated errors on', async () => {
    const t = testApi(peopleCalls);
    expect(await t.api.call('session.setSimulateErrors', { on: true })).toEqual({ simulateErrors: true });
    expect(t.store.state.session.simulateErrors).toBe(true);
  });
});

describe('people calls', () => {
  it('lets only the Admin add people', async () => {
    const t = testApi(peopleCalls);
    const created = await t.api.call('users.create', { name: 'New Person', email: 'new@madar.test', discipline: 'MEP' });
    expect(created).toMatchObject({ id: 'usr_006', systemRole: 'member', kind: 'human', weeklyHourTarget: 40, active: true });
    t.as('usr_003');
    await expect(t.api.call('users.create', { name: 'X', email: 'x@madar.test', discipline: 'MEP' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a duplicate email', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.create', { name: 'X', email: 'USR_002@madar.test', discipline: 'MEP' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['email'] },
    });
  });

  it('keeps at least one Admin', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.update', { id: 'usr_001', patch: { systemRole: 'member' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('gives every agent a person to act for', async () => {
    const t = testApi(peopleCalls);
    await expect(t.api.call('users.create', { name: 'Bot', email: 'bot@madar.test', discipline: 'Agent', kind: 'agent' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['ownerId'] },
    });
    const agent = await t.api.call('users.create', { name: 'Bot', email: 'bot@madar.test', discipline: 'Agent', kind: 'agent', ownerId: 'usr_002' });
    expect(agent.ownerId).toBe('usr_002');
    t.as(agent.id);
    const session = await t.api.call('session.get', {});
    expect(session.actingFor?.id).toBe('usr_002');
    expect(session.previewUsers.find((u) => u.id === 'usr_005')?.actingForName).toBe('Sara Team');
  });

  it('stops the Admin from turning off their own account', async () => {
    const { api } = testApi(peopleCalls);
    await expect(api.call('users.deactivate', { id: 'usr_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await api.call('users.deactivate', { id: 'usr_004' })).active).toBe(false);
  });

  it('saves my preferences and my profile', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const prefs = await t.api.call('me.updatePreferences', { language: 'ar', theme: 'dark' });
    expect(prefs.preferences).toMatchObject({ language: 'ar', theme: 'dark', glass: 'frosted' });
    const profile = await t.api.call('me.updateProfile', { name: 'Sara Al-Qahtani', discipline: 'Interior' });
    expect(profile).toMatchObject({ name: 'Sara Al-Qahtani', discipline: 'Interior' });
  });
});

describe('client and settings calls', () => {
  it('lets anyone add a client and only the Admin edit one', async () => {
    const t = testApi(peopleCalls);
    t.as('usr_003');
    const client = await t.api.call('clients.create', { name: 'Gulf Crest Holding' });
    expect(client).toMatchObject({ id: 'cli_001', contactName: '', email: '' });
    await expect(t.api.call('clients.update', { id: client.id, patch: { phone: '+966 13 864 1000' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    expect((await t.api.call('clients.update', { id: client.id, patch: { phone: '+966 13 864 1000' } })).phone).toBe('+966 13 864 1000');
  });

  it('lets only the Admin change settings and checks the code prefix', async () => {
    const t = testApi(peopleCalls);
    expect((await t.api.call('settings.update', { workloadLimit: 8 })).workloadLimit).toBe(8);
    await expect(t.api.call('settings.update', { codePrefix: 'kh' })).rejects.toMatchObject({ code: 'invalid_input' });
    t.as('usr_002');
    await expect(t.api.call('settings.update', { workloadLimit: 12 })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/handlers/people.test.ts`
Expected: FAIL, "Failed to resolve import ./people".

- [ ] **Step 3: Write the output schema, the builders and the handler helpers**

`src/api/contract/views.ts`:

```ts
import { z } from 'zod';
import { UserId } from './entities';

export const UserCard = z.object({
  id: UserId,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  kind: z.enum(['human', 'agent']),
  discipline: z.string(),
});
export type UserCard = z.infer<typeof UserCard>;
```

`src/api/views.ts`:

```ts
import type { User } from './contract/entities';
import type { UserCard } from './contract/views';
import type { State } from './store';

export function userCard(user: User): UserCard {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, kind: user.kind, discipline: user.discipline };
}

export function cardOf(state: State, userId: string): UserCard {
  const user = state.users[userId];
  return user ? userCard(user) : { id: userId, name: '?', avatarUrl: null, kind: 'human', discipline: '' };
}
```

`src/api/handlers/shared.ts`:

```ts
import type { Ctx } from '../registry';
import { emptyReactions, type Comment, type Project, type Stage, type Task, type User } from '../contract/entities';
import { can, projectRoleOf, type Action, type ProjectRole, type Resource } from '../permissions';
import { forbidden, invalid, notFound } from '../errors';
import { recordCreate } from '../events';
import { notify } from '../notify';
import { nextId, type State } from '../store';
import { mentionedUserIds } from '../../lib/text';

export function assertCan(ctx: Ctx, action: Action, resource: Resource = {}): void {
  if (!can(ctx.authority, action, resource)) throw forbidden('You cannot do this.', { action });
}

export function roleIn(ctx: Ctx, projectId: string): ProjectRole {
  return projectRoleOf(ctx.state, projectId, ctx.authority.id);
}

export function requireUser(ctx: Ctx, id: string): User {
  const user = ctx.state.users[id];
  if (!user) throw notFound('User', id);
  return user;
}

export function requireProject(ctx: Ctx, id: string): Project {
  const project = ctx.state.projects[id];
  if (!project) throw notFound('Project', id);
  return project;
}

export function requireTask(ctx: Ctx, id: string): Task {
  const task = ctx.state.tasks[id];
  if (!task) throw notFound('Task', id);
  return task;
}

export function requireStage(ctx: Ctx, projectId: string, stageId: string): Stage {
  const stage = ctx.state.stages[stageId];
  if (!stage || stage.projectId !== projectId) throw invalid('stageId', 'This stage is not in the project.');
  return stage;
}

/** Marks the project as updated, for the "last update" sort. */
export function touch(ctx: Ctx, projectId: string): void {
  const project = ctx.state.projects[projectId];
  if (project) project.updatedAt = ctx.stamp;
}

export function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

export function activeMentions(state: State, body: string): string[] {
  return mentionedUserIds(body).filter((id) => state.users[id]?.active === true);
}

export function insertComment(ctx: Ctx, targetType: 'task' | 'update', targetId: string, projectId: string, body: string): Comment {
  const id = nextId(ctx.state, 'cmt');
  const comment: Comment = {
    id, targetType, targetId, authorId: ctx.actor.id, body, reactions: emptyReactions(), createdAt: ctx.stamp, editedAt: null,
  };
  ctx.state.comments[id] = comment;
  recordCreate(ctx, { projectId, verb: 'comment.created', targetType: 'comment', targetId: id, entity: comment });
  notify(ctx.state, ctx.actor, ctx.stamp, { userIds: activeMentions(ctx.state, body), trigger: 'mention', targetType, targetId });
  return comment;
}
```

- [ ] **Step 4: Write the calls**

`src/api/handlers/people.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  Client, ClientId, Glass, Language, Settings, Theme, User, UserId, defaultPreferences, type Preferences,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate } from '../events';
import { nextId } from '../store';
import { userCard } from '../views';
import { assertCan, byName, requireUser } from './shared';

const Empty = z.object({});
const Name = z.string().trim().min(1).max(80);
const Discipline = z.string().trim().min(1).max(40);
const Hours = z.number().min(0).max(80);
const SystemRole = z.enum(['admin', 'member']);
const Kind = z.enum(['human', 'agent']);
const ClientName = z.string().trim().min(1).max(120);
const ContactName = z.string().trim().max(80);
const Phone = z.string().trim().max(40);
const ClientEmail = z.union([z.email(), z.literal('')]);

const PreviewUser = UserCard.extend({
  systemRole: SystemRole,
  hint: z.enum(['admin', 'leader', 'member', 'agent']),
  actingForName: z.string().nullable(),
});

export const sessionGet = defineCall({
  input: Empty,
  output: z.object({ user: User, actingFor: UserCard.nullable(), previewUsers: z.array(PreviewUser), persistent: z.boolean(), simulateErrors: z.boolean() }),
  readOnly: true,
  run(_input, ctx) {
    const leaders = new Set(Object.values(ctx.state.projects).map((p) => p.leaderId));
    // An agent shows only while its person is active, because it cannot act otherwise.
    const canAct = (u: User) => u.kind === 'human' || (u.ownerId !== null && ctx.state.users[u.ownerId]?.active === true);
    const previewUsers = Object.values(ctx.state.users)
      .filter((u) => u.active && canAct(u))
      .sort(byName)
      .map((u) => ({
        ...userCard(u),
        systemRole: u.systemRole,
        actingForName: u.kind === 'agent' && u.ownerId ? (ctx.state.users[u.ownerId]?.name ?? null) : null,
        hint: u.kind === 'agent' ? ('agent' as const) : u.systemRole === 'admin' ? ('admin' as const) : leaders.has(u.id) ? ('leader' as const) : ('member' as const),
      }));
    const actingFor = ctx.actor.kind === 'agent' ? userCard(ctx.authority) : null;
    return { user: ctx.actor, actingFor, previewUsers, persistent: ctx.persistent, simulateErrors: ctx.state.session.simulateErrors };
  },
});

export const sessionPreviewAs = defineCall({
  input: z.object({ userId: UserId }),
  output: z.object({ user: User }),
  run(input, ctx) {
    const user = requireUser(ctx, input.userId);
    if (!user.active) throw invalid('userId', 'This person is not active.');
    const owner = user.ownerId ? ctx.state.users[user.ownerId] : undefined;
    if (user.kind === 'agent' && !owner?.active) throw invalid('userId', 'This agent has no active person to act for.');
    ctx.state.session.currentUserId = user.id;
    return { user };
  },
});

export const sessionSetSimulateErrors = defineCall({
  input: z.object({ on: z.boolean() }),
  output: z.object({ simulateErrors: z.boolean() }),
  run(input, ctx) {
    ctx.state.session.simulateErrors = input.on;
    return { simulateErrors: input.on };
  },
});

export const usersList = defineCall({
  input: z.object({ includeInactive: z.boolean().default(false) }),
  output: z.array(User),
  readOnly: true,
  run(input, ctx) {
    return Object.values(ctx.state.users).filter((u) => input.includeInactive || u.active).sort(byName);
  },
});

export const usersGet = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  readOnly: true,
  run(input, ctx) {
    return requireUser(ctx, input.id);
  },
});

function assertEmailFree(ctx: Ctx, email: string, exceptId: string | null): void {
  const taken = Object.values(ctx.state.users).some((u) => u.id !== exceptId && u.email.toLowerCase() === email.toLowerCase());
  if (taken) throw invalid('email', 'This email is already in use.');
}

export const usersCreate = defineCall({
  input: z.object({
    name: Name,
    email: z.email(),
    systemRole: SystemRole.default('member'),
    kind: Kind.default('human'),
    discipline: Discipline,
    weeklyHourTarget: Hours.default(40),
    ownerId: UserId.optional(),
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    assertEmailFree(ctx, input.email, null);
    let ownerId: string | null = null;
    if (input.kind === 'agent') {
      const owner = input.ownerId ? ctx.state.users[input.ownerId] : undefined;
      if (!owner || owner.kind !== 'human' || !owner.active) throw invalid('ownerId', 'An agent needs an active person to act for.');
      ownerId = owner.id;
    } else if (input.ownerId) {
      throw invalid('ownerId', 'Only an agent acts for a person.');
    }
    const id = nextId(ctx.state, 'usr');
    const user: User = {
      id, name: input.name, email: input.email, systemRole: input.systemRole, kind: input.kind, discipline: input.discipline,
      weeklyHourTarget: input.weeklyHourTarget, ownerId, avatarUrl: null, active: true, preferences: defaultPreferences(),
    };
    ctx.state.users[id] = user;
    recordCreate(ctx, { projectId: null, verb: 'user.created', targetType: 'user', targetId: id, entity: user });
    return user;
  },
});

export const usersUpdate = defineCall({
  input: z.object({
    id: UserId,
    patch: z.object({
      name: Name.optional(),
      email: z.email().optional(),
      systemRole: SystemRole.optional(),
      kind: Kind.optional(),
      discipline: Discipline.optional(),
      weeklyHourTarget: Hours.optional(),
      avatarUrl: z.string().max(2000).nullable().optional(),
    }),
  }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const user = requireUser(ctx, input.id);
    if (input.patch.email) assertEmailFree(ctx, input.patch.email, user.id);
    if (input.patch.systemRole === 'member' && user.systemRole === 'admin') {
      const admins = Object.values(ctx.state.users).filter((u) => u.systemRole === 'admin' && u.active);
      if (admins.length <= 1) throw invalid('systemRole', 'The office needs at least one Admin.');
    }
    applyPatch(ctx, user, input.patch, { projectId: null, verb: 'user.updated', targetType: 'user', targetId: user.id });
    return user;
  },
});

export const usersDeactivate = defineCall({
  input: z.object({ id: UserId }),
  output: User,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const user = requireUser(ctx, input.id);
    if (user.id === ctx.authority.id) throw invalid('id', 'You cannot turn off your own account.');
    applyPatch(ctx, user, { active: false }, { projectId: null, verb: 'user.deactivated', targetType: 'user', targetId: user.id });
    return user;
  },
});

export const meUpdateProfile = defineCall({
  input: z.object({ name: Name.optional(), discipline: Discipline.optional(), avatarUrl: z.string().max(2000).nullable().optional() }),
  output: User,
  run(input, ctx) {
    applyPatch(ctx, ctx.actor, input, { projectId: null, verb: 'user.profile_changed', targetType: 'user', targetId: ctx.actor.id });
    return ctx.actor;
  },
});

export const meUpdatePreferences = defineCall({
  input: z.object({ language: Language.optional(), theme: Theme.optional(), glass: Glass.optional() }),
  output: User,
  run(input, ctx) {
    const current = ctx.actor.preferences;
    const next: Preferences = {
      language: input.language ?? current.language,
      theme: input.theme ?? current.theme,
      glass: input.glass ?? current.glass,
      notifications: current.notifications,
    };
    applyPatch(ctx, ctx.actor, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.actor.id });
    return ctx.actor;
  },
});

export const clientsList = defineCall({
  input: Empty,
  output: z.array(Client),
  readOnly: true,
  run(_input, ctx) {
    return Object.values(ctx.state.clients).sort(byName);
  },
});

export const clientsCreate = defineCall({
  input: z.object({ name: ClientName, contactName: ContactName.default(''), phone: Phone.default(''), email: ClientEmail.default('') }),
  output: Client,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    const id = nextId(ctx.state, 'cli');
    const client: Client = { id, ...input };
    ctx.state.clients[id] = client;
    recordCreate(ctx, { projectId: null, verb: 'client.created', targetType: 'client', targetId: id, entity: client });
    return client;
  },
});

export const clientsUpdate = defineCall({
  input: z.object({
    id: ClientId,
    patch: z.object({ name: ClientName.optional(), contactName: ContactName.optional(), phone: Phone.optional(), email: ClientEmail.optional() }),
  }),
  output: Client,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    const client = ctx.state.clients[input.id];
    if (!client) throw notFound('Client', input.id);
    applyPatch(ctx, client, input.patch, { projectId: null, verb: 'client.updated', targetType: 'client', targetId: client.id });
    return client;
  },
});

export const settingsGet = defineCall({
  input: Empty,
  output: Settings,
  readOnly: true,
  run(_input, ctx) {
    return ctx.state.settings;
  },
});

export const settingsUpdate = defineCall({
  input: z.object({
    defaultStages: Settings.shape.defaultStages.optional(),
    codePrefix: Settings.shape.codePrefix.optional(),
    workloadLimit: Settings.shape.workloadLimit.optional(),
  }),
  output: Settings,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    applyPatch(ctx, ctx.state.settings, input, { projectId: null, verb: 'settings.updated', targetType: 'settings', targetId: 'settings' });
    return ctx.state.settings;
  },
});

export const peopleCalls = {
  'session.get': sessionGet,
  'session.previewAs': sessionPreviewAs,
  'session.setSimulateErrors': sessionSetSimulateErrors,
  'users.list': usersList,
  'users.get': usersGet,
  'users.create': usersCreate,
  'users.update': usersUpdate,
  'users.deactivate': usersDeactivate,
  'me.updateProfile': meUpdateProfile,
  'me.updatePreferences': meUpdatePreferences,
  'clients.list': clientsList,
  'clients.create': clientsCreate,
  'clients.update': clientsUpdate,
  'settings.get': settingsGet,
  'settings.update': settingsUpdate,
};
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx vitest run src/api/handlers/people.test.ts`
Expected: PASS (12 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/api/contract/views.ts src/api/views.ts src/api/handlers
git commit -m "feat: add session, people, client and settings calls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 11: Project, member, stage and deadline calls

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/views.ts`
- Create: `src/api/handlers/projects.ts`
- Test: `src/api/handlers/projects.test.ts`

**Interfaces:**
- Consumes: Task 10 helpers, `computeHealth` (Task 6), `notify`, `projectPeople` (Task 8), events (Task 7).
- Produces: schemas and types `HealthResult`, `FeedItem`, `NextDeadline`, `ProjectSummary`, `ViewerCan`, `ProjectDetail`. Builders `stagesOf(state, projectId): Stage[]`, `deadlinesOf(state, projectId): Deadline[]`, `countComments(state, targetType, targetId): number`, `FEED_VERBS`, `eventLabel(state, event)`, `updateItemOf(state, update): FeedItem`, `feedFor(state, projectId, filter: 'all' | 'posts' | 'tasks' | 'files', limit): FeedItem[]`, `summaryOf(state, project, today): ProjectSummary`, `detailOf(state, project, today, viewer): ProjectDetail`. `nextProjectCode(state, prefix, today): string`. The call map `projectCalls` with `projects.list`, `projects.get`, `projects.create`, `projects.update`, `projects.setStage`, `projects.setLeader`, `projects.setStatus`, `projects.setHealthOverride`, `projects.clearHealthOverride`, `projects.delete`, `members.add`, `members.remove`, `members.update`, `stages.replace`, `stages.setDates`, `deadlines.create`, `deadlines.update`, `deadlines.delete`.

Card rules from spec 4.1: the card shows the two latest feed items. The next deadline is the earliest one on or after today. With no future deadline, the card shows the most recent past one, with a negative `daysLeft` (the screen shows it in red).

- [ ] **Step 1: Write the failing test**

`src/api/handlers/projects.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { nextProjectCode, projectCalls } from './projects';
import type { Store } from '../store';
import { makeTask, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

describe('projects.create', () => {
  it('lets a team member create a project and lead it', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const detail = await t.api.call('projects.create', { name: 'Beach Pavilion', teamIds: ['usr_004'] });
    expect(detail.project.code).toBe('KH-26-002');
    expect(detail.project.leaderId).toBe('usr_003');
    expect(detail.stages.map((s) => s.name)).toEqual([
      'Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision',
    ]);
    expect(detail.currentStage.name).toBe('Concept');
    expect(detail.viewerRole).toBe('leader');
    expect(detail.viewerCan.edit).toBe(true);
    expect(detail.members.map((m) => m.user.id)).toEqual(['usr_003', 'usr_004']);
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
    expect(notices(t.store, 'added_to_project', 'usr_003')).toHaveLength(0);
  });

  it('keeps the creator on the team when the leader is someone else or nobody', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const other = await t.api.call('projects.create', { name: 'Kiosk', leader: 'usr_002' });
    expect(other.project.leaderId).toBe('usr_002');
    expect(other.viewerRole).toBe('team');
    expect(other.viewerCan.edit).toBe(false);
    const none = await t.api.call('projects.create', { name: 'Shade Canopy', leader: 'none' });
    expect(none.project.leaderId).toBeNull();
    expect(none.viewerRole).toBe('team');
  });

  it('refuses an end date before the start date and an agent as leader', async () => {
    const { api } = testApi(projectCalls);
    await expect(api.call('projects.create', { name: 'X', startDate: '2026-10-10', targetEndDate: '2026-10-01' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['targetEndDate'] },
    });
    await expect(api.call('projects.create', { name: 'X', leader: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('numbers codes by year', () => {
    const state = makeWorld();
    expect(nextProjectCode(state, 'KH', '2026-09-30')).toBe('KH-26-002');
    expect(nextProjectCode(state, 'KH', '2027-01-02')).toBe('KH-27-001');
  });
});

describe('projects.list and the card', () => {
  it('filters and sorts', async () => {
    const t = testApi(projectCalls);
    await t.api.call('projects.create', { name: 'Alpha Villa', leader: 'usr_002' });
    const byName = await t.api.call('projects.list', { sort: 'name' });
    expect(byName.map((s) => s.project.name)).toEqual(['Alpha Villa', 'Test Tower']);
    t.as('usr_004');
    expect(await t.api.call('projects.list', { filter: 'mine' })).toHaveLength(0);
    t.store.state.tasks.tsk_001 = makeTask({ dueDate: '2026-09-28', status: 'in_progress' });
    const risky = await t.api.call('projects.list', { filter: 'at_risk' });
    expect(risky.map((s) => s.project.id)).toEqual(['prj_001']);
    expect(risky[0].health?.value).toBe('at_risk');
  });

  it('shows the next deadline, or the last past one', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Site survey', date: '2026-09-20' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).nextDeadline).toMatchObject({ name: 'Site survey', daysLeft: -10 });
    await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Client presentation', date: '2026-10-12' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).nextDeadline).toMatchObject({ name: 'Client presentation', daysLeft: 12 });
  });

  it('shows the two latest feed items', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_004' });
    await t.api.call('projects.setStage', { id: 'prj_001', stageId: 'stg_001' });
    const summary = (await t.api.call('projects.list', {}))[0];
    expect(summary.latest.map((item) => (item.kind === 'event' ? item.verb : item.kind))).toEqual(['project.stage_changed', 'member.added']);
  });
});

describe('project changes', () => {
  it('lets the leader edit and stops a team member', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { name: 'New' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { name: 'Test Tower B', areaM2: 1200 } });
    expect(detail.project).toMatchObject({ name: 'Test Tower B', areaM2: 1200 });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { targetEndDate: '2026-07-01' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('moves the stage, clears the override and tells the team', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client delay' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).health?.overridden).toBe(true);
    const detail = await t.api.call('projects.setStage', { id: 'prj_001', stageId: 'stg_001' });
    expect(detail.currentStage.id).toBe('stg_001');
    expect(detail.health?.overridden).toBe(false);
    expect(notices(t.store, 'stage_changed', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'stage_changed', 'usr_002')).toHaveLength(0);
  });

  it('adds a new leader to the team', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('projects.setLeader', { id: 'prj_001', leaderId: 'usr_004' });
    expect(detail.leader?.id).toBe('usr_004');
    expect(detail.members.find((m) => m.isLeader)?.user.id).toBe('usr_004');
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
  });

  it('lets only the Admin delete, and removes the project data', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_002');
    await expect(t.api.call('projects.delete', { id: 'prj_001', confirm: true })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(t.store.state.projects.prj_001).toBeUndefined();
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
    expect(Object.keys(t.store.state.stages)).toHaveLength(0);
    expect(Object.keys(t.store.state.members)).toHaveLength(0);
  });
});

describe('members', () => {
  it('protects the leader and people with open tasks', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
    t.as('usr_002');
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_002' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
    await t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_004' });
    const detail = await t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_004' });
    expect(detail.members.map((m) => m.user.id)).not.toContain('usr_004');
    await expect(t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('stages', () => {
  it('refuses to remove a stage with tasks or hours, and names it', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask({ stageId: 'stg_001' });
    t.as('usr_002');
    const call = t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ id: 'stg_002', name: 'Schematic Design' }] });
    await expect(call).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call).rejects.toThrow('Move the tasks and hours out of "Concept" first.');
    expect(t.store.state.stages.stg_001).toBeDefined();
  });

  it('renames, adds and removes stages', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('stages.replace', {
      projectId: 'prj_001', stages: [{ id: 'stg_002', name: 'Schematic' }, { name: 'Authority approvals' }],
    });
    expect(detail.stages.map((s) => [s.id, s.name, s.order])).toEqual([['stg_002', 'Schematic', 0], ['stg_003', 'Authority approvals', 1]]);
    expect(detail.currentStage.id).toBe('stg_002');
  });

  it('moves the current stage to the first stage when it is removed', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ id: 'stg_001', name: 'Concept' }, { name: 'Detail design' }] });
    expect(detail.currentStage.id).toBe('stg_001');
  });

  it('checks stage dates', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await expect(t.api.call('stages.setDates', { stageId: 'stg_002', startDate: '2026-10-10', endDate: '2026-10-01' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const detail = await t.api.call('stages.setDates', { stageId: 'stg_002', startDate: '2026-09-01', endDate: '2026-10-20' });
    expect(detail.currentStage.endDate).toBe('2026-10-20');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/handlers/projects.test.ts`
Expected: FAIL, "Failed to resolve import ./projects".

- [ ] **Step 3: Add the output schemas**

In `src/api/contract/views.ts`, change the entities import at the top to:

```ts
import {
  Client, Day, Deadline, DeadlineId, EventId, EventTarget, FileId, HealthValue, Project, Stage, Stamp, UpdateId, UserId,
} from './entities';
```

Append to `src/api/contract/views.ts`:

```ts
export const HealthResult = z.object({
  value: HealthValue,
  computed: HealthValue,
  overridden: z.boolean(),
  reason: z.string().nullable(),
  setBy: UserId.nullable(),
});

export const FeedItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('update'), id: UpdateId, at: Stamp, author: UserCard, body: z.string(), fileIds: z.array(FileId),
    editedAt: Stamp.nullable(), commentCount: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal('event'), id: EventId, at: Stamp, author: UserCard, verb: z.string(), targetType: EventTarget,
    targetId: z.string(), label: z.string(), detail: z.record(z.string(), z.string()),
  }),
]);
export type FeedItem = z.infer<typeof FeedItem>;

export const NextDeadline = z.object({ id: DeadlineId, name: z.string(), date: Day, daysLeft: z.number().int() });

export const ProjectSummary = z.object({
  project: Project,
  client: Client.nullable(),
  health: HealthResult.nullable(),
  stages: z.array(Stage),
  currentStage: Stage,
  latest: z.array(FeedItem).max(2),
  nextDeadline: NextDeadline.nullable(),
  leader: UserCard.nullable(),
  team: z.array(UserCard),
  openTasks: z.number().int().min(0),
  lastActivityAt: Stamp,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ViewerCan = z.object({
  edit: z.boolean(), changeLeader: z.boolean(), archive: z.boolean(), delete: z.boolean(), healthOverride: z.boolean(),
  createTaskForAnyone: z.boolean(), createTaskForSelf: z.boolean(), post: z.boolean(), review: z.boolean(), logTime: z.boolean(),
});

export const ProjectDetail = ProjectSummary.extend({
  members: z.array(z.object({ user: UserCard, discipline: z.string(), isLeader: z.boolean(), openTasks: z.number().int().min(0) })),
  deadlines: z.array(Deadline),
  viewerRole: z.enum(['leader', 'team', 'other']),
  viewerCan: ViewerCan,
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;
```

- [ ] **Step 4: Add the builders**

In `src/api/views.ts`, replace the import block at the top with:

```ts
import type { Deadline, Event, Project, Stage, Update, User } from './contract/entities';
import type { FeedItem, ProjectDetail, ProjectSummary, UserCard } from './contract/views';
import { computeHealth } from './health';
import { can, projectRoleOf } from './permissions';
import type { State } from './store';
import { diffDays } from '../lib/dates';
```

Append to `src/api/views.ts`:

```ts
export function stagesOf(state: State, projectId: string): Stage[] {
  return Object.values(state.stages).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
}

export function deadlinesOf(state: State, projectId: string): Deadline[] {
  return Object.values(state.deadlines)
    .filter((d) => d.projectId === projectId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function countComments(state: State, targetType: 'task' | 'update', targetId: string): number {
  return Object.values(state.comments).filter((c) => c.targetType === targetType && c.targetId === targetId).length;
}

/** Events that show in the project feed and on the card. Posts show as "update" items. */
export const FEED_VERBS = new Set([
  'project.created', 'project.stage_changed', 'project.leader_changed', 'task.created', 'task.status_changed',
  'task.approved', 'task.sent_back', 'file.added', 'file.version_added', 'member.added',
]);

function lastLetter(value: unknown): string {
  const versions = (value as { versions?: { letter: string }[] } | null)?.versions;
  return Array.isArray(versions) && versions.length > 0 ? versions[versions.length - 1].letter : '';
}

export function eventLabel(state: State, event: Event): { label: string; detail: Record<string, string> } {
  const after = (event.after ?? {}) as Record<string, unknown>;
  const before = (event.before ?? {}) as Record<string, unknown>;
  switch (event.targetType) {
    case 'task': {
      const title = state.tasks[event.targetId]?.title
        ?? (typeof after.title === 'string' ? after.title : typeof before.title === 'string' ? before.title : '');
      return { label: title, detail: typeof after.status === 'string' ? { status: after.status } : {} };
    }
    case 'file': {
      const letter = lastLetter(event.after);
      return { label: state.files[event.targetId]?.name ?? '', detail: letter ? { version: letter } : {} };
    }
    case 'project': {
      const name = state.projects[event.targetId]?.name ?? '';
      if (typeof after.currentStageId === 'string') return { label: name, detail: { stage: state.stages[after.currentStageId]?.name ?? '' } };
      if ('leaderId' in after) {
        const leader = typeof after.leaderId === 'string' ? (state.users[after.leaderId]?.name ?? '') : '';
        return { label: name, detail: { leader } };
      }
      return { label: name, detail: {} };
    }
    case 'member': {
      const userId = event.targetId.split(':')[1] ?? '';
      return { label: state.users[userId]?.name ?? '', detail: {} };
    }
    default:
      return { label: '', detail: {} };
  }
}

export function updateItemOf(state: State, update: Update): FeedItem {
  return {
    kind: 'update', id: update.id, at: update.createdAt, author: cardOf(state, update.authorId), body: update.body,
    fileIds: update.fileIds, editedAt: update.editedAt, commentCount: countComments(state, 'update', update.id),
  };
}

function newestFirst(a: FeedItem, b: FeedItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return b.id.localeCompare(a.id);
}

export function feedFor(state: State, projectId: string, filter: 'all' | 'posts' | 'tasks' | 'files', limit: number): FeedItem[] {
  const items: FeedItem[] = [];
  if (filter === 'all' || filter === 'posts') {
    for (const update of Object.values(state.updates)) if (update.projectId === projectId) items.push(updateItemOf(state, update));
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

export function summaryOf(state: State, project: Project, today: string): ProjectSummary {
  const stages = stagesOf(state, project.id);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
  const deadlines = deadlinesOf(state, project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2);
  const newest = latest[0]?.at;
  return {
    project,
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health: computeHealth({ project, stages, tasks }, today),
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
  };
}

export function detailOf(state: State, project: Project, today: string, viewer: User): ProjectDetail {
  const role = projectRoleOf(state, project.id, viewer.id);
  const r = { projectRole: role };
  const openBy = (userId: string) =>
    Object.values(state.tasks).filter((t) => t.projectId === project.id && t.ownerId === userId && t.status !== 'done').length;
  const members = Object.values(state.members)
    .filter((m) => m.projectId === project.id)
    .map((m) => ({ user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId) }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  return {
    ...summaryOf(state, project, today),
    members,
    deadlines: deadlinesOf(state, project.id),
    viewerRole: role,
    viewerCan: {
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
    },
  };
}
```

- [ ] **Step 5: Write the calls**

`src/api/handlers/projects.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ClientId, Day, DeadlineId, HealthValue, ProjectId, ProjectStatus, StageId, UserId, type Deadline, type Project } from '../contract/entities';
import { ProjectDetail, ProjectSummary } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { notify, projectPeople } from '../notify';
import { projectRoleOf } from '../permissions';
import { memberKey, nextId, type State } from '../store';
import { detailOf, stagesOf, summaryOf } from '../views';
import { assertCan, requireProject, requireStage, requireUser, roleIn, touch } from './shared';

const ProjectName = z.string().trim().min(1).max(120);
const StageName = z.string().trim().min(1).max(60);
const Location = z.string().trim().max(120);
const Area = z.number().nonnegative().max(10_000_000);
const FolderPath = z.string().trim().max(260);
const Description = z.string().max(5000);
const DeadlineName = z.string().trim().min(1).max(120);

export function nextProjectCode(state: State, prefix: string, today: string): string {
  const head = `${prefix}-${today.slice(2, 4)}-`;
  const max = Object.values(state.projects)
    .filter((p) => p.code.startsWith(head))
    .reduce((highest, p) => Math.max(highest, Number(p.code.slice(head.length))), 0);
  return `${head}${String(max + 1).padStart(3, '0')}`;
}

function assertDates(start: string | null, end: string | null, field: string): void {
  if (start && end && end <= start) throw invalid(field, 'The end date must be after the start date.');
}

function assertLeader(ctx: Ctx, userId: string): void {
  const user = ctx.state.users[userId];
  if (!user || !user.active || user.kind !== 'human') throw invalid('leaderId', 'The leader must be an active person.');
}

function addMember(ctx: Ctx, projectId: string, userId: string, discipline?: string): void {
  const key = memberKey(projectId, userId);
  if (ctx.state.members[key]) return;
  const member = { projectId, userId, discipline: discipline ?? ctx.state.users[userId].discipline };
  ctx.state.members[key] = member;
  recordCreate(ctx, { projectId, verb: 'member.added', targetType: 'member', targetId: key, entity: member });
  notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [userId], trigger: 'added_to_project', targetType: 'project', targetId: projectId });
}

const detail = (ctx: Ctx, project: Project) => detailOf(ctx.state, project, ctx.today, ctx.authority);

function requireEditable(ctx: Ctx, projectId: string): Project {
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'project.edit', { projectRole: roleIn(ctx, project.id) });
  return project;
}

function requireDeadline(ctx: Ctx, id: string): Deadline {
  const deadline = ctx.state.deadlines[id];
  if (!deadline) throw notFound('Deadline', id);
  return deadline;
}

type Sorter = (a: ProjectSummary, b: ProjectSummary) => number;
const SORTS: Record<'updated' | 'deadline' | 'name', Sorter> = {
  updated: (a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0),
  deadline: (a, b) => (a.nextDeadline?.date ?? '9999-12-31').localeCompare(b.nextDeadline?.date ?? '9999-12-31'),
  name: (a, b) => a.project.name.localeCompare(b.project.name),
};

export const projectsList = defineCall({
  input: z.object({
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
    filter: z.enum(['all', 'mine', 'at_risk']).default('all'),
    stageName: z.string().optional(),
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
    sort: z.enum(['updated', 'deadline', 'name']).default('updated'),
  }),
  output: z.array(ProjectSummary),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    return Object.values(state.projects)
      .filter((p) => input.status === 'all' || p.status === input.status)
      .map((p) => summaryOf(state, p, today))
      .filter((s) => input.filter !== 'mine' || projectRoleOf(state, s.project.id, authority.id) !== 'other')
      .filter((s) => input.filter !== 'at_risk' || (s.health !== null && s.health.value !== 'on_track'))
      .filter((s) => !input.stageName || s.currentStage.name === input.stageName)
      .filter((s) => !input.leaderId || s.project.leaderId === input.leaderId)
      .filter((s) => !input.clientId || s.project.clientId === input.clientId)
      .sort(SORTS[input.sort]);
  },
});

export const projectsGet = defineCall({
  input: z.object({ id: ProjectId }),
  output: ProjectDetail,
  readOnly: true,
  run(input, ctx) {
    return detail(ctx, requireProject(ctx, input.id));
  },
});

export const projectsCreate = defineCall({
  input: z.object({
    name: ProjectName,
    clientId: ClientId.nullable().default(null),
    leader: z.union([z.literal('me'), z.literal('none'), UserId]).default('me'),
    location: Location.default(''),
    areaM2: Area.nullable().default(null),
    startDate: Day.nullable().default(null),
    targetEndDate: Day.nullable().default(null),
    stages: z.array(StageName).min(1).max(20).optional(),
    teamIds: z.array(UserId).max(50).default([]),
    modelFolderPath: FolderPath.default(''),
    description: Description.default(''),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    const { state, actor, stamp, today } = ctx;
    assertDates(input.startDate, input.targetEndDate, 'targetEndDate');
    const leaderId = input.leader === 'me' ? ctx.authority.id : input.leader === 'none' ? null : input.leader;
    if (leaderId) assertLeader(ctx, leaderId);
    if (input.clientId && !state.clients[input.clientId]) throw invalid('clientId', 'This client does not exist.');
    for (const userId of input.teamIds) {
      const member = state.users[userId];
      if (!member?.active || member.kind !== 'human') throw invalid('teamIds', 'Every team member must be an active person. Agents act for a person.');
    }
    const id = nextId(state, 'prj');
    const stageIds = (input.stages ?? state.settings.defaultStages).map((name, order) => {
      const stageId = nextId(state, 'stg');
      state.stages[stageId] = { id: stageId, projectId: id, name, order, startDate: null, endDate: null };
      return stageId;
    });
    const project: Project = {
      id, code: nextProjectCode(state, state.settings.codePrefix, today), name: input.name, clientId: input.clientId,
      status: 'active', leaderId, currentStageId: stageIds[0], location: input.location, areaM2: input.areaM2,
      startDate: input.startDate, targetEndDate: input.targetEndDate, coverFileId: null, modelFolderPath: input.modelFolderPath,
      description: input.description, healthOverride: null, createdBy: actor.id, createdAt: stamp, updatedAt: stamp,
    };
    state.projects[id] = project;
    recordCreate(ctx, { projectId: id, verb: 'project.created', targetType: 'project', targetId: id, entity: project });
    const people = new Set([ctx.authority.id, ...(leaderId ? [leaderId] : []), ...input.teamIds]);
    for (const userId of people) addMember(ctx, id, userId);
    return detail(ctx, project);
  },
});

export const projectsUpdate = defineCall({
  input: z.object({
    id: ProjectId,
    patch: z.object({
      name: ProjectName.optional(),
      clientId: ClientId.nullable().optional(),
      location: Location.optional(),
      areaM2: Area.nullable().optional(),
      startDate: Day.nullable().optional(),
      targetEndDate: Day.nullable().optional(),
      modelFolderPath: FolderPath.optional(),
      description: Description.optional(),
    }),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.id);
    const { patch } = input;
    const start = patch.startDate !== undefined ? patch.startDate : project.startDate;
    const end = patch.targetEndDate !== undefined ? patch.targetEndDate : project.targetEndDate;
    assertDates(start, end, 'targetEndDate');
    if (patch.clientId && !ctx.state.clients[patch.clientId]) throw invalid('clientId', 'This client does not exist.');
    applyPatch(ctx, project, patch, { projectId: project.id, verb: 'project.updated', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetStage = defineCall({
  input: z.object({ id: ProjectId, stageId: StageId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.id);
    requireStage(ctx, project.id, input.stageId);
    if (project.currentStageId === input.stageId) return detail(ctx, project);
    applyPatch(ctx, project, { currentStageId: input.stageId, healthOverride: null }, {
      projectId: project.id, verb: 'project.stage_changed', targetType: 'project', targetId: project.id,
    });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: projectPeople(ctx.state, project.id), trigger: 'stage_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetLeader = defineCall({
  input: z.object({ id: ProjectId, leaderId: UserId.nullable() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.changeLeader', { projectRole: roleIn(ctx, project.id) });
    if (input.leaderId) {
      assertLeader(ctx, input.leaderId);
      addMember(ctx, project.id, input.leaderId);
    }
    applyPatch(ctx, project, { leaderId: input.leaderId }, { projectId: project.id, verb: 'project.leader_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetStatus = defineCall({
  input: z.object({ id: ProjectId, status: ProjectStatus }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    applyPatch(ctx, project, { status: input.status }, { projectId: project.id, verb: 'project.status_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetHealthOverride = defineCall({
  input: z.object({ id: ProjectId, value: HealthValue, reason: z.string().trim().min(1).max(280) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.healthOverride', { projectRole: roleIn(ctx, project.id) });
    const override = { value: input.value, reason: input.reason, setBy: ctx.actor.id, setAt: ctx.stamp };
    applyPatch(ctx, project, { healthOverride: override }, { projectId: project.id, verb: 'project.health_overridden', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsClearHealthOverride = defineCall({
  input: z.object({ id: ProjectId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.healthOverride', { projectRole: roleIn(ctx, project.id) });
    applyPatch(ctx, project, { healthOverride: null }, { projectId: project.id, verb: 'project.health_cleared', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsDelete = defineCall({
  input: z.object({ id: ProjectId, confirm: z.literal(true) }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.delete', { projectRole: roleIn(ctx, project.id) });
    const { state } = ctx;
    const pid = project.id;
    const drop = <T extends { projectId: string }>(records: Record<string, T>) => {
      for (const [key, value] of Object.entries(records)) if (value.projectId === pid) delete records[key];
    };
    drop(state.stages);
    drop(state.deadlines);
    drop(state.tasks);
    drop(state.updates);
    drop(state.files);
    drop(state.time);
    drop(state.timeRows);
    drop(state.members);
    for (const [key, comment] of Object.entries(state.comments)) {
      const target = comment.targetType === 'task' ? state.tasks[comment.targetId] : state.updates[comment.targetId];
      if (!target) delete state.comments[key];
    }
    for (const [key, n] of Object.entries(state.notifications)) {
      const gone = (n.targetType === 'project' && n.targetId === pid)
        || (n.targetType === 'task' && !state.tasks[n.targetId])
        || (n.targetType === 'update' && !state.updates[n.targetId]);
      if (gone) delete state.notifications[key];
    }
    delete state.projects[pid];
    recordDelete(ctx, { projectId: pid, verb: 'project.deleted', targetType: 'project', targetId: pid, entity: project });
    return { deleted: true as const };
  },
});

export const membersAdd = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId, discipline: z.string().trim().min(1).max(40).optional() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const user = requireUser(ctx, input.userId);
    if (!user.active) throw invalid('userId', 'This person is not active.');
    if (user.kind === 'agent') throw invalid('userId', 'Agents act for a person. Add the person instead.');
    if (ctx.state.members[memberKey(project.id, user.id)]) throw invalid('userId', 'This person is already on the team.');
    addMember(ctx, project.id, user.id, input.discipline);
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const membersRemove = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const key = memberKey(project.id, input.userId);
    const member = ctx.state.members[key];
    if (!member) throw notFound('Member', key);
    if (project.leaderId === input.userId) throw invalid('userId', 'Change the leader first.');
    const hasOpenTasks = Object.values(ctx.state.tasks).some((t) => t.projectId === project.id && t.ownerId === input.userId && t.status !== 'done');
    if (hasOpenTasks) throw invalid('userId', 'Give their open tasks to someone else first.');
    delete ctx.state.members[key];
    recordDelete(ctx, { projectId: project.id, verb: 'member.removed', targetType: 'member', targetId: key, entity: member });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const membersUpdate = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId, discipline: z.string().trim().min(1).max(40) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const key = memberKey(project.id, input.userId);
    const member = ctx.state.members[key];
    if (!member) throw notFound('Member', key);
    applyPatch(ctx, member, { discipline: input.discipline }, { projectId: project.id, verb: 'member.updated', targetType: 'member', targetId: key });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const stagesReplace = defineCall({
  input: z.object({
    projectId: ProjectId,
    stages: z.array(z.object({
      id: StageId.optional(),
      name: StageName,
      startDate: Day.nullable().default(null),
      endDate: Day.nullable().default(null),
    })).min(1).max(20),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const { state } = ctx;
    const existing = stagesOf(state, project.id);
    const keep = new Set(input.stages.map((s) => s.id).filter((id): id is string => Boolean(id)));
    for (const stage of input.stages) {
      if (stage.id && state.stages[stage.id]?.projectId !== project.id) throw invalid('stages', 'A stage is not in this project.');
      if (stage.startDate && stage.endDate && stage.endDate < stage.startDate) throw invalid('stages', `The stage "${stage.name}" ends before it starts.`);
    }
    const removed = existing.filter((stage) => !keep.has(stage.id));
    for (const stage of removed) {
      const used = Object.values(state.tasks).some((t) => t.stageId === stage.id) || Object.values(state.time).some((e) => e.stageId === stage.id);
      if (used) throw invalid('stages', `Move the tasks and hours out of "${stage.name}" first.`);
    }
    const before = existing.map((stage) => ({ ...stage }));
    for (const stage of removed) {
      delete state.stages[stage.id];
      for (const d of Object.values(state.deadlines)) if (d.stageId === stage.id) d.stageId = null;
      for (const f of Object.values(state.files)) if (f.stageId === stage.id) f.stageId = null;
      for (const [key, row] of Object.entries(state.timeRows)) if (row.stageId === stage.id) delete state.timeRows[key];
    }
    input.stages.forEach((stage, order) => {
      const id = stage.id ?? nextId(state, 'stg');
      state.stages[id] = { id, projectId: project.id, name: stage.name, order, startDate: stage.startDate, endDate: stage.endDate };
    });
    if (!state.stages[project.currentStageId]) project.currentStageId = stagesOf(state, project.id)[0].id;
    writeEvent(ctx, {
      projectId: project.id, verb: 'project.stages_changed', targetType: 'project', targetId: project.id,
      before: { stages: before }, after: { stages: stagesOf(state, project.id) },
    });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const stagesSetDates = defineCall({
  input: z.object({ stageId: StageId, startDate: Day.nullable(), endDate: Day.nullable() }),
  output: ProjectDetail,
  run(input, ctx) {
    const stage = ctx.state.stages[input.stageId];
    if (!stage) throw notFound('Stage', input.stageId);
    const project = requireEditable(ctx, stage.projectId);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid('endDate', 'The stage cannot end before it starts.');
    applyPatch(ctx, stage, { startDate: input.startDate, endDate: input.endDate }, {
      projectId: project.id, verb: 'stage.dates_changed', targetType: 'stage', targetId: stage.id,
    });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesCreate = defineCall({
  input: z.object({ projectId: ProjectId, name: DeadlineName, date: Day, stageId: StageId.nullable().default(null) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    const id = nextId(ctx.state, 'ddl');
    const deadline: Deadline = { id, projectId: project.id, stageId: input.stageId, name: input.name, date: input.date };
    ctx.state.deadlines[id] = deadline;
    recordCreate(ctx, { projectId: project.id, verb: 'deadline.created', targetType: 'deadline', targetId: id, entity: deadline });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesUpdate = defineCall({
  input: z.object({
    id: DeadlineId,
    patch: z.object({ name: DeadlineName.optional(), date: Day.optional(), stageId: StageId.nullable().optional() }),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const deadline = requireDeadline(ctx, input.id);
    const project = requireEditable(ctx, deadline.projectId);
    if (input.patch.stageId) requireStage(ctx, project.id, input.patch.stageId);
    applyPatch(ctx, deadline, input.patch, { projectId: project.id, verb: 'deadline.updated', targetType: 'deadline', targetId: deadline.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesDelete = defineCall({
  input: z.object({ id: DeadlineId }),
  output: ProjectDetail,
  run(input, ctx) {
    const deadline = requireDeadline(ctx, input.id);
    const project = requireEditable(ctx, deadline.projectId);
    delete ctx.state.deadlines[deadline.id];
    recordDelete(ctx, { projectId: project.id, verb: 'deadline.deleted', targetType: 'deadline', targetId: deadline.id, entity: deadline });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectCalls = {
  'projects.list': projectsList,
  'projects.get': projectsGet,
  'projects.create': projectsCreate,
  'projects.update': projectsUpdate,
  'projects.setStage': projectsSetStage,
  'projects.setLeader': projectsSetLeader,
  'projects.setStatus': projectsSetStatus,
  'projects.setHealthOverride': projectsSetHealthOverride,
  'projects.clearHealthOverride': projectsClearHealthOverride,
  'projects.delete': projectsDelete,
  'members.add': membersAdd,
  'members.remove': membersRemove,
  'members.update': membersUpdate,
  'stages.replace': stagesReplace,
  'stages.setDates': stagesSetDates,
  'deadlines.create': deadlinesCreate,
  'deadlines.update': deadlinesUpdate,
  'deadlines.delete': deadlinesDelete,
};
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run src/api/handlers/projects.test.ts`
Expected: PASS (16 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/api
git commit -m "feat: add project, member, stage and deadline calls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 12: Task calls

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/views.ts`
- Create: `src/api/handlers/tasks.ts`
- Test: `src/api/handlers/tasks.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 11.
- Produces: schemas and types `EventView`, `TaskRow`, `TaskDetail`. Builders `eventViewOf(state, event): EventView`, `taskRowOf(state, task, today): TaskRow`, `taskDetailOf(state, task, today, viewer): TaskDetail`. The call map `taskCalls` with `tasks.list`, `tasks.get`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.move`, `tasks.approve`, `tasks.sendBack`, `tasks.delete`. `tasks.complete` and `tasks.move` return `{ result: TaskStatus; task: TaskDetail }`, so the screen can show the "Sent to review" toast.

- [ ] **Step 1: Write the failing test**

`src/api/handlers/tasks.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import type { Store } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

function withTask(overrides = {}) {
  const t = testApi(taskCalls);
  t.store.state.tasks.tsk_001 = makeTask(overrides);
  t.store.state.counters.tsk = 1;
  return t;
}

describe('tasks.create', () => {
  it('lets a team member add a task for themselves', async () => {
    const t = testApi(taskCalls);
    t.as('usr_003');
    const detail = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan' });
    expect(detail.task).toMatchObject({ ownerId: 'usr_003', stageId: 'stg_002', status: 'todo', needsReview: true });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(0);
  });

  it('stops a team member from assigning others or turning review off', async () => {
    const t = testApi(taskCalls);
    t.as('usr_003');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', needsReview: false })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader assign a task and tells the owner', async () => {
    const t = testApi(taskCalls);
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003', dueDate: '2026-10-08' });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(1);
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_004' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['ownerId'] },
    });
  });

  it('stops an outsider', async () => {
    const t = testApi(taskCalls);
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('review flow (spec 5.5)', () => {
  it('sends a team member tick to review and tells the leader', async () => {
    const t = withTask();
    t.as('usr_003');
    const out = await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(out.result).toBe('in_review');
    expect(out.task.task.status).toBe('in_review');
    expect(notices(t.store, 'review_requested', 'usr_002')).toHaveLength(1);
  });

  it('marks the task done when review is off', async () => {
    const t = withTask({ needsReview: false });
    t.as('usr_003');
    const out = await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(out.result).toBe('done');
    expect(out.task.task.completedAt).not.toBeNull();
  });

  it('marks the task done when the leader ticks it', async () => {
    const t = withTask();
    t.as('usr_002');
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('done');
  });

  it('approves a task in review and tells the owner', async () => {
    const t = withTask();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    const detail = await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(detail.task.status).toBe('done');
    expect(notices(t.store, 'task_approved', 'usr_003')).toHaveLength(1);
  });

  it('sends a task back with a note', async () => {
    const t = withTask();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await expect(t.api.call('tasks.sendBack', { id: 'tsk_001', note: ' ' })).rejects.toMatchObject({ code: 'invalid_input' });
    const detail = await t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'Check the stair widths.' });
    expect(detail.task.status).toBe('in_progress');
    expect(detail.commentCount).toBe(1);
    expect(notices(t.store, 'task_sent_back', 'usr_003')).toHaveLength(1);
  });

  it('refuses to approve a task that is not in review', async () => {
    const t = withTask();
    t.as('usr_002');
    await expect(t.api.call('tasks.approve', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('stops an outsider from ticking and a team member from reviewing', async () => {
    const t = withTask();
    t.as('usr_004');
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await expect(t.api.call('tasks.approve', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sends a drag to Done through review and lets the owner pull it back', async () => {
    const t = withTask();
    t.as('usr_003');
    expect((await t.api.call('tasks.move', { id: 'tsk_001', status: 'done' })).result).toBe('in_review');
    expect((await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).task.task.status).toBe('todo');
  });

  it('sends reviews to the Admin when the project has no leader', async () => {
    const t = withTask();
    t.store.state.projects.prj_001.leaderId = null;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(notices(t.store, 'review_requested', 'usr_001')).toHaveLength(1);
  });
});

describe('tasks.update and tasks.delete', () => {
  it('lets the owner edit and stops them from reassigning', async () => {
    const t = withTask();
    t.as('usr_003');
    const detail = await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'GF plan', flagged: true } });
    expect(detail.task).toMatchObject({ title: 'GF plan', flagged: true });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader reassign and tells the new owner', async () => {
    const t = withTask();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_002' } });
    expect(t.store.state.tasks.tsk_001.ownerId).toBe('usr_002');
    t.as('usr_001');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_003' } });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(1);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_005' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lets the leader delete a task', async () => {
    const t = withTask();
    t.as('usr_003');
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
  });
});

describe('agents', () => {
  it('act with the rights of their person', async () => {
    const t = withTask();
    t.as('usr_005');
    const created = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Area check' });
    expect(created.task).toMatchObject({ ownerId: 'usr_003', createdBy: 'usr_005' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
    const event = Object.values(t.store.state.events).find((e) => e.targetId === 'tsk_001');
    expect(event).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003' });
  });
});

describe('tasks.list', () => {
  it('filters mine, overdue and review for me, and hides projects that are not active', async () => {
    const t = testApi(taskCalls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-28', status: 'in_progress' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', dueDate: '2026-10-05' });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', status: 'in_review' });
    t.as('usr_003');
    expect((await t.api.call('tasks.list', { filter: 'mine' })).map((r) => r.task.id)).toEqual(['tsk_001', 'tsk_003']);
    const overdue = await t.api.call('tasks.list', { filter: 'overdue' });
    expect(overdue.map((r) => r.task.id)).toEqual(['tsk_001']);
    expect(overdue[0].overdue).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('tasks.list', { filter: 'review_for_me' })).map((r) => r.task.id)).toEqual(['tsk_003']);
    s.projects.prj_001.status = 'on_hold';
    expect(await t.api.call('tasks.list', {})).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/handlers/tasks.test.ts`
Expected: FAIL, "Failed to resolve import ./tasks".

- [ ] **Step 3: Add the output schemas**

In `src/api/contract/views.ts`, change the entities import at the top to:

```ts
import {
  Client, Day, Deadline, DeadlineId, Event, EventId, EventTarget, FileId, HealthValue, Project, ProjectId, Stage, StageId,
  Stamp, Task, UpdateId, UserId,
} from './entities';
```

Append to `src/api/contract/views.ts`:

```ts
export const EventView = z.object({ event: Event, actor: UserCard });
export type EventView = z.infer<typeof EventView>;

export const TaskRow = z.object({
  task: Task,
  owner: UserCard,
  project: z.object({ id: ProjectId, code: z.string(), name: z.string() }),
  stage: z.object({ id: StageId, name: z.string() }),
  commentCount: z.number().int().min(0),
  fileCount: z.number().int().min(0),
  overdue: z.boolean(),
});
export type TaskRow = z.infer<typeof TaskRow>;

export const TaskDetail = TaskRow.extend({
  hours: z.number().min(0),
  viewerCan: z.object({ edit: z.boolean(), editAll: z.boolean(), complete: z.boolean(), review: z.boolean(), delete: z.boolean() }),
  history: z.array(EventView),
});
export type TaskDetail = z.infer<typeof TaskDetail>;
```

- [ ] **Step 4: Add the builders**

In `src/api/views.ts`, replace the import block at the top with:

```ts
import type { Deadline, Event, Project, Stage, Task, Update, User } from './contract/entities';
import type { EventView, FeedItem, ProjectDetail, ProjectSummary, TaskDetail, TaskRow, UserCard } from './contract/views';
import { computeHealth, isOverdue } from './health';
import { can, projectRoleOf } from './permissions';
import type { State } from './store';
import { diffDays } from '../lib/dates';
```

Append to `src/api/views.ts`:

```ts
export function eventViewOf(state: State, event: Event): EventView {
  return { event, actor: cardOf(state, event.actorId) };
}

export function taskRowOf(state: State, task: Task, today: string): TaskRow {
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
  };
}

export function taskDetailOf(state: State, task: Task, today: string, viewer: User): TaskDetail {
  const r = { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId };
  const history = Object.values(state.events)
    .filter((e) => e.targetType === 'task' && e.targetId === task.id)
    .sort((a, b) => b.seq - a.seq)
    .map((e) => eventViewOf(state, e));
  return {
    ...taskRowOf(state, task, today),
    hours: Object.values(state.time).filter((e) => e.taskId === task.id).reduce((sum, e) => sum + e.hours, 0),
    viewerCan: {
      edit: can(viewer, 'task.updateOwn', r),
      editAll: can(viewer, 'task.updateAny', r),
      complete: can(viewer, 'task.updateOwn', r) && task.status !== 'done',
      review: can(viewer, 'task.review', r) && task.status === 'in_review',
      delete: can(viewer, 'task.delete', r),
    },
    history,
  };
}
```

- [ ] **Step 5: Write the calls**

`src/api/handlers/tasks.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ChecklistItem, Day, ProjectId, StageId, TaskId, TaskStatus, UserId, type Task } from '../contract/entities';
import { TaskDetail, TaskRow } from '../contract/views';
import { invalid } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { isOverdue } from '../health';
import { notify, reviewersOf } from '../notify';
import { can, projectRoleOf } from '../permissions';
import { nextId } from '../store';
import { taskDetailOf, taskRowOf } from '../views';
import { assertCan, insertComment, requireProject, requireStage, requireTask, roleIn, touch } from './shared';

const Title = z.string().trim().min(1).max(200);
const Moved = z.object({ result: TaskStatus, task: TaskDetail });

const detail = (ctx: Ctx, task: Task) => taskDetailOf(ctx.state, task, ctx.today, ctx.authority);
const onProject = (ctx: Ctx, projectId: string, userId: string) => projectRoleOf(ctx.state, projectId, userId) !== 'other';

/** Spec 5.5, with clarification 2: the leader and the Admin are the reviewers, so their tick lands on Done. */
function landingStatus(ctx: Ctx, task: Task): 'done' | 'in_review' {
  const reviewer = can(ctx.authority, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
  return !task.needsReview || reviewer ? 'done' : 'in_review';
}

function changeStatus(ctx: Ctx, task: Task, status: TaskStatus, verb = 'task.status_changed'): void {
  if (task.status === status) return;
  applyPatch(ctx, task, { status, completedAt: status === 'done' ? ctx.stamp : null }, {
    projectId: task.projectId, verb, targetType: 'task', targetId: task.id,
  });
  if (status === 'in_review') {
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: reviewersOf(ctx.state, task.projectId), trigger: 'review_requested', targetType: 'task', targetId: task.id });
  }
  touch(ctx, task.projectId);
}

export const tasksList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    ownerId: UserId.optional(),
    filter: z.enum(['all', 'mine', 'overdue', 'flagged', 'review_for_me']).default('all'),
    status: z.array(TaskStatus).optional(),
    dueFrom: Day.optional(),
    dueTo: Day.optional(),
    includeDone: z.boolean().default(true),
    activeProjectsOnly: z.boolean().default(true),
  }),
  output: z.array(TaskRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    const { projectId, ownerId, status, dueFrom, dueTo } = input;
    const tasks = Object.values(state.tasks).filter((task) => {
      const project = state.projects[task.projectId];
      if (!project || (input.activeProjectsOnly && project.status !== 'active')) return false;
      if (projectId && task.projectId !== projectId) return false;
      if (ownerId && task.ownerId !== ownerId) return false;
      if (!input.includeDone && task.status === 'done') return false;
      if (status && !status.includes(task.status)) return false;
      if (dueFrom && (task.dueDate === null || task.dueDate < dueFrom)) return false;
      if (dueTo && (task.dueDate === null || task.dueDate > dueTo)) return false;
      switch (input.filter) {
        case 'mine':
          return task.ownerId === authority.id;
        case 'overdue':
          return isOverdue(task, today);
        case 'flagged':
          return task.flagged;
        case 'review_for_me':
          return task.status === 'in_review' && reviewersOf(state, task.projectId).includes(authority.id);
        default:
          return true;
      }
    });
    tasks.sort((a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return tasks.map((task) => taskRowOf(state, task, today));
  },
});

export const tasksGet = defineCall({
  input: z.object({ id: TaskId }),
  output: TaskDetail,
  readOnly: true,
  run(input, ctx) {
    return detail(ctx, requireTask(ctx, input.id));
  },
});

export const tasksCreate = defineCall({
  input: z.object({
    projectId: ProjectId,
    title: Title,
    stageId: StageId.optional(),
    ownerId: UserId.optional(),
    dueDate: Day.nullable().default(null),
    description: z.string().max(5000).default(''),
    flagged: z.boolean().default(false),
    needsReview: z.boolean().optional(),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    // A task always belongs to a person. An agent adds tasks for the person it acts for.
    const ownerId = input.ownerId ?? ctx.authority.id;
    assertCan(ctx, ownerId === ctx.authority.id ? 'task.createForSelf' : 'task.createForAnyone', { projectRole: role });
    if (input.needsReview !== undefined) assertCan(ctx, 'task.updateAny', { projectRole: role });
    if (!onProject(ctx, project.id, ownerId)) throw invalid('ownerId', 'The owner must be on the project team.');
    const stageId = input.stageId ?? project.currentStageId;
    requireStage(ctx, project.id, stageId);
    const id = nextId(ctx.state, 'tsk');
    const task: Task = {
      id, projectId: project.id, stageId, title: input.title, description: input.description, ownerId, status: 'todo',
      dueDate: input.dueDate, flagged: input.flagged, needsReview: input.needsReview ?? true, checklist: [],
      createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null,
    };
    ctx.state.tasks[id] = task;
    recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [ownerId], trigger: 'task_assigned', targetType: 'task', targetId: id });
    touch(ctx, project.id);
    return detail(ctx, task);
  },
});

export const tasksUpdate = defineCall({
  input: z.object({
    id: TaskId,
    patch: z.object({
      title: Title.optional(),
      description: z.string().max(5000).optional(),
      dueDate: Day.nullable().optional(),
      stageId: StageId.optional(),
      ownerId: UserId.optional(),
      flagged: z.boolean().optional(),
      needsReview: z.boolean().optional(),
      checklist: z.array(ChecklistItem).max(100).optional(),
    }),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    const { patch } = input;
    const needsAny = patch.ownerId !== undefined || patch.needsReview !== undefined;
    assertCan(ctx, needsAny ? 'task.updateAny' : 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    if (patch.ownerId && !onProject(ctx, task.projectId, patch.ownerId)) throw invalid('ownerId', 'The owner must be on the project team.');
    if (patch.stageId) requireStage(ctx, task.projectId, patch.stageId);
    const reassigned = patch.ownerId !== undefined && patch.ownerId !== task.ownerId;
    applyPatch(ctx, task, patch, { projectId: task.projectId, verb: reassigned ? 'task.reassigned' : 'task.updated', targetType: 'task', targetId: task.id });
    if (reassigned) notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_assigned', targetType: 'task', targetId: task.id });
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

export const tasksComplete = defineCall({
  input: z.object({ id: TaskId }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    if (task.status === 'done') throw invalid('id', 'This task is already done.');
    const result = landingStatus(ctx, task);
    changeStatus(ctx, task, result);
    return { result, task: detail(ctx, task) };
  },
});

export const tasksMove = defineCall({
  input: z.object({ id: TaskId, status: TaskStatus }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    const result = input.status === 'done' ? landingStatus(ctx, task) : input.status;
    changeStatus(ctx, task, result);
    return { result, task: detail(ctx, task) };
  },
});

export const tasksApprove = defineCall({
  input: z.object({ id: TaskId }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    changeStatus(ctx, task, 'done', 'task.approved');
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_approved', targetType: 'task', targetId: task.id });
    return detail(ctx, task);
  },
});

export const tasksSendBack = defineCall({
  input: z.object({ id: TaskId, note: z.string().trim().min(1).max(2000) }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    changeStatus(ctx, task, 'in_progress', 'task.sent_back');
    insertComment(ctx, 'task', task.id, task.projectId, input.note);
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_sent_back', targetType: 'task', targetId: task.id });
    return detail(ctx, task);
  },
});

export const tasksDelete = defineCall({
  input: z.object({ id: TaskId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.delete', { projectRole: roleIn(ctx, task.projectId) });
    recordDelete(ctx, { projectId: task.projectId, verb: 'task.deleted', targetType: 'task', targetId: task.id, entity: task });
    delete ctx.state.tasks[task.id];
    touch(ctx, task.projectId);
    return { deleted: true as const };
  },
});

export const taskCalls = {
  'tasks.list': tasksList,
  'tasks.get': tasksGet,
  'tasks.create': tasksCreate,
  'tasks.update': tasksUpdate,
  'tasks.complete': tasksComplete,
  'tasks.move': tasksMove,
  'tasks.approve': tasksApprove,
  'tasks.sendBack': tasksSendBack,
  'tasks.delete': tasksDelete,
};
```

- [ ] **Step 6: Run the test to see it pass**

Run: `npx vitest run src/api/handlers/tasks.test.ts`
Expected: PASS (18 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/api
git commit -m "feat: add task calls with the review flow" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 13: Update, comment, file and event calls

**Files:**
- Modify: `src/api/contract/views.ts`, `src/api/views.ts`
- Create: `src/api/handlers/content.ts`, `src/api/handlers/files.ts`, `src/api/handlers/history.ts`
- Test: `src/api/handlers/content.test.ts`, `src/api/handlers/files.test.ts`, `src/api/handlers/history.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 12.
- Produces: schemas and types `CommentView`, `FileView`. Builders `commentViewOf(state, comment)`, `fileViewOf(state, file)`. `nextLetter(previous: string): string`. Call maps `contentCalls` (`updates.list`, `updates.create`, `updates.update`, `updates.delete`, `comments.list`, `comments.create`, `comments.update`, `comments.delete`, `reactions.toggle`), `fileCalls` (`files.list`, `files.get`, `files.upload`, `files.delete`), `historyCalls` (`events.list`, `events.undo`).

"Own" content (spec 17): a post, comment or file by an agent counts as its person's own, through `principalOf`. File rules (spec 5.7): an upload with the same name (any letter case) in the same project becomes the next version. The limit is 25 MB per file. `files.get` returns the file data as a `Blob`. Undo rules (spec 10.7): a person can undo their own change; the leader and the Admin can undo an agent change.

- [ ] **Step 1: Write the failing tests**

`src/api/handlers/content.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { contentCalls } from './content';
import type { Store } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { mentionMarkup } from '../../lib/text';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

describe('updates', () => {
  it('posts an update and tells the people it mentions', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: `Please check this ${mentionMarkup('Faisal Leader', 'usr_002')}` });
    expect(item.kind).toBe('update');
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
  });

  it('keeps agent posts quiet unless they mention someone', async () => {
    const t = testApi(contentCalls);
    t.as('usr_005');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Weekly summary: 3 open tasks.' });
    expect(Object.values(t.store.state.notifications)).toHaveLength(0);
    await t.api.call('updates.create', { projectId: 'prj_001', body: `${mentionMarkup('Faisal Leader', 'usr_002')} one task is overdue.` });
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
  });

  it("lets a person edit their agent's post", async () => {
    const t = testApi(contentCalls);
    t.as('usr_005');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Draft summary.' });
    t.as('usr_003');
    const edited = await t.api.call('updates.update', { id: item.id, body: 'Final summary.' });
    expect(edited.kind === 'update' ? edited.body : '').toBe('Final summary.');
  });

  it('stops an outsider from posting', async () => {
    const t = testApi(contentCalls);
    t.as('usr_004');
    await expect(t.api.call('updates.create', { projectId: 'prj_001', body: 'Hello' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets only the author edit, and tells only new mentions', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    const item = await t.api.call('updates.create', { projectId: 'prj_001', body: `Hi ${mentionMarkup('Faisal Leader', 'usr_002')}` });
    t.as('usr_002');
    await expect(t.api.call('updates.update', { id: item.id, body: 'Changed' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    const edited = await t.api.call('updates.update', {
      id: item.id, body: `Hi ${mentionMarkup('Faisal Leader', 'usr_002')} and ${mentionMarkup('Hala Admin', 'usr_001')}`,
    });
    expect(edited.kind === 'update' ? edited.editedAt : null).not.toBeNull();
    expect(notices(t.store, 'mention', 'usr_002')).toHaveLength(1);
    expect(notices(t.store, 'mention', 'usr_001')).toHaveLength(1);
  });

  it('filters the feed', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    await t.api.call('updates.create', { projectId: 'prj_001', body: 'Site visit done.' });
    expect(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'posts' })).toHaveLength(1);
    expect(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'tasks' })).toHaveLength(0);
  });
});

describe('comments', () => {
  it('adds, lists, reacts and protects edits', async () => {
    const t = testApi(contentCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_003');
    const first = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Started.' });
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Thanks.' });
    const list = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(list.map((c) => c.comment.body)).toEqual(['Started.', 'Thanks.']);
    expect((await t.api.call('reactions.toggle', { commentId: first.comment.id, emoji: '👍' })).comment.reactions['👍']).toEqual(['usr_002']);
    expect((await t.api.call('reactions.toggle', { commentId: first.comment.id, emoji: '👍' })).comment.reactions['👍']).toEqual([]);
    await expect(t.api.call('comments.update', { id: first.comment.id, body: 'Edited' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a comment on a missing task', async () => {
    const t = testApi(contentCalls);
    t.as('usr_003');
    await expect(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_404', body: 'Hi' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

`src/api/handlers/files.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fileCalls, nextLetter } from './files';
import { MAX_FILE_BYTES } from '../contract/entities';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

describe('nextLetter', () => {
  it('counts like spreadsheet columns', () => {
    expect(['A', 'Z', 'AZ', 'ZZ'].map(nextLetter)).toEqual(['B', 'AA', 'BA', 'AAA']);
  });
});

describe('files', () => {
  it('adds a new version for the same name', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const a = await t.api.call('files.upload', { projectId: 'prj_001', name: 'GF plan.pdf', blob: pdf('rev A') });
    expect(a.latest).toMatchObject({ letter: 'A', mimeType: 'application/pdf', size: 5 });
    const b = await t.api.call('files.upload', { projectId: 'prj_001', name: 'gf PLAN.pdf', blob: pdf('rev B2') });
    expect(b.file.id).toBe(a.file.id);
    expect(b.latest.letter).toBe('B');
    expect(b.file.versions).toHaveLength(2);
    const got = await t.api.call('files.get', { id: a.file.id, letter: 'A' });
    expect(got.version.letter).toBe('A');
    expect(got.blob.size).toBe(5);
    expect(await t.api.call('files.list', { projectId: 'prj_001' })).toHaveLength(1);
  });

  it('refuses a file over 25 MB', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const big = new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]);
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'huge.zip', blob: big })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['blob'] },
    });
  });

  it('lets only the leader set the cover', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.svg', blob: pdf('x'), asCover: true })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'cover.svg', blob: pdf('x'), asCover: true });
    expect(t.store.state.projects.prj_001.coverFileId).toBe(view.file.id);
  });

  it('lets the uploader or the leader delete a file', async () => {
    const t = testApi(fileCalls);
    t.as('usr_003');
    const mine = await t.api.call('files.upload', { projectId: 'prj_001', name: 'mine.pdf', blob: pdf('x') });
    t.as('usr_004');
    await expect(t.api.call('files.delete', { id: mine.file.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('files.delete', { id: mine.file.id });
    expect(t.store.state.files[mine.file.id]).toBeUndefined();
  });
});
```

`src/api/handlers/history.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { taskCalls } from './tasks';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls };

describe('events', () => {
  it('undoes my own change', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [latest] = await t.api.call('events.list', { targetType: 'task', targetId: 'tsk_001' });
    await t.api.call('events.undo', { eventId: latest.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
  });

  it("lets the leader or the agent's person undo an agent change, and stops others", async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: false });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', needsReview: false });
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    const [second, first] = await t.api.call('events.list', { projectId: 'prj_001' });
    expect(first.actor.kind).toBe('agent');
    expect(first.event.actingForId).toBe('usr_003');
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: first.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: first.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: second.event.id });
    expect(t.store.state.tasks.tsk_002.status).toBe('todo');
  });

  it('reports a conflict when the item changed later', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [done] = await t.api.call('events.list', { targetId: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' });
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: done.event.id })).rejects.toMatchObject({ code: 'conflict' });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/api/handlers/content.test.ts src/api/handlers/files.test.ts src/api/handlers/history.test.ts`
Expected: FAIL, "Failed to resolve import ./content", "./files" and "./history".

- [ ] **Step 3: Add the output schemas and builders**

In `src/api/contract/views.ts`, change the entities import at the top to:

```ts
import {
  Client, Comment, Day, Deadline, DeadlineId, Event, EventId, EventTarget, FileId, FileRec, FileVersion, HealthValue, Project,
  ProjectId, Stage, StageId, Stamp, Task, UpdateId, UserId,
} from './entities';
```

Append to `src/api/contract/views.ts`:

```ts
export const CommentView = z.object({ comment: Comment, author: UserCard });
export type CommentView = z.infer<typeof CommentView>;

export const FileView = z.object({ file: FileRec, latest: FileVersion, uploader: UserCard });
export type FileView = z.infer<typeof FileView>;
```

In `src/api/views.ts`, replace the import block at the top with:

```ts
import type { Comment, Deadline, Event, FileRec, Project, Stage, Task, Update, User } from './contract/entities';
import type {
  CommentView, EventView, FeedItem, FileView, ProjectDetail, ProjectSummary, TaskDetail, TaskRow, UserCard,
} from './contract/views';
import { computeHealth, isOverdue } from './health';
import { can, projectRoleOf } from './permissions';
import type { State } from './store';
import { diffDays } from '../lib/dates';
```

Append to `src/api/views.ts`:

```ts
export function commentViewOf(state: State, comment: Comment): CommentView {
  return { comment, author: cardOf(state, comment.authorId) };
}

export function fileViewOf(state: State, file: FileRec): FileView {
  const latest = file.versions[file.versions.length - 1];
  return { file, latest, uploader: cardOf(state, latest.uploadedBy) };
}
```

- [ ] **Step 4: Write the calls**

`src/api/handlers/content.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { CommentId, FileId, ProjectId, Reaction, TaskId, UpdateId, type Comment, type Update } from '../contract/entities';
import { CommentView, FeedItem } from '../contract/views';
import { invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { notify } from '../notify';
import { principalOf } from '../permissions';
import { nextId } from '../store';
import { commentViewOf, feedFor, updateItemOf } from '../views';
import { activeMentions, assertCan, insertComment, requireProject, roleIn, touch } from './shared';
import { mentionedUserIds } from '../../lib/text';

const Body = z.string().trim().min(1).max(5000);
const Target = z.object({ targetType: z.enum(['task', 'update']), targetId: z.union([TaskId, UpdateId]) });
const Deleted = z.object({ deleted: z.literal(true) });

function requireUpdate(ctx: Ctx, id: string): Update {
  const update = ctx.state.updates[id];
  if (!update) throw notFound('Update', id);
  return update;
}

function requireComment(ctx: Ctx, id: string): Comment {
  const comment = ctx.state.comments[id];
  if (!comment) throw notFound('Comment', id);
  return comment;
}

function projectOfTarget(ctx: Ctx, targetType: 'task' | 'update', targetId: string): string {
  const target = targetType === 'task' ? ctx.state.tasks[targetId] : ctx.state.updates[targetId];
  if (!target) throw notFound(targetType === 'task' ? 'Task' : 'Update', targetId);
  return target.projectId;
}

function newMentions(ctx: Ctx, before: string, after: string): string[] {
  const old = new Set(mentionedUserIds(before));
  return activeMentions(ctx.state, after).filter((id) => !old.has(id));
}

export const updatesList = defineCall({
  input: z.object({
    projectId: ProjectId,
    filter: z.enum(['all', 'posts', 'tasks', 'files']).default('all'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.array(FeedItem),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return feedFor(ctx.state, input.projectId, input.filter, input.limit);
  },
});

export const updatesCreate = defineCall({
  input: z.object({ projectId: ProjectId, body: Body, fileIds: z.array(FileId).max(20).default([]) }),
  output: FeedItem,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    for (const fileId of input.fileIds) {
      if (ctx.state.files[fileId]?.projectId !== project.id) throw invalid('fileIds', 'A file is not in this project.');
    }
    const id = nextId(ctx.state, 'upd');
    const update: Update = { id, projectId: project.id, authorId: ctx.actor.id, body: input.body, fileIds: input.fileIds, createdAt: ctx.stamp, editedAt: null };
    ctx.state.updates[id] = update;
    recordCreate(ctx, { projectId: project.id, verb: 'update.posted', targetType: 'update', targetId: id, entity: update });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: activeMentions(ctx.state, input.body), trigger: 'mention', targetType: 'update', targetId: id });
    touch(ctx, project.id);
    return updateItemOf(ctx.state, update);
  },
});

export const updatesUpdate = defineCall({
  input: z.object({ id: UpdateId, body: Body }),
  output: FeedItem,
  run(input, ctx) {
    const update = requireUpdate(ctx, input.id);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
    const added = newMentions(ctx, update.body, input.body);
    applyPatch(ctx, update, { body: input.body, editedAt: ctx.stamp }, { projectId: update.projectId, verb: 'update.edited', targetType: 'update', targetId: update.id });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: added, trigger: 'mention', targetType: 'update', targetId: update.id });
    return updateItemOf(ctx.state, update);
  },
});

export const updatesDelete = defineCall({
  input: z.object({ id: UpdateId }),
  output: Deleted,
  run(input, ctx) {
    const update = requireUpdate(ctx, input.id);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, update.projectId), authorId: principalOf(ctx.state, update.authorId) });
    recordDelete(ctx, { projectId: update.projectId, verb: 'update.deleted', targetType: 'update', targetId: update.id, entity: update });
    delete ctx.state.updates[update.id];
    return { deleted: true as const };
  },
});

export const commentsList = defineCall({
  input: Target,
  output: z.array(CommentView),
  readOnly: true,
  run(input, ctx) {
    projectOfTarget(ctx, input.targetType, input.targetId);
    return Object.values(ctx.state.comments)
      .filter((c) => c.targetType === input.targetType && c.targetId === input.targetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((c) => commentViewOf(ctx.state, c));
  },
});

export const commentsCreate = defineCall({
  input: Target.extend({ body: Body }),
  output: CommentView,
  run(input, ctx) {
    const projectId = projectOfTarget(ctx, input.targetType, input.targetId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, projectId) });
    const comment = insertComment(ctx, input.targetType, input.targetId, projectId, input.body);
    touch(ctx, projectId);
    return commentViewOf(ctx.state, comment);
  },
});

export const commentsUpdate = defineCall({
  input: z.object({ id: CommentId, body: Body }),
  output: CommentView,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, projectId), authorId: principalOf(ctx.state, comment.authorId) });
    const added = newMentions(ctx, comment.body, input.body);
    applyPatch(ctx, comment, { body: input.body, editedAt: ctx.stamp }, { projectId, verb: 'comment.edited', targetType: 'comment', targetId: comment.id });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: added, trigger: 'mention', targetType: comment.targetType, targetId: comment.targetId });
    return commentViewOf(ctx.state, comment);
  },
});

export const commentsDelete = defineCall({
  input: z.object({ id: CommentId }),
  output: Deleted,
  run(input, ctx) {
    const comment = requireComment(ctx, input.id);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.editOwn', { projectRole: roleIn(ctx, projectId), authorId: principalOf(ctx.state, comment.authorId) });
    recordDelete(ctx, { projectId, verb: 'comment.deleted', targetType: 'comment', targetId: comment.id, entity: comment });
    delete ctx.state.comments[comment.id];
    return { deleted: true as const };
  },
});

export const reactionsToggle = defineCall({
  input: z.object({ commentId: CommentId, emoji: Reaction }),
  output: CommentView,
  run(input, ctx) {
    const comment = requireComment(ctx, input.commentId);
    const projectId = projectOfTarget(ctx, comment.targetType, comment.targetId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, projectId) });
    const list = comment.reactions[input.emoji];
    comment.reactions[input.emoji] = list.includes(ctx.actor.id) ? list.filter((id) => id !== ctx.actor.id) : [...list, ctx.actor.id];
    return commentViewOf(ctx.state, comment);
  },
});

export const contentCalls = {
  'updates.list': updatesList,
  'updates.create': updatesCreate,
  'updates.update': updatesUpdate,
  'updates.delete': updatesDelete,
  'comments.list': commentsList,
  'comments.create': commentsCreate,
  'comments.update': commentsUpdate,
  'comments.delete': commentsDelete,
  'reactions.toggle': reactionsToggle,
};
```

`src/api/handlers/files.ts`:

```ts
import { z } from 'zod';
import { defineCall } from '../registry';
import { FileId, FileVersion, MAX_FILE_BYTES, ProjectId, StageId, TaskId, type FileRec, type FileVersion as Version } from '../contract/entities';
import { FileView } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { can, principalOf } from '../permissions';
import { nextId } from '../store';
import { fileViewOf } from '../views';
import { assertCan, requireProject, requireStage, roleIn, touch } from './shared';

/** A, B, ... Z, AA, AB: the version letters. */
export function nextLetter(previous: string): string {
  let n = 0;
  for (const ch of previous) n = n * 26 + (ch.charCodeAt(0) - 64);
  n += 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export const filesList = defineCall({
  input: z.object({ projectId: ProjectId, stageId: StageId.optional(), taskId: TaskId.optional() }),
  output: z.array(FileView),
  readOnly: true,
  run(input, ctx) {
    requireProject(ctx, input.projectId);
    return Object.values(ctx.state.files)
      .filter((f) => f.projectId === input.projectId && (!input.stageId || f.stageId === input.stageId) && (!input.taskId || f.taskId === input.taskId))
      .map((f) => fileViewOf(ctx.state, f))
      .sort((a, b) => b.latest.uploadedAt.localeCompare(a.latest.uploadedAt));
  },
});

export const filesGet = defineCall({
  input: z.object({ id: FileId, letter: z.string().regex(/^[A-Z]+$/).optional() }),
  output: z.object({ file: FileView, version: FileVersion, blob: z.instanceof(Blob) }),
  readOnly: true,
  async prepare(input, p) {
    const file = p.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    const version = input.letter ? file.versions.find((v) => v.letter === input.letter) : file.versions[file.versions.length - 1];
    if (!version) throw notFound('Version', input.letter ?? '');
    const blob = await p.persister.getBlob(version.blobKey);
    if (!blob) throw notFound('File data', version.blobKey);
    return { blob, version };
  },
  run(input, ctx, prepared) {
    const file = ctx.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    return { file: fileViewOf(ctx.state, file), version: prepared.version, blob: prepared.blob };
  },
});

export const filesUpload = defineCall({
  input: z
    .object({
      projectId: ProjectId,
      name: z.string().trim().min(1).max(200),
      blob: z.instanceof(Blob),
      stageId: StageId.nullable().default(null),
      taskId: TaskId.nullable().default(null),
      asCover: z.boolean().default(false),
    })
    .refine((value) => value.blob.size <= MAX_FILE_BYTES, { path: ['blob'], message: 'Files must be 25 MB or smaller.' }),
  output: FileView,
  async prepare(input, p) {
    const blobKey = `blob_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    await p.persister.putBlob(blobKey, input.blob);
    return { blobKey };
  },
  run(input, ctx, prepared) {
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    assertCan(ctx, 'content.post', { projectRole: role });
    if (input.asCover) assertCan(ctx, 'project.edit', { projectRole: role });
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    if (input.taskId && ctx.state.tasks[input.taskId]?.projectId !== project.id) throw invalid('taskId', 'This task is not in the project.');
    const version: Version = {
      letter: 'A', blobKey: prepared.blobKey, mimeType: input.blob.type || 'application/octet-stream', size: input.blob.size,
      uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp,
    };
    const same = Object.values(ctx.state.files).find((f) => f.projectId === project.id && f.name.toLowerCase() === input.name.toLowerCase());
    let file: FileRec;
    if (same) {
      version.letter = nextLetter(same.versions[same.versions.length - 1].letter);
      const before = { versions: structuredClone(same.versions) };
      same.versions.push(version);
      writeEvent(ctx, { projectId: project.id, verb: 'file.version_added', targetType: 'file', targetId: same.id, before, after: { versions: structuredClone(same.versions) } });
      file = same;
    } else {
      const id = nextId(ctx.state, 'fil');
      file = { id, projectId: project.id, stageId: input.stageId, taskId: input.taskId, name: input.name, versions: [version] };
      ctx.state.files[id] = file;
      recordCreate(ctx, { projectId: project.id, verb: 'file.added', targetType: 'file', targetId: id, entity: file });
    }
    if (input.asCover) {
      applyPatch(ctx, project, { coverFileId: file.id }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    touch(ctx, project.id);
    return fileViewOf(ctx.state, file);
  },
});

export const filesDelete = defineCall({
  input: z.object({ id: FileId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const file = ctx.state.files[input.id];
    if (!file) throw notFound('File', input.id);
    const role = roleIn(ctx, file.projectId);
    const allowed = can(ctx.authority, 'task.delete', { projectRole: role })
      || can(ctx.authority, 'content.editOwn', { projectRole: role, authorId: principalOf(ctx.state, file.versions[0].uploadedBy) });
    if (!allowed) throw forbidden('Only the uploader or the project leader can delete this file.');
    const project = ctx.state.projects[file.projectId];
    if (project?.coverFileId === file.id) {
      applyPatch(ctx, project, { coverFileId: null }, { projectId: project.id, verb: 'project.cover_changed', targetType: 'project', targetId: project.id });
    }
    recordDelete(ctx, { projectId: file.projectId, verb: 'file.deleted', targetType: 'file', targetId: file.id, entity: file });
    delete ctx.state.files[file.id];
    touch(ctx, file.projectId);
    return { deleted: true as const };
  },
});

export const fileCalls = {
  'files.list': filesList,
  'files.get': filesGet,
  'files.upload': filesUpload,
  'files.delete': filesDelete,
};
```

The data of a deleted file stays in storage, so Undo can bring the file back.

`src/api/handlers/history.ts`:

```ts
import { z } from 'zod';
import { defineCall } from '../registry';
import { EventId, EventTarget, ProjectId } from '../contract/entities';
import { EventView } from '../contract/views';
import { forbidden, notFound } from '../errors';
import { undoEvent } from '../events';
import { can } from '../permissions';
import { eventViewOf } from '../views';
import { roleIn, touch } from './shared';

export const eventsList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    targetType: EventTarget.optional(),
    targetId: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(50),
  }),
  output: z.array(EventView),
  readOnly: true,
  run(input, ctx) {
    return Object.values(ctx.state.events)
      .filter((e) => (!input.projectId || e.projectId === input.projectId)
        && (!input.targetType || e.targetType === input.targetType)
        && (!input.targetId || e.targetId === input.targetId))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, input.limit)
      .map((e) => eventViewOf(ctx.state, e));
  },
});

export const eventsUndo = defineCall({
  input: z.object({ eventId: EventId }),
  output: EventView,
  run(input, ctx) {
    const event = ctx.state.events[input.eventId];
    if (!event) throw notFound('Event', input.eventId);
    // Your own changes and your agent's changes are yours to undo: the event names the person each acted for.
    const own = event.actingForId === ctx.authority.id;
    const agentChange = event.actorKind === 'agent' && event.projectId !== null
      && can(ctx.authority, 'event.undoAgent', { projectRole: roleIn(ctx, event.projectId) });
    if (!own && !agentChange) throw forbidden('You can undo changes by you or your agent, and agent changes on a project you lead.');
    const undo = undoEvent(ctx, event.id);
    if (event.projectId && ctx.state.projects[event.projectId]) touch(ctx, event.projectId);
    return eventViewOf(ctx.state, undo);
  },
});

export const historyCalls = {
  'events.list': eventsList,
  'events.undo': eventsUndo,
};
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run src/api/handlers/content.test.ts src/api/handlers/files.test.ts src/api/handlers/history.test.ts`
Expected: PASS (16 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/api
git commit -m "feat: add update, comment, file and undo calls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 14: Time and notification calls

**Files:**
- Create: `src/api/handlers/time.ts`, `src/api/handlers/notifications.ts`
- Test: `src/api/handlers/time.test.ts`, `src/api/handlers/notifications.test.ts`

**Interfaces:**
- Consumes: Tasks 5 to 13.
- Produces: `rowKeyOf(projectId, stageId, taskId): string` (`prj_001|stg_002|-`), `isWeekLocked(state, userId, weekStart, today): boolean`, schema and type `WeekView` (rows carry `hours: number[7]`, one number per day from Sunday), `weekViewOf(state, userId, weekStart, today): WeekView`. The call map `timeCalls` with `time.week`, `time.set`, `time.addRow`, `time.removeRow`, `time.copyLastWeek`, `time.unlockWeek`. `ACTION_TRIGGERS`, schema `NotificationView` (`notification`, `actor`, `target`, `projectCode`, `link`, `needsAction`). The call map `notificationCalls` with `notifications.list`, `notifications.count` (returns `{ unread, badge }`), `notifications.markRead`, `notifications.markAllRead`, `notifications.updateSettings`.

Timesheet rules (spec 6.2): half-hour steps; 24 hours per day at most, over all rows; no future days; the hours always belong to a person (the current user, or the person an agent acts for); a week locks 14 days after its Saturday; only the Admin unlocks. Notification links are hash routes for the screens in plans 2 and 3.

- [ ] **Step 1: Write the failing tests**

`src/api/handlers/time.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { timeCalls } from './time';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const WEEK = '2026-09-27';

function sara() {
  const t = testApi(timeCalls);
  t.as('usr_003');
  return t;
}

describe('time calls', () => {
  it('shows an empty week with seven days and the target', async () => {
    const week = await sara().api.call('time.week', { weekStart: WEEK });
    expect(week.days).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(week).toMatchObject({ target: 40, locked: false, weekTotal: 0, rows: [] });
  });

  it('refuses a week that does not start on Sunday', async () => {
    await expect(sara().api.call('time.week', { weekStart: '2026-09-28' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('logs, changes and clears hours', async () => {
    const t = sara();
    const set = (hours: number) => t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours });
    let week = await set(7.5);
    expect(week.rows[0].hours).toEqual([0, 7.5, 0, 0, 0, 0, 0]);
    expect(week.dayTotals[1]).toBe(7.5);
    week = await set(8);
    expect(week.weekTotal).toBe(8);
    week = await set(0);
    expect(week.rows).toEqual([]);
    expect(Object.keys(t.store.state.time)).toHaveLength(0);
  });

  it('checks half-hour steps, 24 hours a day and future days', async () => {
    const t = sara();
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 0.3 })).rejects.toMatchObject({ code: 'invalid_input' });
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', date: '2026-09-28', hours: 20 });
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 5 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['hours'] },
    });
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-10-01', hours: 1 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['date'] },
    });
  });

  it('stops an outsider and a task from another stage', async () => {
    const t = testApi(timeCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_004');
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', taskId: 'tsk_001', date: '2026-09-28', hours: 1 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['taskId'] },
    });
  });

  it('locks a week 14 days after it ends, until the Admin unlocks it', async () => {
    const t = sara();
    const log = (hours: number) => t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-14', hours });
    setNow(new Date('2026-10-03T06:00:00Z'));
    await expect(log(8)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'week_locked' } });
    setNow(new Date('2026-10-02T06:00:00Z'));
    await expect(log(8)).resolves.toMatchObject({ weekTotal: 8 });
    setNow(new Date('2026-10-03T06:00:00Z'));
    t.as('usr_001');
    expect(await t.api.call('time.unlockWeek', { userId: 'usr_003', weekStart: '2026-09-13' })).toMatchObject({ locked: false, unlocked: true });
    t.as('usr_003');
    await expect(log(7)).resolves.toMatchObject({ weekTotal: 7 });
  });

  it("shows another person's week only to the Admin", async () => {
    const t = testApi(timeCalls);
    t.as('usr_002');
    await expect(t.api.call('time.week', { userId: 'usr_003', weekStart: WEEK })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('time.week', { userId: 'usr_003', weekStart: WEEK })).resolves.toMatchObject({ userId: 'usr_003' });
  });

  it('pins rows, protects rows with hours, and copies last week', async () => {
    const t = sara();
    let week = await t.api.call('time.addRow', { weekStart: WEEK, projectId: 'prj_001', stageId: 'stg_001' });
    expect(week.rows.map((r) => [r.stage.name, r.pinned])).toEqual([['Concept', true]]);
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', date: '2026-09-27', hours: 2 });
    await expect(t.api.call('time.removeRow', { weekStart: WEEK, rowKey: 'prj_001|stg_001|-' })).rejects.toMatchObject({ code: 'invalid_input' });
    week = await t.api.call('time.copyLastWeek', { weekStart: '2026-10-04' });
    expect(week.rows.map((r) => r.key)).toEqual(['prj_001|stg_001|-']);
    expect(week.weekTotal).toBe(0);
    week = await t.api.call('time.removeRow', { weekStart: '2026-10-04', rowKey: 'prj_001|stg_001|-' });
    expect(week.rows).toEqual([]);
  });
});
```

`src/api/handlers/notifications.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { notificationCalls } from './notifications';
import { notify } from '../notify';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

function withNotices() {
  const t = testApi(notificationCalls);
  const s = t.store.state;
  s.tasks.tsk_001 = makeTask();
  notify(s, s.users.usr_002, '2026-09-29T09:00:00.000+03:00', { userIds: ['usr_003'], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_001' });
  notify(s, s.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'stage_changed', targetType: 'project', targetId: 'prj_001' });
  notify(s, s.users.usr_002, STAMP, { userIds: ['usr_004'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
  t.as('usr_003');
  return t;
}

describe('notification calls', () => {
  it('lists my notifications, newest first, with links and a badge count', async () => {
    const t = withNotices();
    const list = await t.api.call('notifications.list', {});
    expect(list.map((v) => v.notification.trigger)).toEqual(['stage_changed', 'task_assigned']);
    expect(list[1]).toMatchObject({ target: 'Ground floor plan', projectCode: 'KH-26-001', link: '/projects/prj_001?task=tsk_001', needsAction: true });
    expect(list[1].actor?.id).toBe('usr_002');
    expect(list[0]).toMatchObject({ link: '/projects/prj_001', needsAction: false });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 2, badge: 1 });
  });

  it('marks my notifications as read and refuses other people', async () => {
    const t = withNotices();
    const [first] = await t.api.call('notifications.list', {});
    expect(await t.api.call('notifications.markRead', { ids: [first.notification.id] })).toEqual({ unread: 1, badge: 1 });
    await expect(t.api.call('notifications.markRead', { ids: ['ntf_003'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await t.api.call('notifications.markAllRead', {})).toEqual({ unread: 0, badge: 0 });
  });

  it('turns a trigger off', async () => {
    const t = withNotices();
    const user = await t.api.call('notifications.updateSettings', { trigger: 'mention', on: false });
    expect(user.preferences.notifications.mention).toBe(false);
    const s = t.store.state;
    expect(notify(s, s.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' })).toHaveLength(0);
  });

  it('links a week reminder to the timesheet', async () => {
    const t = withNotices();
    notify(t.store.state, null, STAMP, { userIds: ['usr_003'], trigger: 'week_under_target', targetType: 'week', targetId: '2026-09-27' });
    const [latest] = await t.api.call('notifications.list', { unreadOnly: true, limit: 1 });
    expect(latest.link).toBe('/work?tab=hours&week=2026-09-27');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/api/handlers/time.test.ts src/api/handlers/notifications.test.ts`
Expected: FAIL, "Failed to resolve import ./time" and "./notifications".

- [ ] **Step 3: Write the calls**

`src/api/handlers/time.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, ProjectId, StageId, TaskId, UserId, type TimeEntry } from '../contract/entities';
import { forbidden, invalid } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { can } from '../permissions';
import { nextId, type State } from '../store';
import { addDays, dayOfWeek, diffDays, weekStartOf } from '../../lib/dates';
import { assertCan, requireProject, requireStage, requireUser, roleIn } from './shared';

const WeekStart = Day.refine((day) => dayOfWeek(day) === 0, 'A week starts on a Sunday.');
const Hours = z.number().min(0).max(24).multipleOf(0.5);

export function rowKeyOf(projectId: string, stageId: string, taskId: string | null): string {
  return `${projectId}|${stageId}|${taskId ?? '-'}`;
}

function pinKey(userId: string, weekStart: string, rowKey: string): string {
  return `${userId}|${weekStart}|${rowKey}`;
}

/** A week locks 14 days after its last day (Saturday), unless the Admin unlocked it. */
export function isWeekLocked(state: State, userId: string, weekStart: string, today: string): boolean {
  const unlocked = state.weekUnlocks.some((u) => u.userId === userId && u.weekStart === weekStart);
  return !unlocked && diffDays(addDays(weekStart, 6), today) >= 14;
}

const Row = z.object({
  key: z.string(),
  project: z.object({ id: ProjectId, code: z.string(), name: z.string() }),
  stage: z.object({ id: StageId, name: z.string() }),
  task: z.object({ id: TaskId, title: z.string() }).nullable(),
  hours: z.array(z.number()).length(7),
  total: z.number(),
  pinned: z.boolean(),
});
type RowView = z.infer<typeof Row>;

export const WeekView = z.object({
  userId: UserId,
  weekStart: Day,
  days: z.array(Day).length(7),
  locked: z.boolean(),
  unlocked: z.boolean(),
  target: z.number(),
  rows: z.array(Row),
  dayTotals: z.array(z.number()).length(7),
  weekTotal: z.number(),
});
export type WeekView = z.infer<typeof WeekView>;

export function weekViewOf(state: State, userId: string, weekStart: string, today: string): WeekView {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rows = new Map<string, RowView>();
  const ensure = (projectId: string, stageId: string, taskId: string | null, pinned: boolean): RowView => {
    const key = rowKeyOf(projectId, stageId, taskId);
    let row = rows.get(key);
    if (!row) {
      const project = state.projects[projectId];
      const stage = state.stages[stageId];
      const task = taskId ? state.tasks[taskId] : undefined;
      row = {
        key,
        project: { id: projectId, code: project?.code ?? '', name: project?.name ?? '' },
        stage: { id: stageId, name: stage?.name ?? '' },
        task: task ? { id: task.id, title: task.title } : null,
        hours: [0, 0, 0, 0, 0, 0, 0],
        total: 0,
        pinned: false,
      };
      rows.set(key, row);
    }
    if (pinned) row.pinned = true;
    return row;
  };
  for (const pin of Object.values(state.timeRows)) {
    if (pin.userId === userId && pin.weekStart === weekStart) ensure(pin.projectId, pin.stageId, pin.taskId, true);
  }
  for (const entry of Object.values(state.time)) {
    if (entry.userId !== userId || entry.date < days[0] || entry.date > days[6]) continue;
    const row = ensure(entry.projectId, entry.stageId, entry.taskId, false);
    row.hours[diffDays(weekStart, entry.date)] += entry.hours;
    row.total += entry.hours;
  }
  const list = [...rows.values()].sort((a, b) =>
    a.project.code.localeCompare(b.project.code) || a.stage.name.localeCompare(b.stage.name) || a.key.localeCompare(b.key));
  const dayTotals = days.map((_, i) => list.reduce((sum, row) => sum + row.hours[i], 0));
  return {
    userId, weekStart, days,
    locked: isWeekLocked(state, userId, weekStart, today),
    unlocked: state.weekUnlocks.some((u) => u.userId === userId && u.weekStart === weekStart),
    target: state.users[userId]?.weeklyHourTarget ?? 0,
    rows: list,
    dayTotals,
    weekTotal: dayTotals.reduce((sum, hours) => sum + hours, 0),
  };
}

function assertLoggable(ctx: Ctx, projectId: string, stageId: string, taskId: string | null): void {
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'time.logOnProject', { projectRole: roleIn(ctx, project.id) });
  requireStage(ctx, project.id, stageId);
  if (taskId) {
    const task = ctx.state.tasks[taskId];
    if (!task || task.projectId !== project.id || task.stageId !== stageId) throw invalid('taskId', 'This task is not in that project stage.');
  }
}

function assertUnlocked(ctx: Ctx, weekStart: string): void {
  if (isWeekLocked(ctx.state, ctx.authority.id, weekStart, ctx.today)) throw forbidden('This week is locked.', { reason: 'week_locked' });
}

export const timeWeek = defineCall({
  input: z.object({ userId: UserId.optional(), weekStart: WeekStart }),
  output: WeekView,
  readOnly: true,
  run(input, ctx) {
    const userId = input.userId ?? ctx.authority.id;
    requireUser(ctx, userId);
    if (userId !== ctx.authority.id) assertCan(ctx, 'time.viewPerson', { targetUserId: userId });
    return weekViewOf(ctx.state, userId, input.weekStart, ctx.today);
  },
});

export const timeSet = defineCall({
  input: z.object({ projectId: ProjectId, stageId: StageId, taskId: TaskId.nullable().default(null), date: Day, hours: Hours }),
  output: WeekView,
  run(input, ctx) {
    const { state, today } = ctx;
    const actor = ctx.authority; // Hours always belong to a person, also when an agent logs them.
    assertLoggable(ctx, input.projectId, input.stageId, input.taskId);
    if (input.date > today) throw invalid('date', 'You cannot log hours for a future day.');
    const weekStart = weekStartOf(input.date);
    assertUnlocked(ctx, weekStart);
    const key = rowKeyOf(input.projectId, input.stageId, input.taskId);
    const sameDay = Object.values(state.time).filter((e) => e.userId === actor.id && e.date === input.date);
    const existing = sameDay.find((e) => rowKeyOf(e.projectId, e.stageId, e.taskId) === key);
    const others = sameDay.filter((e) => e !== existing).reduce((sum, e) => sum + e.hours, 0);
    if (others + input.hours > 24) throw invalid('hours', 'A day cannot have more than 24 hours.');
    const meta = { projectId: input.projectId, targetType: 'time' as const };
    if (input.hours === 0) {
      if (existing) {
        recordDelete(ctx, { ...meta, verb: 'time.cleared', targetId: existing.id, entity: existing });
        delete state.time[existing.id];
      }
    } else if (existing) {
      applyPatch(ctx, existing, { hours: input.hours }, { ...meta, verb: 'time.changed', targetId: existing.id });
    } else {
      const id = nextId(state, 'tim');
      const entry: TimeEntry = {
        id, userId: actor.id, projectId: input.projectId, stageId: input.stageId, taskId: input.taskId, date: input.date, hours: input.hours,
      };
      state.time[id] = entry;
      recordCreate(ctx, { ...meta, verb: 'time.logged', targetId: id, entity: entry });
    }
    return weekViewOf(state, actor.id, weekStart, today);
  },
});

export const timeAddRow = defineCall({
  input: z.object({ weekStart: WeekStart, projectId: ProjectId, stageId: StageId, taskId: TaskId.nullable().default(null) }),
  output: WeekView,
  run(input, ctx) {
    assertLoggable(ctx, input.projectId, input.stageId, input.taskId);
    assertUnlocked(ctx, input.weekStart);
    const key = pinKey(ctx.authority.id, input.weekStart, rowKeyOf(input.projectId, input.stageId, input.taskId));
    ctx.state.timeRows[key] = {
      key, userId: ctx.authority.id, weekStart: input.weekStart, projectId: input.projectId, stageId: input.stageId, taskId: input.taskId,
    };
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeRemoveRow = defineCall({
  input: z.object({ weekStart: WeekStart, rowKey: z.string().min(1) }),
  output: WeekView,
  run(input, ctx) {
    const row = weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today).rows.find((r) => r.key === input.rowKey);
    if (row && row.total > 0) throw invalid('rowKey', 'Clear the hours in this row first.');
    delete ctx.state.timeRows[pinKey(ctx.authority.id, input.weekStart, input.rowKey)];
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeCopyLastWeek = defineCall({
  input: z.object({ weekStart: WeekStart }),
  output: WeekView,
  run(input, ctx) {
    assertUnlocked(ctx, input.weekStart);
    const previous = weekViewOf(ctx.state, ctx.authority.id, addDays(input.weekStart, -7), ctx.today);
    for (const row of previous.rows) {
      const project = ctx.state.projects[row.project.id];
      const stage = ctx.state.stages[row.stage.id];
      if (!project || project.status !== 'active' || !stage) continue;
      if (!can(ctx.authority, 'time.logOnProject', { projectRole: roleIn(ctx, project.id) })) continue;
      const taskId = row.task?.id ?? null;
      const key = pinKey(ctx.authority.id, input.weekStart, rowKeyOf(project.id, stage.id, taskId));
      ctx.state.timeRows[key] = { key, userId: ctx.authority.id, weekStart: input.weekStart, projectId: project.id, stageId: stage.id, taskId };
    }
    return weekViewOf(ctx.state, ctx.authority.id, input.weekStart, ctx.today);
  },
});

export const timeUnlockWeek = defineCall({
  input: z.object({ userId: UserId, weekStart: WeekStart }),
  output: WeekView,
  run(input, ctx) {
    assertCan(ctx, 'admin.manage');
    requireUser(ctx, input.userId);
    const known = ctx.state.weekUnlocks.some((u) => u.userId === input.userId && u.weekStart === input.weekStart);
    if (!known) ctx.state.weekUnlocks.push({ userId: input.userId, weekStart: input.weekStart });
    return weekViewOf(ctx.state, input.userId, input.weekStart, ctx.today);
  },
});

export const timeCalls = {
  'time.week': timeWeek,
  'time.set': timeSet,
  'time.addRow': timeAddRow,
  'time.removeRow': timeRemoveRow,
  'time.copyLastWeek': timeCopyLastWeek,
  'time.unlockWeek': timeUnlockWeek,
};
```

`src/api/handlers/notifications.ts`:

```ts
import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Notification, NotificationId, Trigger, User } from '../contract/entities';
import { UserCard } from '../contract/views';
import { forbidden, notFound } from '../errors';
import { applyPatch } from '../events';
import type { State } from '../store';
import { cardOf } from '../views';

/** The Inbox badge counts only unread items of these kinds (spec 3.2). */
export const ACTION_TRIGGERS: ReadonlySet<string> = new Set([
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested', 'task_sent_back', 'week_under_target',
]);

export const NotificationView = z.object({
  notification: Notification,
  actor: UserCard.nullable(),
  target: z.string(),
  projectCode: z.string().nullable(),
  link: z.string(),
  needsAction: z.boolean(),
});
export type NotificationView = z.infer<typeof NotificationView>;

const Counts = z.object({ unread: z.number().int().min(0), badge: z.number().int().min(0) });

function viewOf(state: State, n: Notification): NotificationView {
  let target = '';
  let projectCode: string | null = null;
  let link = '/inbox';
  if (n.targetType === 'task') {
    const task = state.tasks[n.targetId];
    const project = task ? state.projects[task.projectId] : undefined;
    target = task?.title ?? '';
    projectCode = project?.code ?? null;
    if (task) link = `/projects/${task.projectId}?task=${task.id}`;
  } else if (n.targetType === 'update') {
    const update = state.updates[n.targetId];
    const project = update ? state.projects[update.projectId] : undefined;
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    if (update) link = `/projects/${update.projectId}?update=${update.id}`;
  } else if (n.targetType === 'project') {
    const project = state.projects[n.targetId];
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    if (project) link = `/projects/${project.id}`;
  } else {
    target = n.targetId;
    link = `/work?tab=hours&week=${n.targetId}`;
  }
  return { notification: n, actor: n.actorId ? cardOf(state, n.actorId) : null, target, projectCode, link, needsAction: ACTION_TRIGGERS.has(n.trigger) };
}

const mine = (ctx: Ctx) => Object.values(ctx.state.notifications).filter((n) => n.userId === ctx.authority.id);

function counts(ctx: Ctx): { unread: number; badge: number } {
  const unread = mine(ctx).filter((n) => !n.read);
  return { unread: unread.length, badge: unread.filter((n) => ACTION_TRIGGERS.has(n.trigger)).length };
}

export const notificationsList = defineCall({
  input: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(100) }),
  output: z.array(NotificationView),
  readOnly: true,
  run(input, ctx) {
    return mine(ctx)
      .filter((n) => !input.unreadOnly || !n.read)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, input.limit)
      .map((n) => viewOf(ctx.state, n));
  },
});

export const notificationsCount = defineCall({
  input: z.object({}),
  output: Counts,
  readOnly: true,
  run(_input, ctx) {
    return counts(ctx);
  },
});

export const notificationsMarkRead = defineCall({
  input: z.object({ ids: z.array(NotificationId).min(1).max(200) }),
  output: Counts,
  run(input, ctx) {
    for (const id of input.ids) {
      const n = ctx.state.notifications[id];
      if (!n) throw notFound('Notification', id);
      if (n.userId !== ctx.authority.id) throw forbidden('This notification belongs to someone else.');
      n.read = true;
    }
    return counts(ctx);
  },
});

export const notificationsMarkAllRead = defineCall({
  input: z.object({}),
  output: Counts,
  run(_input, ctx) {
    for (const n of mine(ctx)) n.read = true;
    return counts(ctx);
  },
});

export const notificationsUpdateSettings = defineCall({
  input: z.object({ trigger: Trigger, on: z.boolean() }),
  output: User,
  run(input, ctx) {
    const prefs = ctx.authority.preferences;
    const next = { ...prefs, notifications: { ...prefs.notifications, [input.trigger]: input.on } };
    applyPatch(ctx, ctx.authority, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.authority.id });
    return ctx.authority;
  },
});

export const notificationCalls = {
  'notifications.list': notificationsList,
  'notifications.count': notificationsCount,
  'notifications.markRead': notificationsMarkRead,
  'notifications.markAllRead': notificationsMarkAllRead,
  'notifications.updateSettings': notificationsUpdateSettings,
};
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/api/handlers/time.test.ts src/api/handlers/notifications.test.ts`
Expected: PASS (12 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/api/handlers
git commit -m "feat: add timesheet and notification calls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 15: Dashboard and search calls

**Files:**
- Create: `src/api/handlers/insights.ts`
- Test: `src/api/handlers/insights.test.ts`

**Interfaces:**
- Consumes: `computeHealth`, `isOverdue` (Task 6), `stagesOf`, `deadlinesOf`, `userCard` (Tasks 10 and 11), `normalizeForSearch` (Task 8), dates (Task 2).
- Produces: `periodStart(today, period): string`, schema and type `DashboardView` (`tiles`, `charts`, `workload`, `schedule`, `hoursThisWeek`), schema `SearchView`. The call map `insightCalls` with `dashboard.get` and `search.query`.

Dashboard rules (spec 8, with clarification 1): the status, leader and client filters apply to every part. The period applies only to "Hours per project". Office hours use this week (Sunday to today) and the targets of all active people. The workload grid counts open tasks due in each of the next 4 weeks, starting with this week. `hoursThisWeek.perPerson` is `null` for anyone but the Admin.

- [ ] **Step 1: Write the failing test**

`src/api/handlers/insights.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { insightCalls, periodStart } from './insights';
import type { State } from '../store';
import { makeTask, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

function world(): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-28', status: 'in_progress' });
  state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', dueDate: '2026-10-01', createdAt: '2026-09-01T09:00:00.000+03:00' });
  state.tasks.tsk_003 = makeTask({
    id: 'tsk_003', ownerId: 'usr_002', status: 'done', createdAt: '2026-09-20T09:00:00.000+03:00', completedAt: '2026-09-29T09:00:00.000+03:00',
  });
  state.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Client presentation', date: '2026-10-12' };
  state.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Permit', date: '2026-11-30' };
  const entry = (id: string, userId: string, date: string, hours: number) => {
    state.time[id] = { id, userId, projectId: 'prj_001', stageId: 'stg_002', taskId: null, date, hours };
  };
  entry('tim_001', 'usr_003', '2026-09-28', 8);
  entry('tim_002', 'usr_002', '2026-09-29', 6);
  entry('tim_003', 'usr_003', '2026-08-15', 5);
  return state;
}

describe('dashboard.get', () => {
  it('counts the tiles and the health mix', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.tiles).toEqual({
      activeProjects: 1, atRiskOrLate: 1, overdueTasks: 1, deadlinesNext14: 1,
      officeHours: { hours: 14, target: 160, percent: 9 }, areaInDesign: 1000,
    });
    expect(d.charts.healthMix).toEqual({ on_track: 0, at_risk: 1, late: 0 });
    expect(d.charts.projectsPerStage).toEqual([{ stage: 'Schematic Design', count: 1 }]);
    expect(d.schedule.map((row) => row.project.code)).toEqual(['KH-26-001']);
  });

  it('counts created and done tasks per week for 12 weeks', async () => {
    const d = await testApi(insightCalls, world()).api.call('dashboard.get', {});
    expect(d.charts.throughput).toHaveLength(12);
    expect(d.charts.throughput[10]).toEqual({ weekStart: '2026-09-20', created: 1, done: 0 });
    expect(d.charts.throughput[11]).toEqual({ weekStart: '2026-09-27', created: 1, done: 1 });
  });

  it('applies the period to hours per project only', async () => {
    const t = testApi(insightCalls, world());
    expect((await t.api.call('dashboard.get', { period: 'month' })).charts.hoursPerProject[0].hours).toBe(14);
    expect((await t.api.call('dashboard.get', { period: 'quarter' })).charts.hoursPerProject[0].hours).toBe(19);
    expect(periodStart('2026-09-30', 'quarter')).toBe('2026-07-01');
    expect(periodStart('2026-09-30', 'year')).toBe('2026-01-01');
  });

  it('flags overloaded people in the workload grid', async () => {
    const state = world();
    state.settings.workloadLimit = 1;
    state.tasks.tsk_004 = makeTask({ id: 'tsk_004', ownerId: 'usr_003', dueDate: '2026-10-02' });
    const d = await testApi(insightCalls, state).api.call('dashboard.get', {});
    expect(d.workload.weeks).toEqual(['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']);
    const sara = d.workload.rows.find((row) => row.user.id === 'usr_003');
    expect(sara?.counts).toEqual([3, 0, 0, 0]);
    expect(sara?.over).toEqual([true, false, false, false]);
  });

  it('shows hours per person to the Admin only', async () => {
    const t = testApi(insightCalls, world());
    const perPerson = (await t.api.call('dashboard.get', {})).hoursThisWeek.perPerson;
    expect(perPerson?.find((p) => p.user.id === 'usr_003')?.hours).toBe(8);
    t.as('usr_002');
    expect((await t.api.call('dashboard.get', {})).hoursThisWeek.perPerson).toBeNull();
  });
});

describe('search.query', () => {
  it('ignores case and letter forms', async () => {
    const state = world();
    state.users.usr_004.name = 'أحمد';
    const { api } = testApi(insightCalls, state);
    expect((await api.call('search.query', { text: 'TEST tower' })).projects.map((p) => p.code)).toEqual(['KH-26-001']);
    expect((await api.call('search.query', { text: 'ground floor' })).tasks).toHaveLength(3);
    expect((await api.call('search.query', { text: 'احمد' })).people.map((p) => p.id)).toEqual(['usr_004']);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/handlers/insights.test.ts`
Expected: FAIL, "Failed to resolve import ./insights".

- [ ] **Step 3: Write the calls**

`src/api/handlers/insights.ts`:

```ts
import { z } from 'zod';
import { defineCall } from '../registry';
import {
  ClientId, Day, Deadline, FileId, ProjectId, ProjectStatus, Stage, StageId, TaskId, UserId, type Project, type TimeEntry,
} from '../contract/entities';
import { UserCard } from '../contract/views';
import { computeHealth, isOverdue } from '../health';
import type { State } from '../store';
import { deadlinesOf, stagesOf, userCard } from '../views';
import { addDays, stampDay, weekStartOf } from '../../lib/dates';
import { normalizeForSearch } from '../../lib/text';

const Count = z.number().int().min(0);
const Ref = z.object({ id: ProjectId, code: z.string(), name: z.string() });
const ProjectHours = z.object({ projectId: ProjectId, code: z.string(), name: z.string(), hours: z.number() });
type Period = 'month' | 'quarter' | 'year';

export const DashboardView = z.object({
  tiles: z.object({
    activeProjects: Count,
    atRiskOrLate: Count,
    overdueTasks: Count,
    deadlinesNext14: Count,
    officeHours: z.object({ hours: z.number(), target: z.number(), percent: z.number() }),
    areaInDesign: z.number(),
  }),
  charts: z.object({
    projectsPerStage: z.array(z.object({ stage: z.string(), count: Count })),
    healthMix: z.object({ on_track: Count, at_risk: Count, late: Count }),
    throughput: z.array(z.object({ weekStart: Day, created: Count, done: Count })).length(12),
    hoursPerProject: z.array(ProjectHours),
  }),
  workload: z.object({
    weeks: z.array(Day).length(4),
    limit: Count,
    rows: z.array(z.object({ user: UserCard, counts: z.array(Count).length(4), over: z.array(z.boolean()).length(4) })),
  }),
  schedule: z.array(z.object({ project: Ref, currentStageId: StageId, stages: z.array(Stage), deadlines: z.array(Deadline) })),
  hoursThisWeek: z.object({
    perProject: z.array(ProjectHours),
    perPerson: z.array(z.object({ user: UserCard, hours: z.number(), target: z.number() })).nullable(),
  }),
});
export type DashboardView = z.infer<typeof DashboardView>;

export function periodStart(today: string, period: Period): string {
  const [year, month] = today.split('-').map(Number);
  if (period === 'year') return `${year}-01-01`;
  const first = period === 'quarter' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  return `${year}-${String(first).padStart(2, '0')}-01`;
}

function hoursByProject(state: State, entries: TimeEntry[]): z.infer<typeof ProjectHours>[] {
  const totals = new Map<string, number>();
  for (const entry of entries) totals.set(entry.projectId, (totals.get(entry.projectId) ?? 0) + entry.hours);
  return [...totals.entries()]
    .map(([projectId, hours]) => ({ projectId, code: state.projects[projectId]?.code ?? '', name: state.projects[projectId]?.name ?? '', hours }))
    .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code));
}

export const dashboardGet = defineCall({
  input: z.object({
    period: z.enum(['month', 'quarter', 'year']).default('month'),
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
  }),
  output: DashboardView,
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority: actor } = ctx;
    const projects = Object.values(state.projects).filter((p) =>
      (input.status === 'all' || p.status === input.status) && (!input.leaderId || p.leaderId === input.leaderId) && (!input.clientId || p.clientId === input.clientId));
    const active = projects.filter((p) => p.status === 'active');
    const inScope = new Set(projects.map((p) => p.id));
    const activeIds = new Set(active.map((p) => p.id));
    const tasks = Object.values(state.tasks);
    const healths = active.map((p) => computeHealth({ project: p, stages: stagesOf(state, p.id), tasks: tasks.filter((t) => t.projectId === p.id) }, today));
    const healthMix = { on_track: 0, at_risk: 0, late: 0 };
    for (const health of healths) if (health) healthMix[health.value] += 1;

    const weekStart = weekStartOf(today);
    const humans = Object.values(state.users).filter((u) => u.kind === 'human' && u.active).sort((a, b) => a.name.localeCompare(b.name));
    const weekEntries = Object.values(state.time).filter((e) => e.date >= weekStart && e.date <= today && inScope.has(e.projectId));
    const weekHours = weekEntries.reduce((sum, e) => sum + e.hours, 0);
    const weekTarget = humans.reduce((sum, u) => sum + u.weeklyHourTarget, 0);
    const refOf = (p: Project) => ({ id: p.id, code: p.code, name: p.name });

    const order = state.settings.defaultStages;
    const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
    const perStage = new Map<string, number>();
    for (const p of active) {
      const name = state.stages[p.currentStageId]?.name ?? '';
      perStage.set(name, (perStage.get(name) ?? 0) + 1);
    }

    const scopedTasks = tasks.filter((t) => inScope.has(t.projectId));
    const throughput = Array.from({ length: 12 }, (_, i) => {
      const start = addDays(weekStart, (i - 11) * 7);
      const end = addDays(start, 6);
      const inWeek = (stamp: string | null) => stamp !== null && stampDay(stamp) >= start && stampDay(stamp) <= end;
      return { weekStart: start, created: scopedTasks.filter((t) => inWeek(t.createdAt)).length, done: scopedTasks.filter((t) => inWeek(t.completedAt)).length };
    });

    const weeks = Array.from({ length: 4 }, (_, i) => addDays(weekStart, i * 7));
    const limit = state.settings.workloadLimit;
    const workloadRows = humans.map((user) => {
      const counts = weeks.map((ws) => tasks.filter((t) =>
        t.ownerId === user.id && t.status !== 'done' && t.dueDate !== null && t.dueDate >= ws && t.dueDate <= addDays(ws, 6) && activeIds.has(t.projectId)).length);
      return { user: userCard(user), counts, over: counts.map((count) => count > limit) };
    });

    const periodFrom = periodStart(today, input.period);
    return {
      tiles: {
        activeProjects: active.length,
        atRiskOrLate: healths.filter((h) => h !== null && h.value !== 'on_track').length,
        overdueTasks: tasks.filter((t) => activeIds.has(t.projectId) && isOverdue(t, today)).length,
        deadlinesNext14: Object.values(state.deadlines).filter((d) => activeIds.has(d.projectId) && d.date >= today && d.date <= addDays(today, 14)).length,
        officeHours: { hours: weekHours, target: weekTarget, percent: weekTarget > 0 ? Math.round((weekHours / weekTarget) * 100) : 0 },
        areaInDesign: active.filter((p) => state.stages[p.currentStageId]?.name !== 'Supervision').reduce((sum, p) => sum + (p.areaM2 ?? 0), 0),
      },
      charts: {
        projectsPerStage: [...perStage.entries()]
          .map(([stage, count]) => ({ stage, count }))
          .sort((a, b) => rank(a.stage) - rank(b.stage) || a.stage.localeCompare(b.stage)),
        healthMix,
        throughput,
        hoursPerProject: hoursByProject(state, Object.values(state.time).filter((e) => e.date >= periodFrom && e.date <= today && inScope.has(e.projectId))),
      },
      workload: { weeks, limit, rows: workloadRows },
      schedule: [...active]
        .sort((a, b) => (a.targetEndDate ?? '9999-12-31').localeCompare(b.targetEndDate ?? '9999-12-31') || a.code.localeCompare(b.code))
        .map((p) => ({ project: refOf(p), currentStageId: p.currentStageId, stages: stagesOf(state, p.id), deadlines: deadlinesOf(state, p.id) })),
      hoursThisWeek: {
        perProject: hoursByProject(state, weekEntries),
        perPerson: actor.systemRole === 'admin'
          ? humans.map((u) => ({ user: userCard(u), hours: weekEntries.filter((e) => e.userId === u.id).reduce((sum, e) => sum + e.hours, 0), target: u.weeklyHourTarget }))
          : null,
      },
    };
  },
});

export const SearchView = z.object({
  projects: z.array(Ref).max(5),
  tasks: z.array(z.object({ id: TaskId, title: z.string(), projectId: ProjectId, projectCode: z.string() })).max(5),
  people: z.array(UserCard).max(5),
  files: z.array(z.object({ id: FileId, name: z.string(), projectId: ProjectId, projectCode: z.string() })).max(5),
});

export const searchQuery = defineCall({
  input: z.object({ text: z.string().trim().min(1).max(100) }),
  output: SearchView,
  readOnly: true,
  run(input, ctx) {
    const { state } = ctx;
    const query = normalizeForSearch(input.text);
    const hit = (...parts: (string | undefined)[]) => normalizeForSearch(parts.filter(Boolean).join(' ')).includes(query);
    const codeOf = (projectId: string) => state.projects[projectId]?.code ?? '';
    return {
      projects: Object.values(state.projects)
        .filter((p) => hit(p.code, p.name, p.clientId ? state.clients[p.clientId]?.name : undefined))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((p) => ({ id: p.id, code: p.code, name: p.name })),
      tasks: Object.values(state.tasks)
        .filter((t) => state.projects[t.projectId]?.status === 'active' && hit(t.title))
        .slice(0, 5)
        .map((t) => ({ id: t.id, title: t.title, projectId: t.projectId, projectCode: codeOf(t.projectId) })),
      people: Object.values(state.users)
        .filter((u) => u.active && hit(u.name, u.discipline))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 5)
        .map((u) => userCard(u)),
      files: Object.values(state.files)
        .filter((f) => hit(f.name))
        .slice(0, 5)
        .map((f) => ({ id: f.id, name: f.name, projectId: f.projectId, projectCode: codeOf(f.projectId) })),
    };
  },
});

export const insightCalls = {
  'dashboard.get': dashboardGet,
  'search.query': searchQuery,
};
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/api/handlers/insights.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/api/handlers/insights.ts src/api/handlers/insights.test.ts
git commit -m "feat: add dashboard and search calls" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 16: The call map

**Files:**
- Create: `src/api/calls.ts`
- Test: `src/api/calls.test.ts`

**Interfaces:**
- Consumes: every call map from Tasks 10 to 15, `Api` (Task 9).
- Produces: `calls` (the full map), `type Calls`, `type CallName`, `type CallInput<N>`, `type CallOutput<N>`, `type MadarApi = Api<Calls>`.

- [ ] **Step 1: Write the failing test**

`src/api/calls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calls } from './calls';
import { NOW, testApi } from '../test/factories';
import { setNow } from '../lib/dates';

// Spec section 11.3.
const SPEC_CALLS = [
  'session.get', 'session.previewAs',
  'users.list', 'users.get', 'users.create', 'users.update', 'users.deactivate',
  'clients.list', 'clients.create', 'clients.update',
  'projects.list', 'projects.get', 'projects.create', 'projects.update', 'projects.setStage', 'projects.setLeader',
  'projects.setStatus', 'projects.setHealthOverride', 'projects.clearHealthOverride', 'projects.delete',
  'members.add', 'members.remove', 'members.update',
  'stages.replace', 'stages.setDates',
  'deadlines.create', 'deadlines.update', 'deadlines.delete',
  'tasks.list', 'tasks.get', 'tasks.create', 'tasks.update', 'tasks.complete', 'tasks.move', 'tasks.approve', 'tasks.sendBack', 'tasks.delete',
  'updates.list', 'updates.create', 'updates.update', 'updates.delete',
  'comments.list', 'comments.create', 'comments.update', 'comments.delete', 'reactions.toggle',
  'files.list', 'files.get', 'files.upload', 'files.delete',
  'time.week', 'time.set', 'time.copyLastWeek', 'time.unlockWeek',
  'notifications.list', 'notifications.markRead', 'notifications.markAllRead', 'notifications.updateSettings',
  'events.list', 'events.undo',
  'dashboard.get', 'search.query',
  'settings.get', 'settings.update', 'me.updatePreferences',
];
// Plan clarification 3.
const EXTRA_CALLS = ['session.setSimulateErrors', 'me.updateProfile', 'notifications.count', 'time.addRow', 'time.removeRow'];

describe('the call map', () => {
  it('has every call from the spec plus the documented extras', () => {
    expect(Object.keys(calls).sort()).toEqual([...SPEC_CALLS, ...EXTRA_CALLS].sort());
  });

  it('marks exactly the read calls as read-only', () => {
    for (const [name, def] of Object.entries(calls)) {
      const read = /\.(list|get|week|count|query)$/.test(name);
      expect({ name, readOnly: Boolean((def as { readOnly?: boolean }).readOnly) }).toEqual({ name, readOnly: read });
    }
  });

  it('runs a full review story through one API', async () => {
    setNow(NOW);
    const t = testApi(calls);
    t.as('usr_002');
    const project = await t.api.call('projects.create', { name: 'Harbour Offices', teamIds: ['usr_003'] });
    const task = await t.api.call('tasks.create', { projectId: project.project.id, title: 'Massing options', ownerId: 'usr_003', dueDate: '2026-10-05' });
    t.as('usr_003');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 2, badge: 1 });
    expect((await t.api.call('tasks.complete', { id: task.task.id })).result).toBe('in_review');
    t.as('usr_002');
    expect((await t.api.call('tasks.list', { filter: 'review_for_me' })).map((r) => r.task.id)).toEqual([task.task.id]);
    await t.api.call('tasks.approve', { id: task.task.id });
    const feed = await t.api.call('updates.list', { projectId: project.project.id, filter: 'tasks' });
    expect(feed[0]).toMatchObject({ kind: 'event', verb: 'task.approved' });
    expect((await t.api.call('dashboard.get', {})).charts.throughput[11].done).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/api/calls.test.ts`
Expected: FAIL, "Failed to resolve import ./calls".

- [ ] **Step 3: Write the call map**

`src/api/calls.ts`:

```ts
import type { z } from 'zod';
import type { Api } from './client';
import { contentCalls } from './handlers/content';
import { fileCalls } from './handlers/files';
import { historyCalls } from './handlers/history';
import { insightCalls } from './handlers/insights';
import { notificationCalls } from './handlers/notifications';
import { peopleCalls } from './handlers/people';
import { projectCalls } from './handlers/projects';
import { taskCalls } from './handlers/tasks';
import { timeCalls } from './handlers/time';

/** Every action in Madar. Screens and, later, AI agents use exactly these calls. */
export const calls = {
  ...peopleCalls,
  ...projectCalls,
  ...taskCalls,
  ...contentCalls,
  ...fileCalls,
  ...historyCalls,
  ...timeCalls,
  ...notificationCalls,
  ...insightCalls,
};

export type Calls = typeof calls;
export type CallName = keyof Calls & string;
export type CallInput<N extends CallName> = z.input<Calls[N]['input']>;
export type CallOutput<N extends CallName> = z.output<Calls[N]['output']>;
export type MadarApi = Api<Calls>;
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/api/calls.test.ts`
Expected: PASS (3 tests).

Run: `npm test`
Expected: all test files PASS.

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/api/calls.ts src/api/calls.test.ts
git commit -m "feat: add the full call map" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 17: Sample data, date shift and reset

**Files:**
- Create: `src/data/assets.ts`, `src/data/seed.ts`, `src/data/shift.ts`, `src/api/handlers/system.ts`
- Modify: `src/api/calls.ts`, `src/api/calls.test.ts`
- Create (test helper): `src/test/seed-helpers.ts`
- Test: `src/data/assets.test.ts`, `src/data/seed.test.ts`, `src/data/shift.test.ts`, `src/api/handlers/system.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 16.
- Produces: `renderSvg(title, subtitle, hue, variant): string`, `drawingPdf(lines: string[]): string`, `type PutBlob = (key: string, blob: Blob) => Promise<void>`, `buildSeed(today: string, putBlob: PutBlob): Promise<State>`, `shiftState(state: State, days: number): State`. The call `session.resetSampleData` in `systemCalls`, added to `calls`.

Sample office (spec 12): 12 projects, 8 people plus the agent "Madar Assistant" (it acts for Hala, the Admin, and is on no team), 144 tasks, 60 files (72 versions), about 8 weeks of hours, 4 weeks of agent summaries. Health mix among active projects: 2 Late, 3 At risk, 5 On track, plus 1 On hold and 1 Completed. The current user at start is Hala Nasser, the Admin. Every date is built from "today". `shiftState` keeps saved data relative to today on later visits.

- [ ] **Step 1: Write the failing tests**

`src/data/assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { drawingPdf, renderSvg } from './assets';

describe('generated files', () => {
  it('writes a PDF whose cross-reference offsets point at each object', () => {
    const pdf = drawingPdf(['KH-26-001 Corniche Office Tower', 'Ground floor plan', 'Revision B']);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xref).startsWith('xref')).toBe(true);
    const offsets = [...pdf.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('writes an SVG and escapes the text', () => {
    const svg = renderSvg('Villas & Pools', 'KH-26-002', 28, 1);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Villas &amp; Pools');
  });
});
```

`src/data/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import * as E from '../api/contract/entities';
import { addDays, dayOfWeek, weekStartOf } from '../lib/dates';
import { TODAY } from '../test/factories';
import { healthCounts } from '../test/seed-helpers';

async function seed(today = TODAY) {
  const blobs = new Map<string, Blob>();
  const state = await buildSeed(today, async (key, blob) => {
    blobs.set(key, blob);
  });
  return { state, blobs };
}

describe('sample data', () => {
  it('has the sizes from the spec', async () => {
    const { state } = await seed();
    const users = Object.values(state.users);
    expect(Object.keys(state.projects)).toHaveLength(12);
    expect(users.filter((u) => u.kind === 'human')).toHaveLength(8);
    expect(users.filter((u) => u.kind === 'agent')).toHaveLength(1);
    expect(users.filter((u) => u.systemRole === 'admin').map((u) => u.name)).toEqual(['Hala Nasser']);
    expect(users.find((u) => u.kind === 'agent')?.ownerId).toBe('usr_001');
    expect(Object.values(state.members).some((m) => m.userId === 'usr_009')).toBe(false);
    expect(Object.keys(state.tasks)).toHaveLength(144);
    expect(Object.keys(state.files)).toHaveLength(60);
    expect(state.session.currentUserId).toBe('usr_001');
  });

  it('has the health mix from the spec', async () => {
    const { state } = await seed();
    expect(healthCounts(state, TODAY)).toEqual({ on_track: 5, at_risk: 3, late: 2 });
    const statuses = Object.values(state.projects).map((p) => p.status);
    expect(statuses.filter((s) => s === 'on_hold')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'completed')).toHaveLength(1);
  });

  it('keeps the same mix on another day', async () => {
    const other = '2027-03-14';
    expect(healthCounts((await seed(other)).state, other)).toEqual({ on_track: 5, at_risk: 3, late: 2 });
  });

  it('passes every entity schema', async () => {
    const { state } = await seed();
    const check = (schema: { parse: (value: unknown) => unknown }, items: Record<string, unknown>) => {
      for (const item of Object.values(items)) schema.parse(item);
    };
    check(E.User, state.users);
    check(E.Client, state.clients);
    check(E.Project, state.projects);
    check(E.ProjectMember, state.members);
    check(E.Stage, state.stages);
    check(E.Deadline, state.deadlines);
    check(E.Task, state.tasks);
    check(E.Update, state.updates);
    check(E.Comment, state.comments);
    check(E.FileRec, state.files);
    check(E.TimeEntry, state.time);
    check(E.Notification, state.notifications);
    check(E.Event, state.events);
    E.Settings.parse(state.settings);
  });

  it('links every task to its project stage and team', async () => {
    const { state } = await seed();
    for (const task of Object.values(state.tasks)) {
      expect(state.stages[task.stageId]?.projectId).toBe(task.projectId);
      const project = state.projects[task.projectId];
      expect(project.leaderId === task.ownerId || Boolean(state.members[`${task.projectId}:${task.ownerId}`])).toBe(true);
    }
  });

  it('stores data for every file version', async () => {
    const { state, blobs } = await seed();
    const versions = Object.values(state.files).flatMap((f) => f.versions);
    expect(versions).toHaveLength(72);
    for (const version of versions) expect(blobs.get(version.blobKey)?.size).toBe(version.size);
  });

  it('is the same every time', async () => {
    expect(JSON.stringify((await seed()).state)).toBe(JSON.stringify((await seed()).state));
  });

  it('has agent summaries on every active project', async () => {
    const { state } = await seed();
    for (const project of Object.values(state.projects).filter((p) => p.status === 'active')) {
      const summaries = Object.values(state.updates).filter((u) => u.projectId === project.id && u.authorId === 'usr_009');
      expect(summaries.length).toBe(4);
    }
  });

  it('logs hours on Sunday to Thursday only, 24 hours a day at most', async () => {
    const { state } = await seed();
    const perDay = new Map<string, number>();
    for (const entry of Object.values(state.time)) {
      expect(dayOfWeek(entry.date)).toBeLessThanOrEqual(4);
      expect(entry.date <= TODAY).toBe(true);
      const key = `${entry.userId}:${entry.date}`;
      perDay.set(key, (perDay.get(key) ?? 0) + entry.hours);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(24);
  });

  it('leaves two people under target last week', async () => {
    const { state } = await seed();
    const lastWeek = addDays(weekStartOf(TODAY), -7);
    const totals = new Map<string, number>();
    for (const entry of Object.values(state.time)) {
      if (entry.date >= lastWeek && entry.date <= addDays(lastWeek, 6)) totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.hours);
    }
    const under = [...totals.entries()].filter(([, hours]) => hours < 40).map(([userId]) => state.users[userId].name).sort();
    expect(under).toEqual(['Lina Mansour', 'Sara Al-Qahtani']);
  });
});
```

`src/test/seed-helpers.ts`:

```ts
import { computeHealth } from '../api/health';
import type { State } from '../api/store';

/** Counts the health of every active project in a state. */
export function healthCounts(state: State, today: string): { on_track: number; at_risk: number; late: number } {
  const counts = { on_track: 0, at_risk: 0, late: 0 };
  for (const project of Object.values(state.projects)) {
    const health = computeHealth({
      project,
      stages: Object.values(state.stages).filter((s) => s.projectId === project.id),
      tasks: Object.values(state.tasks).filter((t) => t.projectId === project.id),
    }, today);
    if (health) counts[health.value] += 1;
  }
  return counts;
}
```

`src/data/shift.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shiftState } from './shift';
import { buildSeed } from './seed';
import { healthCounts } from '../test/seed-helpers';
import { Stamp } from '../api/contract/entities';
import { addDays, dayOfWeek } from '../lib/dates';
import { TODAY } from '../test/factories';

describe('shiftState', () => {
  it('moves days and stamps, keeps weeks on Sunday and keeps the health mix', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const task = Object.values(state.tasks).find((t) => t.dueDate !== null)!;
    const key = 'usr_005|2026-09-27|prj_001|stg_004|-';
    state.timeRows[key] = { key, userId: 'usr_005', weekStart: '2026-09-27', projectId: 'prj_001', stageId: 'stg_004', taskId: null };
    const moved = shiftState(structuredClone(state), 10);
    expect(moved.tasks[task.id].dueDate).toBe(addDays(task.dueDate!, 10));
    expect(moved.seededOn).toBe(addDays(state.seededOn, 10));
    expect(Stamp.safeParse(moved.tasks[task.id].createdAt).success).toBe(true);
    for (const row of Object.values(moved.timeRows)) {
      expect(dayOfWeek(row.weekStart)).toBe(0);
      expect(row.key.split('|')[1]).toBe(row.weekStart);
    }
    expect(healthCounts(moved, addDays(TODAY, 10))).toEqual(healthCounts(state, TODAY));
  });

  it('returns the same state for a zero shift', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(shiftState(state, 0)).toBe(state);
  });
});
```

`src/api/handlers/system.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { buildSeed } from '../../data/seed';
import { NOW, TODAY, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

describe('session.resetSampleData', () => {
  it('puts the sample data back and keeps the error switch', async () => {
    setNow(NOW);
    const t = testApi(calls, await buildSeed(TODAY, async () => undefined));
    t.store.state.projects.prj_001.name = 'Changed';
    t.store.state.session.simulateErrors = true;
    t.as('usr_004');
    await t.api.call('session.resetSampleData', {});
    expect(t.store.state.projects.prj_001.name).toBe('Corniche Office Tower');
    expect(t.store.state.session.simulateErrors).toBe(true);
    expect(t.store.state.session.currentUserId).toBe('usr_001');
  });
});
```

In `src/api/calls.test.ts`, change the extras line to:

```ts
const EXTRA_CALLS = ['session.setSimulateErrors', 'session.resetSampleData', 'me.updateProfile', 'notifications.count', 'time.addRow', 'time.removeRow'];
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/data src/api/handlers/system.test.ts src/api/calls.test.ts`
Expected: FAIL, "Failed to resolve import ./assets", "./seed", "./shift", and the call map test fails on the missing `session.resetSampleData`.

- [ ] **Step 3: Write the generated files**

`src/data/assets.ts`:

```ts
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A simple generated "render": sky, building blocks, ground and a title. */
export function renderSvg(title: string, subtitle: string, hue: number, variant: number): string {
  const blocks = [0, 1, 2, 3, 4]
    .map((i) => {
      const width = 150 + ((i * 53 + variant * 31) % 90);
      const height = 260 + ((i * 97 + variant * 61) % 380);
      const x = 180 + i * 260;
      const fill = i % 2 === 0 ? `hsl(${(hue + 190) % 360} 35% 60%)` : `hsl(${hue} 18% 32%)`;
      return `<rect x="${x}" y="${820 - height}" width="${width}" height="${height}" fill="${fill}"/>`;
    })
    .join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">',
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 78%)"/><stop offset="1" stop-color="hsl(${(hue + 30) % 360} 50% 92%)"/></linearGradient></defs>`,
    '<rect width="1600" height="900" fill="url(#sky)"/>',
    blocks,
    `<rect y="820" width="1600" height="80" fill="hsl(${hue} 12% 22%)"/>`,
    `<text x="64" y="96" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="#1D1D1F">${escapeXml(title)}</text>`,
    `<text x="64" y="146" font-family="Inter, Arial, sans-serif" font-size="28" fill="#1D1D1F" fill-opacity="0.72">${escapeXml(subtitle)}</text>`,
    '</svg>',
  ].join('');
}

/** A one-page landscape PDF with plain ASCII text. The cross-reference offsets are exact, so PDF viewers open it. */
export function drawingPdf(lines: string[]): string {
  const safe = lines.map((line) => line.replace(/[^\x20-\x7E]/g, '').replace(/[()\\]/g, ''));
  const text = safe.map((line, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 56 ${540 - i * 28} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}
```

- [ ] **Step 4: Write the seed**

`src/data/seed.ts`:

```ts
import { emptyState, memberKey, nextId, type State } from '../api/store';
import {
  defaultPreferences, emptyReactions, type FileRec, type FileVersion, type Project, type Task, type User,
} from '../api/contract/entities';
import { writeEvent, type EventContext } from '../api/events';
import { notify, reviewersOf } from '../api/notify';
import { addDays, dayOfWeek, diffDays, formatDay, maxDay, minDay, weekStartOf } from '../lib/dates';
import { mentionMarkup } from '../lib/text';
import { drawingPdf, renderSvg } from './assets';

export type PutBlob = (key: string, blob: Blob) => Promise<void>;

/** A timestamp in office time on a given day. */
function at(day: string, hour = 9, minute = 0): string {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+03:00`;
}

// Invented people and clients. usr_001 to usr_008 in this order, then the agent as usr_009.
const PEOPLE: { name: string; admin?: boolean; discipline: string }[] = [
  { name: 'Hala Nasser', admin: true, discipline: 'Architect' },
  { name: 'Faisal Al-Harbi', discipline: 'Architect' },
  { name: 'Reem Al-Ghamdi', discipline: 'Architect' },
  { name: 'Omar Haddad', discipline: 'Structural' },
  { name: 'Sara Al-Qahtani', discipline: 'Architect' },
  { name: 'Yousef Saleh', discipline: 'MEP' },
  { name: 'Lina Mansour', discipline: 'Interior' },
  { name: 'Khalid Al-Mutairi', discipline: 'Structural' },
];

const CLIENTS: [string, string][] = [
  ['Gulf Crest Holding', 'Nawaf Al-Shehri'],
  ['Dune Line Developments', 'Maha Al-Dosari'],
  ['Eastern Shore Schools Co.', 'Tariq Al-Anazi'],
  ['Nakhla Retail Group', 'Dana Al-Omari'],
  ['Tamr Hospitality', 'Bader Al-Zahrani'],
  ['Al Waha Healthcare', 'Rana Al-Subaie'],
];

type Shape = 'late' | 'risk_overdue' | 'risk_stage' | 'on_track' | 'on_hold' | 'completed';
type Plan = {
  code: string; name: string; client: number; shape: Shape; stage: number; leader: number; team: number[];
  area: number; location: string; cover: boolean; hue: number;
};

// "leader" and "team" are indexes into PEOPLE. "stage" is an index into the default stage list.
const PLANS: Plan[] = [
  { code: 'KH-26-001', name: 'Corniche Office Tower', client: 0, shape: 'late', stage: 3, leader: 1, team: [4, 5, 7], area: 24500, location: 'Al Khobar, Corniche', cover: true, hue: 210 },
  { code: 'KH-26-002', name: 'Dune Line Townhouses', client: 1, shape: 'risk_overdue', stage: 2, leader: 2, team: [4, 6], area: 9800, location: 'Al Khobar, Al Rakah', cover: true, hue: 28 },
  { code: 'KH-26-003', name: 'Eastern Shore Primary School', client: 2, shape: 'on_track', stage: 1, leader: 3, team: [5, 7], area: 6200, location: 'Dhahran, Al Doha', cover: true, hue: 150 },
  { code: 'KH-26-004', name: 'Nakhla Mall Extension', client: 3, shape: 'risk_stage', stage: 3, leader: 1, team: [4, 5, 6, 7], area: 31000, location: 'Dammam, King Fahd Road', cover: true, hue: 265 },
  { code: 'KH-26-005', name: 'Tamr Boutique Hotel', client: 4, shape: 'on_track', stage: 0, leader: 2, team: [6], area: 7400, location: 'Al Khobar, Al Olaya', cover: false, hue: 12 },
  { code: 'KH-26-006', name: 'Al Waha Clinic Fit-out', client: 5, shape: 'late', stage: 4, leader: 0, team: [5, 6], area: 1800, location: 'Al Khobar, Al Aqrabiyah', cover: true, hue: 190 },
  { code: 'KH-26-007', name: 'Seaside Villa Compound', client: 1, shape: 'risk_overdue', stage: 2, leader: 3, team: [4, 7], area: 14200, location: 'Al Khobar, Half Moon Bay', cover: true, hue: 45 },
  { code: 'KH-26-008', name: 'Rakah Neighbourhood Mosque', client: 2, shape: 'on_track', stage: 5, leader: 2, team: [5, 7], area: 1200, location: 'Al Khobar, Al Rakah', cover: false, hue: 120 },
  { code: 'KH-25-014', name: 'Gulf Crest HQ Interiors', client: 0, shape: 'on_hold', stage: 2, leader: 1, team: [6], area: 3600, location: 'Al Khobar, Prince Turki Street', cover: true, hue: 300 },
  { code: 'KH-25-009', name: 'Dune Line Show Villa', client: 1, shape: 'completed', stage: 6, leader: 3, team: [4], area: 650, location: 'Al Khobar, Al Rakah', cover: true, hue: 80 },
  { code: 'KH-26-009', name: 'Shore Walk Retail Kiosks', client: 3, shape: 'on_track', stage: 6, leader: 1, team: [5, 7], area: 900, location: 'Al Khobar, Corniche', cover: false, hue: 170 },
  { code: 'KH-26-010', name: 'Tamr Staff Housing', client: 4, shape: 'on_track', stage: 1, leader: 2, team: [4, 6], area: 5200, location: 'Dammam, Al Faisaliyah', cover: true, hue: 340 },
];

// The current stage window, in days from today. These windows make the health mix come out the same every day.
const WINDOW: Record<Shape, [number, number]> = {
  late: [-60, -3], risk_overdue: [-20, 30], risk_stage: [-40, 5], on_track: [-10, 35], on_hold: [-90, -30], completed: [-120, -20],
};
const PAST_STAGE_DAYS = 28;
const FUTURE_STAGE_DAYS = 35;

const TITLES: string[][] = [
  ['Site analysis', 'Massing options', 'Concept presentation', 'Area schedule', 'Client brief review', 'Precedent study', 'Zoning check', 'Concept sketches'],
  ['Floor plan options', 'Structural grid study', 'Facade concept', 'Client review pack', 'Parking layout', 'Core layout', 'Sun study', 'Cost plan input'],
  ['Ground floor plan', 'Typical floor plan', 'Wall sections', 'MEP coordination', 'Facade details', 'Material board', 'Roof plan', 'Landscape layout'],
  ['Door and window schedule', 'Reflected ceiling plans', 'Stair details', 'Structural drawings check', 'Specifications draft', 'Toilet details', 'Finishes schedule', 'Section set'],
  ['Balady submission set', 'Civil Defense drawings', 'Authority comments response', 'Permit fee receipt', 'Fire strategy report', 'Accessibility check', 'Utility approvals', 'Permit tracker update'],
  ['BOQ review', 'Tender drawings issue', 'Bidder questions log', 'Tender evaluation', 'Addendum 1', 'Tender clarifications', 'Contractor shortlist', 'Award memo'],
  ['Site visit report', 'Shop drawing review', 'RFI responses', 'Snag list', 'Material approvals', 'Progress photos', 'Handover checklist', 'As-built review'],
];

const CURRENT_STATUSES: Record<Shape, Task['status'][]> = {
  late: ['done', 'done', 'in_progress', 'in_progress', 'todo', 'in_review'],
  risk_overdue: ['done', 'done', 'done', 'in_progress', 'todo', 'in_review'],
  risk_stage: ['done', 'done', 'in_progress', 'in_progress', 'todo', 'in_review'],
  on_track: ['done', 'done', 'done', 'in_progress', 'todo', 'todo'],
  on_hold: ['done', 'in_progress', 'todo', 'todo', 'todo', 'todo'],
  completed: ['done', 'done', 'done', 'done', 'done', 'done'],
};

// Due dates of the open current-stage tasks, in days from today, in the order they appear above.
const OPEN_DUE: Record<Shape, number[]> = {
  late: [-5, 3, 7, -2],
  risk_overdue: [-4, 9, 2],
  risk_stage: [1, 3, 4, 2],
  on_track: [4, 12, 20],
  on_hold: [30, 34, 38, 42, 46],
  completed: [],
};

const FILES: { name: string; kind: 'svg' | 'pdf'; versions: number; daysAgo: number }[] = [
  { name: 'Cover render.svg', kind: 'svg', versions: 1, daysAgo: 18 },
  { name: 'Massing view.svg', kind: 'svg', versions: 1, daysAgo: 14 },
  { name: 'Ground floor plan.pdf', kind: 'pdf', versions: 2, daysAgo: 10 },
  { name: 'Site plan.pdf', kind: 'pdf', versions: 1, daysAgo: 7 },
  { name: 'Facade study.svg', kind: 'svg', versions: 1, daysAgo: 3 },
];

type SeedCtx = { state: State; today: string; humans: User[]; clientIds: string[]; saveBlob: (blob: Blob) => string };

function addProject(seed: SeedCtx, plan: Plan, index: number): void {
  const { state, today, humans, clientIds, saveBlob } = seed;
  const leader = humans[plan.leader];
  const team = plan.team.map((i) => humans[i]);
  const owners = [leader, ...team];
  const ec = (actor: User, stamp: string): EventContext => ({ state, actor, stamp, correlationId: `seed_${plan.code}` });
  const projectId = nextId(state, 'prj');
  const curStart = addDays(today, WINDOW[plan.shape][0]);
  const curEnd = addDays(today, WINDOW[plan.shape][1]);
  const names = state.settings.defaultStages;

  const stageIds = names.map((name, order) => {
    const id = nextId(state, 'stg');
    let startDate = curStart;
    let endDate = curEnd;
    if (order < plan.stage) {
      startDate = addDays(curStart, -(plan.stage - order) * PAST_STAGE_DAYS);
      endDate = addDays(startDate, PAST_STAGE_DAYS - 1);
    } else if (order > plan.stage) {
      startDate = addDays(curEnd, 1 + (order - plan.stage - 1) * FUTURE_STAGE_DAYS);
      endDate = addDays(startDate, FUTURE_STAGE_DAYS - 1);
    }
    state.stages[id] = { id, projectId, name, order, startDate, endDate };
    return id;
  });
  const firstStart = state.stages[stageIds[0]].startDate ?? curStart;
  const lastEnd = state.stages[stageIds[stageIds.length - 1]].endDate ?? curEnd;
  const created = at(firstStart);
  const status = plan.shape === 'on_hold' ? 'on_hold' : plan.shape === 'completed' ? 'completed' : 'active';
  const project: Project = {
    id: projectId, code: plan.code, name: plan.name, clientId: clientIds[plan.client], status, leaderId: leader.id,
    currentStageId: stageIds[plan.stage], location: plan.location, areaM2: plan.area, startDate: firstStart, targetEndDate: lastEnd,
    coverFileId: null, modelFolderPath: `\\\\STUDIO\\Projects\\${plan.code}`, description: `${plan.name} for ${CLIENTS[plan.client][0]}.`,
    healthOverride: null, createdBy: leader.id, createdAt: created, updatedAt: created,
  };
  state.projects[projectId] = project;

  // Agents are never members: the assistant reaches what its person, the Admin, reaches (spec 17).
  const memberIds = new Set([leader.id, ...team.map((u) => u.id)]);
  for (const userId of memberIds) {
    state.members[memberKey(projectId, userId)] = { projectId, userId, discipline: state.users[userId].discipline };
  }
  writeEvent(ec(leader, created), { projectId, verb: 'project.created', targetType: 'project', targetId: projectId, before: null, after: { ...project } });
  if (plan.stage > 0) {
    writeEvent(ec(leader, at(curStart, 10)), {
      projectId, verb: 'project.stage_changed', targetType: 'project', targetId: projectId,
      before: { currentStageId: stageIds[plan.stage - 1] }, after: { currentStageId: stageIds[plan.stage] },
    });
  }

  const addTask = (stageIndex: number, n: number, taskStatus: Task['status'], createdDay: string, due: string | null, title?: string): Task => {
    const id = nextId(state, 'tsk');
    const owner = owners[(n + index) % owners.length];
    const createdAt = at(createdDay, 9, (n * 7) % 60);
    const doneDay = maxDay(createdDay, minDay(addDays(createdDay, 5), addDays(today, -1)));
    const completedAt = taskStatus === 'done' ? at(doneDay, 14) : null;
    const task: Task = {
      id, projectId, stageId: stageIds[stageIndex], title: title ?? TITLES[stageIndex][(n + index) % TITLES[stageIndex].length],
      description: '', ownerId: owner.id, status: taskStatus, dueDate: due, flagged: n === 3 && index % 2 === 0, needsReview: n % 3 !== 2,
      checklist: n === 1
        ? [{ id: 'c1', text: 'Check the dimensions', done: taskStatus === 'done' }, { id: 'c2', text: 'Coordinate with structure', done: false }]
        : [],
      createdBy: leader.id, createdAt, completedAt,
    };
    state.tasks[id] = task;
    writeEvent(ec(leader, createdAt), { projectId, verb: 'task.created', targetType: 'task', targetId: id, before: null, after: { ...task, status: 'todo', completedAt: null } });
    if (completedAt) {
      writeEvent(ec(owner, completedAt), {
        projectId, verb: 'task.status_changed', targetType: 'task', targetId: id,
        before: { status: 'in_progress', completedAt: null }, after: { status: 'done', completedAt },
      });
    }
    if (taskStatus === 'in_review') {
      const stamp = at(maxDay(createdDay, minDay(addDays(createdDay, 3), addDays(today, -1))), 11);
      writeEvent(ec(owner, stamp), { projectId, verb: 'task.status_changed', targetType: 'task', targetId: id, before: { status: 'in_progress' }, after: { status: 'in_review' } });
      notify(state, owner, stamp, { userIds: reviewersOf(state, projectId), trigger: 'review_requested', targetType: 'task', targetId: id });
    }
    return task;
  };

  // Two done tasks in each of the last two past stages.
  for (let s = Math.max(0, plan.stage - 2); s < plan.stage; s += 1) {
    const start = state.stages[stageIds[s]].startDate ?? curStart;
    for (let n = 0; n < 2; n += 1) addTask(s, n, 'done', addDays(start, 2 + n * 6), addDays(start, 10 + n * 6));
  }
  // Six tasks in the current stage, shaped by the health the project must show.
  let open = 0;
  CURRENT_STATUSES[plan.shape].forEach((taskStatus, n) => {
    const createdDay = minDay(addDays(curStart, 1 + n * 2), today);
    const due = taskStatus === 'done' ? addDays(createdDay, 7) : addDays(today, OPEN_DUE[plan.shape][open++]);
    addTask(plan.stage, n, taskStatus, createdDay, due);
  });
  // Two tasks ready in the next stage.
  const closing = plan.shape === 'completed';
  if (plan.stage < stageIds.length - 1 && !closing) {
    const nextStart = state.stages[stageIds[plan.stage + 1]].startDate ?? curEnd;
    for (let n = 0; n < 2; n += 1) addTask(plan.stage + 1, n, 'todo', addDays(today, -3 + n), addDays(nextStart, 10 + n * 10));
  }
  addTask(plan.stage, 6, closing ? 'done' : 'todo', minDay(addDays(curStart, 3), today), closing ? addDays(curStart, 10) : addDays(today, 14), 'Coordination meeting notes');

  const deadlines: [string, string][] = closing
    ? [['Handover', curEnd]]
    : [['Client presentation', addDays(curEnd, -2)], ['Stage submission', curEnd], ['Coordination workshop', addDays(today, 5 + (index % 7))]];
  if (plan.stage === 3 && !closing) deadlines.push(['Balady submission', addDays(curEnd, 10)]);
  for (const [name, date] of deadlines) {
    const id = nextId(state, 'ddl');
    state.deadlines[id] = { id, projectId, stageId: stageIds[plan.stage], name, date };
  }

  FILES.forEach((spec, n) => {
    const id = nextId(state, 'fil');
    const name = n === 0 && !plan.cover ? 'Street view.svg' : spec.name;
    const title = name.replace(/\.(svg|pdf)$/, '');
    const versions: FileVersion[] = Array.from({ length: spec.versions }, (_, v) => {
      const letter = String.fromCharCode(65 + v);
      const blob = spec.kind === 'svg'
        ? new Blob([renderSvg(plan.name, `${plan.code} · ${title}`, plan.hue, n)], { type: 'image/svg+xml' })
        : new Blob([drawingPdf([`${plan.code} ${plan.name}`, title, `Revision ${letter}`])], { type: 'application/pdf' });
      return {
        letter, blobKey: saveBlob(blob), mimeType: blob.type, size: blob.size, uploadedBy: owners[(n + v) % owners.length].id,
        uploadedAt: at(addDays(today, -spec.daysAgo + v * 4), 12, n * 5),
      };
    });
    const file: FileRec = { id, projectId, stageId: stageIds[plan.stage], taskId: null, name, versions };
    state.files[id] = file;
    writeEvent(ec(state.users[versions[0].uploadedBy], versions[0].uploadedAt), {
      projectId, verb: 'file.added', targetType: 'file', targetId: id, before: null, after: { ...file, versions: [versions[0]] },
    });
    if (versions.length > 1) {
      writeEvent(ec(state.users[versions[1].uploadedBy], versions[1].uploadedAt), {
        projectId, verb: 'file.version_added', targetType: 'file', targetId: id, before: { versions: [versions[0]] }, after: { versions },
      });
    }
    if (n === 0 && plan.cover) project.coverFileId = id;
  });

  const mate = team[0] ?? leader;
  const kickoffAt = at(maxDay(curStart, addDays(today, -12)), 8, 30);
  const kickoffId = nextId(state, 'upd');
  state.updates[kickoffId] = {
    id: kickoffId, projectId, authorId: leader.id, fileIds: [], createdAt: kickoffAt, editedAt: null,
    body: `Kick-off notes for ${names[plan.stage]}: the scope is agreed with the client. ${mentionMarkup(mate.name, mate.id)} please start on the ${TITLES[plan.stage][index % 8].toLowerCase()}.`,
  };
  notify(state, leader, kickoffAt, { userIds: [mate.id], trigger: 'mention', targetType: 'update', targetId: kickoffId });
  const drawing = Object.values(state.files).find((f) => f.projectId === projectId && f.name === 'Ground floor plan.pdf');
  const noteId = nextId(state, 'upd');
  const noteAt = at(addDays(today, -2), 16);
  state.updates[noteId] = {
    id: noteId, projectId, authorId: mate.id, body: `${mentionMarkup(leader.name, leader.id)} I uploaded revision B of the ground floor plan for review.`,
    fileIds: drawing ? [drawing.id] : [], createdAt: noteAt, editedAt: null,
  };
  notify(state, mate, noteAt, { userIds: [leader.id], trigger: 'mention', targetType: 'update', targetId: noteId });

  const discussed = Object.values(state.tasks)
    .filter((t) => t.projectId === projectId && (t.status === 'in_review' || t.status === 'in_progress'))
    .slice(0, 2);
  for (const task of discussed) {
    const askId = nextId(state, 'cmt');
    state.comments[askId] = {
      id: askId, targetType: 'task', targetId: task.id, authorId: leader.id, body: 'Please check the dimensions against the latest survey before Thursday.',
      reactions: { ...emptyReactions(), '👍': [task.ownerId] }, createdAt: at(addDays(today, -1), 10), editedAt: null,
    };
    const replyId = nextId(state, 'cmt');
    state.comments[replyId] = {
      id: replyId, targetType: 'task', targetId: task.id, authorId: task.ownerId, body: 'Done. I updated the sheet.',
      reactions: emptyReactions(), createdAt: at(addDays(today, -1), 14), editedAt: null,
    };
  }
}

function addAgentSummaries(state: State, today: string, agentId: string): void {
  for (const project of Object.values(state.projects)) {
    if (project.status !== 'active') continue;
    const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
    for (let k = 3; k >= 0; k -= 1) {
      const sunday = addDays(weekStartOf(today), -7 * k);
      const open = tasks.filter((t) => t.status !== 'done').length;
      const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < sunday && (t.status === 'todo' || t.status === 'in_progress')).length;
      const next = Object.values(state.deadlines)
        .filter((d) => d.projectId === project.id && d.date >= sunday)
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      const tail = next ? ` Next deadline: ${next.name}, ${formatDay(next.date, 'en')}.` : '';
      const id = nextId(state, 'upd');
      state.updates[id] = {
        id, projectId: project.id, authorId: agentId, body: `Weekly summary: ${open} open tasks, ${overdue} overdue.${tail}`,
        fileIds: [], createdAt: at(sunday, 8), editedAt: null,
      };
    }
  }
}

function addTimeEntries(state: State, today: string, humans: User[]): void {
  const firstWeek = addDays(weekStartOf(today), -49);
  const lastWeek = addDays(weekStartOf(today), -7);
  humans.forEach((user, u) => {
    const projects = Object.values(state.projects).filter((p) => p.status === 'active' && state.members[memberKey(p.id, user.id)]);
    if (projects.length === 0) return;
    for (let day = firstWeek; day <= today; day = addDays(day, 1)) {
      if (dayOfWeek(day) > 4) continue;
      // Sara and Lina stay under target last week, so the Thursday reminder has something to show.
      const total = weekStartOf(day) === lastWeek && (u === 4 || u === 6) ? 6 : 8;
      const split = projects.length > 1 ? [total - 3.5, 3.5] : [total];
      const d = diffDays(firstWeek, day);
      split.forEach((hours, i) => {
        const project = projects[(d + u + i) % projects.length];
        const id = nextId(state, 'tim');
        state.time[id] = { id, userId: user.id, projectId: project.id, stageId: project.currentStageId, taskId: null, date: day, hours };
      });
    }
  });
}

/** Builds the sample office. Every date comes from "today", so the data is fresh on any day. */
export async function buildSeed(today: string, putBlob: PutBlob): Promise<State> {
  const state = emptyState(today);
  const blobJobs: Promise<void>[] = [];
  const saveBlob = (blob: Blob): string => {
    const key = `blob_seed_${String(blobJobs.length + 1).padStart(3, '0')}`;
    blobJobs.push(putBlob(key, blob));
    return key;
  };

  const humans = PEOPLE.map((person) => {
    const id = nextId(state, 'usr');
    const user: User = {
      id, name: person.name, email: `${person.name.toLowerCase().replace(/[^a-z]+/g, '.')}@madar.test`, avatarUrl: null, kind: 'human',
      systemRole: person.admin ? 'admin' : 'member', discipline: person.discipline, weeklyHourTarget: 40, active: true, ownerId: null,
      preferences: defaultPreferences(),
    };
    state.users[id] = user;
    return user;
  });
  const agentId = nextId(state, 'usr');
  state.users[agentId] = {
    id: agentId, name: 'Madar Assistant', email: 'assistant@madar.test', avatarUrl: null, kind: 'agent', systemRole: 'member',
    discipline: 'Agent', weeklyHourTarget: 0, active: true, ownerId: humans[0].id, preferences: defaultPreferences(),
  };
  state.session.currentUserId = humans[0].id;

  const clientIds = CLIENTS.map(([name, contactName], i) => {
    const id = nextId(state, 'cli');
    state.clients[id] = {
      id, name, contactName, phone: `+966 13 864 ${1000 + i * 37}`,
      email: `${contactName.split(' ')[0].toLowerCase()}@${name.split(' ')[0].toLowerCase()}.test`,
    };
    return id;
  });

  const seed: SeedCtx = { state, today, humans, clientIds, saveBlob };
  PLANS.forEach((plan, index) => addProject(seed, plan, index));
  addAgentSummaries(state, today, agentId);
  addTimeEntries(state, today, humans);

  const weekAgo = at(addDays(today, -7), 0);
  for (const n of Object.values(state.notifications)) if (n.createdAt < weekAgo) n.read = true;
  await Promise.all(blobJobs);
  return state;
}
```

- [ ] **Step 5: Write the date shift and the reset call**

`src/data/shift.ts`:

```ts
import type { State } from '../api/store';
import { addDays, nowStamp, weekStartOf } from '../lib/dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

function shiftValue(value: unknown, days: number): unknown {
  if (typeof value === 'string') {
    if (DAY.test(value)) return addDays(value, days);
    if (STAMP.test(value)) return nowStamp(new Date(new Date(value).getTime() + days * DAY_MS));
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => shiftValue(item, days));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftValue(item, days)]));
  }
  return value;
}

/** Moves every date in the state by a number of days, so saved sample data stays relative to today. Weeks snap back to Sunday. */
export function shiftState(state: State, days: number): State {
  if (days === 0) return state;
  const next = shiftValue(state, days) as State;
  const rows: State['timeRows'] = {};
  for (const row of Object.values(next.timeRows)) {
    const weekStart = weekStartOf(row.weekStart);
    const key = `${row.userId}|${weekStart}|${row.projectId}|${row.stageId}|${row.taskId ?? '-'}`;
    rows[key] = { ...row, key, weekStart };
  }
  next.timeRows = rows;
  next.weekUnlocks = next.weekUnlocks.map((unlock) => ({ ...unlock, weekStart: weekStartOf(unlock.weekStart) }));
  for (const n of Object.values(next.notifications)) if (n.targetType === 'week') n.targetId = weekStartOf(n.targetId);
  return next;
}
```

`src/api/handlers/system.ts`:

```ts
import { z } from 'zod';
import { defineCall } from '../registry';
import type { State } from '../store';
import { buildSeed } from '../../data/seed';
import { todayISO } from '../../lib/dates';

/** Prototype control: puts the sample office back. The "Simulate errors" switch keeps its value. */
export const sessionResetSampleData = defineCall({
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  async prepare(_input, p): Promise<State> {
    await p.persister.clear();
    return buildSeed(todayISO(p.now), (key, blob) => p.persister.putBlob(key, blob));
  },
  run(_input, ctx, fresh) {
    const keepErrors = ctx.state.session.simulateErrors;
    const target = ctx.state as unknown as Record<string, unknown>;
    const source = fresh as unknown as Record<string, unknown>;
    for (const key of Object.keys(source)) target[key] = source[key];
    ctx.state.session.simulateErrors = keepErrors;
    return { ok: true as const };
  },
});

export const systemCalls = {
  'session.resetSampleData': sessionResetSampleData,
};
```

In `src/api/calls.ts`, add the import and the spread:

```ts
import { systemCalls } from './handlers/system';
```

```ts
export const calls = {
  ...peopleCalls,
  ...systemCalls,
  ...projectCalls,
  ...taskCalls,
  ...contentCalls,
  ...fileCalls,
  ...historyCalls,
  ...timeCalls,
  ...notificationCalls,
  ...insightCalls,
};
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run src/data src/api/handlers/system.test.ts src/api/calls.test.ts`
Expected: PASS (2 + 10 + 2 + 1 + 3 = 18 tests).

Run: `npm test && npm run typecheck`
Expected: every test file passes, then no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/data src/test/seed-helpers.ts src/api/handlers/system.ts src/api/handlers/system.test.ts src/api/calls.ts src/api/calls.test.ts
git commit -m "feat: add the sample office, the date shift and the reset call" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 18: Languages

**Files:**
- Create: `src/i18n/index.ts`, `src/i18n/en.json`, `src/i18n/ar.json`
- Test: `src/i18n/i18n.test.ts`

**Interfaces:**
- Consumes: `Language` (Task 3).
- Produces: `initI18n(language?: Language): i18n`, `applyLanguage(root: HTMLElement, language: Language): void` (sets `lang` and `dir`). The text keys below. Plans 2 to 5 add keys to both files together.

The Arabic text is a draft for a native speaker (spec 10.8, open item in spec 15).

- [ ] **Step 1: Write the failing test**

`src/i18n/i18n.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import en from './en.json';
import ar from './ar.json';
import { applyLanguage, initI18n } from './index';

function flatten(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.entries(value).reduce<Record<string, string>>((out, [key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof item === 'string') out[path] = item;
    else Object.assign(out, flatten(item as Record<string, unknown>, path));
    return out;
  }, {});
}

const english = flatten(en);
const arabic = flatten(ar);
const placeholders = (text: string) => [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();

describe('languages', () => {
  afterEach(() => {
    initI18n('en');
    applyLanguage(document.documentElement, 'en');
  });

  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort());
  });

  it('has no empty text', () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(arabic)]) expect({ key, empty: text.trim() === '' }).toEqual({ key, empty: false });
  });

  it('keeps the same placeholders in both languages', () => {
    for (const key of Object.keys(english)) expect({ key, vars: placeholders(arabic[key] ?? '') }).toEqual({ key, vars: placeholders(english[key]) });
  });

  it('has no em-dash in any text', () => {
    for (const text of [...Object.values(english), ...Object.values(arabic)]) expect(text).not.toContain('\u2014');
  });

  it('switches the language and the direction', () => {
    const i18n = initI18n('ar');
    expect(i18n.t('nav.projects')).toBe('المشاريع');
    expect(i18n.t('placeholder.body', { step: 2 })).toContain('2');
    applyLanguage(document.documentElement, 'ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/i18n`
Expected: FAIL, "Failed to resolve import ./en.json".

- [ ] **Step 3: Write the text files and the setup**

`src/i18n/en.json`:

```json
{
  "app": { "name": "Madar" },
  "nav": {
    "main": "Main navigation",
    "tabs": "Sections",
    "projects": "Projects",
    "myWork": "My Work",
    "dashboard": "Dashboard",
    "inbox": "Inbox",
    "search": "Search",
    "settings": "Settings",
    "showSidebar": "Show sidebar",
    "hideSidebar": "Hide sidebar",
    "useTabBar": "Use tab bar",
    "useSidebar": "Use sidebar",
    "inboxBadge": "{{count}} items need action"
  },
  "screens": {
    "projects": "Projects",
    "project": "Project",
    "myWork": "My Work",
    "dashboard": "Dashboard",
    "inbox": "Inbox",
    "search": "Search",
    "tasks": "Tasks",
    "settings": "Settings"
  },
  "placeholder": {
    "title": "This screen comes next",
    "body": "This screen arrives in build step {{step}}."
  },
  "storage": { "notSaved": "Changes will not be saved in this window." },
  "preview": {
    "label": "Preview as",
    "prototype": "Prototype",
    "agentFor": "Agent for {{name}}",
    "hint": { "admin": "Admin", "leader": "Leader", "member": "Member", "agent": "Agent" }
  },
  "settings": {
    "profile": "Profile",
    "name": "Name",
    "discipline": "Discipline",
    "save": "Save",
    "saved": "Profile saved.",
    "language": "Language",
    "languages": { "en": "English", "ar": "العربية" },
    "theme": "Theme",
    "themes": { "system": "System", "light": "Light", "dark": "Dark" },
    "glass": "Glass",
    "glassLevels": { "clear": "Clear", "frosted": "Frosted", "solid": "Solid" },
    "notifications": "Notifications",
    "triggers": {
      "task_assigned": "A task is assigned to me",
      "mention": "Someone mentions me",
      "due_tomorrow": "My task is due tomorrow",
      "overdue": "My task is overdue",
      "review_requested": "A task goes to review",
      "task_approved": "My task is approved",
      "task_sent_back": "My task is sent back",
      "stage_changed": "The stage changes on my project",
      "added_to_project": "I am added to a project",
      "week_under_target": "My week is under target"
    },
    "prototype": "Prototype",
    "simulateErrors": "Simulate errors",
    "simulateErrorsHint": "1 in 5 actions fail, so you can see the error states.",
    "reset": "Reset sample data",
    "resetDone": "The sample data is back to its start state."
  },
  "errors": {
    "invalid_input": "Some fields are not valid.",
    "forbidden": "You cannot do this on this project.",
    "not_found": "This item does not exist anymore.",
    "conflict": "This item changed after that edit. Undo is not available.",
    "failed": "Something went wrong. Try again.",
    "week_locked": "This week is locked."
  },
  "common": { "retry": "Retry", "undo": "Undo", "close": "Close", "cancel": "Cancel" }
}
```

`src/i18n/ar.json`:

```json
{
  "app": { "name": "مدار" },
  "nav": {
    "main": "التنقل الرئيسي",
    "tabs": "الأقسام",
    "projects": "المشاريع",
    "myWork": "عملي",
    "dashboard": "لوحة المعلومات",
    "inbox": "الوارد",
    "search": "البحث",
    "settings": "الإعدادات",
    "showSidebar": "إظهار الشريط الجانبي",
    "hideSidebar": "إخفاء الشريط الجانبي",
    "useTabBar": "استخدام شريط التبويب",
    "useSidebar": "استخدام الشريط الجانبي",
    "inboxBadge": "{{count}} عناصر تحتاج إلى إجراء"
  },
  "screens": {
    "projects": "المشاريع",
    "project": "المشروع",
    "myWork": "عملي",
    "dashboard": "لوحة المعلومات",
    "inbox": "الوارد",
    "search": "البحث",
    "tasks": "المهام",
    "settings": "الإعدادات"
  },
  "placeholder": {
    "title": "هذه الشاشة قادمة",
    "body": "تصل هذه الشاشة في مرحلة البناء {{step}}."
  },
  "storage": { "notSaved": "لن تُحفظ التغييرات في هذه النافذة." },
  "preview": {
    "label": "المعاينة باسم",
    "prototype": "نموذج أولي",
    "agentFor": "وكيل ذكي عن {{name}}",
    "hint": { "admin": "مدير النظام", "leader": "قائد مشروع", "member": "عضو فريق", "agent": "وكيل ذكي" }
  },
  "settings": {
    "profile": "الملف الشخصي",
    "name": "الاسم",
    "discipline": "التخصص",
    "save": "حفظ",
    "saved": "تم حفظ الملف الشخصي.",
    "language": "اللغة",
    "languages": { "en": "English", "ar": "العربية" },
    "theme": "المظهر",
    "themes": { "system": "حسب الجهاز", "light": "فاتح", "dark": "داكن" },
    "glass": "الزجاج",
    "glassLevels": { "clear": "شفاف", "frosted": "مصنفر", "solid": "معتم" },
    "notifications": "الإشعارات",
    "triggers": {
      "task_assigned": "إسناد مهمة إليّ",
      "mention": "إشارة أحد إليّ",
      "due_tomorrow": "موعد مهمتي غدًا",
      "overdue": "تأخر مهمتي",
      "review_requested": "إرسال مهمة للمراجعة",
      "task_approved": "اعتماد مهمتي",
      "task_sent_back": "إعادة مهمتي للتعديل",
      "stage_changed": "تغيّر مرحلة مشروعي",
      "added_to_project": "إضافتي إلى مشروع",
      "week_under_target": "ساعات أسبوعي أقل من الهدف"
    },
    "prototype": "النموذج الأولي",
    "simulateErrors": "محاكاة الأخطاء",
    "simulateErrorsHint": "يفشل إجراء واحد من كل خمسة، لتظهر حالات الخطأ.",
    "reset": "إعادة البيانات التجريبية",
    "resetDone": "عادت البيانات التجريبية إلى حالتها الأولى."
  },
  "errors": {
    "invalid_input": "بعض الحقول غير صحيحة.",
    "forbidden": "لا يمكنك تنفيذ هذا في هذا المشروع.",
    "not_found": "هذا العنصر لم يعد موجودًا.",
    "conflict": "تغيّر هذا العنصر بعد ذلك التعديل. التراجع غير متاح.",
    "failed": "حدث خطأ. حاول مرة أخرى.",
    "week_locked": "هذا الأسبوع مقفل."
  },
  "common": { "retry": "إعادة المحاولة", "undo": "تراجع", "close": "إغلاق", "cancel": "إلغاء" }
}
```

`src/i18n/index.ts`:

```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from '../api/contract/entities';
import en from './en.json';
import ar from './ar.json';

export function initI18n(language: Language = 'en'): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      resources: { en: { translation: en }, ar: { translation: ar } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
  } else if (i18n.language !== language) {
    void i18n.changeLanguage(language);
  }
  return i18n;
}

export function applyLanguage(root: HTMLElement, language: Language): void {
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run src/i18n`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/i18n
git commit -m "feat: add English and Arabic text" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 19: Design tokens and appearance

**Files:**
- Create: `src/design/tokens.css`, `src/design/motion.ts`, `src/app/appearance.ts`
- Modify: `src/test/setup.ts`
- Test: `src/app/appearance.test.ts`

**Interfaces:**
- Consumes: `Preferences` (Task 3).
- Produces: CSS tokens and Tailwind names: colors `bg`, `card`, `label`, `label-2`, `label-3`, `separator`, `fill`, `fill-strong`, `accent`, `accent-fill`, `on-accent`, `green`, `orange`, `red`, `green-text`, `orange-text`, `red-text`, `badge`; radii `rounded-card`, `rounded-sheet`, `rounded-control`; shadows `shadow-card`, `shadow-float`; text sizes `text-large-title`, `text-title-1`, `text-title-2`, `text-title-3`, `text-headline`, `text-body`, `text-subheadline`, `text-footnote`, `text-caption`; classes `.glass`, `.surface`, `.pressable`, `.toolbar-fade`, `.tabular`. Motion presets `spring.standard`, `spring.expand`, `spring.flick`, `spring.drop`, `fade`. `type Appearance`, `type Environment`, `resolveAppearance(prefs, env): Appearance`, `readEnvironment(win?): Environment`, `applyAppearance(root, appearance): void`, `ENV_QUERIES`.

The token values follow spec 10 and plan clarification 7. The root element carries `data-theme` (`light` or `dark`), `data-glass` (`clear`, `frosted` or `solid`) and `data-contrast` (`normal` or `more`).

- [ ] **Step 1: Write the failing test**

`src/app/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyAppearance, readEnvironment, resolveAppearance } from './appearance';

const calm = { prefersDark: false, reduceTransparency: false, moreContrast: false };

describe('appearance', () => {
  it('follows the device when the theme is System', () => {
    expect(resolveAppearance({ theme: 'system', glass: 'frosted' }, { ...calm, prefersDark: true })).toEqual({ theme: 'dark', glass: 'frosted', contrast: 'normal' });
    expect(resolveAppearance({ theme: 'system', glass: 'frosted' }, calm).theme).toBe('light');
  });

  it('uses the chosen theme over the device', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'clear' }, { ...calm, prefersDark: true }).theme).toBe('light');
  });

  it('makes the glass solid when the device reduces transparency', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'clear' }, { ...calm, reduceTransparency: true }).glass).toBe('solid');
  });

  it('marks more contrast', () => {
    expect(resolveAppearance({ theme: 'light', glass: 'frosted' }, { ...calm, moreContrast: true }).contrast).toBe('more');
  });

  it('writes the attributes on the root element', () => {
    applyAppearance(document.documentElement, { theme: 'dark', glass: 'solid', contrast: 'more' });
    expect(document.documentElement.dataset).toMatchObject({ theme: 'dark', glass: 'solid', contrast: 'more' });
  });

  it('reads the device settings from media queries', () => {
    const fake = { matchMedia: (query: string) => ({ matches: query.includes('dark') }) } as unknown as Window;
    expect(readEnvironment(fake)).toEqual({ prefersDark: true, reduceTransparency: false, moreContrast: false });
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npx vitest run src/app/appearance.test.ts`
Expected: FAIL, "Failed to resolve import ./appearance".

- [ ] **Step 3: Write the implementation**

`src/app/appearance.ts`:

```ts
import type { Preferences } from '../api/contract/entities';

export type Appearance = { theme: 'light' | 'dark'; glass: 'clear' | 'frosted' | 'solid'; contrast: 'normal' | 'more' };
export type Environment = { prefersDark: boolean; reduceTransparency: boolean; moreContrast: boolean };

export const ENV_QUERIES = ['(prefers-color-scheme: dark)', '(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)'];

export function resolveAppearance(prefs: Pick<Preferences, 'theme' | 'glass'>, env: Environment): Appearance {
  return {
    theme: prefs.theme === 'system' ? (env.prefersDark ? 'dark' : 'light') : prefs.theme,
    glass: env.reduceTransparency ? 'solid' : prefs.glass,
    contrast: env.moreContrast ? 'more' : 'normal',
  };
}

export function readEnvironment(win: Window = window): Environment {
  const matches = (query: string) => win.matchMedia?.(query).matches ?? false;
  return {
    prefersDark: matches(ENV_QUERIES[0]),
    reduceTransparency: matches(ENV_QUERIES[1]),
    moreContrast: matches(ENV_QUERIES[2]),
  };
}

export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  root.dataset.theme = appearance.theme;
  root.dataset.glass = appearance.glass;
  root.dataset.contrast = appearance.contrast;
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', appearance.theme === 'dark' ? '#000000' : '#F5F5F7');
}
```

`src/design/motion.ts`:

```ts
import type { Transition } from 'motion/react';

/** Spring presets from spec 10.6. Motion follows "Reduce motion" through MotionConfig reducedMotion="user". */
export const spring = {
  standard: { type: 'spring', bounce: 0, duration: 0.35 },
  expand: { type: 'spring', bounce: 0, duration: 0.45 },
  flick: { type: 'spring', bounce: 0.15, duration: 0.4 },
  drop: { type: 'spring', bounce: 0.15, duration: 0.35 },
} satisfies Record<string, Transition>;

export const fade: Transition = { duration: 0.2, ease: 'easeOut' };
```

`src/design/tokens.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

/* Design tokens from spec section 10, with the contrast values from plan clarification 7.
   label-3 is for icons and disabled states only, never for text. */
:root {
  --c-bg: #F5F5F7;
  --c-card: #FFFFFF;
  --c-label: #1D1D1F;
  --c-label-2: #5E5E63;
  --c-label-3: #A1A1A6;
  --c-separator: rgba(60, 60, 67, 0.14);
  --c-fill: rgba(120, 120, 128, 0.12);
  --c-fill-strong: rgba(120, 120, 128, 0.2);
  --c-accent: #0066CC;
  --c-accent-fill: #0071E3;
  --c-on-accent: #FFFFFF;
  --c-green: #34C759;
  --c-orange: #FF9500;
  --c-red: #FF3B30;
  --c-green-text: #1E7A34;
  --c-orange-text: #C93400;
  --c-red-text: #D70015;
  --c-badge: #D70015;
  --c-scrim: rgba(0, 0, 0, 0.35);
  --sh-card: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
  --sh-float: 0 8px 32px rgba(0, 0, 0, 0.12);
  --glass-bg: rgba(255, 255, 255, 0.72);
  --glass-filter: blur(24px) saturate(180%);
  --glass-edge: rgba(255, 255, 255, 0.55);
  --glass-border: transparent;
  --r-card: 22px;
  --r-sheet: 28px;
  --r-control: 8px;
  --boost: 1;
  --size-large-title: 34px;
  --size-title-1: 28px;
  --size-title-2: 22px;
  --size-title-3: 20px;
  --size-headline: 17px;
  --size-body: 17px;
  --size-subheadline: 15px;
  --size-footnote: 13px;
  --size-caption: 12px;
  color-scheme: light;
}

@media (min-width: 1024px) {
  :root {
    --size-large-title: 30px;
    --size-title-1: 24px;
    --size-title-2: 19px;
    --size-title-3: 17px;
    --size-headline: 15px;
    --size-body: 15px;
    --size-subheadline: 13px;
    --size-footnote: 12px;
    --size-caption: 11px;
  }
}

/* Arabic reads one step larger than Latin text at the same level (spec 10.4). */
:root[lang="ar"] {
  --boost: 1.08;
}

[data-theme="dark"] {
  --c-bg: #000000;
  --c-card: #1C1C1E;
  --c-label: #F5F5F7;
  --c-label-2: #AEAEB2;
  --c-label-3: #636366;
  --c-separator: rgba(84, 84, 88, 0.6);
  --c-fill: rgba(120, 120, 128, 0.24);
  --c-fill-strong: rgba(120, 120, 128, 0.36);
  --c-accent: #0A84FF;
  --c-accent-fill: #0071E3;
  --c-green: #30D158;
  --c-orange: #FF9F0A;
  --c-red: #FF453A;
  --c-green-text: #30D158;
  --c-orange-text: #FF9F0A;
  --c-red-text: #FF453A;
  --c-scrim: rgba(0, 0, 0, 0.5);
  --sh-card: 0 1px 2px rgba(0, 0, 0, 0.3);
  --sh-float: 0 8px 32px rgba(0, 0, 0, 0.5);
  --glass-bg: rgba(28, 28, 30, 0.72);
  --glass-edge: rgba(255, 255, 255, 0.08);
  color-scheme: dark;
}

[data-glass="clear"] {
  --glass-bg: rgba(255, 255, 255, 0.25);
  --glass-filter: blur(12px);
}

[data-theme="dark"][data-glass="clear"] {
  --glass-bg: rgba(0, 0, 0, 0.25);
}

[data-glass="solid"] {
  --glass-bg: var(--c-card);
  --glass-filter: none;
}

[data-contrast="more"] {
  --glass-border: var(--c-label);
  --c-separator: var(--c-label-2);
}

@theme inline {
  --font-sans: "Inter Variable", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif;
  --color-bg: var(--c-bg);
  --color-card: var(--c-card);
  --color-label: var(--c-label);
  --color-label-2: var(--c-label-2);
  --color-label-3: var(--c-label-3);
  --color-separator: var(--c-separator);
  --color-fill: var(--c-fill);
  --color-fill-strong: var(--c-fill-strong);
  --color-accent: var(--c-accent);
  --color-accent-fill: var(--c-accent-fill);
  --color-on-accent: var(--c-on-accent);
  --color-green: var(--c-green);
  --color-orange: var(--c-orange);
  --color-red: var(--c-red);
  --color-green-text: var(--c-green-text);
  --color-orange-text: var(--c-orange-text);
  --color-red-text: var(--c-red-text);
  --color-badge: var(--c-badge);
  --radius-card: var(--r-card);
  --radius-sheet: var(--r-sheet);
  --radius-control: var(--r-control);
  --shadow-card: var(--sh-card);
  --shadow-float: var(--sh-float);
  --text-large-title: calc(var(--size-large-title) * var(--boost));
  --text-large-title--line-height: 1.1;
  --text-large-title--letter-spacing: -0.02em;
  --text-large-title--font-weight: 700;
  --text-title-1: calc(var(--size-title-1) * var(--boost));
  --text-title-1--line-height: 1.15;
  --text-title-1--letter-spacing: -0.015em;
  --text-title-1--font-weight: 700;
  --text-title-2: calc(var(--size-title-2) * var(--boost));
  --text-title-2--line-height: 1.2;
  --text-title-2--letter-spacing: -0.01em;
  --text-title-2--font-weight: 700;
  --text-title-3: calc(var(--size-title-3) * var(--boost));
  --text-title-3--line-height: 1.25;
  --text-title-3--font-weight: 600;
  --text-headline: calc(var(--size-headline) * var(--boost));
  --text-headline--line-height: 1.3;
  --text-headline--font-weight: 600;
  --text-body: calc(var(--size-body) * var(--boost));
  --text-body--line-height: 1.45;
  --text-subheadline: calc(var(--size-subheadline) * var(--boost));
  --text-subheadline--line-height: 1.35;
  --text-footnote: calc(var(--size-footnote) * var(--boost));
  --text-footnote--line-height: 1.35;
  --text-caption: calc(var(--size-caption) * var(--boost));
  --text-caption--line-height: 1.3;
  --text-caption--letter-spacing: 0.01em;
}

@layer base {
  html {
    background: var(--c-bg);
    color: var(--c-label);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    font-optical-sizing: auto;
  }
  body {
    margin: 0;
    min-height: 100dvh;
    font-family: "Inter Variable", "IBM Plex Sans Arabic", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: calc(var(--size-body) * var(--boost));
    line-height: 1.45;
  }
  :root[lang="ar"] body {
    font-family: "IBM Plex Sans Arabic", "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  :focus-visible {
    outline: 2px solid var(--c-accent);
    outline-offset: 2px;
  }
  * {
    -webkit-tap-highlight-color: transparent;
  }
}

@layer components {
  /* Liquid Glass: navigation layer only (spec 10.1). */
  .glass {
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: inset 0 1px 0 var(--glass-edge);
    border: 1px solid var(--glass-border);
  }
  .surface {
    background: var(--c-card);
    box-shadow: var(--sh-card);
    border: 1px solid var(--glass-border);
  }
  /* Press feedback starts on pointer-down (spec 10.6). */
  .pressable {
    transition: transform 100ms ease-out;
  }
  .pressable:active {
    transform: scale(0.97);
  }
  /* Soft scroll edge under a floating toolbar, instead of a hard divider line. */
  .toolbar-fade::after {
    content: "";
    position: absolute;
    inset-inline: 0;
    top: 100%;
    height: 16px;
    background: linear-gradient(var(--glass-bg), transparent);
    pointer-events: none;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pressable,
  .pressable:active {
    transition: none;
    transform: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .glass {
    background: var(--c-card);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
```

Replace `src/test/setup.ts` with:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setNow } from '../lib/dates';

// jsdom has no matchMedia. The app reads device settings through it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false, media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  setNow(null);
  const root = document.documentElement;
  for (const name of ['dir', 'lang', 'data-theme', 'data-glass', 'data-contrast']) root.removeAttribute(name);
});
```

- [ ] **Step 4: Run the test and the checks**

Run: `npx vitest run src/app/appearance.test.ts`
Expected: PASS (6 tests).

Run: `npm run check:rtl`
Expected: `RTL check passed.`

- [ ] **Step 5: Commit**

```bash
git add src/design src/app/appearance.ts src/app/appearance.test.ts src/test/setup.ts
git commit -m "feat: add design tokens, motion presets and appearance rules" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 20: Runtime, bootstrap and toasts

**Files:**
- Create: `src/app/runtime.tsx`, `src/app/errors.ts`, `src/app/toasts.tsx`, `src/app/bootstrap.ts`, `src/app/AppearanceSync.tsx`
- Test: `src/app/errors.test.ts`, `src/app/bootstrap.test.ts`

**Interfaces:**
- Consumes: `calls`, `MadarApi`, `CallName`, `CallInput`, `CallOutput` (Task 16), `createApi` (Task 9), `Store`, `STATE_VERSION` (Task 4), `openPersister` (Task 4), `buildSeed`, `shiftState` (Task 17), `runScheduledTriggers` (Task 8), `initI18n`, `applyLanguage` (Task 18), appearance (Task 19).
- Produces: `type Runtime = { store: Store; api: MadarApi }`, `createQueryClient()`, `RuntimeProvider`, `useRuntime()`, `useCall(name, input)` (a TanStack query), `useAction(name, { onSuccess? })` (a TanStack mutation that shows an error toast on failure), `errorMessage(error, t): string`, `ToastProvider`, `useToast(): { show(toast: { message: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } }): void }`, `bootstrap(options?: { persister?: Persister; latencyMs?: number }): Promise<Runtime>`, `startScheduler(store): () => void`, `AppearanceSync` (a component with no output).

How the pieces fit: `bootstrap` loads the saved state (or builds the sample office, or shifts the saved dates to today) and runs the time-based triggers once. `RuntimeProvider` refreshes every `useCall` query after any store change, so screens never refresh by hand. `AppearanceSync` applies the current user's language, theme and glass to the page.

- [ ] **Step 1: Write the failing tests**

`src/app/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';
import { ApiError, forbidden } from '../api/errors';
import { initI18n } from '../i18n';

describe('errorMessage', () => {
  it('turns API errors into plain text', () => {
    const i18n = initI18n('en');
    const t = i18n.t.bind(i18n);
    expect(errorMessage(new ApiError('forbidden', 'x'), t)).toBe('You cannot do this on this project.');
    expect(errorMessage(forbidden('x', { reason: 'week_locked' }), t)).toBe('This week is locked.');
    expect(errorMessage(new ApiError('conflict', 'x'), t)).toBe('This item changed after that edit. Undo is not available.');
    expect(errorMessage(new Error('boom'), t)).toBe('Something went wrong. Try again.');
  });
});
```

`src/app/bootstrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bootstrap } from './bootstrap';
import { memoryPersister } from '../api/persist';
import { emptyState } from '../api/store';
import { addDays, setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';

describe('bootstrap', () => {
  it('builds the sample office on the first visit and loads saved work later', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    expect(Object.keys(first.store.state.projects)).toHaveLength(12);
    await first.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    await first.store.flush();
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.projects.prj_001.name).toBe('Corniche Tower');
  });

  it('shifts saved dates when the day changes', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const first = await bootstrap({ persister, latencyMs: 0 });
    await first.store.flush();
    const due = first.store.state.tasks.tsk_001.dueDate!;
    setNow(new Date('2026-10-03T06:00:00Z'));
    const second = await bootstrap({ persister, latencyMs: 0 });
    expect(second.store.state.seededOn).toBe('2026-10-03');
    expect(second.store.state.tasks.tsk_001.dueDate).toBe(addDays(due, 3));
  });

  it('builds a fresh office when the saved version is old', async () => {
    setNow(NOW);
    const persister = memoryPersister();
    const stale = emptyState(TODAY);
    stale.version = 0;
    await persister.save(stale);
    const runtime = await bootstrap({ persister, latencyMs: 0 });
    expect(Object.keys(runtime.store.state.projects)).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/app/errors.test.ts src/app/bootstrap.test.ts`
Expected: FAIL, "Failed to resolve import ./errors" and "./bootstrap".

- [ ] **Step 3: Write the implementation**

`src/app/errors.ts`:

```ts
import type { TFunction } from 'i18next';
import { ApiError } from '../api/errors';

export function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.details.reason === 'week_locked') return t('errors.week_locked');
    return t(`errors.${error.code}`);
  }
  return t('errors.failed');
}
```

`src/app/toasts.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastInput = { message: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } };
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (toast: ToastInput) => void } | null>(null);
let nextToastId = 1;

/** Toasts stay 5 seconds (spec 5.5). At most three show at once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((toast) => toast.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextToastId++;
    setToasts((all) => [...all.slice(-2), { ...toast, id }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className="glass pointer-events-auto flex min-h-11 max-w-full items-center gap-3 rounded-full px-5 py-2 text-subheadline shadow-float"
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="pressable min-h-11 font-semibold text-accent"
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): { show: (toast: ToastInput) => void } {
  const context = useContext(ToastContext);
  if (!context) throw new Error('ToastProvider is missing.');
  return context;
}
```

`src/app/runtime.tsx`:

```tsx
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { CallInput, CallName, CallOutput, MadarApi } from '../api/calls';
import type { Store } from '../api/store';
import { errorMessage } from './errors';
import { useToast } from './toasts';

export type Runtime = { store: Store; api: MadarApi };

const RuntimeContext = createContext<Runtime | null>(null);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 }, mutations: { retry: false } },
  });
}

/** Refreshes every screen query after any change in the store, also after a scheduled notification. */
export function RuntimeProvider({ runtime, queryClient, children }: { runtime: Runtime; queryClient: QueryClient; children: ReactNode }) {
  useEffect(
    () => runtime.store.subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ['api'] });
    }),
    [runtime, queryClient],
  );
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is missing.');
  return runtime;
}

export function useCall<N extends CallName>(name: N, input: CallInput<N>) {
  const { api } = useRuntime();
  return useQuery<CallOutput<N>>({ queryKey: ['api', name, input], queryFn: () => api.call(name, input) });
}

export function useAction<N extends CallName>(name: N, options: { onSuccess?: (output: CallOutput<N>) => void } = {}) {
  const { api } = useRuntime();
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation<CallOutput<N>, unknown, CallInput<N>>({
    mutationFn: (input) => api.call(name, input),
    onSuccess: (output) => options.onSuccess?.(output),
    onError: (error) => toast.show({ tone: 'error', message: errorMessage(error, t) }),
  });
}
```

`src/app/bootstrap.ts`:

```ts
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { runScheduledTriggers } from '../api/notify';
import { openPersister, type Persister } from '../api/persist';
import { STATE_VERSION, Store } from '../api/store';
import { buildSeed } from '../data/seed';
import { shiftState } from '../data/shift';
import { diffDays, now, todayISO } from '../lib/dates';
import type { Runtime } from './runtime';

/** The only place that builds the store and the API. */
export async function bootstrap(options: { persister?: Persister; latencyMs?: number } = {}): Promise<Runtime> {
  const persister = options.persister ?? (await openPersister());
  const today = todayISO();
  let state = await persister.load().catch(() => null);
  if (!state || state.version !== STATE_VERSION) {
    await persister.clear().catch(() => undefined);
    state = await buildSeed(today, (key, blob) => persister.putBlob(key, blob));
  } else if (state.seededOn !== today) {
    state = shiftState(state, diffDays(state.seededOn, today));
    state.seededOn = today;
  }
  const store = new Store(state, persister);
  store.run((s) => {
    runScheduledTriggers(s, now());
  });
  const api = createApi(calls, {
    store,
    latencyMs: options.latencyMs,
    failureRate: () => (store.state.session.simulateErrors ? 0.2 : 0),
  });
  return { store, api };
}

/** Runs the time-based triggers every minute. */
export function startScheduler(store: Store): () => void {
  const id = window.setInterval(() => {
    store.run((s) => {
      runScheduledTriggers(s, now());
    });
  }, 60_000);
  return () => window.clearInterval(id);
}
```

`src/app/AppearanceSync.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useCall } from './runtime';
import { applyAppearance, ENV_QUERIES, readEnvironment, resolveAppearance } from './appearance';
import { applyLanguage, initI18n } from '../i18n';

/** Applies the current user's language, theme and glass to the page, and follows device setting changes. */
export function AppearanceSync() {
  const prefs = useCall('session.get', {}).data?.user.preferences;
  const [env, setEnv] = useState(() => readEnvironment());

  useEffect(() => {
    const lists = ENV_QUERIES.map((query) => window.matchMedia(query));
    const onChange = () => setEnv(readEnvironment());
    for (const list of lists) list.addEventListener?.('change', onChange);
    return () => {
      for (const list of lists) list.removeEventListener?.('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (!prefs) return;
    const root = document.documentElement;
    applyAppearance(root, resolveAppearance(prefs, env));
    applyLanguage(root, prefs.language);
    initI18n(prefs.language);
  }, [prefs, env]);

  return null;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/app/errors.test.ts src/app/bootstrap.test.ts`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat: add the runtime, bootstrap, toasts and appearance sync" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 21: App shell and Settings screen

**Files:**
- Create: `src/components/Avatar.tsx`, `src/components/Badge.tsx`, `src/components/Button.tsx`, `src/components/EmptyState.tsx`, `src/components/ScreenTitle.tsx`, `src/components/SegmentedControl.tsx`, `src/components/Switch.tsx`
- Create: `src/app/nav.ts`, `src/app/Sidebar.tsx`, `src/app/TabBar.tsx`, `src/app/Toolbar.tsx`, `src/app/StorageBanner.tsx`, `src/app/PreviewAs.tsx`, `src/app/AppShell.tsx`, `src/app/routes.tsx`
- Create: `src/features/placeholder/Placeholder.tsx`, `src/features/settings/SettingsScreen.tsx`
- Create: `src/test/render.tsx`
- Modify: `src/main.tsx`
- Test: `src/app/AppShell.test.tsx`, `src/features/settings/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 20 hooks and providers, text keys (Task 18), tokens (Task 19).
- Produces: `createAppRouter()` with the routes `/`, `/projects/:projectId`, `/work`, `/dashboard`, `/inbox`, `/search`, `/tasks`, `/settings`. The shared components `Avatar`, `Badge`, `Button`, `EmptyState`, `ScreenTitle`, `SegmentedControl`, `Switch` for plans 2 to 5. `Placeholder` for the screens of later plans. Test helper `renderApp(path)`.

Layout (spec 3.2): desktop (1024 px and wider) shows the full glass sidebar at the start side; tablet (640 to 1023 px) shows an icon-only sidebar with a switch to the tab bar; phone (under 640 px) shows the glass tab bar with Search as its own tab. The Inbox badge counts unread items that need action. Ctrl+K or ⌘K opens Search. Settings in this plan: profile, language, theme, glass, notification switches, and the prototype controls. Plan 4 adds the Admin sections.

- [ ] **Step 1: Write the test helper and the failing tests**

`src/test/render.tsx`:

```tsx
import { onTestFinished } from 'vitest';
import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { memoryPersister } from '../api/persist';
import { Store } from '../api/store';
import { buildSeed } from '../data/seed';
import { AppearanceSync } from '../app/AppearanceSync';
import { createAppRouter } from '../app/routes';
import { RuntimeProvider, createQueryClient } from '../app/runtime';
import { ToastProvider } from '../app/toasts';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from './factories';

/** Renders the whole app over the sample office, at a hash route, with no latency. */
export async function renderApp(path = '/') {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  initI18n('en');
  window.location.hash = `#${path}`;
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  const view = render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api, router };
}
```

`src/app/AppShell.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

describe('app shell', () => {
  it('shows the navigation and a placeholder screen', async () => {
    await renderApp('/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('This screen arrives in build step 4.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'My Work' }).length).toBeGreaterThan(0);
  });

  it('moves between screens', async () => {
    await renderApp('/');
    await userEvent.click((await screen.findAllByRole('link', { name: 'My Work' }))[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/work');
  });

  it('warns that changes are not saved when storage is in memory', async () => {
    await renderApp('/');
    expect(await screen.findByText('Changes will not be saved in this window.')).toBeInTheDocument();
  });

  it('shows the Inbox badge for items that need action', async () => {
    await renderApp('/');
    expect((await screen.findAllByText(/items need action/)).length).toBeGreaterThan(0);
  });

  it('switches to Arabic and mirrors the page', async () => {
    await renderApp('/dashboard');
    await userEvent.click((await screen.findAllByRole('button', { name: 'العربية' }))[0]);
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(await screen.findByRole('heading', { level: 1, name: 'لوحة المعلومات' })).toBeInTheDocument();
  });

  it('opens Search with Ctrl+K', async () => {
    await renderApp('/');
    await screen.findAllByRole('link', { name: 'My Work' });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
  });
});
```

`src/features/settings/SettingsScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

describe('settings screen', () => {
  it('changes the theme and the glass', async () => {
    await renderApp('/settings');
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    await userEvent.click(screen.getByRole('radio', { name: 'Solid' }));
    await waitFor(() => expect(document.documentElement.dataset.glass).toBe('solid'));
  });

  it('turns a notification trigger off', async () => {
    await renderApp('/settings');
    const toggle = await screen.findByRole('switch', { name: 'Someone mentions me' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Someone mentions me' })).toHaveAttribute('aria-checked', 'false'));
  });

  it('saves the profile', async () => {
    const { store } = await renderApp('/settings');
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Hala N.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(store.state.users.usr_001.name).toBe('Hala N.'));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
  });

  it('previews the app as another person', async () => {
    const { store } = await renderApp('/settings');
    const selects = await screen.findAllByRole('combobox', { name: /Preview as/ });
    await userEvent.selectOptions(selects[0], 'usr_005');
    await waitFor(() => expect(store.state.session.currentUserId).toBe('usr_005'));
  });

  it('resets the sample data and says so', async () => {
    const { store } = await renderApp('/settings');
    store.state.projects.prj_001.name = 'Changed';
    await userEvent.click(await screen.findByRole('button', { name: 'Reset sample data' }));
    expect(await screen.findByText('The sample data is back to its start state.')).toBeInTheDocument();
    expect(store.state.projects.prj_001.name).toBe('Corniche Office Tower');
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/app/AppShell.test.tsx src/features/settings`
Expected: FAIL, "Failed to resolve import ../app/routes".

- [ ] **Step 3: Write the shared components**

`src/components/Avatar.tsx`:

```tsx
import { Sparkles } from 'lucide-react';
import type { UserCard } from '../api/contract/views';

// Darker tints so white initials pass the 4.5:1 contrast rule.
const TINTS = ['#C93400', '#1E7A34', '#0040DD', '#8944AB', '#D30F45', '#0071A4', '#B25000', '#6C6C70'];

function tintOf(id: string): string {
  let sum = 0;
  for (const ch of id) sum += ch.charCodeAt(0);
  return TINTS[sum % TINTS.length];
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

export function Avatar({ user, size = 32 }: { user: Pick<UserCard, 'id' | 'name' | 'avatarUrl' | 'kind'>; size?: number }) {
  const box = { width: size, height: size };
  if (user.kind === 'agent') {
    return (
      <span role="img" aria-label={user.name} style={box} className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-fill text-on-accent">
        <Sparkles size={Math.round(size * 0.5)} aria-hidden />
      </span>
    );
  }
  if (user.avatarUrl) return <img src={user.avatarUrl} alt={user.name} style={box} className="shrink-0 rounded-full object-cover" />;
  return (
    <span
      role="img"
      aria-label={user.name}
      style={{ ...box, background: tintOf(user.id), fontSize: Math.round(size * 0.38) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {initialsOf(user.name)}
    </span>
  );
}
```

`src/components/Badge.tsx`:

```tsx
export function Badge({ count, label, className = '' }: { count: number; label: string; className?: string }) {
  return (
    <span className={`tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-badge px-1.5 text-caption font-semibold text-white ${className}`}>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
```

`src/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'plain' | 'destructive';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-fill text-on-accent',
  secondary: 'bg-fill text-label',
  plain: 'text-accent',
  destructive: 'bg-fill text-red-text',
};

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-body font-semibold disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}
```

`src/components/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';

/** Start-aligned, one sentence and one action (spec 10.4 and 11.6). */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="surface flex flex-col items-start gap-2 rounded-card p-6">
      <h2 className="text-headline">{title}</h2>
      <p className="text-subheadline text-label-2">{body}</p>
      {action}
    </section>
  );
}
```

`src/components/ScreenTitle.tsx`:

```tsx
export function ScreenTitle({ title }: { title: string }) {
  return <h1 className="pb-4 text-large-title [text-wrap:balance]">{title}</h1>;
}
```

`src/components/SegmentedControl.tsx`:

```tsx
export function SegmentedControl<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full bg-fill p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`pressable min-h-11 rounded-full px-4 text-subheadline font-medium ${option.value === value ? 'bg-card text-label shadow-card' : 'text-label-2'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

`src/components/Switch.tsx`:

```tsx
export function Switch({
  id, label, description, checked, onChange,
}: { id: string; label: string; description?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-body">{label}</label>
        {description && <p id={`${id}-hint`} className="text-footnote text-label-2">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-hint` : undefined}
        onClick={() => onChange(!checked)}
        className={`pressable relative h-[31px] w-[51px] shrink-0 rounded-full ${checked ? 'bg-green' : 'bg-fill-strong'}`}
      >
        <span
          aria-hidden
          className={`absolute start-[2px] top-[2px] size-[27px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5 rtl:-translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write the shell**

`src/app/nav.ts`:

```ts
import { FolderKanban, Inbox, LayoutDashboard, ListChecks, Search } from 'lucide-react';

export type NavItem = { to: string; key: string; icon: typeof FolderKanban; badge?: boolean };

export const NAV: NavItem[] = [
  { to: '/', key: 'nav.projects', icon: FolderKanban },
  { to: '/work', key: 'nav.myWork', icon: ListChecks },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/projects');
  return pathname === to || pathname.startsWith(`${to}/`);
}
```

`src/app/PreviewAs.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useAction, useCall } from './runtime';

/** Prototype control: shows the app as another person (spec 3.3). */
export function PreviewAs({ id }: { id: string }) {
  const { t } = useTranslation();
  const session = useCall('session.get', {});
  const previewAs = useAction('session.previewAs');
  if (!session.data) return null;
  return (
    <label className="block" htmlFor={id}>
      <span className="flex items-center gap-1.5 text-caption text-label-2">
        {t('preview.label')}
        <span className="rounded-full bg-fill px-1.5">{t('preview.prototype')}</span>
      </span>
      <select
        id={id}
        value={session.data.user.id}
        onChange={(event) => previewAs.mutate({ userId: event.target.value })}
        className="mt-1 min-h-11 w-full rounded-control bg-fill px-2 text-subheadline text-label"
      >
        {session.data.previewUsers.map((user) => (
          <option key={user.id} value={user.id}>
            {`${user.name} · ${user.actingForName ? t('preview.agentFor', { name: user.actingForName }) : t(`preview.hint.${user.hint}`)}`}
          </option>
        ))}
      </select>
    </label>
  );
}
```

`src/app/Sidebar.tsx`:

```tsx
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Languages, PanelLeft, Rows3 } from 'lucide-react';
import { NAV, isNavActive } from './nav';
import { PreviewAs } from './PreviewAs';
import { useAction, useCall } from './runtime';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';

export function Sidebar({ compact, onHide, onUseTabBar }: { compact: boolean; onHide?: () => void; onUseTabBar?: () => void }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useCall('session.get', {}).data?.user;
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  const setPreferences = useAction('me.updatePreferences');
  const nextLanguage = user?.preferences.language === 'ar' ? 'en' : 'ar';
  const iconButton = 'pressable grid size-11 place-items-center rounded-full text-label-2 hover:bg-fill';

  return (
    <nav aria-label={t('nav.main')} className={`glass flex h-full flex-col gap-1 rounded-card p-2 ${compact ? 'w-16 items-center' : 'w-64'}`}>
      <div className={`flex items-center pb-2 ${compact ? 'justify-center' : 'justify-between ps-2'}`}>
        {!compact && <span className="text-title-3">{t('app.name')}</span>}
        {onHide && (
          <button type="button" onClick={onHide} aria-label={t('nav.hideSidebar')} className={iconButton}>
            <PanelLeft size={20} className="rtl:-scale-x-100" aria-hidden />
          </button>
        )}
        {onUseTabBar && (
          <button type="button" onClick={onUseTabBar} aria-label={t('nav.useTabBar')} className={iconButton}>
            <Rows3 size={20} aria-hidden />
          </button>
        )}
      </div>
      {NAV.map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-label={compact ? t(item.key) : undefined}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative flex min-h-11 items-center gap-3 rounded-xl ${compact ? 'w-11 justify-center' : 'w-full px-3'} ${active ? 'bg-fill-strong text-label' : 'text-label-2 hover:bg-fill'}`}
          >
            <Icon size={20} className={active ? 'text-accent' : ''} aria-hidden />
            {!compact && <span className="text-body font-medium">{t(item.key)}</span>}
            {item.badge && badge > 0 && (
              <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className={compact ? 'absolute -top-1 end-0' : 'ms-auto'} />
            )}
          </Link>
        );
      })}
      <div className={`mt-auto flex flex-col gap-2 pt-2 ${compact ? 'items-center' : 'w-full px-1'}`}>
        {!compact && <PreviewAs id="preview-as-sidebar" />}
        <button
          type="button"
          onClick={() => setPreferences.mutate({ language: nextLanguage })}
          aria-label={t(`settings.languages.${nextLanguage}`)}
          className={`pressable flex min-h-11 items-center gap-2 rounded-xl text-subheadline text-label-2 hover:bg-fill ${compact ? 'w-11 justify-center' : 'px-2'}`}
        >
          <Languages size={18} aria-hidden />
          {!compact && <span aria-hidden>{t(`settings.languages.${nextLanguage}`)}</span>}
        </button>
        {user && (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label={t('nav.settings')}
            className={`pressable flex min-h-11 items-center gap-2 rounded-xl hover:bg-fill ${compact ? 'w-11 justify-center' : 'px-2'}`}
          >
            <Avatar user={user} size={28} />
            {!compact && <span aria-hidden className="truncate text-subheadline">{user.name}</span>}
          </button>
        )}
      </div>
    </nav>
  );
}
```

`src/app/TabBar.tsx`:

```tsx
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { NAV, SEARCH_ITEM, isNavActive } from './nav';
import { useCall } from './runtime';
import { Badge } from '../components/Badge';

/** Navigation only, never actions. It stays visible, except under a sheet (spec 3.2). */
export function TabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const badge = useCall('notifications.count', {}).data?.badge ?? 0;
  return (
    <nav
      aria-label={t('nav.tabs')}
      className="glass fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-full px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1"
    >
      {[...NAV, SEARCH_ITEM].map((item) => {
        const active = isNavActive(item.to, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={`pressable relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1 ${active ? 'text-accent' : 'text-label-2'}`}
          >
            <Icon size={22} aria-hidden />
            <span className="text-caption font-medium">{t(item.key)}</span>
            {item.badge && badge > 0 && <Badge count={badge} label={t('nav.inboxBadge', { count: badge })} className="absolute top-0 end-[18%]" />}
          </Link>
        );
      })}
    </nav>
  );
}
```

`src/app/Toolbar.tsx`:

```tsx
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PanelLeft, Search, SquareMenu } from 'lucide-react';
import { useCall } from './runtime';
import { Avatar } from '../components/Avatar';

export function Toolbar({ onShowSidebar, onUseSidebar }: { onShowSidebar?: () => void; onUseSidebar?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useCall('session.get', {}).data?.user;
  const iconButton = 'pressable size-11 place-items-center rounded-full text-label-2 hover:bg-fill';
  return (
    <header className="glass toolbar-fade sticky top-0 z-20 flex min-h-14 items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
      {onShowSidebar && (
        <button type="button" onClick={onShowSidebar} aria-label={t('nav.showSidebar')} className={`${iconButton} hidden lg:grid`}>
          <PanelLeft size={20} className="rtl:-scale-x-100" aria-hidden />
        </button>
      )}
      {onUseSidebar && (
        <button type="button" onClick={onUseSidebar} aria-label={t('nav.useSidebar')} className={`${iconButton} hidden sm:max-lg:grid`}>
          <SquareMenu size={20} aria-hidden />
        </button>
      )}
      <span className="text-headline sm:hidden">{t('app.name')}</span>
      <div className="ms-auto flex items-center gap-1">
        <button type="button" onClick={() => navigate('/search')} aria-label={t('nav.search')} className={`${iconButton} hidden sm:grid`}>
          <Search size={20} aria-hidden />
        </button>
        {user && (
          <button type="button" onClick={() => navigate('/settings')} aria-label={t('nav.settings')} className="pressable grid size-11 place-items-center rounded-full lg:hidden">
            <Avatar user={user} size={30} />
          </button>
        )}
      </div>
    </header>
  );
}
```

`src/app/StorageBanner.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useCall } from './runtime';

/** Spec 11.6: with no browser storage, the app runs in memory and says so. */
export function StorageBanner() {
  const { t } = useTranslation();
  const persistent = useCall('session.get', {}).data?.persistent;
  if (persistent !== false) return null;
  return (
    <div role="status" className="bg-fill px-4 py-2 text-center text-footnote text-label">
      {t('storage.notSaved')}
    </div>
  );
}
```

`src/app/AppShell.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Sidebar } from './Sidebar';
import { StorageBanner } from './StorageBanner';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';

const SIDEBAR_HIDDEN = 'madar.sidebarHidden';
const TABLET_TABS = 'madar.tabletTabs';

// Per-viewer layout choices only. The app works the same when storage is blocked.
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage is blocked. The choice lasts for this visit only.
  }
}

export function AppShell() {
  const navigate = useNavigate();
  const [sidebarHidden, setSidebarHidden] = useState(() => readFlag(SIDEBAR_HIDDEN));
  const [tabletTabs, setTabletTabs] = useState(() => readFlag(TABLET_TABS));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const hideSidebar = (on: boolean) => {
    setSidebarHidden(on);
    writeFlag(SIDEBAR_HIDDEN, on);
  };
  const chooseTabletTabs = (on: boolean) => {
    setTabletTabs(on);
    writeFlag(TABLET_TABS, on);
  };

  return (
    <div className="min-h-dvh bg-bg text-label">
      {!sidebarHidden && (
        <div className="fixed inset-y-3 start-3 z-30 hidden lg:block">
          <Sidebar compact={false} onHide={() => hideSidebar(true)} />
        </div>
      )}
      {!tabletTabs && (
        <div className="fixed inset-y-3 start-3 z-30 hidden sm:max-lg:block">
          <Sidebar compact onUseTabBar={() => chooseTabletTabs(true)} />
        </div>
      )}
      <div
        className={[
          'pb-28 sm:pb-8',
          sidebarHidden ? '' : 'lg:ps-[17.5rem]',
          tabletTabs ? 'sm:max-lg:pb-28' : 'sm:max-lg:ps-[5.5rem]',
        ].join(' ')}
      >
        <StorageBanner />
        <Toolbar
          onShowSidebar={sidebarHidden ? () => hideSidebar(false) : undefined}
          onUseSidebar={tabletTabs ? () => chooseTabletTabs(false) : undefined}
        />
        <main className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <Outlet />
        </main>
      </div>
      <div className={tabletTabs ? 'lg:hidden' : 'sm:hidden'}>
        <TabBar />
      </div>
    </div>
  );
}
```

`src/features/placeholder/Placeholder.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { ScreenTitle } from '../../components/ScreenTitle';

/** Stands in for a screen that a later plan builds. */
export function Placeholder({ titleKey, step }: { titleKey: string; step: number }) {
  const { t } = useTranslation();
  return (
    <>
      <ScreenTitle title={t(titleKey)} />
      <EmptyState title={t('placeholder.title')} body={t('placeholder.body', { step })} />
    </>
  );
}
```

`src/features/settings/SettingsScreen.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TRIGGERS } from '../../api/contract/entities';
import { PreviewAs } from '../../app/PreviewAs';
import { useAction, useCall } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ScreenTitle } from '../../components/ScreenTitle';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Switch } from '../../components/Switch';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="surface flex flex-col gap-3 rounded-card p-5">
      <h2 className="text-headline">{title}</h2>
      {children}
    </section>
  );
}

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-footnote text-label-2">{label}</span>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-control bg-fill px-3 text-body text-label" />
    </label>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useCall('session.get', {});
  const preferences = useAction('me.updatePreferences');
  const profile = useAction('me.updateProfile', { onSuccess: () => toast.show({ message: t('settings.saved') }) });
  const trigger = useAction('notifications.updateSettings');
  const simulate = useAction('session.setSimulateErrors');
  const reset = useAction('session.resetSampleData', { onSuccess: () => toast.show({ message: t('settings.resetDone') }) });
  const user = session.data?.user;
  const [name, setName] = useState('');
  const [discipline, setDiscipline] = useState('');

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setDiscipline(user.discipline);
  }, [user?.id, user?.name, user?.discipline]);

  if (!session.data || !user) return <ScreenTitle title={t('screens.settings')} />;
  const prefs = user.preferences;

  return (
    <div className="flex flex-col gap-6">
      <ScreenTitle title={t('screens.settings')} />

      <Section title={t('settings.profile')}>
        <div className="flex items-center gap-4">
          <Avatar user={user} size={56} />
          <span className="min-w-0 truncate text-footnote text-label-2">{user.email}</span>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            profile.mutate({ name, discipline });
          }}
        >
          <Field id="profile-name" label={t('settings.name')} value={name} onChange={setName} />
          <Field id="profile-discipline" label={t('settings.discipline')} value={discipline} onChange={setDiscipline} />
          <Button type="submit" variant="primary">{t('settings.save')}</Button>
        </form>
      </Section>

      <Section title={t('settings.language')}>
        <SegmentedControl
          label={t('settings.language')}
          value={prefs.language}
          options={(['en', 'ar'] as const).map((value) => ({ value, label: t(`settings.languages.${value}`) }))}
          onChange={(language) => preferences.mutate({ language })}
        />
      </Section>

      <Section title={t('settings.theme')}>
        <SegmentedControl
          label={t('settings.theme')}
          value={prefs.theme}
          options={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: t(`settings.themes.${value}`) }))}
          onChange={(theme) => preferences.mutate({ theme })}
        />
      </Section>

      <Section title={t('settings.glass')}>
        <SegmentedControl
          label={t('settings.glass')}
          value={prefs.glass}
          options={(['clear', 'frosted', 'solid'] as const).map((value) => ({ value, label: t(`settings.glassLevels.${value}`) }))}
          onChange={(glass) => preferences.mutate({ glass })}
        />
      </Section>

      <Section title={t('settings.notifications')}>
        {TRIGGERS.map((name) => (
          <Switch
            key={name}
            id={`trigger-${name}`}
            label={t(`settings.triggers.${name}`)}
            checked={prefs.notifications[name]}
            onChange={(on) => trigger.mutate({ trigger: name, on })}
          />
        ))}
      </Section>

      <Section title={t('settings.prototype')}>
        <PreviewAs id="preview-as-settings" />
        <Switch
          id="simulate-errors"
          label={t('settings.simulateErrors')}
          description={t('settings.simulateErrorsHint')}
          checked={session.data.simulateErrors}
          onChange={(on) => simulate.mutate({ on })}
        />
        <div>
          <Button onClick={() => reset.mutate({})}>{t('settings.reset')}</Button>
        </div>
      </Section>
    </div>
  );
}
```

`src/app/routes.tsx`:

```tsx
import { createHashRouter } from 'react-router';
import { AppShell } from './AppShell';
import { Placeholder } from '../features/placeholder/Placeholder';
import { SettingsScreen } from '../features/settings/SettingsScreen';

/** Hash links, so the build runs on any static host, the review link included. */
export function createAppRouter() {
  return createHashRouter([
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <Placeholder titleKey="screens.projects" step={2} /> },
        { path: 'projects/:projectId', element: <Placeholder titleKey="screens.project" step={2} /> },
        { path: 'work', element: <Placeholder titleKey="screens.myWork" step={3} /> },
        { path: 'dashboard', element: <Placeholder titleKey="screens.dashboard" step={4} /> },
        { path: 'inbox', element: <Placeholder titleKey="screens.inbox" step={3} /> },
        { path: 'search', element: <Placeholder titleKey="screens.search" step={3} /> },
        { path: 'tasks', element: <Placeholder titleKey="screens.tasks" step={4} /> },
        { path: 'settings', element: <SettingsScreen /> },
      ],
    },
  ]);
}
```

Replace `src/main.tsx` with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './design/tokens.css';
import { AppearanceSync } from './app/AppearanceSync';
import { bootstrap, startScheduler } from './app/bootstrap';
import { createAppRouter } from './app/routes';
import { RuntimeProvider, createQueryClient } from './app/runtime';
import { ToastProvider } from './app/toasts';
import { initI18n } from './i18n';

async function main(): Promise<void> {
  const runtime = await bootstrap();
  const user = runtime.store.state.users[runtime.store.state.session.currentUserId];
  initI18n(user?.preferences.language ?? 'en');
  startScheduler(runtime.store);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AppearanceSync />
            <RouterProvider router={createAppRouter()} />
          </ToastProvider>
        </MotionConfig>
      </RuntimeProvider>
    </StrictMode>,
  );
}

void main();
```

- [ ] **Step 5: Run the tests and the checks**

Run: `npx vitest run src/app/AppShell.test.tsx src/features/settings`
Expected: PASS (11 tests).

Run: `npm test`
Expected: every test file passes.

Run: `npm run build`
Expected: `RTL check passed.`, no type errors, then `✓ built in ...`. A chunk-size warning is acceptable in this plan.

- [ ] **Step 6: Commit**

```bash
git add src index.html
git commit -m "feat: add the app shell, navigation and Settings screen" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
```

---

### Task 22: Verify, browser sweep and review link

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/shell.spec.ts`
- Modify: `package.json` (dev dependencies `@playwright/test` 1.63.0 and `@axe-core/playwright` 4.13.0), `TASKS.md`

**Interfaces:**
- Consumes: the built app from Tasks 1 to 21.
- Produces: a green Playwright sweep with screenshots in `test-results/shell/`, a private review link (Claude artifact), and the git tag `plan-1-done`.

⚠️ Run Playwright only through a subagent (the owner's rule: its output floods the main session). Run the Chrome check in the main session.

- [ ] **Step 1: Run the full check locally**

Run: `npm test && npm run build`
Expected: every test passes, `RTL check passed.`, no type errors, `✓ built`.

- [ ] **Step 2: Check the build in Chrome (main session)**

Serve the build: `python3 -m http.server 8787 --bind 127.0.0.1 --directory dist` (run in the background, with the sandbox off: binding a port needs it).

Load the Chrome tools in one ToolSearch call: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_console_messages`. Then:

1. `tabs_context_mcp`, then `tabs_create_mcp`.
2. `navigate` to `http://127.0.0.1:8787/?v=1#/`. Take a screenshot.
3. Pass criteria: the glass sidebar shows Projects, My Work, Dashboard and Inbox, with a red Inbox badge; the "Projects" title and the placeholder card show; the storage banner does NOT show (Chrome has IndexedDB).
4. `read_console_messages` with the pattern `error|Error`. Expected: none.
5. Click the "العربية" button in the sidebar. Take a screenshot. Pass: the sidebar moves to the right side, the text is Arabic, the digits stay Western.
6. Open Settings. Choose Theme "داكن" (Dark). Take a screenshot. Pass: dark surfaces, readable text, the toolbar is frosted glass.
7. Reload with `?v=2`. Pass: the language and the theme stay (saved in IndexedDB).
8. Choose English and Light again before you leave.

Fix any failure, rebuild, and repeat with the next `?v=N`.

- [ ] **Step 3: Add the Playwright files**

Run: `npm install --save-dev --save-exact @playwright/test@1.63.0 @axe-core/playwright@4.13.0`

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  timeout: 120_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
```

`tests/e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/', '/work', '/dashboard', '/inbox', '/search', '/settings'];
const WIDTHS = [390, 820, 1440];

for (const width of WIDTHS) {
  for (const lang of ['en', 'ar'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`shell at ${width}px, ${lang}, ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/#/settings');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (lang === 'ar') {
          await page.getByRole('radio', { name: 'العربية' }).click();
          await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const route of ROUTES) {
          await page.goto(`/#${route}`);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          const name = route === '/' ? 'projects' : route.slice(1);
          await page.screenshot({ path: `test-results/shell/${width}-${lang}-${theme}-${name}.png`, fullPage: true });
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        }
      });
    }
  }
}

test('keyboard users reach the main navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.textContent?.includes('My Work') ?? false);
  }
  expect(reached).toBe(true);
});

test('reduce motion removes the press animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const duration = await page.locator('.pressable').first().evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toBe('0s');
});
```

- [ ] **Step 4: Run the sweep through a subagent**

Dispatch one subagent (Agent tool, general-purpose) with this prompt:

> In `/Users/osamakhalil/dev/madar`, run `npx playwright install chromium` and then `npx playwright test --reporter=line`. Binding the preview port needs the sandbox off. Report back, in plain sentences: how many tests passed and failed; for each failure, the test name and the first 10 lines of its error; the full list of axe violation lines, if any; and the path of the screenshot folder. Do not change any source file. Do not paste screenshots or full logs.

Fix every failure in the main session, then dispatch the same subagent prompt again. Stop when the sweep is green (14 tests: 12 layout, language and theme runs, plus the keyboard and reduce-motion checks).

- [ ] **Step 5: Publish the review link**

1. Load the `artifact-design` skill (the Artifact tool requires it before a publish). The app already meets the page contract: it has a `<title>`, its own light and dark tokens, and a body background.
2. Run `npm run build`, then list the files: `ls dist/assets`.
3. Publish with the Artifact tool: `file_path` = `dist/index.html`, `files` = one entry per file in `dist/assets` (key `assets/<name>`, value `dist/assets/<name>`), `icon` = `folder`, `description` = "Madar build step 1: the app shell, Settings and the sample office, in English and Arabic."
4. Open the link on a phone. Pass: the tab bar shows, the app loads, and the storage banner shows only if the phone blocks storage in the artifact frame.
5. Update the build room page (`https://claude.ai/artifact/EYvx8XpAq2SLEnJK4qWyNp`): stage 4 "In progress", with the new link in the status text.

- [ ] **Step 6: Commit and tag**

Tick every line in `TASKS.md`.

```bash
git add -A
git commit -m "test: add the browser sweep for the app shell" -m "Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY"
git tag plan-1-done
```

Then tell the owner, in plain words: the review link, what to try (language switch, dark mode, Preview as, Reset sample data), the three items that need them (Arabic text review, the Windows PC check, the name check), and that plan 2 (the Projects screens) comes next.
