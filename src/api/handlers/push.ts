import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { PushDevice, PushEndpoint, type PushDevice as PushDeviceRec, type PushKeys } from '../contract/entities';
import { PUSH_DEVICES_PER_PERSON, PUSH_LABEL_MAX } from '../contract/push';
import { forbidden } from '../errors';
import { nextId, pushDevicesOf } from '../store';

/**
 * Browser push devices (owner, 2026-10-08). A person turns on "Notify me on this device" in Settings. The browser gives a push
 * address (the endpoint) and its two keys, and the screen saves them here. The server then posts one encrypted line to it for each
 * new notice and chat message (owner, 2026-10-21; server/push/CLAUDE.md). A device with no keys gets the empty push.
 *
 * - Only a person, for the person. An agent has no device and the MCP deny list holds all three calls.
 * - A device is private. Nobody else reads it, the Admin included. A call answers with the own devices only.
 * - These calls write no event, so the History and the Undo never hold a device, and the save step sends no change signal for
 *   a device (server/data/save.ts), so no other screen learns of it.
 * - One row for each endpoint. An endpoint that another person held moves to the current person (a shared browser).
 */

/**
 * What a screen reads of a device. It holds no person and never the keys: "hasKeys" only tells the screen to send them again
 * (a device saved before 2026-10-21 has none).
 */
export const PushDeviceView = z.object({
  id: PushDevice.shape.id, label: PushDevice.shape.label, endpoint: PushEndpoint, createdAt: PushDevice.shape.createdAt, hasKeys: z.boolean().default(false),
});
export type PushDeviceView = z.infer<typeof PushDeviceView>;

const viewOf = (device: PushDeviceRec): PushDeviceView => ({
  id: device.id, label: device.label, endpoint: device.endpoint, createdAt: device.createdAt, hasKeys: device.keys !== undefined,
});

/** The keys as a browser gives them: base64url, maybe with padding, which the record does not keep (owner, 2026-10-21). */
const KeysInput = z.object({
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/, 'Expected a P-256 public key of 65 bytes in base64url.'),
  auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/, 'Expected a secret of 16 bytes in base64url.'),
});
const unpadded = (keys: z.infer<typeof KeysInput>): PushKeys => ({ p256dh: keys.p256dh.replace(/=+$/, ''), auth: keys.auth.replace(/=+$/, '') });

/** The person of the call. An agent gets forbidden: a device is the browser of a person. So does a person who is turned off. */
function personOf(ctx: Ctx): string {
  if (ctx.actor.kind !== 'human' || !ctx.actor.active) throw forbidden('Only a person has a device for push notices.', { action: 'push' });
  return ctx.actor.id;
}

/** The devices of one person, oldest first. */
function devicesOf(ctx: Ctx, userId: string): PushDeviceRec[] {
  return Object.values(pushDevicesOf(ctx.state))
    .filter((device) => device.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export const pushRegister = defineCall({
  input: z.object({ endpoint: PushEndpoint, label: z.string().trim().min(1).max(PUSH_LABEL_MAX), keys: KeysInput.optional() }),
  output: PushDeviceView,
  run(input, ctx) {
    const userId = personOf(ctx);
    const devices = pushDevicesOf(ctx.state);
    const known = Object.values(devices).find((device) => device.endpoint === input.endpoint);
    // A browser that sends no keys keeps the keys it gave before: one endpoint has one pair of keys.
    const keys = input.keys ? unpadded(input.keys) : known?.keys;
    let device: PushDeviceRec;
    if (known && known.userId === userId) {
      // The same person again: the label and the keys may have changed. The day and the last push stay.
      device = { ...known, label: input.label };
    } else if (known) {
      // A shared browser: the endpoint moves to the current person, and the history of pushes starts again.
      device = { ...known, userId, label: input.label, createdAt: ctx.stamp, lastPushAt: null };
    } else {
      device = { id: nextId(ctx.state, 'pdv'), userId, endpoint: input.endpoint, label: input.label, createdAt: ctx.stamp, lastPushAt: null };
    }
    if (keys) device = { ...device, keys };
    devices[device.id] = device;
    // The oldest devices go when the person has too many. The device just saved stays.
    const own = devicesOf(ctx, userId);
    for (const old of own.filter((one) => one.id !== device.id).slice(0, Math.max(0, own.length - PUSH_DEVICES_PER_PERSON))) delete devices[old.id];
    return viewOf(device);
  },
});

export const pushRemove = defineCall({
  input: z.object({ endpoint: PushEndpoint }),
  output: z.object({ removed: z.boolean() }),
  run(input, ctx) {
    const userId = personOf(ctx);
    // The device of another person answers as a missing one: no call tells that an endpoint exists.
    const own = devicesOf(ctx, userId).find((device) => device.endpoint === input.endpoint);
    if (!own) return { removed: false };
    delete pushDevicesOf(ctx.state)[own.id];
    return { removed: true };
  },
});

export const pushMine = defineCall({
  input: z.object({}),
  output: z.array(PushDeviceView),
  readOnly: true,
  run(_input, ctx) {
    return devicesOf(ctx, personOf(ctx)).map(viewOf);
  },
});

export const pushCalls = {
  'push.register': pushRegister,
  'push.remove': pushRemove,
  'push.mine': pushMine,
};
