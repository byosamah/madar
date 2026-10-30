import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICE_BUDGET_MS, readOffice, setWorkerFactory, type WorkerLike } from './officeRunner';

/**
 * The parse of a Word or Excel file runs in a Web Worker with a time budget (tsk_495 review). A file that never ends, a worker that
 * breaks and a browser with no worker all give the quiet line "cannot show", never a frozen page.
 */
type Fake = WorkerLike & { sent: { message: unknown; transfer?: unknown[] }[]; terminated: number; reply(data: unknown): void; fail(): void };

function fakeWorker(): Fake {
  const worker: Fake = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    sent: [],
    terminated: 0,
    postMessage(message, transfer) { worker.sent.push({ message, transfer }); },
    terminate() { worker.terminated += 1; },
    reply(data) { worker.onmessage?.({ data }); },
    fail() { worker.onerror?.({}); },
  };
  return worker;
}

/** The worker starts after one awaited step (the factory may be async), so a test waits for it before it looks at the worker. */
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setWorkerFactory(null);
});

describe('readOffice', () => {
  it('sends the bytes to the worker without a copy, and gives its answer for an Excel file', async () => {
    const worker = fakeWorker();
    setWorkerFactory(() => worker);
    const bytes = new ArrayBuffer(8);
    const pending = readOffice('xlsx', bytes);
    await tick();
    expect(worker.sent).toEqual([{ message: { kind: 'xlsx', bytes }, transfer: [bytes] }]);
    worker.reply({ kind: 'sheets', sheets: [{ name: 'A', rows: [['x']], moreRows: false, moreColumns: false }], moreSheets: false });
    expect(await pending).toMatchObject({ kind: 'sheets' });
    expect(worker.terminated).toBe(1);
  });

  it('cleans the HTML of a Word file on the page, because the worker has no DOM', async () => {
    const worker = fakeWorker();
    setWorkerFactory(() => worker);
    const pending = readOffice('docx', new ArrayBuffer(8));
    await tick();
    worker.reply({ kind: 'html', html: '<p onclick="alert(1)">Hello</p><script>alert(2)</script>' });
    const out = await pending;
    if (out.kind !== 'html') throw new Error(`Expected html, got ${out.kind}.`);
    expect(out.html).toContain('Hello');
    expect(out.html).not.toContain('onclick');
    expect(out.html).not.toContain('script');
  });

  it('passes "empty", "bad", "big" and "cells" on as they are', async () => {
    for (const kind of ['bad', 'big', 'cells', 'empty'] as const) {
      const worker = fakeWorker();
      setWorkerFactory(() => worker);
      const pending = readOffice('xlsx', new ArrayBuffer(8));
      await tick();
    await tick();
      worker.reply({ kind });
      expect(await pending).toEqual({ kind });
    }
  });

  it('ends a file that takes longer than the budget: the worker is terminated and the answer is "failed"', async () => {
    const worker = fakeWorker();
    setWorkerFactory(() => worker);
    const pending = readOffice('docx', new ArrayBuffer(8));
    await tick();
    await vi.advanceTimersByTimeAsync(OFFICE_BUDGET_MS - 1);
    expect(worker.terminated).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ kind: 'failed' });
    expect(worker.terminated).toBe(1);
    expect(OFFICE_BUDGET_MS).toBe(8000);
  });

  it('gives "failed" and ends the worker when the worker breaks, or answers with something that is no answer', async () => {
    const broken = fakeWorker();
    setWorkerFactory(() => broken);
    const first = readOffice('xlsx', new ArrayBuffer(8));
    await tick();
    broken.fail();
    expect(await first).toEqual({ kind: 'failed' });
    expect(broken.terminated).toBe(1);
    const odd = fakeWorker();
    setWorkerFactory(() => odd);
    const second = readOffice('xlsx', new ArrayBuffer(8));
    await tick();
    odd.reply('not an answer');
    expect(await second).toEqual({ kind: 'failed' });
    expect(odd.terminated).toBe(1);
  });

  it('gives "failed" when the browser cannot start a worker', async () => {
    setWorkerFactory(() => { throw new Error('No worker.'); });
    expect(await readOffice('docx', new ArrayBuffer(8))).toEqual({ kind: 'failed' });
  });

  it('keeps only the first answer: a late answer after the budget changes nothing', async () => {
    const worker = fakeWorker();
    setWorkerFactory(() => worker);
    const pending = readOffice('xlsx', new ArrayBuffer(8));
    await tick();
    await vi.advanceTimersByTimeAsync(OFFICE_BUDGET_MS + 1);
    worker.reply({ kind: 'big' });
    expect(await pending).toEqual({ kind: 'failed' });
  });
});
