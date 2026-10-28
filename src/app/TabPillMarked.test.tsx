import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../test/render';
import { isNavActive } from './nav';

// The tab pill marks the tab of the open screen (tsk_488). Seen on 2026-10-28: the To-do list at /tasks marked Dashboard, in both
// languages, so a person on a screen about to-dos saw the wrong tab lit. The list is a Tasks screen. Only the Deadlines list
// (/tasks?mode=deadlines) belongs to the Dashboard, because it has no to-dos in it.
const NAMES = {
  en: { label: 'Main navigation', home: 'Home', projects: 'Projects', tasks: 'Tasks', dashboard: 'Dashboard' },
  ar: { label: 'التنقل الرئيسي', home: 'الرئيسية', projects: 'المشاريع', tasks: 'المهام', dashboard: 'لوحة المعلومات' },
} as const;

type Tab = 'home' | 'projects' | 'tasks' | 'dashboard' | null;
const ROUTES: [string, Tab][] = [
  ['/', 'home'],
  ['/projects', 'projects'],
  ['/projects/prj_001', 'projects'],
  ['/work', 'tasks'],
  ['/meetings', 'tasks'],
  ['/tasks', 'tasks'],
  ['/tasks?filter=overdue', 'tasks'],
  ['/tasks?mode=deadlines', 'dashboard'],
  ['/dashboard', 'dashboard'],
  ['/settings', null],
];

describe('the tab pill marks the open screen', () => {
  describe.each(['en', 'ar'] as const)('in %s', (lang) => {
    it.each(ROUTES)('%s marks %s', async (path, tab) => {
      await renderApp(path, (state) => {
        state.users.usr_001.preferences.language = lang;
      });
      const words = NAMES[lang];
      const nav = await screen.findByRole('navigation', { name: words.label });
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => {
        // The four word tabs only. Search, Inbox and the bell are round icons with their own marks.
        const marked = within(nav).queryAllByRole('link', { current: 'page' }).map((link) => link.textContent?.trim());
        expect(marked).toEqual(tab ? [words[tab]] : []);
      });
    });
  });
});

describe('isNavActive', () => {
  it('marks Tasks for the to-do list and Dashboard for the deadline list', () => {
    expect(isNavActive('/work', '/tasks')).toBe(true);
    expect(isNavActive('/dashboard', '/tasks')).toBe(false);
    expect(isNavActive('/dashboard', '/tasks', '?mode=deadlines')).toBe(true);
    expect(isNavActive('/work', '/tasks', '?mode=deadlines')).toBe(false);
    expect(isNavActive('/work', '/meetings')).toBe(true);
    expect(isNavActive('/dashboard', '/dashboard')).toBe(true);
    expect(isNavActive('/dashboard', '/work')).toBe(false);
    expect(isNavActive('/', '/work')).toBe(false);
  });
});
