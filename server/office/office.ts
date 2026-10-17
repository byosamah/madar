import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import type { OfficeSnapshot, Principal } from '../core/types';
import { applyLiteSchema } from '../data/lite/schema';
import { env, setEnvSource } from '../env';
import type { OfficeBatchInput, OfficeBatchOutput } from './batch';
import { doHost } from './doHost';
import { LIVE_PING, LIVE_PONG, type LiveSocket, type Sockets } from './live';
import type { NetApi } from './net';
import type { OpResult } from '../auth/own/office';
import {
  officeParts, type OfficeCronInput, type OfficeCronReport, type OfficeEffectsInput, type OfficeEffectsReport, type OfficeHealth, type OfficeParts,
  type OfficeSigninInput,
} from './parts';
import { principalOfWho, type OfficeWho } from './who';

/**
 * The office object (exit wave 3): one SQLite Durable Object for each copy, named "office". The schema step runs inside
 * blockConcurrencyWhile, so no request meets an office that is not ready; a throw there resets the object. The work sits in
 * officeParts (server/office/parts.ts); this class gives it ctx.storage and the Hibernation API. workerd only.
 */

type Env = Record<string, unknown>;

function socketsOf(ctx: DurableObjectState): Sockets {
  return {
    accept: (socket, tags) => ctx.acceptWebSocket(socket as unknown as WebSocket, tags),
    list: (tag) => ctx.getWebSockets(tag) as unknown as LiveSocket[],
    lastPong: (socket) => ctx.getWebSocketAutoResponseTimestamp(socket as unknown as WebSocket),
    pair: () => {
      const pair = new WebSocketPair();
      return { client: pair[0], server: pair[1] as unknown as LiveSocket };
    },
    upgraded: (client) => new Response(null, { status: 101, webSocket: client } as ResponseInit),
  };
}

export class Office extends DurableObject<Env> {
  protected parts!: OfficeParts;

  constructor(ctx: DurableObjectState, environment: Env) {
    super(ctx, environment);
    setEnvSource(environment);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG));
    void ctx.blockConcurrencyWhile(async () => {
      const host = doHost(ctx.storage);
      await applyLiteSchema(host);
      this.parts = officeParts({ host, read: env, sockets: socketsOf(ctx), principal: (who, office) => this.principal(who, office) });
    });
  }

  /** The person of a batch: the users row of the token check (server/auth/principal.ts). The test object of test:office overrides it. */
  protected principal(who: OfficeWho, office: OfficeSnapshot): Principal {
    return principalOfWho(who, office);
  }

  batch(input: OfficeBatchInput, net: NetApi): Promise<OfficeBatchOutput> {
    return this.parts.batch(input, net);
  }

  runEffects(input: OfficeEffectsInput, net: NetApi): Promise<OfficeEffectsReport> {
    return this.parts.runEffects(input, net);
  }

  /** One 15-minute run of the jobs (the Cron Trigger of the Worker), with the network port of that Worker invocation. */
  cron(input: OfficeCronInput, net: NetApi): Promise<OfficeCronReport> {
    return this.parts.cron(input, net);
  }

  /**
   * One step of the own sign-in (exit wave 2): the routes of the Worker call it through objectSigninOffice. The key of
   * MADAR_AUTH_PRIVATE_JWK is imported before any transaction of the step; an unknown name answers not_found.
   */
  signin(body: OfficeSigninInput): Promise<OpResult<unknown>> {
    return this.parts.signin(body);
  }

  health(): Promise<OfficeHealth> {
    return this.parts.health();
  }

  fetch(request: Request): Promise<Response> {
    return this.parts.socket(request);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    this.parts.message(socket as unknown as LiveSocket, message);
  }

  webSocketClose(socket: WebSocket, code: number): void {
    this.parts.closed(socket as unknown as LiveSocket, code);
  }

  webSocketError(socket: WebSocket): void {
    this.parts.closed(socket as unknown as LiveSocket, 1011);
  }
}
