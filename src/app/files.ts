import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { MadarApi } from '../api/calls';
import { MAX_FILE_BYTES } from '../api/contract/entities';
import { ApiError } from '../api/errors';
import { feedbackAdapter } from '../api/remote/feedback';
import { uploadAdapter } from '../api/remote/upload';
import type { Adapter } from '../api/remote/wire';
import type { Lang } from '../lib/dates';
import { formatNumber } from '../lib/dates';
import { errorMessage } from './errors';
import { REMOTE } from './mode';
import { useCall, useRuntime, type Runtime } from './runtime';
import { makeThumb } from './thumbs';

/** A signed link lives 10 minutes; the screens ask for a new one after 8 (plan 5.2). */
export const LINK_STALE_MS = 8 * 60 * 1000;

/** True in the real build. A runtime that names its mode wins over the build flag, so a test can choose. */
export function isRemote(runtime: Pick<Runtime, 'mode'>): boolean {
  return runtime.mode ? runtime.mode === 'remote' : REMOTE;
}

type Source = { url: string } | { blob: Blob };

/**
 * A URL for a stored file version, for img and iframe tags. The query key sits outside the "api" keys, so a change elsewhere in
 * the office does not load the file again. The real build asks files.link for a signed inline link ("thumb" gives the small
 * picture when the version has one); a broken picture asks for a new link once. The prototype reads the data with files.get and
 * releases its blob URL when it is not needed.
 */
export function useFileLink(fileId: string | null, letter?: string, variant: 'full' | 'thumb' = 'full'): { url: string | null; onError: () => void } {
  const runtime = useRuntime();
  const remote = isRemote(runtime);
  const { api } = runtime;
  const query = useQuery<Source>({
    queryKey: remote ? ['file-link', fileId, letter ?? 'latest', variant] : ['file-blob', fileId, letter ?? 'latest'],
    queryFn: async () => {
      const id = fileId as string;
      if (remote) return { url: (await api.call('files.link', { id, letter, variant, disposition: 'inline' })).url };
      return { blob: (await api.call('files.get', { id, letter })).blob };
    },
    enabled: fileId !== null,
    staleTime: remote ? LINK_STALE_MS : Infinity,
    retry: false,
  });
  const data = query.data;
  const blob = data && 'blob' in data ? data.blob : undefined;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setBlobUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setBlobUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  // One new link for each file and variant: a link that breaks again is not asked for a third time.
  const asked = useRef<string | null>(null);
  const key = `${fileId}|${letter ?? ''}|${variant}`;
  const onError = () => {
    if (!remote || fileId === null || asked.current === key) return;
    asked.current = key;
    void query.refetch();
  };
  const url = data && 'url' in data ? data.url : blobUrl;
  return { url: fileId === null ? null : url, onError };
}

/** The URL alone, for a frame or a picture that does not need a new link on error. */
export function useFileUrl(fileId: string | null, letter?: string, variant: 'full' | 'thumb' = 'full'): string | null {
  return useFileLink(fileId, letter, variant).url;
}

/** Opens a link in a new download. The review link frame blocks this (plan clarification 9). */
function save(href: string, name: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.rel = 'noopener';
  link.click();
}

/** Saves text to the computer as a file. The review link frame blocks this too. */
export function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  save(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves a stored file to the computer. The real build asks files.link for a download link (attachment): the store then sends the
 * file with its name, also an Arabic one (proof Z0a, item 6). The prototype saves the stored data.
 */
export async function downloadFile(api: MadarApi, fileId: string, letter?: string, o: { remote?: boolean } = {}): Promise<void> {
  if (o.remote ?? REMOTE) {
    const link = await api.call('files.link', { id: fileId, letter, variant: 'full', disposition: 'attachment' });
    save(link.url, link.name);
    return;
  }
  const { blob, file } = await api.call('files.get', { id: fileId, letter });
  const url = URL.createObjectURL(blob);
  save(url, file.file.name);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The adapters that RemoteApi runs for the two calls whose input carries files (plan 5.2). The bootstrap passes them. */
export function remoteFileAdapters(): { 'files.upload': Adapter; 'feedback.send': Adapter } {
  return { 'files.upload': uploadAdapter({ makeThumb }), 'feedback.send': feedbackAdapter() };
}

/**
 * The largest file that the office takes: the limit of the active store from session.get (50 MB on Supabase Storage, plan 2b,
 * point 1), never above the ceiling of the contract. The prototype names no limit, so it keeps the ceiling.
 */
export function useFileLimit(): number {
  const limit = useCall('session.get', {}).data?.limits?.maxFileBytes;
  return limit ? Math.min(limit, MAX_FILE_BYTES) : MAX_FILE_BYTES;
}

/** A limit in plain words: "50 MB". */
export function limitText(bytes: number, t: TFunction, lang: Lang): string {
  return t('files.limitMb', { n: formatNumber(bytes / (1024 * 1024), lang, 1) });
}

/** "Model.rvt is larger than 50 MB." */
export function tooLargeText(name: string, limit: number, t: TFunction, lang: Lang): string {
  return t('files.tooLarge', { name, limit: limitText(limit, t, lang) });
}

/** The message of a failed upload. A size refusal names the file and the limit; the rest reads as any other refusal. */
export function uploadErrorMessage(error: unknown, name: string, t: TFunction, lang: Lang): string {
  if (error instanceof ApiError && error.details.reason === 'file_too_large' && typeof error.details.limit === 'number') {
    return tooLargeText(name, error.details.limit, t, lang);
  }
  return errorMessage(error, t);
}
