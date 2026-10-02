import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MadarApi } from '../api/calls';
import { useRuntime } from './runtime';

/**
 * A blob URL for a stored file version, for img and iframe tags. The query key sits outside the "api" keys,
 * so a change elsewhere in the office does not load the file again. The URL is released when it is not needed.
 */
export function useFileUrl(fileId: string | null, letter?: string): string | null {
  const { api } = useRuntime();
  const query = useQuery({
    queryKey: ['file-blob', fileId, letter ?? 'latest'],
    queryFn: () => api.call('files.get', { id: fileId as string, letter }),
    enabled: fileId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const blob = query.data?.blob;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Saves text to the computer as a file. The review link frame blocks this too. */
export function downloadText(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a stored file to the computer. The review link frame blocks this (plan clarification 9). */
export async function downloadFile(api: MadarApi, fileId: string, letter?: string): Promise<void> {
  const { blob, file } = await api.call('files.get', { id: fileId, letter });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
