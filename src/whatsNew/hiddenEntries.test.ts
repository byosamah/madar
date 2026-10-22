import { describe, expect, it } from 'vitest';
import { ar, en } from '../i18n/trees';
import { WHATS_NEW } from './entries';

/** Batch D (fbk_044): internal projects, hidden projects, and "See every project" for the Admin. */
describe("What's new entries of hidden and internal projects", () => {
  it('has the three lines at the top, the Admin line with its right and its link', () => {
    expect(WHATS_NEW.slice(0, 3)).toEqual([
      { id: '2026-10-23-95', day: '2026-10-23', right: 'admin.manage', to: '/admin/roles' },
      { id: '2026-10-23-94', day: '2026-10-23', to: '/projects' },
      { id: '2026-10-23-93', day: '2026-10-23', to: '/projects' },
    ]);
  });

  it('has a short title and body in both languages', () => {
    for (const id of ['2026-10-23-93', '2026-10-23-94', '2026-10-23-95']) {
      for (const tree of [en, ar]) {
        const item = (tree as unknown as { whatsNew: { items: Record<string, { title: string; body: string }> } }).whatsNew.items[id];
        expect(item.title.length, id).toBeGreaterThan(5);
        expect(item.body.length, id).toBeGreaterThan(40);
        expect(item.body.length, id).toBeLessThan(260);
      }
    }
  });
});
