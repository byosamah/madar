import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Locator, Page, Request } from '@playwright/test';
import { DEPLOY_ACCOUNTS } from './accounts';
import { expect, passwordOf, PERSON_AR_OF, PERSON_OF, test } from './fixtures';
import { goto, settle, urlPattern } from './goto';
import { withClient } from './mail';
import { closeTo, shownColors, WALK_PICTURE } from './picture';
import { batchAs, NO_SESSION, openMenu, runId, type Lang } from './steps';
import { word } from './words';

/**
 * The whole-product walk between waves (TASKS.md, "Walk spec"; the check after wave 4). Three people (Admin, Management, Member)
 * walk from sign-in to sign-out, each in a browser of their own, in four variants: English and Arabic at 1440 and 390 px. After
 * each step the walk reads the database to check what the step wrote. A failed step is recorded and the walk goes on, so one
 * run names every broken step; the test fails at the end when any step failed.
 *
 *   MADAR_E2E_WALK=1 npx playwright test -c playwright.deploy.config.ts walk.spec.ts
 *
 * - It runs only with MADAR_E2E_WALK=1, on a fresh seed of the local stack (tests/e2e-deploy/local.ts) or of madar-test. It
 *   reads the database through mail.ts (databaseTarget: madar-test or the local stack only).
 * - It types the passwords of the office accounts, so it keeps no trace.
 * - The picture that it uploads is made at run time (picture.ts), and the preview check reads the shown pixels back.
 * - It changes the language of the three people on the server; the end of the file puts English back.
 * - Screenshots go to MADAR_E2E_WALK_SHOTS (default test-results/e2e-deploy-shots/walk), with a results file for each variant.
 */

test.use({ trace: 'off' });

const WALK = process.env.MADAR_E2E_WALK === '1';
const SHOTS = process.env.MADAR_E2E_WALK_SHOTS ?? 'test-results/e2e-deploy-shots/walk';

type Role = 'admin' | 'management' | 'member';
const ROLES: Role[] = ['admin', 'management', 'member'];
const VARIANTS: { lang: Lang; width: number }[] = [
  { lang: 'en', width: 1440 },
  { lang: 'ar', width: 1440 },
  { lang: 'en', width: 390 },
  { lang: 'ar', width: 390 },
];
const LANGUAGE_LABEL = { en: 'English', ar: 'العربية' } as const;

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return withClient(async (client) => (await client.query(sql, params)).rows as T[]);
}

/** Waits until the query gives a row: the screen answers before a signal or an effect lands. */
async function waitRow<T = Record<string, unknown>>(label: string, sql: string, params: unknown[] = [], ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rows = await q<T>(sql, params);
    if (rows.length > 0) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`DB: no row for ${label}`);
}

type Result = { step: string; role: string; ok: boolean; note: string };

/** Signs in a fresh browser of one person and puts the language back to English (the end of the walk). */
async function restoreEnglish(browser: Browser, baseURL: string, role: Role): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: NO_SESSION });
  try {
    const page = await context.newPage();
    await goto(page, '/sign-in');
    await page.locator('#sign-in-email').fill(DEPLOY_ACCOUNTS[role].email);
    await page.locator('#sign-in-password').fill(passwordOf(role));
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    await goto(page, '/settings');
    const english = page.getByRole('radio', { name: LANGUAGE_LABEL.en });
    if ((await english.getAttribute('aria-checked')) !== 'true') await english.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  } finally {
    await context.close();
  }
}

test.afterAll(async ({ browser }, info) => {
  if (!WALK) return;
  for (const role of ROLES) await restoreEnglish(browser, info.project.use.baseURL!, role);
});

for (const { lang, width } of VARIANTS) {
  const narrow = width < 800;
  const suffix = `${lang}-${width}`;

  test(`walk ${suffix}: Admin, Management and Member from sign-in to sign-out`, async ({ browser, baseURL }) => {
    test.skip(!WALK, 'The walk runs only with MADAR_E2E_WALK=1, on a fresh seed.');
    test.setTimeout(900_000);
    mkdirSync(SHOTS, { recursive: true });
    const w = (key: string, values: Record<string, string> = {}): string => {
      try {
        return word(lang, key, values);
      } catch (error) {
        if (key.endsWith('_female')) return word(lang, key.replace(/_female$/, ''), values);
        throw error;
      }
    };
    const results: Result[] = [];
    const pages = {} as Record<Role, Page>;
    const csp: string[] = [];
    const pageErrors: string[] = [];
    const run = runId();
    const ctx: Record<string, string> = {};
    // The screens show the name of a person in the screen language (owner item 12).
    const nameOf = (role: Role): string => (lang === 'ar' ? PERSON_AR_OF : PERSON_OF)[role];

    async function shot(name: string, role: Role): Promise<void> {
      await pages[role].waitForTimeout(600);
      await pages[role].screenshot({ path: join(SHOTS, `walk-${name}-${role}-${suffix}.png`) }).catch(() => undefined);
    }

    async function step(name: string, role: Role | 'all', work: () => Promise<string | void>): Promise<void> {
      try {
        const note = await work();
        results.push({ step: name, role, ok: true, note: note ?? '' });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 4).join(' | ');
        results.push({ step: name, role, ok: false, note: message });
        if (role !== 'all') await pages[role].screenshot({ path: join(SHOTS, `walk-${name}-${role}-${suffix}-FAILED.png`) }).catch(() => undefined);
      }
    }

    async function newPage(role: Role): Promise<Page> {
      const context = await browser.newContext({
        baseURL, storageState: NO_SESSION, viewport: { width, height: narrow ? 844 : 900 }, acceptDownloads: true,
      });
      await context.addInitScript((value) => {
        try { window.localStorage.setItem('madar.lang', value); } catch { /* blocked storage */ }
        document.addEventListener('securitypolicyviolation', (event) => {
          (window as unknown as { __walkCsp?: (line: string) => void }).__walkCsp?.(`${event.effectiveDirective} ${event.blockedURI}`);
        });
      }, lang);
      await context.exposeBinding('__walkCsp', (_source, line: string) => { csp.push(`${role}: ${line}`); });
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(`${role}: ${error.message}`));
      return page;
    }

    async function useLang(page: Page): Promise<void> {
      await goto(page, '/settings');
      await page.getByRole('radio', { name: LANGUAGE_LABEL[lang] }).click();
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    }

    async function openTask(page: Page, title: string): Promise<string> {
      const row = await waitRow<{ id: string; project_id: string }>(`task ${title}`, "select id, project_id from tasks where doc->>'title' = $1", [title]);
      await goto(page, `/projects/${row.project_id}?tab=tasks&task=${row.id}`);
      await expect(page.getByRole('dialog')).toBeVisible();
      return row.id;
    }

    for (const role of ROLES) pages[role] = await newPage(role);
    const started = new Date();

    // 1. Sign in with a password.
    for (const role of ROLES) {
      await step('signin', role, async () => {
        const page = pages[role];
        await goto(page, '/sign-in');
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await page.locator('#sign-in-email').fill(DEPLOY_ACCOUNTS[role].email);
        await page.locator('#sign-in-password').fill(passwordOf(role));
        await shot('signin', role);
        await page.locator('form button[type="submit"]').click();
        await expect(page).not.toHaveURL(/\/sign-in/);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const row = await waitRow<{ at: Date }>('last sign-in', 'select last_sign_in_at as at from auth.users where lower(email) = lower($1) and last_sign_in_at >= $2', [DEPLOY_ACCOUNTS[role].email, started]);
        await useLang(page);
        return `auth.users.last_sign_in_at ${row.at.toISOString()}`;
      });
    }

    // 2. Home, in the language of the person on the server.
    for (const role of ROLES) {
      await step('home', role, async () => {
        const page = pages[role];
        await goto(page, '/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await shot('home', role);
        const [pref] = await q<{ lang: string }>("select doc->'preferences'->>'language' as lang from users where id = $1", [DEPLOY_ACCOUNTS[role].userId]);
        if (pref?.lang !== lang) throw new Error(`DB: users.doc.preferences.language is ${pref?.lang}, not ${lang}`);
        return `preferences.language=${pref.lang}`;
      });
    }

    // 3. The Admin creates a project; Management sees it.
    const projectName = `Walk ${suffix} ${run}`;
    await step('project', 'admin', async () => {
      const page = pages.admin;
      await goto(page, '/projects');
      await page.getByRole('button', { name: w('projects.new') }).click();
      const sheet = page.getByRole('dialog', { name: w('projectForm.createTitle') });
      await sheet.getByLabel(w('projectForm.name'), { exact: true }).fill(projectName);
      // A new project needs its code parts (owner, 2026-10-05, item 6b).
      await sheet.getByLabel(w('projectCode.initials')).fill('WLK');
      await sheet.getByLabel(w('projectCode.classification')).selectOption('RES');
      await sheet.getByLabel(w('projectCode.type')).fill('Villa');
      await shot('project', 'admin');
      await sheet.getByRole('button', { name: w('projectForm.create') }).click();
      await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
      const row = await waitRow<{ id: string; leader_id: string; code: string }>('project', "select id, leader_id, doc->>'code' as code from projects where doc->>'name' = $1", [projectName]);
      ctx.projectId = row.id;
      if (row.leader_id !== DEPLOY_ACCOUNTS.admin.userId) throw new Error(`DB: leader_id ${row.leader_id}`);
      if (!/^\d{6}WLK-RES-Villa$/.test(row.code)) throw new Error(`DB: code ${row.code}`);
      return `projects.id=${row.id} leader=${row.leader_id} code=${row.code}`;
    });
    await step('project', 'management', async () => {
      const page = pages.management;
      await goto(page, '/projects');
      await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 20_000 });
      await shot('project', 'management');
      return 'Management sees the new project in Projects';
    });

    // 4. The Admin creates two tasks for the Member, with Needs review on.
    const taskA = `Walk task A ${run} ${suffix}`;
    const taskB = `Walk task B ${run} ${suffix}`;
    const member = DEPLOY_ACCOUNTS.member.userId;
    await step('task', 'admin', async () => {
      const page = pages.admin;
      for (const title of [taskA, taskB]) {
        await goto(page, `/projects/${ctx.projectId}?tab=tasks`);
        const add = page.getByRole('textbox', { name: new RegExp(`^${w('tasks.addTaskIn', { stage: 'X' }).replace('X', '').trim()}`) }).first();
        await add.fill(title);
        await add.press('Enter');
        const taskId = await openTask(page, title);
        await page.locator('#task-owner').selectOption(member);
        const review = page.locator('#task-review');
        await expect(review).toBeVisible();
        if ((await review.getAttribute('aria-checked')) !== 'true') await review.click();
        await expect(review).toHaveAttribute('aria-checked', 'true');
        await waitRow('task owner', "select 1 from tasks where id = $1 and owner_id = $2 and (doc->>'needsReview')::boolean", [taskId, member]);
        ctx[title] = taskId;
      }
      await shot('task', 'admin');
      const notice = await waitRow<{ id: string }>('assigned notice', "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_assigned'", [member, ctx[taskA]]);
      return `tasks ${ctx[taskA]}, ${ctx[taskB]} owner ${member} needsReview; notice ${notice.id}`;
    });
    await step('task', 'member', async () => {
      const page = pages.member;
      await goto(page, '/notifications');
      await expect(page.getByText(taskA).first()).toBeVisible();
      await shot('task', 'member');
    });

    // 5. The Member sends both tasks to review.
    await step('review', 'member', async () => {
      const page = pages.member;
      for (const title of [taskA, taskB]) {
        const id = await openTask(page, title);
        await page.locator('#task-status').selectOption('in_review');
        await waitRow('in review', "select 1 from tasks where id = $1 and status = 'in_review'", [id]);
      }
      await shot('review', 'member');
      return 'both tasks status=in_review';
    });

    // The Member keeps Notifications open: the approve, send back and mention notices must arrive without a reload (Realtime).
    await goto(pages.member, '/notifications');
    await expect(pages.member.getByRole('heading', { level: 1 })).toBeVisible().catch(() => undefined);

    // 6. The Admin approves task A.
    await step('approve', 'admin', async () => {
      const page = pages.admin;
      await openTask(page, taskA);
      const block = page.getByRole('region', { name: w('taskSheet.review') });
      await shot('approve', 'admin');
      await block.getByRole('button', { name: w('taskSheet.approve'), exact: true }).click();
      await expect(page.getByText(w('taskSheet.approved')).first()).toBeVisible();
      await waitRow('done', "select 1 from tasks where id = $1 and status = 'done'", [ctx[taskA]]);
      const notice = await waitRow<{ id: string }>('approved notice', "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'task_approved'", [member, ctx[taskA]]);
      return `status=done; notice ${notice.id}`;
    });
    await step('approve', 'member', async () => {
      const page = pages.member;
      await expect(page).toHaveURL(urlPattern('/notifications'));
      await expect(page.getByText(w('inbox.trigger.task_approved_female', { actor: nameOf('admin'), target: taskA })).first()).toBeVisible({ timeout: 20_000 });
      await shot('approve', 'member');
      return 'the notice arrived without a reload';
    });

    // 7. The Admin sends task B back with a note.
    const note = `Please add the fire exits ${run}`;
    await step('sendback', 'admin', async () => {
      const page = pages.admin;
      await openTask(page, taskB);
      const block = page.getByRole('region', { name: w('taskSheet.review') });
      await block.locator('#task-note').fill(note);
      await block.getByRole('button', { name: w('taskSheet.sendBack'), exact: true }).click();
      await expect(page.getByText(w('taskSheet.sentBack')).first()).toBeVisible();
      const row = await waitRow<{ status: string }>('sent back', "select status from tasks where id = $1 and status <> 'in_review'", [ctx[taskB]]);
      const comment = await waitRow<{ id: string }>('note comment', 'select id from comments where target_id = $1 and doc::text like $2', [ctx[taskB], `%${run}%`]);
      await shot('sendback', 'admin');
      return `status=${row.status}; note comment ${comment.id}`;
    });
    await step('sendback', 'member', async () => {
      const page = pages.member;
      const notice = await waitRow<{ trig: string }>('sent back notice', "select doc->>'trigger' as trig from notifications where user_id = $1 and target_id = $2 order by ord desc limit 1", [member, ctx[taskB]]);
      await expect(page.getByText(taskB).first()).toBeVisible({ timeout: 20_000 });
      await shot('sendback', 'member');
      return `newest notice on task B: ${notice.trig}`;
    });

    // 8. The Admin posts an update with an @mention of the Member; the Member sees the notice arrive.
    const updateText = `Site visit notes ${run}`;
    await step('mention', 'admin', async () => {
      const page = pages.admin;
      await goto(page, `/projects/${ctx.projectId}`);
      await page.getByRole('button', { name: w('projects.postUpdate'), exact: true }).first().click();
      const [{ n: before }] = await q<{ n: string }>("select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention'", [member]);
      const field = page.locator('#composer');
      await field.fill(`${updateText} `);
      await field.pressSequentially('@Fai');
      const list = page.getByRole('listbox', { name: w('overview.mentionList') });
      await expect(list.getByRole('option', { name: nameOf('member') })).toBeVisible();
      await field.press('Enter');
      await field.pressSequentially(' please check.');
      await shot('mention', 'admin');
      await page.getByRole('form', { name: w('overview.composer') }).getByRole('button', { name: w('overview.post'), exact: true }).click();
      await expect(page.getByText(w('overview.posted')).first()).toBeVisible();
      const update = await waitRow<{ id: string; body: string }>('update', "select id, doc->>'body' as body from updates where project_id = $1 and doc::text like $2", [ctx.projectId, `%${run}%`]);
      if (!update.body.endsWith(' please check.')) throw new Error(`DB: the update text came out as "${update.body}"`);
      const after = await waitRow<{ n: string }>('mention notice', "select count(*)::text as n from notifications where user_id = $1 and doc->>'trigger' = 'mention' having count(*) > $2", [member, Number(before)]);
      return `updates.id=${update.id}; mention notices ${before} -> ${after.n}`;
    });
    await step('mention', 'member', async () => {
      const page = pages.member;
      await expect(page).toHaveURL(urlPattern('/notifications'));
      await expect(page.getByText(w('inbox.trigger.mention_female', { actor: nameOf('admin'), target: projectName })).first()).toBeVisible({ timeout: 20_000 });
      await shot('mention', 'member');
      return 'the mention notice arrived without a reload';
    });

    // 9. A chat message from the Member to the Admin; the Admin sees it arrive.
    const chatText = `Chat from Faisal ${run}`;
    await goto(pages.admin, '/inbox');
    await step('chat', 'member', async () => {
      const page = pages.member;
      await goto(page, '/inbox');
      await page.getByRole('button', { name: w('chat.newMessage') }).click();
      const sheet = page.getByRole('dialog', { name: w('chat.pickPerson') });
      await sheet.getByRole('button', { name: new RegExp(nameOf('admin')) }).first().click();
      await page.getByRole('textbox', { name: w('chat.composer') }).fill(chatText);
      await page.getByRole('button', { name: w('chat.send'), exact: true }).click();
      await expect(page.getByRole('log').getByText(chatText)).toBeVisible();
      await shot('chat', 'member');
      const message = await waitRow<{ id: string; conversation_id: string }>('message', 'select id, conversation_id from messages where doc::text like $1', [`%${chatText}%`]);
      ctx.conversation = message.conversation_id;
      return `messages.id=${message.id} in ${message.conversation_id}`;
    });
    await step('chat', 'admin', async () => {
      const page = pages.admin;
      await expect(page.getByRole('list', { name: w('chat.list') }).getByText(chatText).first()).toBeVisible({ timeout: 20_000 });
      await shot('chat', 'admin');
      await goto(page, `/inbox/${ctx.conversation}`);
      await expect(page.getByRole('log').getByText(chatText)).toBeVisible();
      return 'the chat list showed the message without a reload';
    });

    // 10. The Admin uploads a picture and a PDF, sees the picture in the preview, and downloads the PDF.
    const fileBase = `walk-${run}-${suffix}`;
    await step('file', 'admin', async () => {
      const page = pages.admin;
      await goto(page, `/projects/${ctx.projectId}?tab=files`);
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
      await page.locator('input[type="file"]').first().setInputFiles([
        { name: `${fileBase}.png`, mimeType: 'image/png', buffer: WALK_PICTURE.png() },
        { name: `${fileBase}.pdf`, mimeType: 'application/pdf', buffer: pdf },
      ]);
      await expect(page.getByText(w('files.uploaded', { n: '2' })).first()).toBeVisible({ timeout: 30_000 });
      const rows = await q<{ id: string }>('select id from files where project_id = $1 and doc::text like $2', [ctx.projectId, `%${fileBase}%`]);
      if (rows.length !== 2) throw new Error(`DB: ${rows.length} files rows`);
      const objects = await q<{ n: string }>("select count(*)::text as n from storage.objects where bucket_id = 'madar-files' and created_at > now() - interval '3 minutes'");
      await shot('file', 'admin');
      // The toast sits over the bottom of the preview at 390 px; the pixel check waits until it goes.
      await expect(page.getByText(w('files.uploaded', { n: '2' }))).toHaveCount(0, { timeout: 15_000 });
      // The preview must show the picture's own pixels: a blank or broken picture shows the white panel behind it.
      await openMenu(page.getByRole('button', { name: w('files.actions', { name: `${fileBase}.png` }) }));
      await page.getByRole('menuitem', { name: w('files.preview') }).click();
      const picture = page.getByRole('dialog').last().getByRole('img', { name: `${fileBase}.png` });
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img: HTMLImageElement, width) => img.complete && img.naturalWidth === width, WALK_PICTURE.width), { timeout: 15_000 }).toBe(true);
      const shown = await shownColors(browser, picture, WALK_PICTURE.quarters);
      const wrong = WALK_PICTURE.quarters.filter((quarter, i) => !closeTo(quarter.rgb, shown[i]));
      if (wrong.length > 0) throw new Error(`the preview shows ${shown.map((c) => `rgb(${c.join(',')})`).join(' ')}, not the picture (${wrong.map((x) => x.name).join(', ')})`);
      await shot('file-preview', 'admin');
      await page.keyboard.press('Escape');
      // The download of the PDF: a download, a new tab, or at least a signed link.
      const signed: string[] = [];
      const watch = (request: Request) => { if (/storage\/v1\/object\/sign/.test(request.url())) signed.push(request.url()); };
      page.on('request', watch);
      const download = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      const popup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
      await openMenu(page.getByRole('button', { name: w('files.actions', { name: `${fileBase}.pdf` }) }));
      await page.getByRole('menuitem', { name: w('files.download') }).click();
      const [saved, tab] = await Promise.all([download, popup]);
      page.off('request', watch);
      let how: string;
      if (saved) {
        how = `download ${saved.suggestedFilename()} (${(await saved.path()) ? 'saved' : 'no file'})`;
      } else if (tab) {
        how = `new tab ${tab.url().slice(0, 60)}`;
        await tab.close();
      } else if (signed.length > 0) {
        how = 'a signed link';
      } else {
        throw new Error('the Download gave no download, no new tab and no signed link');
      }
      return `files rows 2; new storage objects ${objects[0].n}; preview pixels match the 4 quarters; ${how}`;
    });

    // 11. Requests and bugs (owner, 2026-10-07): the Member reports a bug with a screenshot. Each active Admin gets a notice that
    // opens Settings > Admin > Requests and bugs. The screenshot shows its own pixels there and in a bigger sheet. Mark done offers
    // Undo and gives the Member a notice with words only. Management gets no notice, and no mail goes out for either notice.
    const report = `Walk bug ${run} ${suffix}`;
    const shotName = w('feedback.screenshotN', { n: '1' });
    // A notice row keeps the excerpt in its own direction with FSI and PDI marks. The check reads the words without them.
    const plain = (text: string) => text.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
    const rowSays = (row: Locator, sentence: string) => expect.poll(async () => plain(await row.innerText()), { timeout: 10_000 }).toContain(plain(sentence));
    /** The picture must show its own pixels: a blank or broken picture shows the panel behind it. */
    async function expectPicture(picture: Locator, where: string): Promise<void> {
      await expect.poll(() => picture.evaluate((img: HTMLImageElement, width) => img.complete && img.naturalWidth === width, WALK_PICTURE.width), { timeout: 15_000 }).toBe(true);
      const shown = await shownColors(browser, picture, WALK_PICTURE.quarters);
      const wrong = WALK_PICTURE.quarters.filter((quarter, i) => !closeTo(quarter.rgb, shown[i]));
      if (wrong.length > 0) throw new Error(`the ${where} shows ${shown.map((c) => `rgb(${c.join(',')})`).join(' ')}, not the picture (${wrong.map((x) => x.name).join(', ')})`);
    }
    await step('report', 'member', async () => {
      const page = pages.member;
      await goto(page, '/');
      await page.getByRole('button', { name: nameOf('member'), exact: true }).click();
      await page.getByRole('dialog', { name: nameOf('member') }).getByRole('button', { name: w('feedback.menu') }).click();
      const sheet = page.getByRole('dialog', { name: w('feedback.title') });
      await sheet.getByRole('radio', { name: w('feedback.kinds.bug'), exact: true }).click();
      await sheet.locator('#feedback-message').fill(report);
      await sheet.locator('input[type="file"]').setInputFiles({ name: `${fileBase}-bug.png`, mimeType: 'image/png', buffer: WALK_PICTURE.png() });
      await expect(sheet.getByRole('img', { name: shotName, exact: true })).toBeVisible();
      await shot('report', 'member');
      await sheet.getByRole('button', { name: w('feedback.send'), exact: true }).click();
      await expect(page.getByText(w('feedback.sent')).first()).toBeVisible({ timeout: 30_000 });
      const row = await waitRow<{ id: string; kind: string; shots: number; by: string; status: string }>('report', "select id, doc->>'kind' as kind, jsonb_array_length(doc->'screenshots') as shots, doc->>'createdBy' as by, doc->>'status' as status from feedback where doc->>'message' = $1", [report]);
      ctx.reportId = row.id;
      if (row.kind !== 'bug' || row.shots !== 1 || row.by !== member || row.status !== 'new') throw new Error(`DB: feedback kind=${row.kind} screenshots=${row.shots} createdBy=${row.by} status=${row.status}`);
      // Each active Admin gets one notice, and nobody else (rule B1, B2).
      const admins = (await q<{ id: string }>("select id from users where kind = 'human' and active and doc->>'systemRole' = 'admin' and id <> $1 order by id", [member])).map((r) => r.id);
      const notices = await waitRow<{ ids: string[]; users: string[] }>('report notices', "select array_agg(id order by user_id) as ids, array_agg(user_id order by user_id) as users from notifications where target_id = $1 and doc->>'trigger' = 'feedback_sent' having count(*) >= $2", [row.id, admins.length]);
      if (notices.users.join(',') !== admins.join(',')) throw new Error(`DB: the report notices went to ${notices.users.join(', ')}, not to the active Admins ${admins.join(', ')}`);
      ctx.reportNotices = notices.ids.join(',');
      return `feedback.id=${row.id} kind=bug screenshots=1; feedback_sent notices to ${notices.users.join(', ')}`;
    });
    await step('report', 'admin', async () => {
      const page = pages.admin;
      await goto(page, '/notifications');
      const notice = page.locator('li').filter({ hasText: report });
      await expect(notice).toHaveCount(1, { timeout: 20_000 });
      await rowSays(notice, w('inbox.feedback.sentBug', { actor: nameOf('member'), target: report }));
      const link = notice.getByRole('link');
      await expect(link).toHaveAttribute('href', '/admin/feedback');
      await shot('report-notice', 'admin');
      await link.click();
      await expect(page).toHaveURL(urlPattern('/admin/feedback', { end: true }));
      // The new report is open and the newest, so it is the top row of the list.
      const item = page.locator('li').filter({ hasText: report });
      const thumb = item.getByRole('img', { name: shotName, exact: true });
      await expect(thumb).toBeVisible({ timeout: 20_000 });
      // A thumbnail loads only near the view (loading="lazy").
      await thumb.scrollIntoViewIfNeeded();
      await expectPicture(thumb, 'thumbnail');
      await shot('report-list', 'admin');
      await item.getByRole('button', { name: shotName, exact: true }).click();
      const sheet = page.getByRole('dialog', { name: shotName });
      await expect(sheet).toBeVisible();
      const full = sheet.getByRole('link', { name: w('feedback.openFull', { n: '1' }) });
      await expect(full).toHaveAttribute('target', '_blank');
      const big = full.locator('img');
      await settle(page);
      await expectPicture(big, 'bigger view');
      const href = (await full.getAttribute('href')) ?? '';
      if (!href || href !== (await big.getAttribute('src'))) throw new Error('the full-size link is not the link of the shown picture');
      await shot('report-sheet', 'admin');
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      // Mark done offers Undo for a few seconds (rule B20). The walk does not press it.
      await item.getByRole('button', { name: w('feedback.markDone'), exact: true }).click();
      await expect(page.getByText(w('feedback.markedDone')).first()).toBeVisible();
      await expect(page.locator('[data-toasts]').getByRole('button', { name: w('common.undo'), exact: true })).toBeVisible();
      await shot('report-done', 'admin');
      await waitRow('report done', "select 1 from feedback where id = $1 and doc->>'status' = 'done' and doc->>'doneBy' = $2", [ctx.reportId, DEPLOY_ACCOUNTS.admin.userId]);
      const done = await waitRow<{ id: string }>('done notice', "select id from notifications where user_id = $1 and target_id = $2 and doc->>'trigger' = 'feedback_done'", [member, ctx.reportId]);
      ctx.doneNotice = done.id;
      await waitRow('report notice read', 'select 1 from notifications where id = any($1) and user_id = $2 and read', [ctx.reportNotices.split(','), DEPLOY_ACCOUNTS.admin.userId]);
      return `notice link /admin/feedback, marked read; thumbnail and sheet pixels match the 4 quarters; full-size link on ${new URL(href).host}; status=done; done notice ${done.id}`;
    });
    await step('report-done', 'member', async () => {
      const page = pages.member;
      await goto(page, '/notifications');
      const notice = page.locator('li').filter({ hasText: report });
      await expect(notice).toHaveCount(1, { timeout: 20_000 });
      await rowSays(notice, w('inbox.feedback.doneBug', { target: report }));
      // Words only: no link and no Approve. The row itself is a button that only marks the notice read.
      await expect(notice.locator('a')).toHaveCount(0);
      await expect(notice.getByRole('button')).toHaveCount(1);
      await shot('report-done', 'member');
      await notice.getByRole('button').click();
      await waitRow('done notice read', 'select 1 from notifications where id = $1 and read', [ctx.doneNotice]);
      await expect(page).toHaveURL(urlPattern('/notifications', { end: true }));
      // No mail for either notice (rule B18): no mail.notice effect in the outbox, and no mail in mail_outbox.
      const ids = [...ctx.reportNotices.split(','), ctx.doneNotice];
      const [{ n: queued }] = await q<{ n: string }>("select count(*)::text as n from outbox where payload->>'notificationId' = any($1)", [ids]);
      const [{ n: mailed }] = await q<{ n: string }>('select count(*)::text as n from mail_outbox where idempotency_key = any($1)', [ids.map((id) => `notice-${id}`)]);
      if (queued !== '0' || mailed !== '0') throw new Error(`DB: ${queued} outbox rows and ${mailed} mails for the report notices`);
      return `the done row has the words, no link, no Approve; a press marked it read and opened nothing; outbox 0, mail_outbox 0`;
    });
    await step('report', 'management', async () => {
      const page = pages.management;
      const rows = await q('select id from notifications where user_id = $1 and target_id = $2', [DEPLOY_ACCOUNTS.management.userId, ctx.reportId]);
      if (rows.length > 0) throw new Error(`DB: Management has ${rows.length} notices of the report`);
      await goto(page, '/notifications');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settle(page);
      await expect(page.getByText(report)).toHaveCount(0);
      // Only an Admin sees the switch of the new-report notice. Everyone sees the switch of the done notice.
      await goto(page, '/settings');
      await expect(page.getByRole('switch', { name: w('notices.switchInApp', { trigger: w('settings.triggers.feedback_done') }), exact: true })).toBeVisible();
      await expect(page.getByRole('switch', { name: w('notices.switchInApp', { trigger: w('settings.triggers.feedback_sent') }), exact: true })).toHaveCount(0);
      return 'no notice of the report in the database or on the screen; no new-report switch';
    });

    // 12. Settings, Notifications: each person turns one in-app switch off and on again; the choice survives a reload.
    for (const role of ROLES) {
      await step('notices', role, async () => {
        const page = pages[role];
        await goto(page, '/settings');
        const tail = w('notices.switchInApp', { trigger: 'X' }).replace(/^.*X/, '');
        const first = page.locator(`[role="switch"][aria-checked="true"][aria-label$="${tail}"]`).first();
        await expect(first).toBeVisible();
        const label = (await first.getAttribute('aria-label'))!;
        const toggle = () => page.getByRole('switch', { name: label, exact: true });
        await toggle().click();
        await expect(toggle()).toHaveAttribute('aria-checked', 'false');
        await waitRow('preference off', "select 1 from users where id = $1 and (doc->'preferences'->'notifications')::text like '%false%'", [DEPLOY_ACCOUNTS[role].userId]);
        await page.reload();
        await expect(toggle()).toHaveAttribute('aria-checked', 'false');
        await shot('notices', role);
        await toggle().click();
        await expect(toggle()).toHaveAttribute('aria-checked', 'true');
        return `switch "${label}" saved off, then on`;
      });
    }

    // 13. The Admin invites a person; the mail lands in the outbox.
    const invited = { name: `Lina Walk ${suffix} ${run}`, nameAr: `لينا ${suffix} ${run}`, email: `walk-${suffix}-${run}@madar.test` };
    // Arabic screens show the Arabic name of a person (owner item 12).
    const invitedShown = lang === 'ar' ? invited.nameAr : invited.name;
    await step('invite', 'admin', async () => {
      const page = pages.admin;
      const [{ max }] = await q<{ max: string | null }>('select max(id)::text as max from mail_outbox');
      await goto(page, '/admin/people');
      await page.getByRole('button', { name: w('admin.addPerson') }).click();
      const sheet = page.getByRole('dialog', { name: w('admin.addPerson') });
      await sheet.locator('#person-name').fill(invited.name);
      await sheet.locator('#person-name-ar').fill(invited.nameAr);
      await sheet.locator('#person-email').fill(invited.email);
      await sheet.locator('#person-gender').selectOption('female');
      await sheet.locator('#person-language').selectOption(lang);
      await sheet.locator('#person-discipline').fill('Architect');
      await shot('invite', 'admin');
      await sheet.getByRole('button', { name: w('admin.save'), exact: true }).click();
      await expect(sheet).toHaveCount(0);
      const user = await waitRow<{ id: string; auth_user_id: string | null }>('invited user', 'select id, auth_user_id from users where lower(email) = lower($1)', [invited.email]);
      ctx.invitedId = user.id;
      const mail = await waitRow<{ id: string; tag: string }>('invite mail', 'select id::text, tag from mail_outbox where id > $1 and lower(to_email) = lower($2)', [Number(max ?? 0), invited.email]);
      return `users.id=${user.id} auth=${user.auth_user_id ? 'linked' : 'none'}; mail_outbox ${mail.id} tag=${mail.tag}`;
    });

    // 14. The Admin changes that person's email; Management sees it read-only, and the API refuses Management.
    const newEmail = `walk-new-${suffix}-${run}@madar.test`;
    await step('email', 'admin', async () => {
      const page = pages.admin;
      await goto(page, '/admin/people');
      await openMenu(page.getByRole('button', { name: w('admin.actions', { name: invitedShown }) }));
      await page.getByRole('menuitem', { name: w('admin.edit') }).click();
      const sheet = page.getByRole('dialog').last();
      await sheet.locator('#person-email').fill(newEmail);
      await shot('email', 'admin');
      await sheet.getByRole('button', { name: w('admin.save'), exact: true }).click();
      await expect(sheet).toHaveCount(0);
      await waitRow('users.email', 'select 1 from users where id = $1 and lower(email) = lower($2)', [ctx.invitedId, newEmail]);
      const auth = await q<{ email: string }>('select a.email from auth.users a join users u on u.auth_user_id = a.id where u.id = $1', [ctx.invitedId]);
      if (auth.length > 0 && auth[0].email.toLowerCase() !== newEmail.toLowerCase()) throw new Error(`DB: auth.users email is still ${auth[0].email}`);
      return `users.email is new; auth.users ${auth.length > 0 ? 'is new too' : 'has no row yet'}`;
    });
    await step('email', 'management', async () => {
      const page = pages.management;
      await goto(page, '/admin/people');
      await openMenu(page.getByRole('button', { name: w('admin.actions', { name: invitedShown }) }));
      await page.getByRole('menuitem', { name: w('admin.edit') }).click();
      const sheet = page.getByRole('dialog').last();
      await expect(sheet.locator('#person-email')).toHaveAttribute('readonly', '');
      await expect(sheet.getByText(w('admin.emailAdminOnly'))).toBeVisible();
      await shot('email', 'management');
      await page.keyboard.press('Escape');
      const [answer] = await batchAs(page, '/admin', [{ name: 'users.update', input: { id: ctx.invitedId, patch: { email: `walk-evil-${run}@madar.test` } } }]);
      if (answer.ok) throw new Error('the API let Management change the email');
      const [row] = await q<{ email: string }>('select email from users where id = $1', [ctx.invitedId]);
      if (row.email.toLowerCase() !== newEmail.toLowerCase()) throw new Error(`DB: the email changed to ${row.email}`);
      return `the field is read-only with the hint; the API answered ${answer.error?.code}; users.email unchanged`;
    });

    // 15. Admin, Usage: only the Admin sees it.
    for (const role of ROLES) {
      await step('usage', role, async () => {
        const page = pages[role];
        await goto(page, '/admin/usage');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const heading = page.getByRole('heading', { level: 2, name: w('usage.title'), exact: true });
        if (role === 'admin') {
          await expect(heading).toBeVisible();
          const section = page.locator('section').filter({ has: heading });
          await expect(section.locator('p, li').first()).toBeVisible();
          await heading.scrollIntoViewIfNeeded();
          await shot('usage', role);
          return 'the Usage section shows';
        }
        await page.waitForTimeout(1000);
        await expect(heading).toHaveCount(0);
        return 'no Usage section';
      });
    }

    // 16. Settings, Agents: no agent of the sample office (the seed leaves it out), and no link in the database.
    for (const role of ROLES) {
      await step('agents', role, async () => {
        const page = pages[role];
        await goto(page, '/settings');
        const heading = page.getByRole('heading', { level: 2, name: w('agents.title'), exact: true });
        await expect(heading).toBeVisible();
        await heading.scrollIntoViewIfNeeded();
        const section = page.locator('section').filter({ has: heading });
        await expect(section.getByText(w('agents.none'), { exact: true })).toBeVisible();
        await expect(page.getByText('Madar Assistant')).toHaveCount(0);
        await shot('agents', role);
        const links = await q<{ n: string }>('select count(*)::text as n from agent_links where owner_user_id = $1 and revoked_at is null', [DEPLOY_ACCOUNTS[role].userId]);
        if (links[0].n !== '0') throw new Error(`DB: ${links[0].n} live agent links`);
        return 'the empty words show, no sample agent, agent_links 0';
      });
    }

    // 17. Sign out: no session key stays in the browser.
    for (const role of ROLES) {
      await step('signout', role, async () => {
        const page = pages[role];
        await goto(page, '/');
        await page.getByRole('button', { name: nameOf(role), exact: true }).click();
        await page.getByRole('dialog', { name: nameOf(role) }).getByRole('button', { name: w('auth.signOut') }).click();
        await expect(page).toHaveURL(urlPattern('/sign-in?reason=signed_out'));
        await expect(page.getByText(w('auth.reasons.signed_out'))).toBeVisible();
        await shot('signout', role);
        const left = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('sb-')).length);
        if (left > 0) throw new Error(`${left} Supabase session keys stay in localStorage`);
        return 'signed out, no session key left';
      });
    }

    await step('csp-and-errors', 'all', async () => {
      if (csp.length > 0 || pageErrors.length > 0) throw new Error(`CSP: ${csp.join('; ')} | page errors: ${pageErrors.join('; ')}`);
    });

    for (const page of Object.values(pages)) await page.context().close();
    writeFileSync(join(SHOTS, `results-${suffix}.json`), JSON.stringify(results, null, 1));
    await test.info().attach(`walk-${suffix}`, { body: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.step} ${r.role}: ${r.note}`).join('\n'), contentType: 'text/plain' });
    expect(results.filter((r) => !r.ok), `the failed steps of the ${suffix} walk`).toEqual([]);
  });
}
