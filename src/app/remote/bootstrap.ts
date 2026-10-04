import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallName, Calls, MadarApi } from '../../api/calls';
import type { Language } from '../../api/contract/entities';
import { feedbackAdapter } from '../../api/remote/feedback';
import { createRemoteApi } from '../../api/remote/remoteApi';
import { uploadAdapter } from '../../api/remote/upload';
import type { Adapter, ChangeSignal } from '../../api/remote/wire';
import type { AuthPort, AuthStatus } from '../auth';
import type { Runtime } from '../runtime';
import type { ChangeListener, ChangeSource } from '../signals';
import { createSupabaseAuth } from './auth';
import { supabaseChangeSource } from './channel';
import { createSupabase } from './supabase';

/**
 * The runtime of the real screens (plan R2, client map 8): the Supabase client, the sign-in port, RemoteApi over the batch
 * endpoint, and the change signals of Realtime. main.tsx imports this file only in the remote build, so the prototype page
 * carries no Supabase code, and this file never imports the sample office or the handlers.
 */

/** The public values of the build (config/remote.<env>.env). None of them is a secret. */
export type RemoteConfig = { supabaseUrl: string; publishableKey: string; apiUrl: string; build: string };

export function remoteConfig(env: Record<string, string | boolean | undefined>): RemoteConfig {
  const text = (name: string) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter((name) => text(name) === undefined);
  if (missing.length > 0) throw new Error(`The remote build needs ${missing.join(', ')} (config/remote.<env>.env).`);
  const supabaseUrl = text('VITE_SUPABASE_URL')!.replace(/\/+$/, '');
  return {
    supabaseUrl,
    publishableKey: text('VITE_SUPABASE_PUBLISHABLE_KEY')!,
    apiUrl: (text('VITE_API_URL') ?? `${supabaseUrl}/functions/v1/api`).replace(/\/+$/, ''),
    // The server answers 409 client_outdated to a build older than MIN_CLIENT_BUILD. '0' passes while that is 0.
    build: text('VITE_MADAR_BUILD') ?? '0',
  };
}

/** The language of the first screen (client map 7.4): the one saved on this device, else the first of the browser that Madar has. */
export function firstLanguage(saved: string | null, browser: readonly string[]): Language {
  if (saved === 'ar' || saved === 'en') return saved;
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'ar' || base === 'en') return base;
  }
  return 'en';
}

/** The saved language key of the sign-in screens (src/features/auth/AuthPage.tsx, LANGUAGE_KEY). */
const LANGUAGE_KEY = 'madar.lang';

/** firstLanguage with the values of this browser. Blocked storage counts as nothing saved. */
export function browserLanguage(): Language {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(LANGUAGE_KEY);
  } catch {
    // Blocked storage.
  }
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return firstLanguage(saved, list.filter(Boolean));
}

/** A change source that also takes the signals of own answers (RemoteApi onSignals). */
export type PersonChangeSource = ChangeSource & { own(signals: ChangeSignal[]): void };

/**
 * The change signals of whoever is signed in. The channels of a person need the person's id, which only the session names, so
 * this source asks for it after each sign-in and joins that person's channels. It leaves them at the sign-out, and joins the
 * next person's channels at a sign-in as someone else. Each join after the first asks for a reload of every list (an empty
 * list), because signals of the time between were lost.
 */
export function personChangeSource(o: {
  auth: AuthPort;
  person: () => Promise<string>;
  open: (me: string) => ChangeSource;
  retryMs?: number;
}): PersonChangeSource {
  const retryMs = o.retryMs ?? 5000;
  const listeners = new Set<ChangeListener>();
  let current: ChangeSource | undefined;
  let leave: (() => void) | undefined;
  let stopAuth: (() => void) | undefined;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let joins = 0;
  // True while the session is asked for the person, so a second sign-in note does not ask again.
  let asking = false;

  const tell: ChangeListener = (signals, origin) => {
    for (const listener of [...listeners]) listener(signals, origin);
  };

  function disconnect(): void {
    attempt += 1;
    asking = false;
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    leave?.();
    leave = undefined;
    current = undefined;
  }

  function connect(): void {
    disconnect();
    const mine = attempt;
    asking = true;
    o.person().then(
      (me) => {
        if (mine !== attempt) return;
        asking = false;
        if (listeners.size === 0 || o.auth.status() !== 'signed_in') return;
        current = o.open(me);
        leave = current.subscribe(tell);
        joins += 1;
        if (joins > 1) tell([]);
      },
      () => {
        if (mine !== attempt) return;
        asking = false;
        if (listeners.size === 0) return;
        retry = setTimeout(() => {
          retry = undefined;
          if (mine === attempt && o.auth.status() === 'signed_in') connect();
        }, retryMs);
      },
    );
  }

  function follow(status: AuthStatus, change?: string): void {
    if (status === 'signed_out') disconnect();
    else if (change === 'person' || (!current && !asking && retry === undefined)) connect();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        stopAuth = o.auth.subscribe(follow as (status: AuthStatus) => void);
        if (o.auth.status() === 'signed_in') connect();
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        disconnect();
        stopAuth?.();
        stopAuth = undefined;
      };
    },
    status: () => current?.status() ?? 'closed',
    own: (signals) => tell(signals, 'own'),
  };
}

export type RemoteRuntime = Runtime & { api: MadarApi; auth: AuthPort; changes: PersonChangeSource; mode: 'remote' };

/**
 * Builds the remote runtime. The parts can come in for tests; by default they come from the public values of the build.
 * Track F fills the two adapters; makeThumb stays a stand-in until src/app/thumbs.ts exists (plan 5.2).
 */
export async function bootstrapRemote(o: {
  config?: RemoteConfig;
  supabase?: SupabaseClient;
  auth?: AuthPort;
  fetch?: typeof fetch;
} = {}): Promise<RemoteRuntime> {
  const config = o.config ?? remoteConfig(import.meta.env);
  const supabase = o.supabase ?? createSupabase({ url: config.supabaseUrl, publishableKey: config.publishableKey });
  const auth = o.auth ?? (await createSupabaseAuth(supabase, { apiUrl: config.apiUrl, fetch: o.fetch }));
  const adapters: Partial<Record<CallName, Adapter>> = {
    'files.upload': uploadAdapter({ makeThumb: async () => null }),
    'feedback.send': feedbackAdapter(),
  };
  let changes: PersonChangeSource | undefined;
  const api = createRemoteApi<Calls>({
    url: config.apiUrl,
    build: config.build,
    token: () => auth.accessToken(),
    refresh: async () => {
      // A 401 with a token that has not ended yet: ask Auth for a new one, then read it as usual.
      await supabase.auth.refreshSession().catch(() => undefined);
      return auth.accessToken();
    },
    fetch: o.fetch,
    adapters,
    // The Supabase gateway names the project by its public key.
    headers: { apikey: config.publishableKey },
    onSignals: (signals) => changes?.own(signals),
  });
  changes = personChangeSource({
    auth,
    person: async () => (await api.call('session.get', {})).user.id,
    open: (me) => supabaseChangeSource(supabase, me),
  });
  return { api, auth, changes, mode: 'remote' };
}
