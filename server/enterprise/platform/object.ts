import { DurableObject, type DurableObjectState } from 'cloudflare:workers';
import { env, setEnvSource } from '../../env';
import { doHost, type DoHost } from '../../office/doHost';
import type { EnterpriseId } from '../ids';
import type { DayCounts, EnterpriseRow, EnterpriseStatus } from '../types';
import { platformParts, type PlatformParts } from './parts';
import { applyPlatformSchema } from './schema';
import type { CapAnswer, PlatformStub } from './stub';

/**
 * The platform object (Madar enterprises): one SQLite Durable Object named "platform". The schema step runs inside blockConcurrencyWhile,
 * as in the office object. The work sits in platformParts (parts.ts); this class gives it ctx.storage and the RPC methods. workerd only.
 */

type Env = Record<string, unknown>;

export class Platform extends DurableObject<Env> implements PlatformStub {
  protected parts!: PlatformParts;
  protected host!: DoHost;

  constructor(ctx: DurableObjectState, environment: Env) {
    super(ctx, environment);
    setEnvSource(environment);
    void ctx.blockConcurrencyWhile(async () => {
      const host = doHost(ctx.storage);
      await applyPlatformSchema(host);
      this.host = host;
      this.parts = platformParts({ host, read: env });
    });
  }

  resolveEmail(input: { email: string }) {
    return this.parts.resolveEmail(input);
  }

  resolveAddress(input: { address: string }) {
    return this.parts.resolveAddress(input);
  }

  listed() {
    return this.parts.listed();
  }

  reserveEmail(input: { ent: EnterpriseId; email: string }) {
    return this.parts.reserveEmail(input);
  }

  releaseEmail(input: { ent: EnterpriseId; email: string }) {
    return this.parts.releaseEmail(input);
  }

  isOwner(input: { ent: EnterpriseId; userId: string }) {
    return this.parts.isOwner(input);
  }

  setOwners(input: { owners: { ent: EnterpriseId; userId: string }[] }) {
    return this.parts.setOwners(input);
  }

  report(input: EnterpriseStatus) {
    return this.parts.report(input);
  }

  meter(input: { ent: EnterpriseId; day: string; counts: DayCounts }): Promise<CapAnswer> {
    return this.parts.meter(input);
  }

  mailReserve(input: { ent: EnterpriseId; kind: 'signin' | 'notice'; day: string }) {
    return this.parts.mailReserve(input);
  }

  register(input: { row: EnterpriseRow; emails: string[] }) {
    return this.parts.register(input);
  }

  refuseSignin(input: Parameters<PlatformStub['refuseSignin']>[0]) {
    return this.parts.refuseSignin(input);
  }

  refuseMail(input: Parameters<PlatformStub['refuseMail']>[0]) {
    return this.parts.refuseMail(input);
  }

  sweep(input: { at: string }) {
    return this.parts.sweep(input);
  }

  health() {
    return this.parts.health();
  }
}
