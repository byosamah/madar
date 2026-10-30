import { handleOffice, type WorkerReply, type WorkerRequest } from './officeWorkerCore';

/**
 * The worker of the Word and Excel preview (tsk_495). It unpacks and reads the file off the page, so a crafted file cannot freeze the tab,
 * and `officeRunner.ts` ends it when its time budget is over. It has no DOM, no network call and no storage: it takes the bytes of one
 * file and answers with plain data. An error of any kind is an answer of kind "bad".
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  handleOffice(event.data).then(
    (reply) => (self as unknown as { postMessage(message: WorkerReply): void }).postMessage(reply),
    () => (self as unknown as { postMessage(message: WorkerReply): void }).postMessage({ kind: 'bad' }),
  );
};
