import { notBuiltAsync } from '../core/notBuilt';
import { FILE_STORE_LIMITS, type FilesPort } from '../core/ports';

export type SupabaseStorageEnv = { supabaseUrl: string; secretKey: string; bucket: string };

/**
 * The default store (plan 2b, point 1): the private bucket madar-files, signed upload links, staging key then object copy,
 * signed download links with the download file name, a 10-minute life. Track F replaces this stub.
 */
export function supabaseStorageFilesPort(_env: SupabaseStorageEnv): FilesPort {
  return {
    kind: 'supabase',
    maxFileBytes: FILE_STORE_LIMITS.supabase.maxFileBytes,
    presignPut: () => notBuiltAsync('The Supabase Storage store'),
    presignGet: () => notBuiltAsync('The Supabase Storage store'),
    head: () => notBuiltAsync('The Supabase Storage store'),
    copy: () => notBuiltAsync('The Supabase Storage store'),
    remove: () => notBuiltAsync('The Supabase Storage store'),
  };
}
