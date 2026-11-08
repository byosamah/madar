import type { State } from '../../../src/api/store';
import { ENT_VADO } from '../../enterprise/ids';
import { httpOf, NODE_NOW, NODE_OFFICE_ENV, NODE_TODAY, nodeWorld, stubOf, type OfficeHttpAnswer, type OfficeHttpRequest } from './nodeWorld';

export { httpOf, NODE_NOW, NODE_OFFICE_ENV, NODE_TODAY, stubOf };
export type { OfficeHttpAnswer, OfficeHttpRequest };

/**
 * The office path on node:sqlite for the node tests (exit wave 4): one enterprise, ENT_VADO, from nodeWorld (server/office/test/nodeWorld.ts).
 * It keeps the fields that the tests of one office read. A test of two enterprises uses nodeWorld.
 */
export async function nodeOffice(o: { at?: string; env?: Record<string, string>; seed?: State | false; row?: false } = {}) {
  const world = await nodeWorld({
    ...(o.at ? { at: o.at } : {}),
    ...(o.env ? { env: o.env } : {}),
    ...(o.seed !== undefined ? { seeds: { [ENT_VADO]: o.seed } } : {}),
    ...(o.row === false ? { row: false as const } : {}),
  });
  const vado = world.ents.get(ENT_VADO)!;
  return {
    raw: vado.raw, host: vado.host, parts: vado.parts, sockets: vado.sockets, stub: vado.stub,
    clock: world.clock, env: world.env, jwk: world.jwk, net: world.net, route: world.route, lines: world.lines,
    signins: (rows: Parameters<typeof world.signins>[0]) => world.signins(rows, ENT_VADO),
    world,
  };
}
