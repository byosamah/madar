import { handleOffice } from './officeWorkerCore';
import type { WorkerLike } from './officeRunner';

/**
 * A worker that runs the code of the real worker in the same thread and answers the way the real one does. Two uses: the prototype build
 * (one script file, so it has no worker file; its files are local to the browser of the person), and the tests (jsdom has no Worker; give
 * it to `setWorkerFactory`). It has no time budget in any real sense: a timer cannot fire while the thread works. The unpack limits and the
 * grid scan (`zipGuard.ts`, `xlsxSheets.ts`) still stop a bomb and a far cell.
 */
export function inlineWorker(): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      handleOffice(message as Parameters<typeof handleOffice>[0]).then(
        (reply) => worker.onmessage?.({ data: reply }),
        () => worker.onmessage?.({ data: { kind: 'bad' } }),
      );
    },
    terminate() {},
  };
  return worker;
}
