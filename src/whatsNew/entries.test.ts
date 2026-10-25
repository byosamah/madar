import { describe, expect, it } from 'vitest';
import { ar, en } from '../i18n/trees';
import { WHATS_NEW } from './entries';

/** The text at a key path of a word tree, or undefined when the tree has no such key. */
function wordAt(tree: unknown, path: string[]): unknown {
  return path.reduce<unknown>((at, key) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined), tree);
}

describe("What's new entries", () => {
  // The page puts each day of news under its date (owner, 2026-10-22: "add the date of each release when it released"). The day of an
  // entry is the day its production release went live, never a planned day: before, every entry held 2026-10-23, a day still to come.
  it('dates each entry on the day of its release: never a day still to come, and never newer than the entry above it', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
    for (const [i, entry] of WHATS_NEW.entries()) {
      expect(entry.day, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.day <= today, `${entry.id} ${entry.day}`).toBe(true);
      if (i > 0) expect(entry.day <= WHATS_NEW[i - 1].day, `${entry.id} ${entry.day}`).toBe(true);
    }
  });

  it('keeps the release days of the history (Cloudflare production deploys and the release records)', () => {
    const dayOf = (id: string) => WHATS_NEW.find((entry) => entry.id === id)?.day;
    expect(dayOf('2026-10-23-82')).toBe('2026-10-22');
    expect(new Set(WHATS_NEW.map((entry) => entry.day))).toEqual(new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25']));
  });

  // Batch A (fbk_038, fbk_040, fbk_043, fbk_045, fbk_046, fbk_047): five lines, newer than every other entry.
  it('has the five lines of batch A, above the entry of the speed release', () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    const speed = ids.indexOf('2026-10-23-82');
    for (const n of [83, 84, 85, 86, 87]) {
      const id = `2026-10-23-${n}`;
      expect(ids.indexOf(id), id).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(id), id).toBeLessThan(speed);
      for (const tree of [en, ar]) expect(String(wordAt(tree, ['whatsNew', 'items', id, 'body'])).length, id).toBeGreaterThan(20);
    }
  });

  it('have unique ids in the form YYYY-MM-DD-n', () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
  });

  it('gives each entry its own id, which stays a name and no longer has to match the day (owner, 2026-10-22)', () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
  });

  it('list the newest day first', () => {
    const days = WHATS_NEW.map((entry) => entry.day);
    expect([...days].sort().reverse()).toEqual(days);
  });

  it('have a title and a body in both languages', () => {
    for (const entry of WHATS_NEW) {
      for (const tree of [en, ar]) {
        expect(typeof wordAt(tree, ['whatsNew', 'items', entry.id, 'title'])).toBe('string');
        expect(typeof wordAt(tree, ['whatsNew', 'items', entry.id, 'body'])).toBe('string');
      }
    }
  });

  it('use no em-dash and no en-dash in any word of an entry', () => {
    for (const entry of WHATS_NEW) {
      for (const tree of [en, ar]) {
        for (const part of ['title', 'body']) {
          expect(String(wordAt(tree, ['whatsNew', 'items', entry.id, part]))).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
        }
      }
    }
  });

  it('name a real right and a real address when they have them (chats-14)', () => {
    const rights = ['admin.manage', 'people.manage', 'payment.manage', 'clients.manage', 'templates.projectAny', 'report.office', 'ai.projectSetup'];
    for (const entry of WHATS_NEW) {
      if (entry.right) expect(rights, entry.id).toContain(entry.right);
      if (entry.to) expect(entry.to, entry.id).toMatch(/^\/[a-z-]+(\/[a-z-]+)*(\?[a-z]+=[a-z]+)?$/);
    }
    // Every entry that only the Admin can use has a right, so a Member does not read it.
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-7')?.right).toBe('admin.manage');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-11')?.right).toBe('admin.manage');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-12')?.right).toBe('report.office');
  });

  // Role rights version 2 (owner, 2026-10-21): the 112 switches. Only the Admin makes roles, so only the Admin reads the entry.
  it('shows the entry about the 112 switches to the Admin only, and opens the Roles section', () => {
    // The chat presence entry (2026-10-23-80) came after it, so the entry is found by its id, not by its place.
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-75')).toEqual({ id: '2026-10-23-75', day: '2026-10-21', right: 'admin.manage', to: '/admin/roles' });
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-75', 'title'])).toBe('Rights in 112 switches');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-75', 'body']))).toContain('112');
  });

  // The two entries about templates moved from the old right templates.manageAll to the power that stands for it.
  it('names templates.projectAny for the entries about changing any project template', () => {
    const rights = WHATS_NEW.filter((entry) => ['2026-10-23-29', '2026-10-23-10'].includes(entry.id)).map((entry) => entry.right);
    expect(rights).toEqual(['templates.projectAny', 'templates.projectAny']);
    expect(WHATS_NEW.some((entry) => (entry.right as string | undefined) === 'templates.manageAll')).toBe(false);
  });

  // role-rights (owner, 2026-10-23): only the Admin makes roles, so only the Admin reads the entry about the sections of rights.
  it('shows the entry about the rights in sections to the Admin only, and opens the Roles section', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-68')).toEqual({ id: '2026-10-23-68', day: '2026-10-20', right: 'admin.manage', to: '/admin/roles' });
  });

  // Chat design 2026-10-19 (track msg, B17): the message menu, reply, edit, delete, reactions and instant send.
  it('name the message menu of the chats in one entry that opens the Inbox', () => {
    const entry = WHATS_NEW.find((item) => item.id === '2026-10-23-30');
    expect(entry).toEqual({ id: '2026-10-23-30', day: '2026-10-20', to: '/inbox' });
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-30', 'title'])).toBe('Reply, react and edit in chats');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-30', 'body']))).toContain('أرسلها مجددًا');
  });

  // Chat design 2026-10-19 (track find, D13): message search, the Message button and the Project chat button.
  it('name the search of messages in one entry that opens the Search screen, between the notify and the msg lines', () => {
    const entry = WHATS_NEW.find((item) => item.id === '2026-10-23-40');
    expect(entry).toEqual({ id: '2026-10-23-40', day: '2026-10-20', to: '/search' });
    const ids = WHATS_NEW.map((item) => item.id);
    expect(ids.indexOf('2026-10-23-40')).toBeGreaterThan(ids.indexOf('2026-10-23-50'));
    expect(ids.indexOf('2026-10-23-40')).toBeLessThan(ids.indexOf('2026-10-23-30'));
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-40', 'title'])).toBe('Search messages');
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-40', 'body']))).toContain('Project chat');
    expect(wordAt(ar, ['whatsNew', 'items', '2026-10-23-40', 'title'])).toBe('ابحث في الرسائل');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-40', 'body']))).toContain('محادثة المشروع');
  });

  // Meetings, wave 3 (fbk_022): a meeting can repeat every day, every week or every 2 weeks.
  it('name the repeating meetings in one entry that opens the Meetings view, above the Google Calendar line', () => {
    const entry = WHATS_NEW.find((item) => item.id === '2026-10-23-54');
    expect(entry).toEqual({ id: '2026-10-23-54', day: '2026-10-20', to: '/meetings' });
    const ids = WHATS_NEW.map((item) => item.id);
    expect(ids.indexOf('2026-10-23-54')).toBeLessThan(ids.indexOf('2026-10-23-53'));
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-54', 'title'])).toBe('Meetings that repeat');
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-54', 'body']))).toContain('A meeting can repeat every day, every week or every 2 weeks.');
    expect(wordAt(ar, ['whatsNew', 'items', '2026-10-23-54', 'title'])).toBe('اجتماعات متكررة');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-54', 'body']))).toContain('كل أسبوعين');
  });

  it('have a short "Open" link word and a "New" mark in both languages', () => {
    for (const tree of [en, ar]) {
      for (const key of ['newMark', 'seeNew', 'open', 'openItem']) expect(typeof wordAt(tree, ['whatsNew', key]), key).toBe('string');
    }
  });

  // The Madar report from the AI assistant (owner, 2026-10-21): only the people with the report right can ask for it.
  it('shows the entry about the Madar report to the people with the report right', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-81')).toEqual({ id: '2026-10-23-81', day: '2026-10-21', right: 'report.office' });
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-81', 'body']))).toContain('from 1 to 15 October');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-81', 'title']))).toBe('تقرير مدار من مساعدك الذكي');
  });

  // The speed release (owner, 2026-10-21: "audit the performance of the full product and make the best"): one line for everyone.
  it('tells everyone that Madar is faster', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-82')).toEqual({ id: '2026-10-23-82', day: '2026-10-22' });
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-82', 'title']))).toBe('Madar is faster');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-82', 'title']))).toBe('صار مدار أسرع');
  });

  // Direction D (owner, 2026-10-22): the phone shell has four tabs, icons only. One line for everyone, with no link to open.
  it('tells everyone that the phone has four tabs', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-99')).toEqual({ id: '2026-10-23-99', day: '2026-10-22' });
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-99', 'title'])).toBe('Madar on the phone: four tabs');
    expect(wordAt(ar, ['whatsNew', 'items', '2026-10-23-99', 'title'])).toBe('مدار على الجوال: أربعة تبويبات');
    const body = String(wordAt(en, ['whatsNew', 'items', '2026-10-23-99', 'body']));
    for (const tab of ['Today', 'Inbox', 'Work', 'Me']) expect(body, tab).toContain(tab);
    const arBody = String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-99', 'body']));
    for (const tab of ['اليوم', 'الوارد', 'العمل', 'أنا']) expect(arBody, tab).toContain(tab);
    // The tabs show icons only (owner, 2026-10-22): the entry names the icon of each tab, and never says "with words".
    for (const icon of ['sun', 'tray', 'briefcase', 'person']) expect(body, icon).toContain(icon);
    for (const icon of ['الشمس', 'الصندوق', 'الحقيبة', 'الشخص']) expect(arBody, icon).toContain(icon);
    expect(body).not.toContain('with words');
    expect(arBody).not.toContain('بكلمات');
  });
});

// The Inbox line (fbk_056) and projects from the AI agent (fbk_057), owner 2026-10-25. The entries are found by id, never by place.
describe("the What's new entries of the Inbox line and of projects from the AI agent", () => {
  it('tells everyone about the Inbox line, with the Inbox to open', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-100')).toEqual({ id: '2026-10-23-100', day: '2026-10-25', to: '/inbox' });
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-100', 'body']))).toContain('"Show all"');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-100', 'body']))).toContain('«اعرض الكل»');
  });

  it('shows the entry about projects from the AI agent only to the holders of its switch, and names the missing Undo', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-101')).toEqual({ id: '2026-10-23-101', day: '2026-10-25', right: 'ai.projectSetup' });
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-101', 'body']))).toContain('no Undo');
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-101', 'body']))).toContain('"AI creates projects and clients"');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-101', 'body']))).toContain('لا تراجع');
  });
});

// Quiet hours and @everyone (owner, 2026-10-22, fbk_048 and fbk_041). The entries are found by id, never by place.
describe("the What's new entries of quiet hours and @everyone", () => {
  it('have the three ids, for everyone, with a screen to open', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-88')).toEqual({ id: '2026-10-23-88', day: '2026-10-22', to: '/settings' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-89')).toEqual({ id: '2026-10-23-89', day: '2026-10-22', to: '/inbox' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-90')).toEqual({ id: '2026-10-23-90', day: '2026-10-22', to: '/settings' });
  });

  it('say how to change the hours, the three words, and the new time of the summary, in both languages', () => {
    const text = (tree: unknown, id: string) => `${wordAt(tree, ['whatsNew', 'items', id, 'title'])} ${wordAt(tree, ['whatsNew', 'items', id, 'body'])}`;
    expect(text(en, '2026-10-23-88')).toContain('Settings, Quiet hours');
    expect(text(en, '2026-10-23-89')).toContain('@everyone');
    expect(text(en, '2026-10-23-90')).toContain('start of your work hours');
    expect(text(ar, '2026-10-23-88')).toContain('ساعات الهدوء');
    expect(text(ar, '2026-10-23-89')).toContain('@الجميع');
    expect(text(ar, '2026-10-23-90')).toContain('بداية ساعات عملك');
  });
});
