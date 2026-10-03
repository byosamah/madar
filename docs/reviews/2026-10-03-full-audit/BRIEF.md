# Madar full-product audit: shared brief

You are one of six auditors. Read this whole brief first. It is your requirements.

## What Madar is

Madar (مدار) is a project-management prototype for a small architecture and engineering office in Al Khobar, Saudi Arabia (roughly 5 to 20 people). Repo: `~/dev/madar` (branch `main`). Stack: React 19, TypeScript, Vite 8, Tailwind 4 (`@theme inline` tokens in `src/design/tokens.css`), TanStack Query 5, i18next (English and Arabic with full right-to-left), zod 4, Vitest + jsdom. There is no real server: `src/api` is a fake API (`api.call(name, input)`, zod contracts, one permission function, one event log). Its calls are the contract a later Python build will copy, so a rule the fake API breaks is a real bug. Screens must change data only through the API.

Roles: Admin (system), Member, Management, Accounting. Per project: a Project Leader and a team. Anyone can create a project. Everyone sees all projects; people edit only their own projects. Payments are visible only to Admin, Management and Accounting.

Specs (the authority; read the parts for your area): `docs/superpowers/specs/2026-09-30-madar-prototype-design.md` and `docs/superpowers/specs/2026-10-01-madar-calm-redesign-design.md`. Owner decisions after the specs: `docs/reviews/2026-10-01-colleague-comments.md`, `docs/superpowers/plans/2026-10-02-madar-meeting-view.md` and its `-ledger.md`. Where code comments say "owner, <date>", that is an owner decision: do not report it as a bug unless the code fails to do what the comment says.

## The owner's standing rule: the ADHD view

Some team members have ADHD. Judge every screen from their view: one obvious next step, the fewest controls in view, one place for each thing (no duplicate counters, lists or buttons), rare actions tucked away, no flashing or sound, clear state words ("Paused", "Discussed", "Late"), color that means one thing, and nothing that resets or loses work by accident.

## What to look for

1. **Bugs**: wrong data, wrong permissions (a person can do or see what they must not, or cannot do what they must), crashes, stale screens after a change, broken undo, lost input, wrong dates (office time zone Asia/Riyadh, week Sun to Thu, Fri and Sat off), wrong counts, Arabic or RTL faults (mirrored arrows, wrong plural forms, English words in Arabic screens, a person's gender in Arabic verbs), keyboard and screen-reader faults, layout that breaks at phone width (390 px) or in Big screen.
2. **Gaps**: something the spec or an owner decision promises that is missing or half-built; a flow with a dead end (no way back, no way to undo, no empty state, no error state); an action with no feedback; data a person can create but never edit or find again.
3. **ADHD problems**: see the rule above.

Do NOT report: style opinions with no user cost, code-style nits, missing tests on their own, things the owner decided on purpose, or the absence of a real server or real login.

## How to work

- You are READ-ONLY on the repo. Do not edit, create or delete any file in `~/dev/madar`. Do not commit. You may run `npx vitest run <path>` and `npx tsc -p tsconfig.json --noEmit` from `~/dev/madar`. Write scratch files only under `/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/`.
- Do not spawn subagents.
- **Verify every finding before you write it.** Read the code path end to end. Where you can, prove it: name the exact input and the exact wrong result. A finding you could not confirm goes in a separate "Unconfirmed" list at the end, or not at all. Precision beats volume: ten real findings are worth more than forty guesses.
- Quote file paths as `src/...:line`.

## Report format

Write your report to `/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/<your-area>.md` with this shape:

```
# <Area> audit

## Findings
### <ID> <short title>
- Type: BUG | GAP | ADHD
- Severity: HIGH (data loss, wrong permission, crash, blank screen, a core flow blocked) | MEDIUM (wrong result a person will notice, a missing promised feature) | LOW (rough edge)
- Where: src/...:line
- What happens: <concrete input or steps> -> <wrong result>. <What should happen, and the spec line or owner decision if any.>
- Fix idea: <one or two sentences>

## Unconfirmed
- ...
```

Use IDs with your area prefix (for example API-1, PRJ-3). Sort by severity. Then reply to the controller with only: the report path, the count of findings by severity, and the three most serious titles. Keep the reply under 120 words.
