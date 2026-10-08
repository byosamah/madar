import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallName, Calls, MadarApi } from '../../api/calls';
import type { FreshReads } from '../../api/remote/follow';
import { createRemoteApi } from '../../api/remote/remoteApi';
import type { Adapter, ChangeSignal } from '../../api/remote/wire';
import type { AuthPort, AuthStatus } from '../auth';
import { remoteFileAdapters } from '../files';
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
export type RemoteConfig = {
  supabaseUrl: string;
  publishableKey: string;
  apiUrl: string;
  build: string;
  /** The same-host forwarder of the batch (VITE_BATCH_URL, /api/batch), when the build names one (performance audit FET-10). */
  batchUrl?: string;
};

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
    batchUrl: text('VITE_BATCH_URL'),
  };
}

/** The language of the first screen (client map 7.4). It lives with the words, so main.tsx reads it before the bootstrap (BND-7). */
export { browserLanguage, firstLanguage } from '../../i18n/firstLanguage';

/**
 * A change source that also takes the signals of own answers (RemoteApi onSignals), with the reads that ran after the write in
 * its request (performance audit FET-3).
 */
export type PersonChangeSource = ChangeSource & { own(signals: ChangeSignal[], fresh?: FreshReads): void };

/**
 * The change signals of whoever is signed in. The channels of a person need the person's id, which only the session names, so
 * this source asks for it after each sign-in and joins that person's channels. It leaves them at the sign-out, and joins the
 * next person's channels at a sign-in as someone else. The channels of each join ask for a reload of every list once they
 * have joined (channel.ts), so the signals of the time between are not lost.
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
  // True while the session is asked for the person, so a second sign-in note does not ask again.
  let asking = false;

  const tell: ChangeListener = (...args) => {
    for (const listener of [...listeners]) listener(...args);
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
    own: (signals, fresh) => (fresh ? tell(signals, 'own', fresh) : tell(signals, 'own')),
  };
}

export type RemoteRuntime = Runtime & { api: MadarApi; auth: AuthPort; changes: PersonChangeSource; mode: 'remote' };

/**
 * Builds the remote runtime. The parts can come in for tests; by default they come from the public values of the build.
 * The two file adapters come from track F (src/app/files.ts), with the thumbnail maker of src/app/thumbs.ts (plan 5.2).
 */
export async function bootstrapRemote(o: {
  config?: RemoteConfig;
  supabase?: SupabaseClient;
  auth?: AuthPort;
  fetch?: typeof fetch;
} = {}): Promise<RemoteRuntime> {
  // Each name on its own: the bundler then puts only these four values in the page, never every VITE_ value of the build shell.
  const config = o.config ?? remoteConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_API_URL: import.meta.env.VITE_API_URL,
    VITE_BATCH_URL: import.meta.env.VITE_BATCH_URL,
    VITE_MADAR_BUILD: import.meta.env.VITE_MADAR_BUILD,
  });
  const supabase = o.supabase ?? createSupabase({ url: config.supabaseUrl, publishableKey: config.publishableKey });
  const auth = o.auth ?? (await createSupabaseAuth(supabase, { apiUrl: config.apiUrl, fetch: o.fetch }));
  const adapters: Partial<Record<CallName, Adapter>> = remoteFileAdapters();
  let changes: PersonChangeSource | undefined;
  const api = createRemoteApi<Calls>({
    url: config.apiUrl,
    batchUrl: config.batchUrl,
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
    onSignals: (signals, fresh) => changes?.own(signals, fresh),
  });
  changes = personChangeSource({
    auth,
    person: async () => (await api.call('session.get', {})).user.id,
    open: (me) => supabaseChangeSource(supabase, me),
  });
  return { api, auth, changes, mode: 'remote' };
}
