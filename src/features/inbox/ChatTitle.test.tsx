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

describe('the task thread title on a phone (owner, 2026-10-20)', () => {
  it('gives the title up to two lines and shows the task picture only from 640 px', async () => {
    await renderApp('/inbox/tsk_001');
    const link = await screen.findByRole('link', { name: 'Open to-do' }, { timeout: 10_000 });
    const header = link.closest('header') as HTMLElement;
    const heading = within(header).getByRole('heading', { level: 2 });
    // At 390 px the Open task button took the width, and one line held only a few letters of the title.
    expect(cutter(heading)).toHaveClass('line-clamp-2', 'sm:line-clamp-1');
    expect(cutter(heading)).not.toHaveClass('truncate');
    // The task picture only decorates: the line under the title already says "Task thread".
    expect(header.querySelector(':scope > span[aria-hidden]')).toHaveClass('hidden', 'sm:grid');
  }, 30_000);

  it('keeps one line for the title of a chat', async () => {
    await renderApp('/inbox/cnv_001');
    const header = (await screen.findByRole('textbox', { name: 'Message' }, { timeout: 10_000 })).closest('form')!.parentElement!.querySelector('header') as HTMLElement;
    expect(cutter(within(header).getByRole('heading', { level: 2 }))).toHaveClass('block', 'truncate');
  }, 30_000);
});
