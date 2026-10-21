import { useCallback, useContext, useSyncExternalStore } from 'react';
import { useRuntime } from '../runtime';
import { TypingContext } from './typing';
import type { PersonState } from './types';

const NO_SUBSCRIBE = () => () => undefined;

/**
 * The state of one person (chat presence design A). A change of another person's state does not render this screen, because the
 * snapshot is the state of this person alone. With no live port every person is offline.
 */
export function usePersonState(userId: string): PersonState {
  const { live } = useRuntime();
  const subscribe = useCallback((listener: () => void) => (live ? live.subscribeStates(listener) : NO_SUBSCRIBE()), [live]);
  return useSyncExternalStore(subscribe, () => live?.stateOf(userId) ?? 'offline', () => 'offline');
}

/** The state of the person on this screen, as the others see it (the own face shows the own dot). */
export function useMyState(): PersonState {
  const meId = useContext(TypingContext)?.meId ?? '';
  return usePersonState(meId);
}
