import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { addDays, todayISO } from '../../../lib/dates';
import type { State } from '../../../api/store';
import { renderApp } from '../../../test/render';

// Home "Today" cut the text of a to-do row (fbk_083, owner decisions 2026-11-08). jsdom draws no layout, so these tests pin the classes and
// the markup that the real browser measured (the method of fbk_077). In the sample office usr_005 leads Civil Defense drawings (tsk_012) and
// helps on Stair details (tsk_007, led by usr_006). usr_002 leads the project prj_001, where Stair details sits.
const LONG = 'Coordinate the structural grid with the mechanical riser drawings before the client review of the third floor';

/** The sample person usr_005 sees two rows in Today: the one that this person leads, and the one that this person helps on. */
function asSara(state: State) {
  state.session.currentUserId = 'usr_005';
  for (const task of Object.values(state.tasks)) {
    if (task.ownerId === 'usr_005' || (task.helperIds ?? []).includes('usr_005')) task.dueDate = '2099-06-01';
  }
  state.tasks.tsk_012.title = LONG;
  state.tasks.tsk_012.startDate = null;
  state.tasks.tsk_012.dueDate = addDays(todayISO(), -2);
  state.tasks.tsk_007.helperIds = ['usr_005'];
  state.tasks.tsk_007.startDate = null;
  state.tasks.tsk_007.dueDate = todayISO();
  state.tasks.tsk_007.prerequisiteIds = [];
}
const rowOf = async (title: string) => (await screen.findByText(title)).closest('li') as HTMLElement;
const PATHS = ['/', '/work', '/projects/prj_001?tab=tasks'];

describe('the title of a to-do row (fbk_083, option A)', () => {
  it.each(PATHS)('shows up to two lines on %s, never one cut line', async (path) => {
    await renderApp(path, asSara);
    const title = await screen.findByText(path.startsWith('/projects') ? 'Stair details' : LONG);
    expect(title).toHaveClass('line-clamp-2', 'min-w-0', 'break-words');
    expect(title).not.toHaveClass('truncate');
    // `block` came after `line-clamp-2` in the built CSS and switched the clamp off (measured in Chrome): the title takes no display class.
    expect(title).not.toHaveClass('block', 'flex', 'inline-block');
  });
});

describe('the project of a row in Today and in My Work (fbk_083, "Name only")', () => {
  it.each(['/', '/work'])('shows the name of the project and no project tile on %s', async (path) => {
    const { store } = await renderApp(path, asSara);
    const row = await rowOf(LONG);
    const project = store.state.projects[store.state.tasks.tsk_012.projectId as string];
    expect(within(row).getByText(project.name, { selector: 'bdi' })).toBeInTheDocument();
    expect(row.querySelector('[data-project-mark]')).toBeNull();
  });

  it('keeps the plain people picture of an office to-do, which has no project', async () => {
    await renderApp('/work', (state) => {
      asSara(state);
      Object.assign(state.tasks.tsk_012, { projectId: null, stageId: null });
    });
    const row = await rowOf(LONG);
    expect(within(row).getByText('Office')).toBeInTheDocument();
    expect(within(row).getAllByRole('img').length).toBeGreaterThan(0);
  });
});

describe('the helper line of a row (fbk_083, owner: "the images are clear")', () => {
  it.each([['en', 'Yousef Saleh', 'Helper · Lead: Yousef Saleh'], ['ar', 'يوسف صالح', 'مساعدة · المسؤول الرئيسي: يوسف صالح']])('keeps the %s words for a screen reader and draws no text', async (language, lead, words) => {
    await renderApp('/work', (state) => {
      asSara(state);
      state.users.usr_005.preferences.language = language as 'en' | 'ar';
    });
    const row = await rowOf('Stair details');
    const line = within(row).getByText(lead, { selector: 'bdi' }).parentElement as HTMLElement;
    expect(line.textContent).toBe(words);
    expect(line).toHaveClass('sr-only');
    expect(line.closest('button')).not.toBeNull();
  });

  it('shows the faces of a row that this person helps on, with the lead in its ring, and none on a row that this person leads', async () => {
    await renderApp('/work', asSara);
    const helped = await rowOf('Stair details');
    expect(helped.querySelector('[data-leader]')).not.toBeNull();
    const led = await rowOf(LONG);
    expect(led.querySelector('[data-leader]')).toBeNull();
    expect(within(led).queryAllByRole('img')).toHaveLength(0);
  });
});

describe('the "add a helper" slot of a row (fbk_083, owner decision 5)', () => {
  it('takes no room in the row: it floats beside the picture, shows on hover or focus, and takes no press while hidden', async () => {
    await renderApp('/projects/prj_001?tab=tasks', (state) => { state.session.currentUserId = 'usr_002'; });
    const add = await screen.findByRole('button', { name: 'Add a helper to Stair details' });
    expect(add).toHaveClass('absolute', 'start-full', 'size-5', 'opacity-0', 'pointer-events-none');
    expect(add).toHaveClass('group-hover/people:opacity-100', 'group-hover/people:pointer-events-auto', 'focus-visible:opacity-100', 'focus-visible:pointer-events-auto');
    expect(add).toHaveClass('max-sm:hidden', 'pointer-coarse:hidden');
    expect(add).not.toHaveClass('ms-1');
    expect(add.parentElement).toHaveClass('relative', 'group/people');
  });

  it('leaves no blank of the slot in a row of a person who may not change the people, so the pictures line up at the end', async () => {
    await renderApp('/projects/prj_001?tab=tasks', (state) => { state.session.currentUserId = 'usr_005'; });
    const row = await rowOf('Stair details');
    expect(within(row).queryByRole('button', { name: /Add a helper/ })).toBeNull();
    expect(row.querySelector('span[aria-hidden="true"].size-6')).toBeNull();
    expect(row.querySelector('span[aria-hidden].size-6')).toBeNull();
  });
});

describe('the small facts of the meta line (fbk_083, owner decision 2)', () => {
  it('wraps only between facts: the line is a wrapping row, no fact is cut, and a past-due phrase wraps only when it is alone on its line', async () => {
    await renderApp('/', asSara);
    const row = await rowOf(LONG);
    const sign = row.querySelector('[data-sign="late"]') as HTMLElement;
    expect(sign.textContent).toContain('2 days past due');
    // A flex item that fits stays whole. One that is wider than the whole line shrinks and wraps inside (fbk_036).
    expect(sign).toHaveClass('min-w-0', 'whitespace-normal');
    expect(sign).not.toHaveClass('truncate', 'shrink-0');
    const meta = sign.parentElement as HTMLElement;
    expect(meta).toHaveClass('flex', 'flex-wrap', 'gap-x-3');
    for (const fact of Array.from(meta.children) as HTMLElement[]) expect(fact.className).not.toMatch(/\bline-clamp|\bbreak-all\b/);
  });
});
