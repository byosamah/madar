import { QueryClient } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import { posthogOptions } from './client';
import { noteSheet, noteSlow, setInsightClient, type InsightClient } from './notes';
import { watchCalls, watchRoutes } from './watch';

/**
 * The fields of every Madar PostHog event (owner rule of 2026-10-25, said again 2026-10-28, tsk_489): only an `$exception` record
 * carries the name of the person. An action (a screen view, a click, a slow step, a refusal, a failed call, a sheet) carries none.
 * This file lists each event that `src/app/insight/` captures, with the exact fields it may send. A new event fails the source test
 * below until its line is added here, so the review of its fields cannot be skipped.
 */
const FIELDS: Record<string, string[]> = {
  $pageview: ['$current_url', 'screen', 'tab'],
  madar_call_failed: ['call'],
  madar_refused: ['call', 'code', 'reason'],
  madar_slow_request: ['calls', 'ms'],
  madar_sheet: ['sheet', 'step'],
};
const PERSON_FIELDS = ['personId', 'personName'];
const PERSON = { id: 'usr_1', name: 'Alice Example' };

/** The non-test source files of the insight module. */
const sources = () =>
  readdirSync('src/app/insight')
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(`src/app/insight/${name}`, 'utf8') }));

describe('the fields of every Madar PostHog event', () => {
  afterEach(() => setInsightClient(null));

  /** Runs every place that sends an action, with a person known, and collects what it sends. */
  async function sent(): Promise<[string, Record<string, unknown>][]> {
    const out: [string, Record<string, unknown>][] = [];
    const client: InsightClient = { track: (event, props) => void out.push([event, props ?? {}]), exception: () => undefined, stop: () => undefined };
    const router = { state: { location: { pathname: '/projects/prj_1', search: '?tab=tasks' } }, subscribe: () => () => undefined };
    watchRoutes(router as never, client.track);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    watchCalls(queryClient, client);
    await queryClient.fetchQuery({ queryKey: ['api', 'tasks.list', {}], queryFn: () => Promise.reject(new ApiError('failed', 'x')), retry: false }).catch(() => undefined);
    await queryClient.fetchQuery({ queryKey: ['api', 'tasks.update', {}], queryFn: () => Promise.reject(new ApiError('conflict', 'x', { reason: 'week_locked' })), retry: false }).catch(() => undefined);
    setInsightClient(client);
    noteSlow(['tasks.list'], 2500);
    noteSheet('payment', 'open');
    return out;
  }

  it('sends each action with the listed fields only, and never the person, while a person is known', async () => {
    const events = await sent();
    expect(events.map(([event]) => event).sort()).toEqual(Object.keys(FIELDS).sort());
    for (const [event, props] of events) {
      for (const key of Object.keys(props)) expect(FIELDS[event], `${event} sends ${key}`).toContain(key);
      for (const key of PERSON_FIELDS) expect(props, `${event} must not send ${key}`).not.toHaveProperty(key);
      expect(JSON.stringify(props), event).not.toContain(PERSON.name);
    }
  });

  it('adds personId and personName in before_send to an $exception record and to no other event', () => {
    const options = posthogOptions({ env: 'test', build: '1', person: () => PERSON });
    const send = options.before_send;
    if (typeof send !== 'function') throw new Error('before_send must be one function');
    const record = (event: string) => ({ uuid: 'u', event, properties: {} as Record<string, unknown> });
    const withPerson = send(record('$exception'))?.properties ?? {};
    expect(withPerson).toMatchObject({ personId: PERSON.id, personName: PERSON.name });
    const events = [...Object.keys(FIELDS), '$autocapture', '$pageleave', '$web_vitals', '$snapshot', '$identify', 'some_new_event'];
    for (const event of events) {
      const properties = send(record(event))?.properties ?? {};
      for (const key of PERSON_FIELDS) expect(properties, `${event} must not get ${key}`).not.toHaveProperty(key);
    }
  });

  it('names each event that the source captures in the list above, and names the person only in the before_send of client.ts', () => {
    const names = new Set<string>();
    for (const { text } of sources()) {
      for (const match of text.matchAll(/\b(?:track|capture)\(\s*['"]([^'"]+)['"]/g)) names.add(match[1]);
    }
    expect([...names].sort()).toEqual(Object.keys(FIELDS).sort());
    const naming = sources().filter(({ text }) => PERSON_FIELDS.some((field) => text.includes(field))).map(({ name }) => name);
    expect(naming).toEqual(['client.ts']);
    // In client.ts the one line sits inside the branch of the $exception record.
    const lines = readFileSync('src/app/insight/client.ts', 'utf8').split('\n');
    const at = lines.findIndex((line) => PERSON_FIELDS.some((field) => line.includes(field)));
    expect(lines.slice(at + 1).some((line) => PERSON_FIELDS.some((field) => line.includes(field)))).toBe(false);
    expect(lines.slice(Math.max(0, at - 6), at).join('\n')).toContain("clean.event === '$exception'");
  });
});
