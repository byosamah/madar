import { RpcTarget } from 'cloudflare:workers';
import type { Config, DirectoryPort, FilesPort, Mail, MailPort, PresignedPut } from '../core/ports';
import type { PoolKind } from '../enterprise/platform/mailPool';
import type { PlatformStub } from '../enterprise/platform/stub';
import { ENT_VADO, type EnterpriseId } from '../enterprise/ids';
import { guardFilesPort } from '../files/guard';
import { answerOf, daftraRequest, googleRequest, postPush, type NetAnswer, type NetApi, type NetHttpReply, type NetHttpRequest } from './net';

/**
 * The network port of the Worker (exit wave 3, server/office/net.ts): the Worker passes one into each office object call, and the
 * object calls it back. Each method runs one port call of the Worker and answers it as a NetAnswer. workerd only (RpcTarget).
 */
export class WorkerNet extends RpcTarget implements NetApi {
  readonly #files: FilesPort;
  readonly #mail: MailPort;
  readonly #post: ReturnType<typeof postPush>;
  readonly #google: ReturnType<typeof googleRequest>;
  readonly #daftra: ReturnType<typeof daftraRequest> | null;
  readonly #directory: DirectoryPort | null;
  readonly #platform: Pick<PlatformStub, 'mailReserve'> | null;
  readonly #ent: EnterpriseId;

  /**
   * `daftra`: the Daftra accounts of the Worker. The keys stay here.
   * `ent`: the enterprise of the object that this port serves, from the Worker (the token claim, the tag or the address), never from the
   * object. It is required and has no default. The file port works inside the key folder of this enterprise (guardFilesPort), and a
   * missing or malformed id throws when the port is made.
   * `directory`: the email directory bound to the enterprise of this request (plan C).
   * `platform`: the platform object, for the mail pool of the account (plan D). With none, the pool answers a failure and no mail goes out.
   */
  constructor(o: { files: FilesPort; mail: MailPort; fetch?: typeof globalThis.fetch; daftra?: NonNullable<Config['daftra']>; ent: EnterpriseId; directory?: DirectoryPort; platform?: Pick<PlatformStub, 'mailReserve'> }) {
    super();
    this.#files = guardFilesPort(o.files, o.ent);
    this.#mail = o.mail;
    const run = o.fetch ?? ((input, init) => fetch(input, init));
    this.#post = postPush(run);
    this.#google = googleRequest(run);
    // The Daftra accounts belong to VADOs' Companies (design D6): the Worker sends no Daftra request for any other enterprise.
    this.#daftra = o.daftra && o.ent === ENT_VADO ? daftraRequest(o.daftra, run) : null;
    this.#directory = o.directory ?? null;
    this.#platform = o.platform ?? null;
    this.#ent = o.ent;
  }

  presignPut(key: string, o: { mimeType: string; size?: number }): Promise<NetAnswer<PresignedPut>> {
    return answerOf(() => this.#files.presignPut(key, o));
  }

  presignGet(key: string, o: { disposition: 'inline' | 'attachment'; filename: string; mimeType: string }): Promise<NetAnswer<{ url: string; expiresAt: string }>> {
    return answerOf(() => this.#files.presignGet(key, o));
  }

  head(key: string, o?: { timeoutMs?: number }): Promise<NetAnswer<{ size: number; mimeType: string } | null>> {
    return answerOf(() => this.#files.head(key, o));
  }

  copy(from: string, to: string): Promise<NetAnswer<null>> {
    return answerOf(async () => (await this.#files.copy(from, to), null));
  }

  remove(keys: string[]): Promise<NetAnswer<null>> {
    return answerOf(async () => (await this.#files.remove(keys), null));
  }

  sendMail(mail: Mail): Promise<NetAnswer<{ id: string }>> {
    return answerOf(() => this.#mail.send(mail));
  }

  pushPost(endpoint: string, headers: Record<string, string>, timeoutMs: number): Promise<NetAnswer<{ status: number }>> {
    return this.#post(endpoint, headers, timeoutMs);
  }

  googleFetch(req: NetHttpRequest): Promise<NetAnswer<NetHttpReply>> {
    return this.#google(req);
  }

  /** With no directory the answer is a failure, so a write of an email stops (fail closed). */
  directoryReserve(email: string): Promise<NetAnswer<'ok' | 'taken'>> {
    const directory = this.#directory;
    if (!directory) return Promise.resolve({ ok: false, failure: { name: 'NetworkError', message: 'The Worker holds no email directory for this call.' } });
    return answerOf(() => directory.reserve(email));
  }

  directoryRelease(email: string): Promise<NetAnswer<null>> {
    const directory = this.#directory;
    if (!directory) return Promise.resolve({ ok: false, failure: { name: 'NetworkError', message: 'The Worker holds no email directory for this call.' } });
    return answerOf(async () => (await directory.release(email), null));
  }

  /** The enterprise of this port is the one of the Worker (the constructor), never one that the object names. */
  mailReserve(kind: PoolKind, day: string, ref: string): Promise<NetAnswer<'ok' | 'full'>> {
    const platform = this.#platform;
    if (!platform) return Promise.resolve({ ok: false, failure: { name: 'NetworkError', message: 'The Worker holds no mail pool for this call.' } });
    return answerOf(() => platform.mailReserve({ ent: this.#ent, kind, day, ref }));
  }

  async daftraGet(req: { url: string }): Promise<NetAnswer<NetHttpReply>> {
    if (!this.#daftra) return { ok: false, failure: { name: 'NetworkError', message: 'The Worker holds no Daftra account.' } };
    return this.#daftra(req);
  }
}
