import { notBuiltAsync } from '../core/notBuilt';
import { FILE_STORE_LIMITS, type FilesPort } from '../core/ports';

export type R2Env = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

/** The R2 store with aws4fetch on the EU endpoint (plan 5.2). Ready for the switch MADAR_FILE_STORE=r2. Track F replaces this stub. */
export function r2FilesPort(_env: R2Env): FilesPort {
  return {
    kind: 'r2',
    maxFileBytes: FILE_STORE_LIMITS.r2.maxFileBytes,
    presignPut: () => notBuiltAsync('The R2 store'),
    presignGet: () => notBuiltAsync('The R2 store'),
    head: () => notBuiltAsync('The R2 store'),
    copy: () => notBuiltAsync('The R2 store'),
    remove: () => notBuiltAsync('The R2 store'),
  };
}
