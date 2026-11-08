import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformApi } from '../api/contract/platform';
import { ApiError } from '../api/errors';

/**
 * The platform calls of the site Madar enterprises (design 12, D7). The site gives its client with PlatformProvider (src/platform/PlatformApp.tsx);
 * a test gives its own. Without a provider every platform call refuses with not_found, so a part drawn alone never reaches a server.
 */
const PlatformContext = createContext<PlatformApi | null>(null);

export function PlatformProvider({ api, children }: { api: PlatformApi; children: ReactNode }) {
  return <PlatformContext.Provider value={api}>{children}</PlatformContext.Provider>;
}

/** The closed fallback: a name of a platform call gives a call that refuses. */
const CLOSED = new Proxy({} as PlatformApi, {
  get: (_target, name) => (typeof name === 'string' && name.startsWith('platform.') ? () => Promise.reject(new ApiError('not_found', 'This address does not exist.')) : undefined),
});

export function usePlatform(): PlatformApi {
  return useContext(PlatformContext) ?? CLOSED;
}
