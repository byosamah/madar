import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { expectCalm } from './calmChecks';
import { fakeAuth } from './fakeAuth';
import { renderAuth } from './renderAuth';

/**
 * The sign-in frame carries the Madar logo (TASKS.md, Logo, point 2): one small mark with the name, above the title of each
 * sign-in screen. It adds no button and no link, and the screen stays calm.
 */
const HALA = { email: 'hala.nasser@madar.test', password: 'blue-river-42', userId: 'usr_001' };
const auth = () => fakeAuth({ accounts: [HALA], links: { 'hash-reset': { type: 'recovery', email: HALA.email }, 'hash-invite': { type: 'invite', email: HALA.email } } });

const SCREENS = [
  { path: '/sign-in', title: { en: 'Sign in to Madar', ar: 'تسجيل الدخول إلى مدار' } },
  { path: '/forgot', title: { en: null, ar: null } },
  { path: '/reset?token_hash=hash-reset&type=recovery', title: { en: null, ar: null } },
  { path: '/welcome?token_hash=hash-invite&type=invite', title: { en: 'Welcome to Madar', ar: null } },
] as const;
const NAME = { en: 'Madar', ar: 'مدار' } as const;

describe('the Madar mark on the sign-in screens', () => {
  for (const language of ['en', 'ar'] as const) {
    for (const s of SCREENS) {
      it(`shows the mark and the name above the title of ${s.path.split('?')[0]}, ${language}`, async () => {
        const { container } = await renderAuth(s.path, { auth: auth(), language });
        const title = await screen.findByRole('heading', { level: 1 });
        if (s.title[language]) expect(title).toHaveTextContent(s.title[language]!);
        const brand = container.querySelector('[data-madar-brand]') as HTMLElement;
        expect(brand).not.toBeNull();
        expect(brand).toHaveTextContent(NAME[language]);
        // Above the title: first in the reading order.
        expect(brand.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // One small mark, hidden from screen readers, because the name is next to it.
        const marks = brand.querySelectorAll('[data-madar-mark]');
        expect(marks).toHaveLength(1);
        expect(marks[0]).toHaveAttribute('aria-hidden', 'true');
        expect(parseInt((marks[0] as HTMLElement).style.width, 10)).toBeLessThanOrEqual(32);
        // No new button and no new link, and the name is not a second title.
        expect(brand.querySelectorAll('button, a, h1, h2, h3')).toHaveLength(0);
        expectCalm(container);
      });
    }
  }
});
