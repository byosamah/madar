import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

const helpingInArabic = (state: State) => {
  state.session.currentUserId = 'usr_005';
  state.users.usr_005.preferences.language = 'ar';
  state.tasks.tsk_007.helperIds = ['usr_005'];
  // A lead with an English name only, so the Arabic line holds a Latin name (owner item 12).
  state.users.usr_006.nameAr = undefined;
};
const rowOf = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement;

// One truncated right-to-left line cut the start of the Latin lead name ("...eh") on a phone (audit 2026-10-03, F-7).
describe('the helper line of a task row', () => {
  it.each(['/projects/prj_001?tab=tasks', '/work'])('on %s keeps the lead name in its own box and lets the line wrap', async (path) => {
    await renderApp(path, helpingInArabic);
    const row = await rowOf('Stair details');
    const name = within(row).getByText('Yousef Saleh', { selector: 'bdi' });
    const line = name.parentElement as HTMLElement;
    expect(line.textContent).toBe('مساعدة · المسؤول الرئيسي: Yousef Saleh');
    // The line wraps. Only a name too long for the whole line is cut, and then at its own end.
    expect(line).not.toHaveClass('truncate');
    expect(name).toHaveClass('truncate');
    expect(name).toHaveClass('max-w-full');
  });
});
