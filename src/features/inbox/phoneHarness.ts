import { act } from '@testing-library/react';
import { onTestFinished } from 'vitest';
import { addGroupConversation } from '../../api/chatState';
import { chatReadKey } from '../../api/rowKeys';
import type { State } from '../../api/store';
import { fakeVisualViewport as baseViewport, phoneMedia } from '../../test/phoneMedia';

/**
 * Helpers for the phone tests of the Inbox. They only wrap `src/test/phoneMedia.ts`, the one phone media helper of the app
 * (Direction D, amendment 1). A test file imports this file. The app code never does.
 */

/** Makes jsdom a phone (narrow, the default) or a desk, and a finger (coarse) or a mouse. `set` turns either one. */
export function stubPhone(initial: { narrow?: boolean; coarse?: boolean } = {}): { set(next: { narrow?: boolean; coarse?: boolean }): void } {
  const media = phoneMedia({ phone: initial.narrow ?? true, coarse: initial.coarse ?? false });
  return {
    set(next) {
      act(() => {
        if (next.narrow !== undefined) media.set(next.narrow);
        if (next.coarse !== undefined) media.setCoarse(next.coarse);
      });
    },
  };
}

/**
 * A fake `window.visualViewport` over a window of `innerHeight` (800 by default). `set` moves it and tells the listeners, as
 * Safari for iPhone does when the keyboard opens.
 */
export function fakeVisualViewport(initial: { height: number; offsetTop?: number; innerHeight?: number }): { set(next: { height?: number; offsetTop?: number }): void } {
  const base = baseViewport({ height: initial.height, offsetTop: initial.offsetTop ?? 0 });
  const before = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: initial.innerHeight ?? 800 });
  onTestFinished(() => {
    if (before) Object.defineProperty(window, 'innerHeight', before);
  });
  return {
    set(next) {
      act(() => {
        base.set(next);
        base.fire('resize');
        base.fire('scroll');
      });
    },
  };
}

/** Hala (the Admin) sees a project chat, a direct chat, a group and a task thread, one of each kind at least. */
export const withEveryKind = (state: State) => {
  const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_006');
  if (!task) throw new Error('The sample has no task in the clinic project.');
  task.title = 'Room finish schedule';
  state.comments.cmt_901 = {
    id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_006', body: 'The finish codes are ready.',
    reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: '2026-09-30T07:00:00.000+03:00', editedAt: null,
  };
  addGroupConversation(state, 'Site crew', 'usr_001', ['usr_001', 'usr_002', 'usr_005'], '2026-09-29T09:00:00.000+03:00');
};

/** A group "Tower team" of Hala (usr_001, the maker), Faisal (usr_002) and Reem (usr_003). */
export const withGroup = (state: State) => {
  addGroupConversation(state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], '2026-09-30T09:00:00.000+03:00');
};

/** The project chat of the Corniche Office Tower is archived for Hala (usr_001). */
export const withArchivedTower = (state: State) => {
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001');
  if (!room) throw new Error('The sample has no project chat for prj_001.');
  state.chatReads[chatReadKey(room.id, 'usr_001')] = {
    conversationId: room.id, userId: 'usr_001', lastReadAt: '2026-09-30T09:00:00.000+03:00', archivedAt: '2099-01-01T00:00:00.000+03:00',
  };
};
