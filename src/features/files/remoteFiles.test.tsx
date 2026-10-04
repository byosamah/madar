import { describe, expect, it } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { MadarApi } from '../../api/calls';
import type { FileView, ProjectSummary } from '../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { DrawingsStrip } from '../dashboard/meeting/DrawingsStrip';
import { ProjectCover } from '../projects/ProjectCard';
import { useAttachments } from './Attachments';
import { initI18n } from '../../i18n';

const MB = 1024 * 1024;

/** The real build as the screens see it: files.link signs a new link on each call, session.get names the 50 MB store limit. */
function remote(o: { files?: FileView[] } = {}) {
  const links: unknown[] = [];
  const api = {
    call: async (name: string, input: unknown) => {
      if (name === 'files.link') {
        links.push(input);
        return { url: `https://store.test/link-${links.length}`, expiresAt: 'x', name: 'x.png', mimeType: 'image/png', size: 1 };
      }
      if (name === 'files.list') return o.files ?? [];
      if (name === 'session.get') return { limits: { maxFileBytes: 50 * MB } };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  const runtime: Runtime = { api, mode: 'remote' };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient()}>
      <ToastProvider>{children}</ToastProvider>
    </RuntimeProvider>
  );
  return { links, wrapper };
}

const view = (id: string, name: string): FileView => ({
  file: { id, projectId: 'prj_001', stageId: null, taskId: null, name, versions: [] },
  latest: { letter: 'C', blobKey: 'k', mimeType: 'image/png', size: 10, uploadedBy: 'usr_001', uploadedAt: '2026-09-29T10:00:00.000+03:00' },
} as unknown as FileView);

describe('the picture lines in the real build (plan 5.2)', () => {
  it('the project cover asks for the small picture, and a new link once when it breaks', async () => {
    initI18n('en');
    const { links, wrapper } = remote();
    const summary = { project: { id: 'prj_001', name: 'Corniche Office Tower', coverFileId: 'fil_002' }, coverLetter: 'B' } as unknown as ProjectSummary;
    render(<ProjectCover summary={summary} />, { wrapper });
    // Before the link comes, the cover is the project mark (a div with the role img), so wait for the picture itself.
    await waitFor(() => expect(screen.getByRole('img', { name: /Corniche Office Tower/ })).toHaveAttribute('src', 'https://store.test/link-1'));
    const img = screen.getByRole('img', { name: /Corniche Office Tower/ });
    expect(links).toEqual([{ id: 'fil_002', letter: 'B', variant: 'thumb', disposition: 'inline' }]);
    fireEvent.error(img);
    await waitFor(() => expect(screen.getByRole('img', { name: /Corniche Office Tower/ })).toHaveAttribute('src', 'https://store.test/link-2'));
  });

  it('the meeting drawings ask for the small pictures', async () => {
    initI18n('en');
    const { links, wrapper } = remote({ files: [view('fil_901', 'Plan 1.png')] });
    const { container } = render(<DrawingsStrip projectId="prj_001" />, { wrapper });
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://store.test/link-1'));
    expect(links).toEqual([{ id: 'fil_901', letter: 'C', variant: 'thumb', disposition: 'inline' }]);
  });
});

describe('attachments in the real build', () => {
  it('refuse a file over the store limit when the person picks it, and name the limit', async () => {
    initI18n('en');
    const { wrapper } = remote();
    const { result } = renderHook(() => useAttachments(), { wrapper });
    const big = new File(['x'], 'Survey.dwg', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 51 * MB });
    const small = new File(['x'], 'Note.txt', { type: 'text/plain' });
    // Wait for session.get, so the limit of the store is known.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const list = { 0: big, 1: small, length: 2, item: (i: number) => [big, small][i], [Symbol.iterator]: function* () { yield big; yield small; } } as unknown as FileList;
    await waitFor(() => {
      result.current.add(list);
      expect(result.current.files.map((f) => f.name)).toContain('Note.txt');
    });
    expect(result.current.files.map((f) => f.name)).not.toContain('Survey.dwg');
    expect(await screen.findAllByText('Survey.dwg is larger than 50 MB.')).not.toHaveLength(0);
  });
});
