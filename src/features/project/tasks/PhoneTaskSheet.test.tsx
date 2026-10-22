import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../../api/store';
import { phoneMedia } from '../../../test/phoneMedia';
import { renderApp } from '../../../test/render';
import { addOfficeTask, setupTask } from '../../../test/renderPanel';

// A spy over the Sheet records its props. The real Sheet still draws, so every other test of this file sees the real panel.
const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock('../../../components/Sheet', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../components/Sheet')>();
  return { ...real, Sheet: (props: Parameters<typeof real.Sheet>[0]) => { seen.props.push(props as unknown as Record<string, unknown>); return <real.Sheet {...props} />; } };
});

const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}`;
const open = async (path: string, prepare: (state: State) => void, phone = true) => {
  phoneMedia(phone);
  return renderApp(path, prepare);
};
const as = (userId: string) => (state: State) => { state.session.currentUserId = userId; };
const sheetOf = (name: string | RegExp) => screen.findByRole('dialog', { name });
const mains = (root: HTMLElement) => root.querySelectorAll('.signature');
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  seen.props.length = 0;
});

describe('the task panel on a phone (Direction D)', () => {
  it('passes tall and a phoneHeader to the Sheet', async () => {
    await open(TASK('tsk_007'), as('usr_002'));
    await sheetOf('Stair details');
    const last = seen.props[seen.props.length - 1];
    expect(last.tall).toBe(true);
    expect(last.phoneHeader).toBeTruthy();
  });

  it('names the dialog by the task title and keeps the sr-only title with data-sheet-title', async () => {
    await open(TASK('tsk_007'), as('usr_002'));
    const sheet = await sheetOf('Stair details');
    const title = sheet.querySelector('[data-sheet-title]');
    expect(title).toHaveTextContent('Stair details');
    expect(title).toHaveClass('sr-only');
    expect(title).toHaveAttribute('tabindex', '-1');
  });

  it('draws the blocks in the order of the design', async () => {
    await open(TASK('tsk_007'), as('usr_006'));
    const sheet = await sheetOf('Stair details');
    const link = await within(sheet).findByRole('link', { name: 'Corniche Office Tower' });
    const focus = within(sheet).getByRole('button', { name: 'Focus' });
    const close = within(sheet).getByRole('button', { name: 'Close' });
    const title = within(sheet).getByRole('button', { name: /Stair details/ });
    const state = within(sheet).getAllByText('In progress')[0];
    const step = sheet.querySelector('[data-next-step]') as HTMLElement;
    const tabs = within(sheet).getByRole('tablist');
    const people = within(sheet).getByRole('region', { name: 'People' });
    const order = [link, focus, close, title, state, step, tabs, people];
    for (let i = 0; i < order.length - 1; i += 1) expect(follows(order[i], order[i + 1]), `block ${i} before block ${i + 1}`).toBe(true);
  });

  it('draws the office note under the state line for an office to-do', async () => {
    await open('/work?task=tsk_900', (state) => { state.session.currentUserId = 'usr_005'; addOfficeTask(state); });
    const sheet = await sheetOf('Renew the trade licence');
    const note = await within(sheet).findByText("Office to-do. Only its people and the Admin see it.");
    expect(within(sheet).getByText('Office')).toBeInTheDocument();
    expect(within(sheet).queryByRole('link', { name: 'Corniche Office Tower' })).toBeNull();
    expect(follows(within(sheet).getByRole('button', { name: /Renew the trade licence/ }), note)).toBe(true);
    expect(follows(note, within(sheet).getByRole('tablist'))).toBe(true);
  });

  it.each([
    ['review', 'tsk_010', 'usr_002', {}],
    ['take', 'tsk_007', 'usr_005', { ownerId: null, status: 'todo' }],
    ['complete', 'tsk_007', 'usr_006', {}],
    ['waiting', 'tsk_008', 'usr_008', {}],
    ['new version', 'tsk_007', 'usr_006', { status: 'done' }],
    ['join', 'tsk_011', 'usr_005', {}],
    ['none', 'tsk_011', 'usr_005', { helperIds: ['usr_005'] }],
  ] as const)('draws one main button at most for the kind %s, in both views', async (_kind, taskId, userId, patch) => {
    await open(TASK(taskId), (state) => {
      if (taskId === 'tsk_008') state.session.currentUserId = userId;
      else setupTask(taskId, userId, patch as never)(state);
    });
    const sheet = await sheetOf(/./);
    await within(sheet).findByRole('tablist');
    await waitFor(() => expect(sheet.querySelector('[data-next-step]')).not.toBeNull());
    expect(mains(sheet).length).toBeLessThanOrEqual(1);
    await userEvent.click(within(sheet).getByRole('tab', { name: /^Conversation/ }));
    await within(sheet).findByRole('region', { name: 'Comments' });
    expect(mains(sheet).length).toBeLessThanOrEqual(1);
  });

  it('gives every row a labelled native control', async () => {
    await open(TASK('tsk_007'), as('usr_002'));
    const sheet = await sheetOf('Stair details');
    await within(sheet).findByRole('region', { name: 'People' });
    const controls = [...sheet.querySelectorAll<HTMLElement>('select, textarea, [role="switch"], input:not([type="hidden"])')];
    expect(controls.length).toBeGreaterThan(6);
    for (const control of controls) {
      const named = control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')
        || (control.id && sheet.querySelector(`label[for="${control.id}"]`)) || control.closest('label');
      expect(named, control.outerHTML.slice(0, 120)).toBeTruthy();
    }
    for (const select of sheet.querySelectorAll('select')) expect(select).toHaveClass('opacity-0');
  });

  it('shows a reader no control', async () => {
    await open(TASK('tsk_011'), (state) => {
      setupTask('tsk_011', 'usr_005')(state);
      state.tasks.tsk_011.checklist = [{ id: 'chk_a', text: 'Stamp', done: false }];
    });
    const sheet = await sheetOf('Balady submission set');
    await within(sheet).findByRole('region', { name: 'People' });
    expect(sheet.querySelectorAll('select, textarea, [role="switch"], input:not([type="hidden"])')).toHaveLength(0);
    expect(within(sheet).getByText(/^You can view this to-do/)).toBeInTheDocument();
  });

  it('switches to the Conversation with the pill, keeps role=tab named Conversation (n), and the link thread=1', async () => {
    const { router } = await open(TASK('tsk_007'), as('usr_006'));
    const sheet = await sheetOf('Stair details');
    const tab = await within(sheet).findByRole('tab', { name: /^Conversation/ });
    expect(within(sheet).getByRole('tablist').querySelector('[data-thumb="task-section-thumb"]')).not.toBeNull();
    await userEvent.click(tab);
    await waitFor(() => expect(router.state.location.search).toContain('thread=1'));
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('docks the box and hides the heading in the Conversation view', async () => {
    await open(`${TASK('tsk_007')}&thread=1`, as('usr_006'));
    const sheet = await sheetOf('Stair details');
    await within(sheet).findByRole('textbox', { name: 'Add a comment' });
    expect(sheet.querySelector('[data-comment-dock]')).not.toBeNull();
    expect(within(sheet).queryByRole('heading', { name: 'Comments' })).toBeNull();
  });

  it('keeps the next step slot in both views and turns its button secondary in the Conversation', async () => {
    await open(TASK('tsk_007'), as('usr_006'));
    const sheet = await sheetOf('Stair details');
    const done = await within(sheet).findByRole('button', { name: 'Mark done' });
    expect(done).toHaveClass('signature');
    await userEvent.click(within(sheet).getByRole('tab', { name: /^Conversation/ }));
    const again = await within(sheet).findByRole('button', { name: 'Mark done' });
    expect(sheet.querySelector('[data-next-step]')).not.toBeNull();
    expect(again).not.toHaveClass('signature');
  });

  it('opens the Conversation first for a link with thread=1', async () => {
    await open(`${TASK('tsk_007')}&thread=1`, as('usr_006'));
    const sheet = await sheetOf('Stair details');
    expect(await within(sheet).findByRole('tab', { name: /^Conversation/ })).toHaveAttribute('aria-selected', 'true');
    expect(await within(sheet).findByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('closes the panel by the X and by Back, and saves a typed description at close', async () => {
    const { store, router } = await open('/projects/prj_001?tab=tasks', as('usr_002'));
    await router.navigate(TASK('tsk_007'));
    const sheet = await sheetOf('Stair details');
    await userEvent.type(await within(sheet).findByRole('textbox', { name: 'Description' }), 'Bring the tape.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
    await waitFor(() => expect(store.state.tasks.tsk_007.description).toBe('Bring the tape.'));
    await router.navigate(TASK('tsk_007'));
    await sheetOf('Stair details');
    await router.navigate(-1);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair details' })).toBeNull());
  });

  it('keeps the Focus button', async () => {
    await open(TASK('tsk_007'), as('usr_006'));
    const sheet = await sheetOf('Stair details');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Focus' }));
    expect(await screen.findByRole('dialog', { name: 'Focus' })).toBeInTheDocument();
  });

  it('does not change the desk panel', async () => {
    await open(TASK('tsk_007'), as('usr_002'), false);
    const sheet = await sheetOf('Stair details');
    expect(await within(sheet).findByLabelText('Title')).toBeInTheDocument();
    expect(within(sheet).getByRole('tab', { name: 'Details' })).toBeInTheDocument();
    expect(sheet.querySelector('[data-next-step]')).toBeNull();
    expect(sheet.querySelector('[data-thumb]')).toBeNull();
  });
});
