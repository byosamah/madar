import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { MadarApi } from '../../../api/calls';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { FilesTab } from './FilesTab';

const MB = 1024 * 1024;

/** One file of the project with no stage, as files.list gives it. */
const view = (id: string, name: string, mimeType: string): FileView => ({
  file: { id, projectId: 'prj_001', stageId: null, taskId: null, name, versions: [{ letter: 'A' }] },
  latest: { letter: 'A', blobKey: 'k', mimeType, size: 2048, uploadedBy: 'usr_001', uploadedAt: '2026-09-29T10:00:00.000+03:00' },
  uploader: { id: 'usr_001', name: 'Osama' },
  canDelete: false,
} as unknown as FileView);

/** The project detail as the Files tab reads it: one stage, and a person who may post. */
const DETAIL = {
  project: { id: 'prj_001', name: 'Corniche Office Tower', coverFileId: null },
  stages: [{ id: 'stg_001', name: 'Concept Design' }],
  currentStage: { id: 'stg_001', name: 'Concept Design' },
  viewerCan: { upload: true, links: true, deliver: true, editDetails: true },
} as unknown as ProjectDetail;

/** The Files tab in the real build: files.link signs a new link on each call, session.get names the 50 MB store limit. */
function renderRemote(files: FileView[]) {
  const links: unknown[] = [];
  const api = {
    call: async (name: string, input: unknown) => {
      if (name === 'files.link') {
        links.push(input);
        return { url: `https://store.test/link-${links.length}`, expiresAt: 'x', name: 'x.png', mimeType: 'image/png', size: 1 };
      }
      if (name === 'files.list') return files;
      if (name === 'session.get') return { limits: { maxFileBytes: 50 * MB } };
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  const runtime: Runtime = { api, mode: 'remote' };
  initI18n('en');
  const router = createMemoryRouter([{ path: '*', element: <FilesTab detail={DETAIL} /> }], { initialEntries: ['/projects/prj_001?tab=files'] });
  const view = render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: true })}>
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, links };
}

describe('the Files tab in the real build (plan 5.2)', () => {
  it('shows the small picture of a picture row, and lets the browser load and decode it only near the view (performance audit BGR-4)', async () => {
    const { container, links } = renderRemote([view('fil_001', 'Site photo.jpg', 'image/jpeg'), view('fil_002', 'Brief.pdf', 'application/pdf')]);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'https://store.test/link-1'));
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    // Only the picture asks for a link, and only for its small picture.
    expect(links).toEqual([{ id: 'fil_001', letter: 'A', variant: 'thumb', disposition: 'inline' }]);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByText('Brief.pdf')).toBeInTheDocument();
  });
});
