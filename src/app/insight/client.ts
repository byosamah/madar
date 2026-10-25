import posthog, { type PostHog, type PostHogConfig } from 'posthog-js/dist/module.full.no-external';
import type { QueryClient } from '@tanstack/react-query';
import { PRIVATE } from '../privateMark';
import type { AppRouter } from './index';
import type { InsightClient, InsightPerson } from './notes';
import { scrubEvent } from './scrub';
import { watchCalls, watchRoutes } from './watch';

/**
 * The lazy PostHog client of the real screens (insight design, section 6). Only this file imports `posthog-js`. It loads the full
 * library with no external script (`module.full.no-external`: the replay recorder, the web vitals and the error capture are inside).
 */

/** PostHog Cloud EU (Frankfurt). The security policy names this one host in `connect-src`. */
export const POSTHOG_HOST = 'https://eu.i.posthog.com';

export type InsightEnv = 'production' | 'test';

/**
 * A browser warning with no fault in it: a ResizeObserver callback that changes a size in the same frame. The Open space map gave 8 of
 * the first 9 errors on the test copy (2026-10-25), so it would fill the error list of the owner.
 */
const HARMLESS_ERROR = /ResizeObserver loop/;

/** True for an error record that holds only the harmless warning. */
function harmlessError(properties: Record<string, unknown> | undefined): boolean {
  const list = properties?.$exception_list;
  const first = Array.isArray(list) ? (list[0] as { value?: unknown } | undefined)?.value : undefined;
  const text = typeof first === 'string' ? first : properties?.$exception_message;
  return typeof text === 'string' && HARMLESS_ERROR.test(text);
}

type OptionsInput = {
  env: InsightEnv;
  build: string;
  person: () => InsightPerson | null;
  /** False after a sign-out: every record is dropped, so nothing of the next visitor goes out before the next start. */
  active?: () => boolean;
};

/**
 * The init options. They carry the privacy rules of the design, section 5: masked inputs, the private class, no network capture, no
 * console, no lasting id, scrubbed addresses, and the person on error records only.
 */
export function posthogOptions(o: OptionsInput): Partial<PostHogConfig> {
  const { env, build, person, active = () => true } = o;
  return {
    api_host: POSTHOG_HOST,
    ui_host: 'https://eu.posthog.com',
    // Actions stay anonymous (and cheaper): Madar never calls identify.
    person_profiles: 'identified_only',
    // A new tab is a new visitor, and no id follows a person across days (rule 7).
    persistence: 'sessionStorage',
    save_referrer: false,
    save_campaign_params: false,
    // No script loads from another host (the security policy allows only the own site).
    disable_external_dependency_loading: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    // Clicks only. The page views come from the router (watch.ts), because the router, not the address bar, knows the screen.
    autocapture: { dom_event_allowlist: ['click'], capture_copied_text: false },
    capture_pageview: false,
    capture_pageleave: true,
    capture_exceptions: true,
    // The web vitals stay on. Network timing is off: a signed file link carries its signature in the request address (rule 4).
    capture_performance: { network_timing: false, web_vitals: true },
    enable_recording_console_log: false,
    session_recording: {
      maskAllInputs: true,
      recordHeaders: false,
      recordBody: false,
      // The one class of rule 1. PostHog also leaves such a part out of the click records.
      blockClass: PRIVATE,
    },
    before_send: (record) => {
      try {
        if (!active()) return null;
        // A record that the scrub cannot read is dropped (the scrub fails closed).
        const clean = scrubEvent(record);
        if (!clean) return null;
        if (clean.event === '$exception' && harmlessError(clean.properties)) return null;
        const extra: Record<string, unknown> = { env, build };
        if (clean.event === '$exception') {
          try {
            const who = person();
            if (who) Object.assign(extra, { personId: who.id, personName: who.name });
          } catch {
            // An error record without a person is better than none.
          }
        }
        return { ...clean, properties: { ...clean.properties, ...extra } };
      } catch {
        return null;
      }
    },
  };
}

type ClientOptions = {
  key: string;
  env: InsightEnv;
  build: string;
  person: () => InsightPerson | null;
  queryClient: QueryClient;
  router: AppRouter;
};

/** PostHog starts once for the page. A second sign-in on the same page uses the same instance. */
let instance: PostHog | undefined;
let live = false;
let currentPerson: () => InsightPerson | null = () => null;

export function createInsightClient(o: ClientOptions): InsightClient {
  live = true;
  currentPerson = o.person;
  if (instance) {
    instance.startSessionRecording();
  } else {
    instance = posthog.init(o.key, posthogOptions({ env: o.env, build: o.build, person: () => currentPerson(), active: () => live }));
  }
  const ph = instance;
  const client: InsightClient = {
    track: (event, props) => {
      try {
        ph.capture(event, props);
      } catch {
        // PostHog is never allowed to break Madar.
      }
    },
    exception: (error, props) => {
      try {
        ph.captureException(error, props);
      } catch {
        // PostHog is never allowed to break Madar.
      }
    },
    stop: () => {
      // Drop first, so nothing goes out while the watchers, the recorder and the ids are cleared.
      live = false;
      currentPerson = () => null;
      for (const stop of stops) {
        try {
          stop();
        } catch {
          // A watcher that fails to stop leaves nothing to clean.
        }
      }
      try {
        ph.stopSessionRecording();
        ph.reset();
      } catch {
        // A stop that fails leaves the drop rule in place.
      }
    },
  };
  const stops: (() => void)[] = [];
  try {
    stops.push(watchRoutes(o.router, client.track), watchCalls(o.queryClient, client, o.person));
  } catch {
    // A watcher that fails to start leaves the others running.
  }
  return client;
}
