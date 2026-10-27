import { downloadFile, isRemote } from './files';
import { useRuntime } from './runtime';
import { useToast } from './toasts';

/**
 * The press handler of a Download control. It reads the runtime and the toast once, saves the file with the build flag of the
 * runtime, and shows a failure as a toast. It sits in its own file and imports downloadFile, so a test that replaces downloadFile in
 * `files.ts` also sees the calls of this hook.
 */
export function useDownloadFile(): (fileId: string, letter?: string) => void {
  const runtime = useRuntime();
  const toast = useToast();
  return (fileId, letter) => {
    downloadFile(runtime.api, fileId, letter, { remote: isRemote(runtime) }).catch((error: unknown) => toast.failed(error));
  };
}
