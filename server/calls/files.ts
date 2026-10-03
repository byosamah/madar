import type { ServerHooks } from '../../src/api/registry';
import type { UploadPrepared } from '../../src/api/handlers/files';
import { notBuiltAsync } from '../core/notBuilt';
import type { Deps } from '../core/ports';
import type { ServerCall } from '../core/types';

/** Track F replaces these stubs (plan 5.2 and section 2b, point 1: Supabase Storage or R2 behind FilesPort). */
export const filesUploadStart: ServerCall<'files.uploadStart'> = () => notBuiltAsync('files.uploadStart');
export const filesLink: ServerCall<'files.link'> = () => notBuiltAsync('files.link');

/** files.upload on the server: the preflight checks and copies the uploaded object; prepare marks the intent used and gives run() its data. */
export const filesUploadHooks: ServerHooks<unknown, UploadPrepared, Deps> = {
  preflight: () => notBuiltAsync('The files.upload preflight'),
  prepare: () => notBuiltAsync('The files.upload prepare'),
};
