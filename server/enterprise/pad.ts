/**
 * Waits until a minimum time has passed since startedAt (Madar enterprises). Every branch of a route that must not tell a known
 * input from an unknown one (forgot, renew, a socket ticket) ends here, so all branches take the same time.
 */
export async function padTo(startedAt: number, minMs: number, sleep: (ms: number) => Promise<void>, now: () => number = () => performance.now()): Promise<void> {
  const left = minMs - (now() - startedAt);
  if (left > 0) await sleep(left);
}
