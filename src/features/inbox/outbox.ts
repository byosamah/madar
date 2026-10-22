import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { User } from '../../api/contract/entities';
import { ApiError } from '../../api/errors';
import type { ReplyRef, UserCard } from '../../api/contract/views';
import { readDraft, writeDraft } from '../../app/drafts';
import { isPhoneNow } from '../../app/useIsPhone';
import { plainText } from '../../lib/text';
import type { Bubble } from './MessageBubble';

/**
 * Instant send (chat design 2026-10-19, item 13). A send puts an entry in the outbox at once. The log draws it as a faded bubble. The
 * server answers, and the saved message shows in the log (by the change signal, or by the reads that go with the write). The faded copy
 * goes when the saved message shows. The signal may come before the answer, or the answer before the signal, so the two meet here.
 */
export type Outgoing<I> = {
  /** A local name of the entry. The faded bubble has the id "out-<key>". */
  key: string;
  /** The input of the send, the same object for a retry, so a retry carries the key of the failed attempt (no double). */
  input: I;
  body: string;
  replyTo: ReplyRef | null;
  /** The time the faded bubble shows. */
  at: string;
  /** The ids of the messages in the log when the person sent. An older message with the same words is not this one. */
  seen: ReadonlySet<string>;
  failed: boolean;
  /** The id of the saved message, once the answer came. */
  savedId?: string;
};

/** The part of a saved message that the match reads. */
export type SavedItem = { id: string; mine: boolean; body: string };

/**
 * Which entries still wait, and which saved messages came from the outbox. The oldest entry goes first. An entry that knows its saved
 * message (the answer came) is taken by that message and by no other. An entry that does not know it yet is taken by the oldest saved
 * message of the person with the same words that was not in the log at the send and that no entry took. So two same words ("ok", "ok")
 * each find one copy, in the order they were sent.
 */
export function matchOutbox<I>(outgoing: readonly Outgoing<I>[], saved: readonly SavedItem[]): { unsent: Outgoing<I>[]; claimed: string[] } {
  const taken = new Set<string>();
  const unsent: Outgoing<I>[] = [];
  const claimed: string[] = [];
  for (const entry of outgoing) {
    const hit = entry.savedId === undefined
      ? saved.find((item) => item.mine && item.body === entry.body && !entry.seen.has(item.id) && !taken.has(item.id))
      : saved.find((item) => item.id === entry.savedId && !taken.has(item.id));
    if (hit) {
      taken.add(hit.id);
      claimed.push(hit.id);
    } else {
      unsent.push(entry);
    }
  }
  return { unsent, claimed };
}

/**
 * The outbox of one pane. `saved` is what the log shows now. `unsent` are the entries to draw as faded bubbles. `claimed` holds every id
 * a faded copy ever gave way to, for the life of the pane, so the saved bubble can skip its rise (the swap shows no second motion).
 * The render is pure: a saved message that took an entry is written to the state in an effect, and the entry leaves with it.
 */
export function useOutbox<I>(saved: readonly SavedItem[]) {
  const [state, setState] = useState<{ entries: Outgoing<I>[]; done: ReadonlySet<string> }>({ entries: [], done: new Set() });
  const { unsent, claimed: fresh } = matchOutbox(state.entries, saved.filter((item) => !state.done.has(item.id)));
  const freshKey = fresh.join(',');
  // An entry that a saved message took leaves the state for good, and its message is noted as claimed.
  useEffect(() => {
    if (freshKey === '') return;
    setState((now) => {
      const again = matchOutbox(now.entries, saved.filter((item) => !now.done.has(item.id)));
      return { entries: again.unsent, done: new Set([...now.done, ...again.claimed]) };
    });
    // The effect reads the latest saved list; it runs again only for a new claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshKey]);
  const add = useCallback((entry: Outgoing<I>) => setState((now) => ({ ...now, entries: [...now.entries, entry] })), []);
  const change = useCallback((match: (entry: Outgoing<I>) => boolean, patch: Partial<Outgoing<I>>) => {
    setState((now) => ({ ...now, entries: now.entries.map((entry) => (match(entry) ? { ...entry, ...patch } : entry)) }));
  }, []);
  const markFailed = useCallback((input: I) => change((entry) => entry.input === input, { failed: true }), [change]);
  const markSaved = useCallback((key: string, id: string) => change((entry) => entry.key === key, { savedId: id }), [change]);
  const markRetry = useCallback((key: string) => change((entry) => entry.key === key, { failed: false }), [change]);
  const claimed: ReadonlySet<string> = fresh.length === 0 ? state.done : new Set([...state.done, ...fresh]);
  return { unsent, claimed, add, markFailed, markSaved, markRetry };
}

/** The faded bubble of an entry: the person's own message, with its words and its reply link, and no files. */
export function bubbleOfOutgoing(entry: Outgoing<unknown>, me: UserCard): Bubble {
  return {
    id: `out-${entry.key}`, author: me, actingFor: null, body: entry.body, files: [], createdAt: entry.at, mine: true, edited: false,
    replyTo: entry.replyTo, status: entry.failed ? 'failed' : 'pending',
  };
}

let counter = 0;
/** A new local name for an entry of the outbox. */
export function newOutboxKey(): string {
  counter += 1;
  return `o${counter}`;
}

/** True while the pane is on screen. A failure that comes after the pane closed shows its toast, as before. */
export function usePaneOpen(): MutableRefObject<boolean> {
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  return open;
}

/**
 * The `onRefused` of a send. While the pane is open, the entry shows "Not sent" with its button. The toast stays away only for a
 * failure of the network or the server (code "failed"): that has the button. A refusal (a closed chat, a rule) still shows its toast
 * with the reason, and the entry shows "Not sent" beside it.
 */
export function refusedByOutbox<I>(paneOpen: boolean, markFailed: (input: I) => void, error: unknown, input: I): boolean {
  if (!paneOpen) return false;
  markFailed(input);
  return error instanceof ApiError && error.code === 'failed';
}

/** The card of the reader for the faded bubbles. Picture data stays out, as in every card. */
export function cardOfUser(user: User): UserCard {
  return { id: user.id, name: user.name, ...(user.nameAr ? { nameAr: user.nameAr } : {}), avatarUrl: null, kind: user.kind, discipline: user.discipline, ...(user.gender ? { gender: user.gender } : {}) };
}

/**
 * Keeps the words of a message that was not sent as the draft of its chat (Direction D). A phone closes the chat page with Back, and the
 * pane takes its faded bubbles away with it, so the words would be lost. An empty body does nothing. With no draft the words become the
 * draft (as plain text, without the mention markup). A draft that exists keeps its place after the words: the old words come first.
 */
export function keepAsDraft(owner: string, key: string, body: string): void {
  const words = plainText(body);
  if (words.trim() === '') return;
  const draft = readDraft(owner, key);
  writeDraft(owner, key, draft === '' ? words : `${words}\n${draft}`);
}

/**
 * On a phone, a pane that closes with a failed entry writes the words of the entry into the draft of its chat (Direction D). The hook
 * keeps the latest entries and the owner in refs, and acts only in the cleanup, so a re-render does nothing. A desk writes no draft.
 */
export function useDraftOnClose(owner: string | undefined, key: string, unsent: readonly Outgoing<unknown>[]): void {
  const latest = useRef({ owner, key, unsent });
  latest.current = { owner, key, unsent };
  useEffect(() => () => {
    const { owner: who, key: where, unsent: entries } = latest.current;
    if (!who || !isPhoneNow()) return;
    for (const entry of entries) if (entry.failed) keepAsDraft(who, where, entry.body);
  }, []);
}
