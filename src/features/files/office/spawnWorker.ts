import type { WorkerLike } from './officeRunner';

/**
 * Starts the real worker of the preview (the remote build only). It sits in its own file, so the prototype build, which is one script file,
 * never sees the worker URL and makes no worker file (`officeRunner.ts`). Current Safari for iPhone (15 and up) runs a module worker.
 */
export function spawnWorker(): WorkerLike {
  return new Worker(new URL('./officeWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}
