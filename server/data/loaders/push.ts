import type { Load } from './build';

/**
 * The push loader (owner, 2026-10-08). A device is private to its person, so a call reads the rows of the person of the call and
 * nothing else, and no read brings a device of another person to a handler. The one exception is push.register: it must see
 * the row of the endpoint it saves, because a shared browser moves that row to the new person (the handler never gives anything
 * of the other person back).
 */

type Endpoint = { endpoint: string };

const me = (L: Load): string => L.authority?.id ?? '';

/** push.mine: the devices of the person. */
export async function pushMine(L: Load): Promise<void> {
  await L.select({ c: 'pushDevices', where: [{ col: 'user_id', eq: me(L) }] });
}

/** push.remove: the device of the person with this endpoint. A device of another person stays unread, so it reads as missing. */
export async function pushRemove(L: Load, input: Endpoint): Promise<void> {
  await L.select({ c: 'pushDevices', where: [{ col: 'user_id', eq: me(L) }, { col: 'endpoint', eq: input.endpoint }] });
}

/** push.register: the devices of the person (the limit of ten), and the row of the endpoint, whoever holds it. */
export async function pushRegister(L: Load, input: Endpoint): Promise<void> {
  await L.select({ c: 'pushDevices', where: [{ or: [{ col: 'user_id', eq: me(L) }, { col: 'endpoint', eq: input.endpoint }] }] });
}
