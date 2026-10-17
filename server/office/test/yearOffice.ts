import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { TABLES, rowsOf } from '../../data/tables';

/**
 * One year of growth for the rows pins of test:office (Supabase exit, wave 1). It grows the sample office (src/data/seed.ts),
 * so each record keeps the shape that its zod schema checks (the records of the wave 0 generator fail zod in 12 of 20 tables).
 * The sizes follow the profile "year" of scripts/proof/do-rows/src/gen.js. The sample office has 10 people, not 15, so the
 * rows of one person are more than in wave 0.
 *  1. Copies of the project work, each 45 days older, with new ids. Direct chats, people, clients and templates stay once.
 *  2. More rounds of the activity (events, comments, notices, messages, files, posts, Tracker entries), each one day older.
 *  3. One seq for each event in time order, and each counter at the highest number of its prefix.
 */
export const YEAR = { copies: 6, events: 62_000, comments: 12_000, notifications: 26_000, messages: 20_000, files: 6_000, updates: 2_600, tracker: 1_500 } as const;

const DAY = 86_400_000;
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^([a-z]+)_(\d+)$/;

type Rec = Record<string, unknown>;
type Lists = Record<string, Record<string, Rec>>;

const COPIED = ['projects', 'members', 'stages', 'deadlines', 'conversations', 'tasks', 'updates', 'comments', 'files', 'tracker', 'payments', 'events', 'notifications', 'messages', 'chatReads'] as const;
const GROWN = ['events', 'comments', 'notifications', 'messages', 'files', 'updates', 'tracker'] as const;

/** A stamp or a date moved by ms, in the same text form: the same offset and the same digits. Other text stays. */
export function shifted(text: string, ms: number): string {
  if (DATE.test(text)) return new Date(Date.parse(`${text}T00:00:00Z`) + Math.round(ms / DAY) * DAY).toISOString().slice(0, 10);
  const m = STAMP.exec(text);
  if (!m) return text;
  const sign = m[4].startsWith('-') ? -1 : 1;
  const offset = m[4] === 'Z' ? 0 : sign * (Number(m[4].slice(1, 3)) * 60 + Number(m[4].slice(4, 6))) * 60_000;
  const local = new Date(Date.parse(text) + ms + offset).toISOString();
  return `${local.slice(0, 19)}${m[3] ?? ''}${m[4]}`;
}

const bump = (id: string, offset: number) => id.replace(ID, (_whole, prefix: string, n: string) => `${prefix}_${String(Number(n) + offset).padStart(3, '0')}`);

/** A deep copy with each id of names renamed (also as an object key) and each stamp and date moved by ms. */
function moved(value: Rec, names: ReadonlyMap<string, string>, ms: number): Rec {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return names.get(v) ?? shifted(v, ms);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v as Rec).map(([key, inner]) => [names.get(key) ?? key, walk(inner)]));
    return v;
  };
  return walk(value) as Rec;
}

export async function yearOffice(today: string): Promise<State> {
  const base = await buildSeed(today, async () => undefined);
  const state = structuredClone(base);
  const lists = state as unknown as Lists;
  const from = base as unknown as Lists;
  const keyOf = (c: string, rec: Rec) => TABLES.find((spec) => spec.collection === c)!.key(rec);
  const add = (c: string, rec: Rec) => {
    (lists[c] ??= {})[keyOf(c, rec)] = rec;
  };
  // A notice key is unique in the table (notifications_dedupe): each copy and round gets its own.
  const unique = (c: string, rec: Rec, tag: string): Rec => (c === 'notifications' && typeof rec.dedupeKey === 'string' ? { ...rec, dedupeKey: `${rec.dedupeKey}:${tag}` } : rec);

  for (let copy = 1; copy < YEAR.copies; copy++) {
    const names = new Map<string, string>();
    const copied = (c: string, rec: Rec) => !(c === 'conversations' && rec.kind !== 'project');
    for (const c of COPIED) for (const rec of Object.values(from[c] ?? {})) if (copied(c, rec) && typeof rec.id === 'string' && ID.test(rec.id)) names.set(rec.id, bump(rec.id, copy * 100_000));
    for (const c of COPIED) {
      for (const rec of Object.values(from[c] ?? {})) {
        if (!copied(c, rec)) continue;
        if (c === 'chatReads' && !names.has(String(rec.conversationId))) continue;
        add(c, unique(c, moved(rec, names, -copy * 45 * DAY), `c${copy}`));
      }
    }
  }

  for (const c of GROWN) {
    const list = (lists[c] ??= {});
    const pool = Object.values(list).filter((rec) => !(c === 'events' && typeof rec.undoes === 'string'));
    // The count of the list, kept beside it: a count of the keys for each record is too slow on 62,000 events.
    let size = Object.keys(list).length;
    for (let round = 1; size < YEAR[c]; round++) {
      const names = new Map(pool.map((rec) => [String(rec.id), bump(String(rec.id), (YEAR.copies + round) * 100_000)]));
      for (const rec of pool) {
        if (size >= YEAR[c]) break;
        const clone = unique(c, moved(rec, names, -round * DAY), `r${round}`);
        const key = keyOf(c, clone);
        if (!(key in list)) size++;
        add(c, c === 'events' ? { ...clone, undoneBy: null } : clone);
      }
    }
  }

  const events = Object.values(lists.events);
  events.sort((a, b) => Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt)) || (String(a.id) < String(b.id) ? -1 : 1));
  events.forEach((event, i) => {
    event.seq = i + 1;
  });
  lists.events = Object.fromEntries(events.map((event) => [String(event.id), event]));

  const counters: Record<string, number> = { ...state.counters };
  for (const spec of TABLES) {
    for (const row of rowsOf(state, spec)) {
      const m = typeof row.doc?.id === 'string' ? ID.exec(row.doc.id) : null;
      if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]));
    }
  }
  counters.evt = Math.max(counters.evt ?? 0, events.length);
  state.counters = counters;
  return state;
}
