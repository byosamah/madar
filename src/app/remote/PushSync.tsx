import { useEffect } from 'react';
import { useCall, useRuntime } from '../runtime';
import { REMOTE } from '../mode';
import { buildKey, syncThisDevice, type PushApi } from './push';

/** The check waits a little, so it never competes with the first screen. */
export const PUSH_SYNC_DELAY_MS = 3_000;

/**
 * The check of browser push at the start of the app, for the person who is signed in (owner, 2026-10-08). A browser that holds a
 * push subscription and the permission gets its endpoint saved again when the server does not list it: the browser may renew the
 * endpoint without telling the page. Push is on by default (owner, 2026-10-09): a browser that has the permission and no
 * subscription (after a sign-out) gets push turned on, unless this person turned it off here. It draws nothing, runs once for each
 * person, and ignores every error. The real build only.
 */
export function PushSync({ delayMs = PUSH_SYNC_DELAY_MS }: { delayMs?: number }) {
  const { api } = useRuntime();
  const userId = useCall('session.get', {}, { enabled: REMOTE }).data?.user.id;

  useEffect(() => {
    const key = buildKey();
    if (!REMOTE || !key || !userId) return;
    const timer = setTimeout(() => void syncThisDevice(api as unknown as PushApi, key, userId).catch(() => undefined), delayMs);
    return () => clearTimeout(timer);
  }, [api, userId, delayMs]);

  return null;
}
