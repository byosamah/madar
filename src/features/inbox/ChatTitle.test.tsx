import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

const cutter = (heading: HTMLElement) => heading.querySelector('bdi') as HTMLElement;

describe('the chat title (design item 8)', () => {
  for (const lang of ['en', 'ar'] as const) {
    it(`cuts a long English title at its end, not at its start, in ${lang}`, async () => {
      await renderApp('/inbox', (state) => {
        state.users.usr_001.preferences.language = lang;
        state.users.usr_002.nameAr = undefined;
        state.users.usr_002.name = 'Faisal Abdulrahman Al-Harbi of the Corniche Office Tower team';
      });
      if (lang === 'ar') await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
      await userEvent.click(await within(await screen.findByRole('list', { name: lang === 'en' ? 'Chats' : 'المحادثات' })).findByRole('link', { name: /Faisal Abdulrahman/ }));
      const heading = await screen.findByRole('heading', { level: 2, name: /Faisal Abdulrahman/ });
      // The element that cuts is the bdi: it takes the direction of its own text, so the ellipsis sits at the end of the words.
      expect(cutter(heading)).toHaveClass('block', 'truncate');
      expect(heading).not.toHaveClass('truncate');
      expect(heading).not.toHaveAttribute('dir');
    });
  }
});
