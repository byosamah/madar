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
      // The usage data entry stays first whatever its day, so the order check starts at the third entry (2026-10-26).
      if (i > 1) expect(entry.day <= WHATS_NEW[i - 1].day, `${entry.id} ${entry.day}`).toBe(true);
    }
  });

  it('keeps the release days of the history (Cloudflare production deploys and the release records)', () => {
    const dayOf = (id: string) => WHATS_NEW.find((entry) => entry.id === id)?.day;
    expect(dayOf('2026-10-23-82')).toBe('2026-10-22');
    expect(new Set(WHATS_NEW.map((entry) => entry.day))).toEqual(new Set(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']));
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
    // The usage data entry stays first (2026-10-23-102), so the check leaves it out.
    const days = WHATS_NEW.slice(1).map((entry) => entry.day);
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
    const rights = ['admin.manage', 'people.manage', 'payment.manage', 'clients.manage', 'templates.projectAny', 'report.office', 'ai.projectSetup', 'dashboard.view', 'payment.daftraLink', 'ai.readChats', 'people.turnOff'];
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

// Four team reports (owner, 2026-10-25): Undo (fbk_052), the Open space (fbk_055), the chat in Focus mode (fbk_059) and the summary days
// (fbk_058). The entries are found by id, never by place.
describe("the What's new entries of the four team reports of 2026-10-25", () => {
  it('give each change its line, the Open space only to the people who see the Dashboard', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-103')).toEqual({ id: '2026-10-23-103', day: '2026-10-25' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-104')).toEqual({ id: '2026-10-23-104', day: '2026-10-25', right: 'dashboard.view', to: '/dashboard/space' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-105')).toEqual({ id: '2026-10-23-105', day: '2026-10-25' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-106')).toEqual({ id: '2026-10-23-106', day: '2026-10-25', to: '/settings' });
  });

  it('quote the button words as the screens show them, in both languages', () => {
    const body = (tree: unknown, id: string) => String(wordAt(tree, ['whatsNew', 'items', id, 'body']));
    expect(body(en, '2026-10-23-103')).toContain('8 seconds');
    expect(body(ar, '2026-10-23-103')).toContain('«تراجع»');
    expect(body(en, '2026-10-23-104')).toContain('"Show more"');
    expect(body(ar, '2026-10-23-104')).toContain('«أظهر المزيد»');
    expect(body(en, '2026-10-23-105')).toContain('"Project chat"');
    expect(body(ar, '2026-10-23-105')).toContain('«محادثة المشروع»');
    expect(body(en, '2026-10-23-106')).toContain('office work days');
    expect(body(ar, '2026-10-23-106')).toContain('أيام عمل المكتب');
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

  // Insight with PostHog (owner, 2026-10-25): one line for the team, with the way to Settings.
  it('has the usage data line above every other entry, and it says what is never recorded (insight design, section 8)', () => {
    expect(WHATS_NEW[0]).toEqual({ id: '2026-10-23-102', day: '2026-10-25', to: '/settings' });
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-102', 'body']))).toBe('Madar now records errors and how people use it, so we fix problems faster. It never records what you type, chat messages or amounts. Details in Settings.');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-102', 'body']))).toBe('صار مدار يحفظ الأخطاء وطريقة استخدامه، لنصلح المشاكل أسرع. لا يحفظ ما تكتبه، ولا رسائل المحادثة، ولا المبالغ. التفاصيل في الإعدادات.');
  });
});

// The lead button, the leader ring (fbk_064 and fbk_060) and the person menu (fbk_063), owner 2026-10-26. Found by id, never by place.
describe("the What's new entries of 2026-10-26 (small fixes)", () => {
  it('has the two entries, under the usage data entry, in the 2026-10-26 group', () => {
    expect(WHATS_NEW[0].id).toBe('2026-10-23-102');
    const day = WHATS_NEW.filter((entry) => entry.day === '2026-10-26').map((entry) => entry.id);
    expect(day).toEqual(expect.arrayContaining(['2026-10-23-109', '2026-10-23-108']));
    expect(day.indexOf('2026-10-23-109')).toBeLessThan(day.indexOf('2026-10-23-108'));
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-108')).toEqual({ id: '2026-10-23-108', day: '2026-10-26', to: '/projects' });
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-109')).toEqual({ id: '2026-10-23-109', day: '2026-10-26' });
  });

  it('names the lead button and the leader ring, and the groups of the person menu', () => {
    const body = (tree: typeof en, id: string) => String(wordAt(tree, ['whatsNew', 'items', id, 'body']));
    expect(body(en, '2026-10-23-108')).toContain('lead button');
    expect(body(en, '2026-10-23-108')).toContain('dark ring');
    expect(body(ar, '2026-10-23-108')).toContain('حلقة داكنة');
    expect(body(en, '2026-10-23-109')).toContain('Away, Mode and Language');
    expect(body(ar, '2026-10-23-109')).toContain('زر الخروج');
  });
});

// MCP parity (owner, 2026-10-26): the AI assistant does what its person does in the screens. The entry is found by id, never by place.
describe("the What's new entry of the MCP parity track", () => {
  it('tells everyone that the assistant does more, names the Admin work switch and the project delete that stays in the screens', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-116')).toEqual({ id: '2026-10-23-116', day: '2026-10-26', to: '/settings' });
    const body = String(wordAt(en, ['whatsNew', 'items', '2026-10-23-116', 'body']));
    expect(body).toContain('"AI does Admin work"');
    expect(body).toContain('A project delete stays in the screens.');
    // The code guard and the chat files (owner, 2026-10-26): the text of this entry changed, and no new entry came.
    expect(body).toContain('needs a code that Madar sends to your email');
    expect(body).toContain('sends files into your chats and opens the files of your chats');
    // Pictures are uploads too (owner, 2026-10-26): the assistant sets the picture of its person and a sub-company logo.
    expect(body).toContain('It sets your profile picture and the logo of a sub-company.');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-116', 'body']))).toContain('يضع صورتك الشخصية وشعار الشركة الفرعية');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-116', 'body']))).toContain('تحتاج رمزًا يصلك على بريدك');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-116', 'body']))).toContain('«ينفّذ المساعد أعمال الإدارة»');
    expect(String(wordAt(en, ['whatsNew', 'items', '2026-10-23-116', 'title']))).not.toMatch(/[–—]/);
  });
});

// The AI assistant: stages, many to-dos at once and long lists in pages (owner, 2026-10-26). Found by id, never by place.
describe("the What's new entry of the AI assistant (2026-10-26)", () => {
  it('has its line in the 2026-10-26 group, for everyone', () => {
    expect(WHATS_NEW[0].id).toBe('2026-10-23-102');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-115')).toEqual({ id: '2026-10-23-115', day: '2026-10-26' });
  });

  it('names the three changes in both languages', () => {
    const body = (tree: typeof en) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-115', 'body']));
    for (const word of ['stages', 'many to-dos', 'page by page']) expect(body(en)).toContain(word);
    for (const word of ['المراحل', 'عدة مهام', 'صفحة بعد صفحة']) expect(body(ar)).toContain(word);
  });
});

// The AI assistant uploads files by content (owner, 2026-10-26). Found by id, never by place.
describe("the What's new entry of the AI upload (2026-10-26)", () => {
  it('has its line in the 2026-10-26 group, for everyone', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-117')).toEqual({ id: '2026-10-23-117', day: '2026-10-26' });
  });

  it('names the file, the places and the limit in both languages, and uses no dash', () => {
    const body = (tree: typeof en) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-117', 'body']));
    const title = (tree: typeof en) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-117', 'title']));
    for (const word of ['upload a file', 'project', 'to-do', 'meeting', '10 MB', '3 pictures']) expect(body(en), word).toContain(word);
    for (const word of ['يرفع ملفًا', 'مشروع', 'مهمة', 'اجتماع', '10 ميغابايت', '3 صور']) expect(body(ar), word).toContain(word);
    for (const text of [body(en), body(ar), title(en), title(ar)]) expect(text).not.toMatch(/[–—]/);
  });
});

// The Daftra link (owner, 2026-10-26): one line for the people who link invoices. The usage data line stays first, this one is second.
describe("the What's new entry of the Daftra link", () => {
  it('is in the newest day, under the usage entry, for the people who hold the switch "Link Daftra invoices", with no screen to open', () => {
    // A test finds its entry by id (src/CLAUDE.md): the tile shapes entry 2026-10-23-114 came in the same release.
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-113')).toEqual({ id: '2026-10-23-113', day: '2026-10-26', right: 'payment.daftraLink' });
    expect(WHATS_NEW.findIndex((entry) => entry.id === '2026-10-23-113')).toBeGreaterThan(0);
  });

  it('says in both languages that a payment shows its Daftra invoice and that Received sets itself, and that Madar never changes Daftra', () => {
    const title = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-113', 'title']));
    const body = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-113', 'body']));
    expect(title(en)).toBe('Link a payment to its Daftra invoice');
    expect(body(en)).toContain('Daftra invoice');
    expect(body(en)).toContain('Received');
    expect(body(en)).toContain('never changes');
    expect(title(ar)).toContain('دفترة');
    expect(body(ar)).toContain('استُلمت');
    expect(body(ar)).toContain('دفترة');
    for (const text of [title(en), body(en), title(ar), body(ar)]) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});

// The continuous project (owner, 2026-10-26, fbk_069): one entry for everybody, with a link to Projects.
describe("the What's new entry of the continuous project", () => {
  it('is in the newest day, under the usage entry, and opens Projects', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-118')).toEqual({ id: '2026-10-23-118', day: '2026-10-26', to: '/projects' });
    expect(WHATS_NEW.findIndex((entry) => entry.id === '2026-10-23-118')).toBeGreaterThan(0);
  });

  it('says in both languages that the project shows Continuous and that a stage date never makes it Late', () => {
    const title = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-118', 'title']));
    const body = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-118', 'body']));
    expect(title(en)).toBe('Continuous projects');
    expect(body(en)).toContain('Continuous project');
    expect(body(en)).toContain('never makes it Late');
    expect(title(ar)).toContain('مستمر');
    expect(body(ar)).toContain('مشروع مستمر');
    for (const text of [title(en), body(en), title(ar), body(ar)]) expect(text).not.toMatch(/[–—]/);
  });
});

// The AI assistant reads the chats before it answers about a project or a to-do (owner, 2026-10-27). Only for the holders of
// "AI reads chats": an assistant without it cannot read them.
describe("the What's new entry of the context rule of the AI assistant", () => {
  it('is in its day, under the usage entry and the two fixes of 2026-10-28, for the holders of the switch "AI reads chats"', () => {
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-120')).toEqual({ id: '2026-10-23-120', day: '2026-10-27', right: 'ai.readChats' });
    expect(WHATS_NEW.findIndex((entry) => entry.id === '2026-10-23-120')).toBe(4);
  });

  it('names the project chat and the to-do thread in the screen words, and says to start a new chat', () => {
    const title = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-120', 'title']));
    const body = (tree: Parameters<typeof wordAt>[0]) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-120', 'body']));
    expect(title(en)).toContain('AI assistant');
    expect(body(en)).toContain('project chat');
    expect(body(en)).toContain('to-do thread');
    expect(body(en)).toContain('new chat');
    expect(title(ar)).toContain('مساعدك');
    expect(body(ar)).toContain('محادثة المشروع');
    expect(body(ar)).toContain('نقاش المهمة');
    for (const text of [title(en), body(en), title(ar), body(ar)]) expect(text).not.toMatch(/[–—]/);
  });
});

// The two fixes of the cleanup of the project page and of Settings (code review 2026-10-27). The note about who changes the leader
// is only for the people who may turn people off, because only they open the warning.
describe("the What's new entries of the fixes of 2026-10-28", () => {
  it('sit under the usage entry and the entry of the late push: the Tracker weeks for everyone, and the warning before Deactivate for its holders', () => {
    expect(WHATS_NEW.slice(2, 4)).toEqual([
      { id: '2026-10-23-122', day: '2026-10-28', to: '/projects' },
      { id: '2026-10-23-121', day: '2026-10-28', right: 'people.turnOff' },
    ]);
  });

  it('name the screen words: the Tracker history and its weeks, Deactivate and the note about the leader', () => {
    const words = (tree: Parameters<typeof wordAt>[0], id: string) =>
      ['title', 'body'].map((part) => String(wordAt(tree, ['whatsNew', 'items', id, part])));
    expect(words(en, '2026-10-23-122').join(' ')).toContain('Tracker history');
    expect(words(en, '2026-10-23-122')[1]).toContain('"Last week"');
    expect(words(ar, '2026-10-23-122')[1]).toContain('«الأسبوع الماضي»');
    expect(words(en, '2026-10-23-121')[0]).toContain('deactivate');
    expect(words(en, '2026-10-23-121')[1]).toContain('"An Admin changes the leader."');
    expect(words(ar, '2026-10-23-121')[0]).toContain('توقف حساب');
    for (const id of ['2026-10-23-121', '2026-10-23-122']) {
      for (const text of [...words(en, id), ...words(ar, id)]) expect(text).not.toMatch(/[–—]|undefined/);
    }
  });
});

// A push that was planned before a person lost the view of a project no longer reaches the person (owner, 2026-10-28, task tsk_439).
describe("the What's new entry of the late push from a project that the person cannot see", () => {
  it('is the newest entry, under the usage entry, and has no right and no link', () => {
    expect(WHATS_NEW[1]).toEqual({ id: '2026-10-23-123', day: '2026-10-28' });
  });

  it('says that no push comes from a project that the person cannot see, in English and Arabic', () => {
    const word = (tree: Parameters<typeof wordAt>[0], part: string) => String(wordAt(tree, ['whatsNew', 'items', '2026-10-23-123', part]));
    expect(word(en, 'title')).toContain('push');
    expect(word(en, 'body')).toContain('You have something new in Madar.');
    expect(word(ar, 'title')).toContain('إشعارات');
    expect(word(ar, 'body')).toContain('لديك جديد في مدار.');
    for (const text of [word(en, 'title'), word(en, 'body'), word(ar, 'title'), word(ar, 'body')]) expect(text).not.toMatch(/[–—]|undefined/);
  });
});
