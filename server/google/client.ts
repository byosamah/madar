import type { Deps } from '../core/ports';
import type { GoogleClient } from './api';
import { GOOGLE_CALLBACK_PATH } from './callback';
import { googleKeysOf, type GoogleKeys } from './keys';

/**
 * The Google client and the keys of one copy, from its deps (fbk_022). `google` is absent when the copy has no Google values.
 * The redirect address is the address of the callback route on the page host of the copy: <APP_URL>/api/google/callback. It must be
 * one of the two redirect URIs of the OAuth client in Google Cloud.
 */

export type GoogleReady = { client: GoogleClient; keys: () => Promise<GoogleKeys> };

export function redirectUriOf(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api${GOOGLE_CALLBACK_PATH}`;
}

/** The client and the keys of the copy, or undefined when Google is off. deps.googleFetch is the fetch of a test. */
export function googleOf(deps: Pick<Deps, 'config' | 'googleFetch'>): GoogleReady | undefined {
  const google = deps.config.google;
  if (!google) return undefined;
  return {
    client: {
      clientId: google.clientId,
      clientSecret: google.clientSecret,
      redirectUri: redirectUriOf(deps.config.appUrl),
      ...(deps.googleFetch ? { fetch: deps.googleFetch } : {}),
    },
    keys: () => googleKeysOf(google.key),
  };
}
