import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { nowStamp, todayISO } from '../../../lib/dates';

/** The time choices for each project, in minutes. The owner set 5 minutes as the default. */
export const MEETING_MINUTES = [3, 5, 10, 15] as const;
export type MeetingMinutes = (typeof MEETING_MINUTES)[number];

/** The meeting as the browser keeps it for the day. A damaged value fails the check and gives a new meeting. */
const Saved = z.object({
  startedAt: z.string(),
  /** Every project of this meeting in agenda order, also the ones that a filter hides now. */
  order: z.array(z.string()),
  currentId: z.string().nullable(),
  discussed: z.array(z.string()),
  minutes: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(15)]),
  /** The time each project used, in milliseconds, before the stretch that runs now. */
  used: z.record(z.string(), z.number().nonnegative()),
  paused: z.boolean(),
  /** When the clock of the current project started (epoch milliseconds). Null while the clock stands. */
  runningSince: z.number().nullable(),
});
type Saved = z.infer<typeof Saved>;

const keyFor = (day: string) => `madar.meeting.${day}`;

function fresh(order: string[], minutes: MeetingMinutes = 5): Saved {
  return { startedAt: nowStamp(), order, currentId: order[0] ?? null, discussed: [], minutes, used: {}, paused: false, runningSince: null };
}

function load(key: string): Saved {
  try {
    const text = window.sessionStorage.getItem(key);
    if (text) {
      const parsed = Saved.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // The browser blocks the storage, or the value is damaged. The meeting starts new.
  }
  return fresh([]);
}

function save(key: string, session: Saved): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // The browser blocks the storage. The meeting lasts for this visit only.
  }
}

/** Adds the running stretch to the time of the current project and stops the clock. */
function stop(s: Saved, at: number): Saved {
  if (s.runningSince === null) return s;
  if (s.currentId === null) return { ...s, runningSince: null };
  const used = { ...s.used, [s.currentId]: (s.used[s.currentId] ?? 0) + Math.max(0, at - s.runningSince) };
  return { ...s, used, runningSince: null };
}

/** Shows another project. Its own clock runs on from its own used time, if the clock ran. */
function show(s: Saved, id: string, at: number): Saved {
  if (id === s.currentId) return s;
  const running = s.runningSince !== null;
  return { ...stop(s, at), currentId: id, runningSince: running ? at : null };
}

/** The first project from a position on (it goes round to the start) that is not discussed, or null. */
function nextOpen(order: readonly string[], from: number, discussed: ReadonlySet<string>): string | null {
  for (let step = 0; step < order.length; step += 1) {
    const id = order[(from + step) % order.length];
    if (!discussed.has(id)) return id;
  }
  return null;
}

/**
 * The meeting session (owner, 2026-10-02): the agenda order, the project on the screen, the projects discussed,
 * and a clock for each project. The browser keeps it for the day under `madar.meeting.<YYYY-MM-DD>`, so a reload
 * keeps the meeting and a new day starts a new one. `projectIds` is the agenda order of the projects shown now.
 * The clock of the current project runs only while `onScreen` is true and nobody paused it.
 */
export function useMeetingSession(projectIds: readonly string[], onScreen = true) {
  const [key, setKey] = useState(() => keyFor(todayISO()));
  const [session, setSession] = useState(() => load(key));
  const latest = useRef(session);
  const day = useRef(key);
  // Each save checks the day first. A room screen can stay awake overnight, so a change on a new day goes to the meeting of that day.
  const commit = useCallback((change: (s: Saved) => Saved) => {
    const today = keyFor(todayISO());
    const newDay = today !== day.current;
    const base = newDay ? load(today) : latest.current;
    const next = change(base);
    if (!newDay && next === base) return;
    day.current = today;
    latest.current = next;
    save(today, next);
    setSession(next);
    if (newDay) setKey(today);
  }, []);

  // The page shows again, for example in the morning: a new day starts a new meeting at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') commit((s) => s);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [commit]);

  // The order of the meeting stays as it was when each project first showed, so a change in the data does not move a project.
  const ids = projectIds.join(' ');
  const order = useMemo(() => {
    const known = new Set(session.order);
    const shown = new Set(projectIds);
    return [...session.order, ...projectIds.filter((id) => !known.has(id))].filter((id) => shown.has(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids holds the content of projectIds
  }, [session.order, ids]);
  const discussed = useMemo(() => new Set(session.discussed), [session.discussed]);
  const at = session.currentId === null ? -1 : order.indexOf(session.currentId);
  const current = Math.max(0, at);
  const currentId = order[current] ?? null;
  const allDiscussed = order.length > 0 && order.every((id) => discussed.has(id));
  const nextId = currentId === null ? null : nextOpen(order, current + 1, new Set([...discussed, currentId]));

  // A project that is new to the meeting joins the end of the order. When the current project is not shown, the first open one shows.
  useEffect(() => {
    if (projectIds.length === 0) return;
    commit((s) => {
      const known = new Set(s.order);
      const added = projectIds.filter((id) => !known.has(id));
      const next = added.length > 0 ? { ...s, order: [...s.order, ...added] } : s;
      if (next.currentId !== null && projectIds.includes(next.currentId)) return next;
      const shownOrder = next.order.filter((id) => projectIds.includes(id));
      return show(next, nextOpen(shownOrder, 0, new Set(next.discussed)) ?? shownOrder[0], Date.now());
    });
    // A new day gives a new key and an empty meeting, so the projects join it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids holds the content of projectIds
  }, [ids, commit, key]);

  // The clock runs while the project is on the screen, the meeting is not paused, and a project is still open.
  const live = onScreen && !session.paused && at >= 0 && !allDiscussed;
  useEffect(() => {
    if (!live) {
      commit((s) => stop(s, Date.now()));
      return;
    }
    commit((s) => (s.runningSince === null ? { ...s, runningSince: Date.now() } : s));
    return () => commit((s) => stop(s, Date.now()));
  }, [live, commit]);

  /** The time a project used, in milliseconds. It reads the latest state, so a timer can call it each second. */
  const elapsedFor = useCallback((id: string) => {
    const s = latest.current;
    const running = id === s.currentId && s.runningSince !== null ? Math.max(0, Date.now() - s.runningSince) : 0;
    return (s.used[id] ?? 0) + running;
  }, []);

  const goTo = (index: number) => {
    const id = order[Math.min(Math.max(0, index), order.length - 1)];
    if (id) commit((s) => show(s, id, Date.now()));
  };

  /** Marks the current project as discussed and shows the next project that is not discussed. */
  const done = () => {
    if (!currentId) return;
    commit((s) => {
      const marked = s.discussed.includes(currentId) ? s : { ...s, discussed: [...s.discussed, currentId] };
      return nextId === null ? marked : show(marked, nextId, Date.now());
    });
  };

  /**
   * Moves the current project to the end of the order and shows the next project that is not discussed.
   * The skipped project is not a candidate, so the search goes round to the start. It stays on the screen only when it is the last open one.
   */
  const skip = () => {
    if (!currentId) return;
    const moved = [...order.filter((id) => id !== currentId), currentId];
    const next = nextOpen(moved, current, new Set([...discussed, currentId])) ?? currentId;
    commit((s) => show({ ...s, order: [...s.order.filter((id) => id !== currentId), currentId] }, next, Date.now()));
  };

  const togglePause = () => commit((s) => (s.paused ? { ...s, paused: false } : { ...stop(s, Date.now()), paused: true }));
  const setMinutes = (minutes: MeetingMinutes) => commit((s) => ({ ...s, minutes }));

  /** Starts a new meeting: a new start time, the agenda order again, nothing discussed, and every clock at zero. */
  const restart = () => commit((s) => ({ ...fresh([...projectIds], s.minutes), runningSince: s.runningSince !== null ? Date.now() : null }));

  return {
    startedAt: session.startedAt,
    /** The projects shown now, in the order of this meeting. */
    order,
    /** The position of the project on the screen in `order`. */
    current,
    currentId,
    /** The project that Done shows next: the first one after the current one that is not discussed. */
    nextId,
    discussed: discussed as ReadonlySet<string>,
    allDiscussed,
    minutes: session.minutes,
    setMinutes,
    goTo,
    done,
    skip,
    elapsedFor,
    paused: session.paused,
    /** True while the clock of the current project runs. */
    running: session.runningSince !== null,
    togglePause,
    restart,
  };
}

export type MeetingSession = ReturnType<typeof useMeetingSession>;
