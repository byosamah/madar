import { useCallback, useEffect, useRef, useState } from 'react';
import { buildKey, isSubscribed, readEnv, statusOf, syncThisDevice, turnOff, turnOn, type PushApi, type PushStatus } from '../../app/remote/push';
import { useRuntime } from '../../app/runtime';

/**
 * The state and the two actions of the Settings switch "Notify me on this device" (owner, 2026-10-08). The state is the truth of
 * this browser (the permission and its subscription), not a row on the server: a device is a browser. null means that the first
 * check has not finished. When the browser already holds a subscription, the check also saves its endpoint again if the server
 * does not list it (the browser may renew it).
 */
export type PushFailure = 'on' | 'off';

export function usePushDevice(): { status: PushStatus | null; busy: boolean; failure: PushFailure | null; turnOn(): void; turnOff(): void } {
  const { api } = useRuntime();
  const pushApi = api as unknown as PushApi;
  const key = buildKey();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<PushFailure | null>(null);
  const alive = useRef(true);

  const check = useCallback(async () => {
    const env = readEnv();
    const next = statusOf(env, key, env.hasWorker && env.hasNotification ? await isSubscribed() : false);
    if (alive.current) setStatus(next);
  }, [key]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      const env = readEnv();
      if (key && env.hasWorker && env.hasNotification && env.hasManager) await syncThisDevice(pushApi, key).catch(() => undefined);
      await check();
    })();
    return () => {
      alive.current = false;
    };
  }, [check, key, pushApi]);

  const run = useCallback((work: Promise<unknown>, failed: PushFailure) => {
    setBusy(true);
    setFailure(null);
    work
      .then(check)
      .catch(() => alive.current && setFailure(failed))
      .finally(() => alive.current && setBusy(false));
  }, [check]);

  return {
    status,
    busy,
    failure,
    // turnOn asks the permission as its first step, so it must start in the click, before any wait.
    turnOn: () => run(turnOn(pushApi, key!), 'on'),
    turnOff: () => run(turnOff(pushApi), 'off'),
  };
}
