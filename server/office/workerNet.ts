import { RpcTarget } from 'cloudflare:workers';
import type { FilesPort, Mail, MailPort, PresignedPut } from '../core/ports';
import { answerOf, postPush, type NetAnswer, type NetApi } from './net';

/**
 * The network port of the Worker (exit wave 3, server/office/net.ts): the Worker passes one into each office object call, and the
 * object calls it back. Each method runs one port call of the Worker and answers it as a NetAnswer. workerd only (RpcTarget).
 */
export class WorkerNet extends RpcTarget implements NetApi {
  readonly #files: FilesPort;
  readonly #mail: MailPort;
  readonly #post: ReturnType<typeof postPush>;

  constructor(o: { files: FilesPort; mail: MailPort; fetch?: typeof globalThis.fetch }) {
    super();
    this.#files = o.files;
    this.#mail = o.mail;
    this.#post = postPush(o.fetch ?? ((input, init) => fetch(input, init)));
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
}
