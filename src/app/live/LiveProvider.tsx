import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useCall, useRuntime } from '../runtime';
import { useIsPhone } from '../useIsPhone';
import { useDeviceState, useResting } from './activity';
import { TypingContext, createTypingBoard, type TypingContextValue } from './typing';

/** True while the person is signed in. A runtime with no sign-in (the prototype, a test) is always signed in. */
function useSignedIn(): boolean {
  const { auth } = useRuntime();
  return useSyncExternalStore(
    (listener) => (auth ? auth.subscribe(listener) : () => undefined),
    () => (auth ? auth.status() === 'signed_in' : true),
    () => true,
  );
}

/**
 * The live part of a screen (chat presence design, "One port"). It sits inside RuntimeProvider when the runtime has a live port, and it
 * only feeds the port: the active humans to watch, the state of this device (Online or Away, or Away by hand), the rest of a page that
 * stays out of view, and the typing signals into one board that useTypers and useTypingRows read. It asks nothing before the person
 * signs in. The faces and the lines that show the states are the work of the track faces.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { live } = useRuntime();
  const signedIn = useSignedIn();
  const users = useCall('users.list', {}, { enabled: signedIn });
  const session = useCall('session.get', {}, { enabled: signedIn });
  const meId = session.data?.user.id ?? '';

  const people = useMemo(() => (users.data ?? []).filter((user) => user.kind === 'human' && user.active).map((user) => user.id), [users.data]);
  const peopleKey = people.join(',');
  useEffect(() => {
    live?.watch(signedIn ? people : []);
    // peopleKey carries the content of people, so the port hears of a change of the list and of nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, signedIn, peopleKey]);

  const device = useDeviceState(session.data?.user.preferences.awayByHand === true);
  const ready = signedIn && meId !== '';
  useEffect(() => {
    if (ready) live?.setMine(device);
  }, [live, ready, device]);

  const phone = useIsPhone();
  const resting = useResting(phone);
  useEffect(() => {
    if (ready) live?.setResting(resting);
  }, [live, ready, resting]);

  const board = useMemo(() => createTypingBoard(Date.now), []);
  useEffect(() => {
    const stop = live?.subscribeTyping((signal) => board.apply(signal));
    return () => {
      stop?.();
      board.stop();
    };
  }, [live, board]);
  const value = useMemo<TypingContextValue>(() => ({ board, meId }), [board, meId]);
  return <TypingContext.Provider value={value}>{children}</TypingContext.Provider>;
}
