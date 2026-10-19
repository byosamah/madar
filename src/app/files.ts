import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { MadarApi } from '../api/calls';
import { MAX_FILE_BYTES } from '../api/contract/limits';
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

/** A picture URL for an img tag, with the one new link after an error, and "broken" when the picture cannot show. */
export type PictureLink = { url: string | null; onError: () => void; broken: boolean };

/**
 * The shared body of the picture hooks. The query key sits outside the "api" keys, so a change elsewhere in the office does not
 * load the picture again. The real build keeps a signed link for LINK_STALE_MS, also in the cache after the screen closes: a
 * screen that opens again then has the same URL, and the browser shows the picture from its image cache (performance audit
 * BGR-4). A broken picture asks for a new link once, and a second break gives no URL. The prototype makes a blob URL from the
 * data and releases it when it is not needed. "picture" names one picture, so a new picture gets its own new link.
 */
function usePictureSource(o: { queryKey: readonly unknown[]; load: () => Promise<Source>; enabled: boolean; remote: boolean; picture: string }): PictureLink {
  const query = useQuery<Source>({
    queryKey: o.queryKey,
    queryFn: o.load,
    enabled: o.enabled,
    staleTime: o.remote ? LINK_STALE_MS : Infinity,
    ...(o.remote ? { gcTime: LINK_STALE_MS } : {}),
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

  // One new link for each picture. A picture that breaks again gives no URL, so the screen shows its fallback.
  // A strike counts against a link, not against an error event: one bad link can break in two pictures (the thumbnail and the
  // sheet). So an error that comes while the new link loads, or before it came (dataUpdatedAt unchanged), is the old link
  // again. The hook gives up only when the new link breaks (review, 2026-10-07).
  const client = useQueryClient();
  const asked = useRef<{ picture: string; dataUpdatedAt: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const onError = () => {
    if (!o.remote || !o.enabled) return;
    // The live state of the query, not the state of the last render: an error can come before the next render.
    const live = client.getQueryState(o.queryKey);
    const dataUpdatedAt = live?.dataUpdatedAt ?? 0;
    if (asked.current?.picture === o.picture) {
      if (live?.fetchStatus === 'fetching' || dataUpdatedAt === asked.current.dataUpdatedAt) return;
      setFailed(o.picture);
      return;
    }
    asked.current = { picture: o.picture, dataUpdatedAt };
    void query.refetch();
  };
  const url = data && 'url' in data ? data.url : blobUrl;
  const gaveUp = failed === o.picture;
  return { url: !o.enabled || gaveUp ? null : url, onError, broken: o.enabled && (gaveUp || query.isError) };
}

/**
 * A URL for a stored file version, for img and iframe tags. The real build asks files.link for a signed inline link ("thumb"
 * gives the small picture when the version has one). The prototype reads the data with files.get (usePictureSource). "broken" is
 * true when the link fails or the new link breaks too, so a screen can fall back to a file chip.
 */
export function useFileLink(fileId: string | null, letter?: string, variant: 'full' | 'thumb' = 'full'): PictureLink {
  const runtime = useRuntime();
  const remote = isRemote(runtime);
  const { api } = runtime;
  return usePictureSource({
    queryKey: remote ? ['file-link', fileId, letter ?? 'latest', variant] : ['file-blob', fileId, letter ?? 'latest'],
    load: async () => {
      const id = fileId as string;
      if (remote) return { url: (await api.call('files.link', { id, letter, variant, disposition: 'inline' })).url };
      return { blob: (await api.call('files.get', { id, letter })).blob };
    },
    enabled: fileId !== null,
    remote,
    picture: `${fileId}|${letter ?? ''}|${variant}`,
  });
}

/** The answer of feedback.screenshot in the real build: its wire.output, a signed inline link. */
type ScreenshotLink = { url: string; expiresAt: string };

/**
 * A URL for one screenshot of a report, for the Admin (spec 4.3). The real build signs a link; the prototype reads the stored
 * picture. "broken" is true when the sign fails or the new link breaks too, so the screen shows its fallback.
 */
export function useScreenshotLink(id: string, index: number): PictureLink {
  const runtime = useRuntime();
  const remote = isRemote(runtime);
  const { api } = runtime;
  return usePictureSource({
    queryKey: remote ? ['feedback-shot-link', id, index] : ['feedback-shot', id, index],
    load: async () => {
      // The contract output is the picture. The real build answers with wire.output, a signed link, so the cast reads that form.
      if (remote) return { url: ((await api.call('feedback.screenshot', { id, index })) as unknown as ScreenshotLink).url };
      return { blob: (await api.call('feedback.screenshot', { id, index })).blob };
    },
    enabled: true,
    remote,
    picture: `${id}|${index}`,
  });
}

/** The pictures that the server shows inline (isPictureType in server/files/links.ts). It keeps every other type as a download. */
const INLINE_PICTURES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/** True for a picture that an img tag shows in the real build. A type with a parameter counts by its base; a list never does. */
export function isInlinePicture(mimeType: string): boolean {
  const lower = mimeType.trim().toLowerCase();
  return !lower.includes(',') && INLINE_PICTURES.has(lower.split(';')[0].trim());
}

/**
 * The picture test of the screens: in the real build only an inline picture (an SVG comes as a download, so an img never shows
 * it); in the prototype every picture, because the browser reads the stored data with its own type.
 */
export function usePictureTest(): (mimeType: string) => boolean {
  const remote = isRemote(useRuntime());
  return remote ? isInlinePicture : (mimeType) => mimeType.startsWith('image/');
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
 * The largest file that the office takes: the limit of the active store from session.get (50 MB on Supabase Storage, 250 MB on
 * R2, plan 2b, point 1), never above the ceiling of the contract. The prototype names no limit, so it keeps the ceiling.
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
