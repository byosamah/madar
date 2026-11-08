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

// One truncated right-to-left line cut the start of a Latin lead name ("...eh") on a phone (audit 2026-10-03, F-7). The line is now text for a
// screen reader only (fbk_083), so nothing draws or cuts it; the name stays in its own box, so a screen reader and the order of a mixed
// Arabic and Latin line stay right.
describe('the helper line of a task row', () => {
  it.each(['/projects/prj_001?tab=tasks', '/work'])('on %s keeps the lead name in its own box, in a line for a screen reader only', async (path) => {
    await renderApp(path, helpingInArabic);
    const row = await rowOf('Stair details');
    const name = within(row).getByText('Yousef Saleh', { selector: 'bdi' });
    const line = name.parentElement as HTMLElement;
    expect(line.textContent).toBe('مساعدة · المسؤول الرئيسي: Yousef Saleh');
    expect(line).toHaveClass('sr-only');
    expect(line).toHaveAttribute('dir', 'auto');
    // The name is no longer cut, since the line draws nothing.
    expect(name).not.toHaveClass('truncate');
  });
});

// Each task row asked session.get for itself, so a long list held one query observer for each row. The list asks once and gives
// the person to its rows (cleanup 2026-10-06).
describe('the person of the task rows', () => {
  const observersOn = async (path: string, extraRows: number) => {
    const view = await renderApp(path, (state) => {
      const model = state.tasks.tsk_007;
      // The lead of the task looks, so its rows show on My Work too.
      state.session.currentUserId = model.ownerId as string;
      for (let n = 1; n <= extraRows; n += 1) state.tasks[`tsk_9${n}0`] = { ...structuredClone(model), id: `tsk_9${n}0`, title: `Extra row ${n}` };
    });
    await screen.findByText('Stair details');
    if (extraRows > 0) await screen.findByText(`Extra row ${extraRows}`);
    const observers = view.queryClient.getQueryCache().find({ queryKey: ['api', 'session.get', {}] })?.getObserversCount() ?? 0;
    view.unmount();
    return observers;
  };

  it.each(['/projects/prj_001?tab=tasks', '/work'])('on %s comes from one session.get for the whole list', async (path) => {
    expect(await observersOn(path, 4)).toBe(await observersOn(path, 0));
  });
});
