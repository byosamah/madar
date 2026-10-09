import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildKey, canAsk, isPushOptedOut, isSubscribed, readEnv, setPushOptOut, statusOf, syncThisDevice, turnOff, turnOn, type PushApi, type PushStatus,
} from '../../app/remote/push';
import { useCall, useRuntime } from '../../app/runtime';

/**
 * The state and the two actions of the Settings switch "Notify me on this device" (owner, 2026-10-08). The state is the truth of
 * this browser (the permission and its subscription), not a row on the server: a device is a browser. null means that the first
 * check has not finished. When the browser already holds a subscription, the check also saves its endpoint again if the server
 * does not list it (the browser may renew it).
 *
 * Push is on by default (owner, 2026-10-09). When the permission was granted before and the browser holds no subscription, the check
 * turns push on, unless this person turned it off here. A turn off keeps that choice in this browser, and a turn on forgets it.
 * askable: the one ask on Home may show (the person was never asked and did not turn push off).
 */
export type PushFailure = 'on' | 'off';

export function usePushDevice(): { status: PushStatus | null; askable: boolean; busy: boolean; failure: PushFailure | null; turnOn(): void; turnOff(): void } {
  const { api } = useRuntime();
  const pushApi = api as unknown as PushApi;
  const userId = useCall('session.get', {}).data?.user.id;
  const key = buildKey();
  const [state, setState] = useState<{ status: PushStatus; askable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PushFailure | null>(null);
  const alive = useRef(true);

  const check = useCallback(async () => {
    const env = readEnv();
    const status = statusOf(env, key, env.hasWorker && env.hasNotification ? await isSubscribed() : false);
    // Until the session answers, the choice of the person is unknown, so the ask waits.
    const askable = canAsk(env, key, userId ? isPushOptedOut(userId) : true);
    if (alive.current) setState({ status, askable });
  }, [key, userId]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const env = readEnv();
      if (key && userId && env.hasWorker && env.hasNotification && env.hasManager) await syncThisDevice(pushApi, key, userId).catch(() => undefined);
      await check();
    })();
    return () => {
      alive.current = false;
    };
  }, [check, key, pushApi, userId]);

  const run = useCallback((work: Promise<unknown>, failed: PushFailure) => {
    setBusy(true);
    setFailure(null);
    work
      .then(check)
      .catch(() => alive.current && setFailure(failed))
      .finally(() => alive.current && setBusy(false));
  }, [check]);

  return {
    status: state?.status ?? null,
    askable: state?.askable ?? false,
    busy,
    failure,
    // turnOn asks the permission as its first step, so it must start in the click, before any wait.
    turnOn: () => run(turnOn(pushApi, key!).then((result) => {
      if (result === 'on' && userId) setPushOptOut(userId, false);
      return result;
    }), 'on'),
    turnOff: () => {
      // The choice is kept first, so a check that runs meanwhile does not turn push on again. A failed turn off takes it back.
      if (userId) setPushOptOut(userId, true);
      run(turnOff(pushApi).catch((error: unknown) => {
        if (userId) setPushOptOut(userId, false);
        throw error;
      }), 'off');
    },
  };
}
