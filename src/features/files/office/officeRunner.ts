import type { OfficeKind } from './officeKind';
import type { SheetTable } from './xlsxSheets';

/**
 * The main-thread side of the preview of a Word or Excel file (tsk_495). The unpack and the parse run in a Web Worker
 * (`officeWorker.ts`, its own chunk) and have a time budget. When the budget is over, or the worker breaks, the worker is terminated and the
 * answer is "failed": the screen shows the quiet line and the Download button, and the page never freezes. A module worker runs on current
 * Safari for iPhone (15 and up) and on every current browser.
 */
export const OFFICE_BUDGET_MS = 8000;

export type OfficeOutcome =
  | { kind: 'html'; html: string }
  | { kind: 'sheets'; sheets: SheetTable[]; moreSheets: boolean }
  | { kind: 'empty' | 'bad' | 'big' | 'cells' | 'failed' };

/** The parts of a Worker that this file uses. A test gives its own. */
export type WorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
};

let factory: (() => WorkerLike | Promise<WorkerLike>) | null = null;

/** A test replaces the worker. `null` gives the real one back. */
export function setWorkerFactory(next: (() => WorkerLike | Promise<WorkerLike>) | null): void {
  factory = next;
}

/**
 * The remote build starts the real worker. The prototype is one script file and has no worker file, so it runs the same code in the page
 * (`inlineWorker.ts`). The flag is written in full, so the build folds it and drops the branch that the build does not use.
 */
async function makeWorker(): Promise<WorkerLike> {
  if (factory) return factory();
  if (import.meta.env.VITE_MADAR_API === 'remote') {
    const { spawnWorker } = await import('./spawnWorker');
    return spawnWorker();
  }
  const { inlineWorker } = await import('./inlineWorker');
  return inlineWorker();
}

const FAILED: OfficeOutcome = { kind: 'failed' };

/** Reads the worker answer, or null when it is no answer that this file knows. */
function readReply(data: unknown): { kind: string; html?: string; sheets?: SheetTable[]; moreSheets?: boolean } | null {
  if (typeof data !== 'object' || data === null) return null;
  const reply = data as { kind?: unknown; html?: unknown; sheets?: unknown };
  if (reply.kind === 'html') return typeof reply.html === 'string' ? (data as { kind: string; html: string }) : null;
  if (reply.kind === 'sheets') return Array.isArray(reply.sheets) ? (data as { kind: string; sheets: SheetTable[]; moreSheets: boolean }) : null;
  return reply.kind === 'empty' || reply.kind === 'bad' || reply.kind === 'big' || reply.kind === 'cells' ? { kind: reply.kind } : null;
}

/** The answer of the worker for one file. The bytes move to the worker (no copy) and are gone from the page after this call. */
export async function readOffice(kind: OfficeKind, bytes: ArrayBuffer, budgetMs: number = OFFICE_BUDGET_MS): Promise<OfficeOutcome> {
  let worker: WorkerLike;
  try {
    worker = await makeWorker();
  } catch {
    return FAILED;
  }
  const answer = await new Promise<ReturnType<typeof readReply>>((resolve) => {
    const timer = setTimeout(() => resolve(null), budgetMs);
    const done = (value: ReturnType<typeof readReply>) => {
      clearTimeout(timer);
      resolve(value);
    };
    worker.onmessage = (event) => done(readReply(event.data));
    worker.onerror = () => done(null);
    worker.onmessageerror = () => done(null);
    try {
      worker.postMessage({ kind, bytes }, [bytes]);
    } catch {
      done(null);
    }
  });
  worker.terminate();
  if (!answer) return FAILED;
  if (answer.kind === 'html') {
    // DOMPurify needs a DOM, so the cleaner runs here, in a chunk of its own.
    const { cleanDocxHtml } = await import('./docxClean');
    return cleanDocxHtml(answer.html ?? '');
  }
  if (answer.kind === 'sheets') return { kind: 'sheets', sheets: answer.sheets ?? [], moreSheets: answer.moreSheets === true };
  return { kind: answer.kind } as OfficeOutcome;
}
