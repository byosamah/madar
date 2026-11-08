import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PlatformApi } from '../../api/contract/platform';
import { ApiError } from '../../api/errors';
import { createPlatformClient } from '../../api/remote/platformClient';
import { REMOTE } from '../../app/mode';
import { useRuntime } from '../../app/runtime';

/**
 * The platform calls of the page "Madar enterprises". The remote build puts the address, the build and the token into its runtime (src/app/remote/bootstrap.ts), and the page
 * builds the client. The prototype has none: its page gets the fake of the runtime (src/api/platformFake.ts). `REMOTE` is fixed at build time, so the
 * prototype script drops the client and the Supabase address that the client holds (the same rule as the OAuth port, src/features/oauth/oauthPort.tsx),
 * and the remote build carries no fake. Without a runtime part, every call answers not_found, as the real route does for a person who is no platform owner.
 * A test gives its own api with PlatformProvider.
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
  const given = useContext(PlatformContext);
  const runtime = useRuntime();
  const config = runtime.platformConfig;
  const real = useMemo(() => (REMOTE && config ? createPlatformClient(config) : null), [config]);
  return given ?? real ?? runtime.platform ?? CLOSED;
}
