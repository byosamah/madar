import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderApp } from '../../test/render';

// Render counters for the performance test (audit 2026-10-07, RND-3). The wrappers call the real parts, so every other test of
// this file sees the same screen. ageOf runs once in each render of an Age; RichText runs once in each render of a comment.
const renders = vi.hoisted(() => ({ ages: [] as string[], bodies: [] as string[] }));
vi.mock('../../lib/age', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/age')>();
  return { ...real, ageOf: (stamp: string, at: Date) => { renders.ages.push(stamp); return real.ageOf(stamp, at); } };
});
vi.mock('../../components/RichText', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/RichText')>();
  return { ...real, RichText: (props: Parameters<typeof real.RichText>[0]) => { renders.bodies.push(props.body); return <real.RichText {...props} />; } };
});

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const TASK = (id: string) => `/projects/prj_001?tab=tasks&task=${id}&thread=1`;

describe('comments', () => {
  it('adds a comment with a mention on a task', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Checked with @Kh');
    await userEvent.click(within(sheet).getByRole('option', { name: 'Khalid Al-Mutairi' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Checked with @[Khalid Al-Mutairi](usr_008)')).toBe(true));
    expect(await within(sheet).findByText('@Khalid Al-Mutairi')).toBeInTheDocument();
  });

  // A half-written comment survives a closed panel, for example Focus mode or another task row (audit PER-11).
  it('keeps a half-written comment when the panel closes and opens again', async () => {
    const { router } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Half a thought');
    await router.navigate('/projects/prj_001?tab=tasks');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await router.navigate(TASK('tsk_007'));
    const again = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(again).findByRole('textbox', { name: 'Add a comment' })).toHaveValue('Half a thought');
  });

  it('shows the next person no half-written comment of the person before, after Preview as (audit 2026-10-03, V-22)', async () => {
    const { api } = await renderApp(TASK('tsk_007'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Only for Hala');
    await act(async () => { await api.call('session.previewAs', { userId: 'usr_002' }); });
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Stair details' })).getByRole('textbox', { name: 'Add a comment' })).toHaveValue(''));
  });

  it('reads the Inbox thread of the task when its comments show in the task panel (audit 2026-10-03, SHL-5)', async () => {
    const { store, api } = await renderApp(TASK('tsk_007'), (state) => {
      state.session.currentUserId = 'usr_006';
      state.comments.cmt_901 = {
        id: 'cmt_901', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_002', body: 'Please check the landing.',
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('Please check the landing.')).toBeInTheDocument();
    await waitFor(() => expect(Object.values(store.state.chatReads).some((r) => r.conversationId === 'tsk_007' && r.userId === 'usr_006')).toBe(true));
    expect((await api.call('chats.list', {})).find((row) => row.id === 'tsk_007')?.unread).toBe(0);
  });

  it('shows a picture of a task comment as a preview, and a press opens the viewer with Close and Download (owner, 2026-10-19)', async () => {
    const save = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.upload(
      within(sheet).getByLabelText('Attach files'),
      [new File(['x'], 'Stair site.jpg', { type: 'image/jpeg' }), new File(['y'], 'Stair detail.pdf', { type: 'application/pdf' })],
    );
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Photo and detail.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    const preview = await within(sheet).findByRole('button', { name: 'View Stair site.jpg' });
    expect(within(sheet).getByRole('button', { name: 'Download Stair detail.pdf' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Download Stair site.jpg' })).toBeNull();
    await userEvent.click(preview);
    const viewer = await screen.findByRole('dialog', { name: 'Stair site.jpg' });
    await userEvent.click(within(viewer).getByRole('button', { name: 'Download Stair site.jpg' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    // The viewer opens over the task panel: Close shuts the viewer only, and the focus goes back to the preview.
    await userEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stair site.jpg' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Stair details' })).toBeInTheDocument();
    await waitFor(() => expect(preview).toHaveFocus());
    save.mockRestore();
  });

  it('attaches a file to a task comment and shows it as a chip', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.upload(within(sheet).getByLabelText('Attach files'), new File(['x'], 'Stair detail.pdf', { type: 'application/pdf' }));
    expect(within(sheet).getByText('Stair detail.pdf')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Detail attached.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    const chip = await within(sheet).findByRole('button', { name: 'Download Stair detail.pdf' });
    expect(chip).toBeInTheDocument();
    const file = Object.values(store.state.files).find((f) => f.name === 'Stair detail.pdf');
    expect(file).toMatchObject({ projectId: 'prj_001', taskId: 'tsk_007' });
    expect(Object.values(store.state.comments).find((c) => c.body === 'Detail attached.')?.fileIds).toEqual([file?.id]);
  });

  it('takes a picture from the clipboard like the attach button, and leaves a text paste alone (fbk_032)', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const box = within(sheet).getByRole('textbox', { name: 'Add a comment' });
    const clip = (files: File[], text: string) => ({ files, types: files.length > 0 ? ['Files'] : ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') });
    expect(fireEvent.paste(box, { clipboardData: clip([], 'Some words') })).toBe(true);
    expect(within(sheet).queryByRole('list', { name: 'Files to send' })).toBeNull();
    expect(fireEvent.paste(box, { clipboardData: clip([new File(['x'], 'Landing.png', { type: 'image/png' })], '') })).toBe(false);
    expect(within(within(sheet).getByRole('list', { name: 'Files to send' })).getByText('Landing.png')).toBeInTheDocument();
    await userEvent.type(box, 'The landing.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByRole('button', { name: 'View Landing.png' });
    expect(Object.values(store.state.files).find((f) => f.name === 'Landing.png')).toMatchObject({ projectId: 'prj_001', taskId: 'tsk_007' });
  });

  it('takes files dropped on the comments like the attach button, and shows the overlay while they are over (fbk_030)', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const zone = within(sheet).getByRole('region', { name: 'Comments' }).closest('[data-drop-zone]') as HTMLElement;
    const drag = (files: File[]) => ({ dataTransfer: { types: ['Files'], files, dropEffect: 'none' } });
    const detail = new File(['x'], 'Stair detail.pdf', { type: 'application/pdf' });
    fireEvent.dragEnter(zone, drag([detail]));
    expect(within(sheet).getByText('Drop to attach')).toBeInTheDocument();
    fireEvent.drop(zone, drag([detail]));
    expect(within(sheet).queryByText('Drop to attach')).toBeNull();
    expect(within(within(sheet).getByRole('list', { name: 'Files to send' })).getByText('Stair detail.pdf')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'Dropped.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByRole('button', { name: 'Download Stair detail.pdf' });
    expect(Object.values(store.state.files).find((f) => f.name === 'Stair detail.pdf')).toMatchObject({ projectId: 'prj_001', taskId: 'tsk_007' });
  });

  it('shows a deleted file in a comment as removed', async () => {
    await renderApp(TASK('tsk_007'), (state) => {
      state.session.currentUserId = 'usr_006';
      state.comments.cmt_902 = {
        id: 'cmt_902', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_006', body: 'The old detail.', fileIds: ['fil_999'],
        reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
      };
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('The old detail.')).toBeInTheDocument();
    expect(within(sheet).getByText('File removed')).toBeInTheDocument();
  });

  it('toggles a reaction', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    const [look] = await within(sheet).findAllByRole('button', { name: /React with 👀/ });
    await userEvent.click(look);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👀'].includes('usr_006'))).toBe(true));
    await waitFor(() => expect(within(sheet).getAllByRole('button', { name: /React with 👀/ })[0]).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(within(sheet).getAllByRole('button', { name: /React with 👀/ })[0]);
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.reactions['👀'].includes('usr_006'))).toBe(false));
  });

  it('edits and deletes my own comment, with Undo', async () => {
    const { store } = await renderApp(TASK('tsk_007'), as('usr_006'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Add a comment' }), 'First draft');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send' }));
    await within(sheet).findByText('First draft');
    const mine = () => within(sheet).getByText(/First draft|Second draft/).closest('li') as HTMLElement;
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const box = within(mine()).getByRole('textbox', { name: 'Edit' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Second draft');
    await userEvent.click(within(mine()).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Second draft')).toBeInTheDocument();
    expect(within(mine()).getByText(/edited/)).toBeInTheDocument();
    await userEvent.click(within(mine()).getByRole('button', { name: 'Actions for this comment' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(false));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((c) => c.body === 'Second draft')).toBe(true));
  });

  it('shows a person outside the project the comments only', async () => {
    await renderApp(TASK('tsk_007'), as('usr_003'));
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' });
    expect(await within(sheet).findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /React with/ })).toBeNull();
  });

  it('opens the thread of the post in the link', async () => {
    await renderApp('/projects/prj_001?tab=activity&update=upd_002', as('usr_002'));
    expect(await screen.findByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
  });

  it('lets the author delete a post, then brings it back with Undo', async () => {
    const { store } = await renderApp('/projects/prj_001?tab=activity', as('usr_005'));
    const post = (await screen.findByText(/I uploaded revision B/)).closest('li') as HTMLElement;
    await userEvent.click(within(post).getByRole('button', { name: 'Actions for this post' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.updates.upd_002).toBeDefined());
  });

  it('types in the comment box with no new render of the comments, and every age still reads the clock on each key (performance audit RND-3)', async () => {
    const stamps = Array.from({ length: 20 }, (_, i) => `2026-09-29T${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:07.000+03:00`);
    const { store } = await renderApp(TASK('tsk_007'), (state) => {
      state.session.currentUserId = 'usr_006';
      stamps.forEach((createdAt, i) => {
        state.comments[`cmt_8${String(i).padStart(2, '0')}`] = {
          id: `cmt_8${String(i).padStart(2, '0')}`, targetType: 'task', targetId: 'tsk_007', authorId: 'usr_002', body: `Comment ${i}.`,
          reactions: { '👍': [], '✅': [], '👀': [] }, createdAt, editedAt: null,
        };
      });
    });
    const sheet = await screen.findByRole('dialog', { name: 'Stair details' }, { timeout: 10_000 });
    expect(await within(sheet).findByText('Comment 19.')).toBeInTheDocument();
    await waitFor(() => expect(Object.values(store.state.chatReads).some((r) => r.conversationId === 'tsk_007' && r.userId === 'usr_006')).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    const comments = () => renders.bodies.filter((body) => body.startsWith('Comment ')).length;
    const ages = () => renders.ages.filter((stamp) => stamps.includes(stamp)).length;
    const before = { comments: comments(), ages: ages() };
    const box = within(sheet).getByRole('textbox', { name: 'Add a comment' });
    await userEvent.type(box, 'abcde');
    expect(box).toHaveValue('abcde');
    expect(comments()).toBe(before.comments);
    expect(ages()).toBeGreaterThanOrEqual(before.ages + 5 * stamps.length);
  }, 30_000);
});
