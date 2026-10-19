import { render, screen } from '@testing-library/react';
import { calls } from '../../api/calls';
import { createApi } from '../../api/client';
import type { UserCard } from '../../api/contract/views';
import { memoryPersister } from '../../api/persist';
import { Store, emptyState } from '../../api/store';
import { RuntimeProvider, createQueryClient } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { NOW, TODAY } from '../../test/factories';
import type { Bubble } from './MessageBubble';
import { MessageLog, type MessageLogProps } from './MessageLog';

/**
 * Test helper for the message log (chat design 2026-10-19, track read). The log renders one component with a runtime, no router and no
 * sample office, so a test builds its bubbles by hand and reads the log at once (the render is synchronous).
 */
export const FAISAL: UserCard = { id: 'usr_002', name: 'Faisal Al-Harbi', nameAr: 'فيصل الحربي', avatarUrl: null, kind: 'human', discipline: 'Architect' };
export const OMAR: UserCard = { id: 'usr_004', name: 'Omar Haddad', nameAr: 'عمر حداد', avatarUrl: null, kind: 'human', discipline: 'Engineer' };
export const HALA: UserCard = { id: 'usr_001', name: 'Hala Nasser', nameAr: 'هالة ناصر', avatarUrl: null, kind: 'human', discipline: 'Architect' };
export const AGENT: UserCard = { id: 'usr_090', name: 'Site notes agent', avatarUrl: null, kind: 'agent', discipline: 'Agent' };

/** A bubble with the defaults of a message from Faisal that the reader did not write. */
export function makeBubble(over: Partial<Bubble> & Pick<Bubble, 'id' | 'createdAt' | 'body'>): Bubble {
  return { author: FAISAL, actingFor: null, files: [], mine: false, edited: false, ...over };
}

/** n bubbles, `msg_1` to `msg_n`, bodies `Note 1` to `Note n`, from Faisal and Omar in turn, 10 minutes apart. */
export function talk(n: number): Bubble[] {
  const start = Date.parse('2026-09-29T09:00:00.000+03:00');
  return Array.from({ length: n }, (_, i) => makeBubble({
    id: `msg_${i + 1}`,
    author: i % 2 === 0 ? FAISAL : OMAR,
    createdAt: new Date(start + i * 600_000).toISOString().replace('Z', '+00:00'),
    body: `Note ${i + 1}`,
  }));
}

type LogProps = Partial<MessageLogProps> & { bubbles: Bubble[] };

/** Renders the log with the runtime of the app tests. "rerender" gives the log new props, as a new answer of the server does. */
export function renderLog(props: LogProps, o: { lang?: 'en' | 'ar' } = {}): { log: HTMLElement; rerender: (next: LogProps) => void } {
  setNow(NOW);
  const state = emptyState(TODAY);
  state.session.currentUserId = HALA.id;
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  const lang = o.lang ?? 'en';
  initI18n(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const queryClient = createQueryClient();
  const element = (next: LogProps) => (
    <RuntimeProvider runtime={{ store, api }} queryClient={queryClient}>
      <ToastProvider>
        <MessageLog resetKey="cnv_test" emptyText="No messages" {...next} />
      </ToastProvider>
    </RuntimeProvider>
  );
  const view = render(element(props));
  return { log: screen.getByRole('log'), rerender: (next) => view.rerender(element(next)) };
}

/**
 * jsdom draws nothing, so the log gets a height that a test can grow, and a scroll position that a test can set. "at" sets the
 * position, "top" reads it, "grow" makes the content taller.
 */
export function measureLog(log: HTMLElement) {
  let top = 0;
  let height = 1000;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => 500 });
  Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value; } });
  return { at: (value: number) => { top = value; }, top: () => top, grow: (by: number) => { height += by; } };
}

/** The row (the closest `li`) of a text in the log. */
export function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest('li');
  if (!row) throw new Error(`No row holds "${text}".`);
  return row;
}
