import type { LiveSocket, Sockets } from '../live';
import type { NetAnswer, NetApi } from '../net';

/** One server socket of the Hibernation API in memory. */
export type FakeSocket = LiveSocket & { sent: string[]; closed?: { code?: number; reason?: string }; failSend?: boolean };

export function fakeSocket(): FakeSocket {
  let note: unknown = null;
  const socket: FakeSocket = {
    sent: [],
    send(text) {
      if (socket.failSend) throw new Error('The socket is closed.');
      socket.sent.push(text);
    },
    close(code, reason) {
      socket.closed = { code, reason };
    },
    serializeAttachment(value) {
      note = structuredClone(value);
    },
    deserializeAttachment() {
      return note;
    },
  };
  return socket;
}

export type FakeSockets = Sockets & { all: { socket: FakeSocket; tags: string[] }[]; pongs: Map<LiveSocket, Date> };

/** The sockets of the object in memory: accept with tags, list by tag, the time of the last auto pong of each one. */
export function fakeSockets(): FakeSockets {
  const all: { socket: FakeSocket; tags: string[] }[] = [];
  const pongs = new Map<LiveSocket, Date>();
  return {
    all,
    pongs,
    accept(socket, tags) {
      all.push({ socket: socket as FakeSocket, tags });
    },
    list(tag) {
      return all.filter((one) => !one.socket.closed && (tag === undefined || one.tags.includes(tag))).map((one) => one.socket);
    },
    lastPong(socket) {
      return pongs.get(socket) ?? null;
    },
    pair() {
      const server = fakeSocket();
      return { client: { peer: server }, server };
    },
    upgraded(client) {
      return { status: 101, webSocket: client } as unknown as Response;
    },
  };
}

/** A socket of one person, as acceptLive leaves it. */
export function openFor(sockets: FakeSockets, userId: string, openedAt: number): FakeSocket {
  const socket = fakeSocket();
  sockets.accept(socket, ['office', `person:${userId}`]);
  socket.serializeAttachment({ userId, openedAt });
  return socket;
}

const ok = <T,>(value: T): Promise<NetAnswer<T>> => Promise.resolve({ ok: true, value });

/** A network port of the Worker that records each call and answers well, unless a test gives another answer. */
export function recordingNet(over: Partial<NetApi> = {}): NetApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    presignPut: (key) => (calls.push(`presignPut ${key}`), ok({ url: `https://files.test/put/${key}`, headers: { 'Content-Type': 'image/png' }, expiresAt: '2099-01-01T00:00:00.000Z' })),
    presignGet: (key) => (calls.push(`presignGet ${key}`), ok({ url: `https://files.test/get/${key}`, expiresAt: '2099-01-01T00:00:00.000Z' })),
    head: (key) => (calls.push(`head ${key}`), ok({ size: 10, mimeType: 'image/png' })),
    copy: (from, to) => (calls.push(`copy ${from}>${to}`), ok(null)),
    remove: (keys) => (calls.push(`remove ${keys.join(',')}`), ok(null)),
    sendMail: (mail) => (calls.push(`mail ${mail.idempotencyKey}`), ok({ id: `mail_${calls.length}` })),
    pushPost: (endpoint) => (calls.push(`push ${endpoint}`), ok({ status: 201 })),
    ...over,
  };
}
