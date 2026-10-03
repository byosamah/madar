# Madar audit fixes: shared brief for fixers

Read this whole brief first. It is your requirements.

## Context

Madar is a project-management prototype for a small architecture office in Al Khobar (React 19, TypeScript, Vite 8, Tailwind 4, TanStack Query 5, i18next English + Arabic RTL, zod 4, Vitest + jsdom). A fake API in `src/api` is the contract a later Python build copies; screens change data only through it. Six auditors reviewed the product. Their reports are in `/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/` (`api.md`, `project.md`, `shell.md`, `dashboard.md`, `personal.md`, and the audit brief `BRIEF.md`, which explains the owner's ADHD rule). Each finding has steps, file lines and a fix idea. Read the findings you own in full before you start.

The owner's standing rule: some team members have ADHD. One obvious next step, the fewest controls, one place for each thing, rare actions tucked away, clear state words, color that means one thing, nothing that loses work by accident. Code comments marked "owner, <date>" are owner decisions: keep them.

## Your workspace

You work ONLY in your own git worktree (path in your task). It already has `node_modules` (a link). Never touch `~/dev/madar` or another worktree. Run commands from your worktree: `npx vitest run <paths>`, `npx tsc -p tsconfig.json --noEmit`, `node scripts/check-rtl.ts`. Do not spawn subagents. Do not push. Commit on your branch.

Other fixers work in parallel on other areas and will be merged with yours. To keep merges clean: change only what a finding needs, keep hunks small and local, do not reformat or reorder code you do not change, and do not rename shared functions. When you add i18n keys, add them next to related keys in the same section of BOTH `src/i18n/en.json` and `src/i18n/ar.json`, keep the files' 2-space JSON format with a trailing newline, and give Arabic plural forms (`_zero/_one/_two/_few/_many/_other`) for any key used with a count, and a `_female` form for any verb that follows a person's name (pass `context: actorContext(person)` from `src/lib/grammar.ts`).

## How to fix

For each finding:
1. Confirm it in the code. If it is not real, mark it "Not a bug" with one sentence of proof.
2. Write a failing test first (Vitest; screens through `renderApp` in `src/test/render.tsx`, API through `testApi` in `src/test/factories.ts`). Run it and see it fail for the right reason.
3. Make the smallest correct fix. Run the test and see it pass.
4. Add a short code comment where the reason is not obvious, in the house style: "(audit 2026-10-03, <ID>)".

Commit in small groups (one commit per finding or per few related findings). Commit messages in plain English, no em-dashes, ending with this exact line and nothing after it:

Claude-Session: https://claude.ai/code/session_01HKRYb2gf7uWMex3HNtzkuY

Do NOT add a Co-Authored-By line.

Writing rules for every text you write (code comments, commit messages, UI words, your report): Simplified Technical English (active voice, short sentences, one word for one meaning). Never use the em-dash character. UI words must be calm and clear; give every new English UI string a natural Arabic translation in Modern Standard Arabic.

If a fix needs a product decision the brief does not settle, do not guess: skip it and write the question in your report. If a fix turns out much larger than the finding suggests, do the safe part and report the rest.

## Finish

Before you report: run the FULL suite (`npx vitest run`) and `npx tsc -p tsconfig.json --noEmit` and `node scripts/check-rtl.ts` in your worktree; all must pass. If a test outside your area fails, check if your change caused it; fix it if so, report it if not.

Write your report to `/private/tmp/claude-501/-Users-osamakhalil/5721f5d8-5441-480d-b8e1-5ea30aba78f8/scratchpad/audit/fixed-<area>.md`: one line per finding ID: `ID | Fixed / Not a bug / Skipped | commit | one sentence (what changed, or why skipped)`. Then a "Questions for the owner" list, then a "Screens that changed" list (route and what to look at), so the controller can take screenshots. Reply to the controller with only: the report path, counts (fixed / not a bug / skipped), the final test count, and your branch's last commit. Under 80 words.
