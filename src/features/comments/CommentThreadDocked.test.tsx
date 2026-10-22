import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { State } from '../../api/store';
import { renderPanel } from '../../test/renderPanel';
import type { TaskPanel } from '../project/tasks/useTaskPanel';
import { CommentThread } from './CommentThread';

type Flags = { docked?: boolean; hideTitle?: boolean; canPost?: boolean; canAttach?: boolean };
const thread = (flags: Flags) => (panel: TaskPanel) => (
  <CommentThread
    targetType="task" targetId={panel.task.id} projectId={panel.detail?.project.id ?? null} people={panel.people}
    canPost={flags.canPost ?? true} canAttach={flags.canAttach ?? true} everyone={3} docked={flags.docked} hideTitle={flags.hideTitle}
  />
);
const prepare = (state: State) => {
  state.session.currentUserId = 'usr_006';
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_002', body: 'Please check the landing.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T08:00:00.000+03:00', editedAt: null,
  };
};
const open = (flags: Flags) => renderPanel('tsk_007', { phone: true, prepare, render: thread(flags) });
/** The calls of scrollIntoView on the end marker of the thread (other parts of the screen may call it too). */
const endCalls = (spy: { mock: { contexts: unknown[] } }) => spy.mock.contexts.filter((node) => node instanceof Element && node.hasAttribute('data-comment-end'));

describe('CommentThread docked (Direction D)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('hides the heading Comments and keeps the section name', async () => {
    await open({ docked: true, hideTitle: true });
    expect(await screen.findByRole('region', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Comments' })).toBeNull();
  });

  it('puts the box in a dock at the bottom of the scroll area', async () => {
    await open({ docked: true, hideTitle: true });
    await screen.findByRole('textbox', { name: 'Add a comment' });
    const dock = document.querySelector('[data-comment-dock]');
    expect(dock).not.toBeNull();
    // The scroll area has 20 px of padding at its end. A sticky box keeps that padding free, so the dock reaches under it with -bottom-5
    // and leaves no strip of comments below the box.
    expect(dock).toHaveClass('sticky', '-bottom-5', 'border-t', 'bg-panel');
    expect(within(dock as HTMLElement).getByRole('textbox', { name: 'Add a comment' })).toBeInTheDocument();
    expect(within(dock as HTMLElement).getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('opens the @ list above the box and keeps the row Everyone', async () => {
    await open({ docked: true, hideTitle: true });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Add a comment' }), '@');
    const list = await screen.findByRole('listbox');
    expect(list).toHaveClass('bottom-full');
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('Everyone · 3 people');
  });

  it('scrolls to the newest comment when the comments arrive', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    await open({ docked: true, hideTitle: true });
    expect(await screen.findByText('Please check the landing.')).toBeInTheDocument();
    await waitFor(() => expect(endCalls(spy)).toHaveLength(1));
  });

  it('scrolls again to the comment that the reader sends, so it shows above the box and not under it', async () => {
    // Without this scroll the new comment sat under the dock: the reader sent a comment and did not see it (browser check, task panel).
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const { store } = await open({ docked: true, hideTitle: true });
    expect(await screen.findByText('Please check the landing.')).toBeInTheDocument();
    await waitFor(() => expect(endCalls(spy)).toHaveLength(1));
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Done.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(Object.values(store.state.comments).some((comment) => comment.body === 'Done.')).toBe(true));
    expect(await screen.findByText('Done.')).toBeInTheDocument();
    await waitFor(() => expect(endCalls(spy)).toHaveLength(2));
  });

  it('keeps the place of the reader when a comment of another person arrives', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    const { store } = await open({ docked: true, hideTitle: true });
    expect(await screen.findByText('Please check the landing.')).toBeInTheDocument();
    await waitFor(() => expect(endCalls(spy)).toHaveLength(1));
    act(() => {
      store.run((state) => {
        state.comments.cmt_902 = {
          id: 'cmt_902', targetType: 'task', targetId: 'tsk_007', authorId: 'usr_002', body: 'One more thing.',
          reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T09:00:00.000+03:00', editedAt: null,
        };
      });
    });
    expect(await screen.findByText('One more thing.')).toBeInTheDocument();
    expect(endCalls(spy)).toHaveLength(1);
  });

  it('leaves room for the dock when it scrolls to the newest comment, so the newest comment ends above the box', async () => {
    // The dock is a sticky box over the end of the scroll area. A scroll that puts the end marker at the bottom edge hid the newest comment
    // under the box, and the 25 px that this scroll moved cut the title of the to-do in half (browser check, WebKit 393 x 659).
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(140);
    const room: string[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scroll(this: Element) {
      if (this.hasAttribute('data-comment-end')) room.push((this as HTMLElement).style.getPropertyValue('--dock-height'));
    });
    await open({ docked: true, hideTitle: true });
    expect(await screen.findByText('Please check the landing.')).toBeInTheDocument();
    await waitFor(() => expect(room).toEqual(['140px']));
    expect(document.querySelector('[data-comment-end]')).toHaveClass('scroll-mb-[var(--dock-height,0px)]');
  });

  it('keeps Attach only with canAttach and shows comments.cannot without canPost', async () => {
    const view = await open({ docked: true, canAttach: false });
    await screen.findByRole('textbox', { name: 'Add a comment' });
    expect(screen.queryByLabelText('Attach files')).toBeNull();
    view.unmount();
    const second = await open({ docked: true, canAttach: true });
    await screen.findByRole('textbox', { name: 'Add a comment' });
    expect(screen.getByLabelText('Attach files')).toBeInTheDocument();
    second.unmount();
    await open({ docked: true, canPost: false });
    expect(await screen.findByText('Only the project team can comment here.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
  });

  it('keeps the old layout when docked is false', async () => {
    await open({});
    expect(await screen.findByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    expect(document.querySelector('[data-comment-dock]')).toBeNull();
    expect(document.querySelector('[data-comment-end]')).toBeNull();
  });
});
