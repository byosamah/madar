import { describe, expect, it } from 'vitest';
import { ar, en } from '../i18n/trees';
import { WHATS_NEW } from './entries';

/** The text at a key path of a word tree, or undefined when the tree has no such key. */
function wordAt(tree: unknown, path: string[]): unknown {
  return path.reduce<unknown>((at, key) => (typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined), tree);
}

describe("What's new entries", () => {
  it('have unique ids in the form YYYY-MM-DD-n', () => {
    const ids = WHATS_NEW.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
  });

  it('give each entry the day of its id', () => {
    for (const entry of WHATS_NEW) expect(entry.id.startsWith(`${entry.day}-`)).toBe(true);
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
    const rights = ['admin.manage', 'people.manage', 'payment.manage', 'clients.manage', 'templates.manageAll', 'report.office'];
    for (const entry of WHATS_NEW) {
      if (entry.right) expect(rights, entry.id).toContain(entry.right);
      if (entry.to) expect(entry.to, entry.id).toMatch(/^\/[a-z-]+(\/[a-z-]+)*(\?[a-z]+=[a-z]+)?$/);
    }
    // Every entry that only the Admin can use has a right, so a Member does not read it.
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-7')?.right).toBe('admin.manage');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-11')?.right).toBe('admin.manage');
    expect(WHATS_NEW.find((entry) => entry.id === '2026-10-23-12')?.right).toBe('report.office');
  });

  // Chat design 2026-10-19 (track msg, B17): the message menu, reply, edit, delete, reactions and instant send.
  it('name the message menu of the chats in one entry that opens the Inbox', () => {
    const entry = WHATS_NEW.find((item) => item.id === '2026-10-23-30');
    expect(entry).toEqual({ id: '2026-10-23-30', day: '2026-10-23', to: '/inbox' });
    expect(wordAt(en, ['whatsNew', 'items', '2026-10-23-30', 'title'])).toBe('Reply, react and edit in chats');
    expect(String(wordAt(ar, ['whatsNew', 'items', '2026-10-23-30', 'body']))).toContain('أرسلها مجددًا');
  });

  // Chat design 2026-10-19 (track find, D13): message search, the Message button and the Project chat button.
  it('name the search of messages in one entry that opens the Search screen, between the notify and the msg lines', () => {
    const entry = WHATS_NEW.find((item) => item.id === '2026-10-23-40');
    expect(entry).toEqual({ id: '2026-10-23-40', day: '2026-10-23', to: '/search' });
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
    expect(entry).toEqual({ id: '2026-10-23-54', day: '2026-10-23', to: '/meetings' });
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
});
