# API client of the real build

Rules for `src/api/remote/`: the batcher, the wire, the keys and the follow step. The screens call `api.call(name, input)`.

- With no session token the client sends nothing: the call fails with `unauthenticated`, reason `no_session` (`AuthGate`
  ignores that reason).
- The Batcher (`batcher.ts`) places a read with `after` (a read of a follow step) in the request of the write before it, while
  the request holds fewer than `MAX_BATCH` calls and its cost stays within `BATCH_BUDGET` (`callCost`, `wire.ts`). Every other
  call keeps the limit of one overview call for each request, so the cold start of a screen sends the same requests as before.
  If the read does not fit, it goes as any other call and `RemoteApi` does not name it as fresh. A read that goes again after
  a lost answer goes alone and drops `after`.
- `follow.ts` holds the reads that go after an own write. It stays in its own file so the prototype bundle never takes
  `RemoteApi`.
- A server read must be in `READ_CALLS` (`keys.ts`), or the browser gives it an idempotency key.
- WebKit sends the batch through the page's own `/api` (`pageApi.ts`, `isWebKit`). The reason is in `functions/CLAUDE.md`.
