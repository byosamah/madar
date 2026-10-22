import { createContext, useContext, type ReactNode } from 'react';

const Bare = createContext(false);

/**
 * The bare mode of a Settings part (Direction D). A sub-page of the Me tab has its own page title, so the visible h2 of the part
 * becomes sr-only (it stays for the screen reader and for aria-labelledby). The desk renders no provider, so nothing changes there.
 */
export function BareProvider({ children }: { children: ReactNode }) {
  return <Bare.Provider value>{children}</Bare.Provider>;
}

/** True inside a BareProvider. False with no provider. */
export function useBare(): boolean {
  return useContext(Bare);
}
