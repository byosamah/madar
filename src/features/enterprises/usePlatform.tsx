import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PlatformApi } from '../../api/contract/platform';
import { fakePlatform } from '../../api/platformFake';
import { createPlatformClient } from '../../api/remote/platformClient';
import { useRuntime } from '../../app/runtime';

/**
 * The platform calls of the page "Madar enterprises". The remote build puts the address, the build and the token into its runtime (src/app/remote/bootstrap.ts), and the page builds the client;
 * the prototype has none, so its page gets the fake (plan D fills it). A test gives its own api with PlatformProvider.
 */
const PlatformContext = createContext<PlatformApi | null>(null);

export function PlatformProvider({ api, children }: { api: PlatformApi; children: ReactNode }) {
  return <PlatformContext.Provider value={api}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformApi {
  const given = useContext(PlatformContext);
  const config = useRuntime().platformConfig;
  const real = useMemo(() => (config ? createPlatformClient(config) : null), [config]);
  return given ?? real ?? fakePlatform;
}
