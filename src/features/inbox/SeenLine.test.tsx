import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserCard } from '../../api/contract/views';
import { chatReadKey } from '../../api/store';
import { renderApp } from '../../test/render';
import type { Bubble } from './MessageBubble';
import { FAISAL, HALA, OMAR, makeBubble, renderLog } from './logHarness';
import type { SeenInfo } from './SeenLine';

/** Seen and Seen by N under the last own message (chat presence design C, F3). */
const REEM: UserCard = { id: 'usr_003', name: 'Reem Al-Ghamdi', nameAr: 'ريم الغامدي', avatarUrl: null, kind: 'human', discipline: 'Architect', gender: 'female' };
const SARA: UserCard = { id: 'usr_005', name: 'Sara Al-Qahtani', nameAr: 'سارة القحطاني', avatarUrl: null, kind: 'human', discipline: 'Architect', gender: 'female' };
const people = [FAISAL, OMAR, REEM, SARA];

const AT = '2026-09-29T10:00:00.000+03:00';
const LATER = '2026-09-29T10:30:00.000+03:00';
const EARLIER = '2026-09-29T09:30:00.000+03:00';
const talkWithMine = (over: Partial<Bubble> = {}): Bubble[] => [
  makeBubble({ id: 'msg_1', createdAt: '2026-09-29T09:00:00.000+03:00', body: 'First' }),
  makeBubble({ id: 'msg_2', createdAt: AT, body: 'Mine', author: HALA, mine: true, ...over }),
];
const direct = (readers: SeenInfo['readers'], context?: 'female'): SeenInfo => ({ kind: 'direct', readers, others: 1, people, ...(context ? { context } : {}) });
const group = (readers: SeenInfo['readers'], others = 3): SeenInfo => ({ kind: 'group', readers, others, people });

describe('Seen in a direct chat', () => {
  it('shows Seen once the other person looked, and nothing before', () => {
    renderLog({ bubbles: talkWithMine(), seen: direct([]) });
    expect(screen.queryByText('Seen')).toBeNull();
  });

  it('shows Seen under the last own message when the seen time is not before it', () => {
    renderLog({ bubbles: talkWithMine(), seen: direct([{ userId: 'usr_002', at: LATER }]) });
    const line = screen.getByText('Seen');
    expect(line.closest('li')).toHaveClass('text-caption', 'text-ink-2');
    // It sits right after the own message.
    expect(screen.getByText('Mine').closest('li')?.nextElementSibling).toBe(line.closest('li'));
    expect(screen.queryByRole('button', { name: /Seen/ })).toBeNull();
  });

  it('shows nothing when the look was before the message', () => {
    renderLog({ bubbles: talkWithMine(), seen: direct([{ userId: 'usr_002', at: EARLIER }]) });
    expect(screen.queryByText('Seen')).toBeNull();
  });
});

describe('Seen by N in a group', () => {
  const readers = (n: number) => ['usr_002', 'usr_004', 'usr_003'].slice(0, n).map((userId) => ({ userId, at: LATER }));

  it('shows nothing at 0, Seen by 1, Seen by 2, then Seen by everyone', () => {
    const view = renderLog({ bubbles: talkWithMine(), seen: group(readers(0)) });
    expect(screen.queryByText(/Seen/)).toBeNull();
    view.rerender({ bubbles: talkWithMine(), seen: group(readers(1)) });
    expect(screen.getByRole('button', { name: 'Seen by 1' })).toBeInTheDocument();
    view.rerender({ bubbles: talkWithMine(), seen: group(readers(2)) });
    expect(screen.getByRole('button', { name: 'Seen by 2' })).toBeInTheDocument();
    view.rerender({ bubbles: talkWithMine(), seen: group(readers(3)) });
    expect(screen.queryByRole('button', { name: /Seen by 3/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Seen by everyone' })).toBeInTheDocument();
  });

  it('counts only the looks that came after the message', () => {
    renderLog({ bubbles: talkWithMine(), seen: group([{ userId: 'usr_002', at: LATER }, { userId: 'usr_004', at: EARLIER }]) });
    expect(screen.getByRole('button', { name: 'Seen by 1' })).toBeInTheDocument();
  });

  it('keeps a 44 px press area', () => {
    renderLog({ bubbles: talkWithMine(), seen: group([{ userId: 'usr_002', at: LATER }]) });
    expect(screen.getByRole('button', { name: 'Seen by 1' })).toHaveClass('min-h-11');
  });

  it('opens the names with Enter, with no times, and closes with Escape', async () => {
    renderLog({ bubbles: talkWithMine(), seen: group([{ userId: 'usr_002', at: LATER }, { userId: 'usr_003', at: LATER }]) });
    const button = screen.getByRole('button', { name: 'Seen by 2' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    const popover = within(await screen.findByRole('dialog', { name: 'Seen by' }));
    expect(popover.getByText('Faisal Al-Harbi')).toBeInTheDocument();
    expect(popover.getByText('Reem Al-Ghamdi')).toBeInTheDocument();
    expect(popover.queryByText(/\d\d:\d\d/)).toBeNull();
    expect(popover.queryByRole('time')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Seen by' })).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('where the line sits', () => {
  it('shows it only under the last own message', () => {
    const bubbles = [
      ...talkWithMine(),
      makeBubble({ id: 'msg_3', createdAt: LATER, body: 'Their answer' }),
    ];
    // The last message is not mine, but the last own message is "Mine": the line sits under it.
    renderLog({ bubbles, seen: direct([{ userId: 'usr_002', at: '2026-09-29T11:00:00.000+03:00' }]) });
    expect(screen.getAllByText('Seen')).toHaveLength(1);
    expect(screen.getByText('Mine').closest('li')?.nextElementSibling).toBe(screen.getByText('Seen').closest('li'));
  });

  it('does not show it under an older own message when a newer own message exists', () => {
    const bubbles = [
      ...talkWithMine(),
      makeBubble({ id: 'msg_3', createdAt: LATER, body: 'Newest', author: HALA, mine: true }),
    ];
    renderLog({ bubbles, seen: direct([{ userId: 'usr_002', at: '2026-09-29T10:15:00.000+03:00' }]) });
    // The look is after "Mine" but before "Newest": the last own message is not seen yet.
    expect(screen.queryByText('Seen')).toBeNull();
  });

  it('shows nothing under a message that is not sent yet', () => {
    const bubbles = [...talkWithMine(), makeBubble({ id: 'out-1', createdAt: LATER, body: 'Waiting', author: HALA, mine: true, status: 'pending' })];
    renderLog({ bubbles, seen: direct([{ userId: 'usr_002', at: '2026-09-29T12:00:00.000+03:00' }]) });
    expect(screen.queryByText('Seen')).toBeNull();
  });

  it('shows nothing when the log has no seen information (a task thread)', () => {
    renderLog({ bubbles: talkWithMine() });
    expect(screen.queryByText('Seen')).toBeNull();
  });
});

describe('Seen in Arabic', () => {
  it('says قرأتها for Reem and قرأها for Faisal', () => {
    const view = renderLog({ bubbles: talkWithMine(), seen: direct([{ userId: 'usr_003', at: LATER }], 'female') }, { lang: 'ar' });
    expect(screen.getByText('قرأتها')).toBeInTheDocument();
    view.rerender({ bubbles: talkWithMine(), seen: direct([{ userId: 'usr_002', at: LATER }]) });
    expect(screen.getByText('قرأها')).toBeInTheDocument();
  });

  it('uses the one, two and many forms of Seen by', () => {
    const view = renderLog({ bubbles: talkWithMine(), seen: group([{ userId: 'usr_002', at: LATER }], 9) }, { lang: 'ar' });
    expect(screen.getByRole('button', { name: 'قرأها شخص واحد' })).toBeInTheDocument();
    const some = (n: number) => ({ bubbles: talkWithMine(), seen: group(Array.from({ length: n }, (_, i) => ({ userId: `usr_0${10 + i}`, at: LATER })), 200) });
    view.rerender(some(2));
    expect(screen.getByRole('button', { name: 'قرأها شخصان' })).toBeInTheDocument();
    view.rerender(some(3));
    expect(screen.getByRole('button', { name: 'قرأها 3 أشخاص' })).toBeInTheDocument();
    view.rerender(some(11));
    expect(screen.getByRole('button', { name: 'قرأها 11 شخصًا' })).toBeInTheDocument();
    view.rerender(some(100));
    expect(screen.getByRole('button', { name: 'قرأها 100 شخص' })).toBeInTheDocument();
  });

  it('says قرأها الجميع and titles the list من قرأها', async () => {
    renderLog({ bubbles: talkWithMine(), seen: group([{ userId: 'usr_002', at: LATER }], 1) }, { lang: 'ar' });
    await userEvent.click(screen.getByRole('button', { name: 'قرأها الجميع' }));
    expect(await screen.findByRole('dialog', { name: 'من قرأها' })).toBeInTheDocument();
  });
});

describe('Seen in the chat pane', () => {
  const room = (state: { conversations: Record<string, { id: string; kind: string; memberIds: string[] }> }) => (
    Object.values(state.conversations).find((c) => c.kind === 'direct' && c.memberIds.includes('usr_001') && c.memberIds.includes('usr_003'))!
  );
  const seenBy = (at: string) => (state: Parameters<NonNullable<Parameters<typeof renderApp>[1]>>[0]) => {
    const id = room(state).id;
    state.chatReads[chatReadKey(id, 'usr_003')] = { conversationId: id, userId: 'usr_003', lastReadAt: at, seenAt: at };
  };

  it('shows Seen under the last own message of a direct chat when the other person looked', async () => {
    await renderApp('/inbox', seenBy('2026-09-30T09:30:00.000+03:00'));
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Reem Al-Ghamdi/ }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    const mine = (await log.findByText('Good news. Please tell the team and update the stage.')).closest('li');
    expect(mine?.nextElementSibling).toHaveTextContent('Seen');
  });

  it('shows nothing when the other person has no seen time', async () => {
    await renderApp('/inbox');
    await userEvent.click(await within(await screen.findByRole('list', { name: 'Chats' })).findByRole('link', { name: /Reem Al-Ghamdi/ }));
    const log = within(await screen.findByRole('log', { name: 'Messages' }));
    await log.findByText('Good news. Please tell the team and update the stage.');
    expect(log.queryByText('Seen')).toBeNull();
  });
});
