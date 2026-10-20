import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onTestFinished } from 'vitest';
import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { calls } from '../../../api/calls';
import { createApi } from '../../../api/client';
import { memoryPersister } from '../../../api/persist';
import { Store, type State } from '../../../api/store';
import { uploadAdapter, type PutSender } from '../../../api/remote/upload';
import { AppearanceSync } from '../../../app/AppearanceSync';
import { createAppRouter } from '../../../app/routes';
import { RuntimeProvider, createQueryClient } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { buildSeed } from '../../../data/seed';
import { initI18n } from '../../../i18n';
import { setNow } from '../../../lib/dates';
import { NOW, TODAY } from '../../../test/factories';
import { renderApp } from '../../../test/render';
import { ApiError } from '../../../api/errors';

const as = (userId: string) => (state: State) => {
  state.session.currentUserId = userId;
};
const FILES = '/projects/prj_001?tab=files';

describe('the Files tab', () => {
  it('groups the files by stage and shows the latest version', async () => {
    await renderApp(FILES);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    expect(within(group).getByText('Ground floor plan.pdf')).toBeInTheDocument();
    expect(within(group).getByText('Version B')).toBeInTheDocument();
  });

  it('puts Versions on its own line under the name on a phone, so the name keeps most of the row (audit 2026-10-03, V-33)', async () => {
    await renderApp(FILES);
    const group = await screen.findByRole('region', { name: 'Construction Documents' });
    const versions = within(group).getByRole('button', { name: 'Versions' });
    const row = versions.parentElement as HTMLElement;
    // A phone lays the row out as a grid: picture, name and menu on the first line, Versions under the name. sm and up is one flex line.
    expect(row).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)_auto]', 'sm:flex');
    expect(versions).toHaveClass('col-start-2', 'row-start-2');
    expect(within(row).getByRole('button', { name: 'Actions for Ground floor plan.pdf' })).toBeInTheDocument();
  });

  it('uploads a file, and a second upload with the same name becomes version B', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const input = await screen.findByLabelText('Upload files');
    await userEvent.upload(input, new File(['notes'], 'Site notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Files uploaded: 1.')).toBeInTheDocument();
    await userEvent.upload(input, new File(['notes 2'], 'Site notes.txt', { type: 'text/plain' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Site notes.txt')?.versions.map((v) => v.letter)).toEqual(['A', 'B']));
  });

  it('refuses a file over 250 MB before any upload', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const big = new File(['x'], 'Huge model.rvt', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 251 * 1024 * 1024 });
    await userEvent.upload(await screen.findByLabelText('Upload files'), big);
    expect(await screen.findByText('Huge model.rvt is larger than 250 MB.')).toBeInTheDocument();
    expect(Object.values(store.state.files).some((f) => f.name === 'Huge model.rvt')).toBe(false);
  });

  it('deletes a file, then brings it back with Undo', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeUndefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.files.fil_004).toBeDefined());
  });

  it('logs a File entry from the client when the upload says so, and only then', async () => {
    const { store } = await renderApp(FILES, as('usr_005'));
    const input = await screen.findByLabelText('Upload files');
    await userEvent.upload(input, new File(['a'], 'Plain.txt', { type: 'text/plain' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Plain.txt')).toBeDefined());
    expect(Object.values(store.state.tracker ?? {}).find((e) => e.title === 'Plain.txt')).toBeUndefined();
    const box = screen.getByRole('checkbox', { name: 'Received from the client' });
    await userEvent.click(box);
    await userEvent.upload(input, new File(['b'], 'Land survey.txt', { type: 'text/plain' }));
    const file = await waitFor(() => {
      const found = Object.values(store.state.files).find((f) => f.name === 'Land survey.txt');
      expect(found).toBeDefined();
      return found!;
    });
    expect(Object.values(store.state.tracker ?? {}).find((e) => e.title === 'Land survey.txt')).toMatchObject({
      type: 'file', direction: 'in', fileIds: [file.id], auto: 'upload', createdBy: 'usr_005', date: '2026-09-30', projectId: 'prj_001',
    });
    // The option does not stay on for the next upload.
    await waitFor(() => expect(box).not.toBeChecked());
  });

  it('marks a file as delivered to the client from its menu, with Undo', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark as delivered to client' }));
    expect(await screen.findByText('Marked as delivered to the client.')).toBeInTheDocument();
    const entries = () => Object.values(store.state.tracker ?? {}).filter((e) => e.auto === 'delivered' && e.fileIds.includes('fil_004'));
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ type: 'file', direction: 'out', title: 'Site plan.pdf', createdBy: 'usr_002' });
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(entries()).toHaveLength(0));
  });

  it('sets an image as the project cover', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Massing view.svg' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Set as cover' }));
    await waitFor(() => expect(store.state.projects.prj_001.coverFileId).toBe('fil_002'));
  });

  it('retries only the files that did not upload', async () => {
    const { store, api } = await renderApp(FILES, as('usr_005'));
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'files.upload' && (input as { name: string }).name === 'Two.txt' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.upload(await screen.findByLabelText('Upload files'), [new File(['1'], 'One.txt', { type: 'text/plain' }), new File(['2'], 'Two.txt', { type: 'text/plain' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Two.txt')).toBeDefined());
    expect(Object.values(store.state.files).find((f) => f.name === 'One.txt')?.versions).toHaveLength(1);
  });

  it('shares a file into the project chat from the file menu', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share in chat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share Site plan.pdf' });
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Message (optional)' }), 'Please check this.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Shared in the Corniche Office Tower chat.')).toBeInTheDocument();
    const room = Object.values(store.state.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001');
    const message = Object.values(store.state.messages).find((m) => m.conversationId === room?.id && m.body === 'Please check this.');
    expect(message?.fileIds).toEqual(['fil_004']);
  });

  it('shows the refusal when the person picked is not on the project', async () => {
    const { store } = await renderApp(FILES, as('usr_002'));
    const outsider = Object.values(store.state.users).find((u) => u.kind === 'human' && u.active && u.id !== 'usr_002'
      && !store.state.members[`prj_001:${u.id}`] && store.state.projects.prj_001.leaderId !== u.id && u.systemRole !== 'admin');
    expect(outsider).toBeDefined();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site plan.pdf' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Share in chat' }));
    const sheet = await screen.findByRole('dialog', { name: 'Share Site plan.pdf' });
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Person' }));
    await userEvent.selectOptions(within(sheet).getByRole('combobox', { name: 'Person' }), outsider?.id as string);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('This person is not on the project of this file. They cannot open it.')).toBeInTheDocument();
    expect(Object.values(store.state.messages).some((m) => m.fileIds?.includes('fil_004'))).toBe(false);
  });

  // The file input is hidden. The Add button opens it from the menu item Upload a file, so a keyboard user reaches the upload by the button.
  it('keeps the hidden file input out of the tab order, so the Add button is the one stop', async () => {
    await renderApp(FILES, as('usr_005'));
    expect(await screen.findByLabelText('Upload files')).toHaveAttribute('tabindex', '-1');
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

const MB = 1024 * 1024;

/**
 * The app over the sample office, as the real build sees it: session.get names the limit of the active store (50 MB on Supabase
 * Storage), and "wrap" can stand between the screen and the API (for example the upload adapter), as RemoteApi does.
 */
async function renderReal(o: { language?: 'en' | 'ar'; wrap?: (call: (n: string, i: unknown, m?: unknown) => Promise<unknown>) => (n: string, i: unknown, m?: unknown) => Promise<unknown> } = {}) {
  setNow(NOW);
  const state = await buildSeed(TODAY, async () => undefined);
  state.session.currentUserId = 'usr_005';
  state.users.usr_005.preferences.language = o.language ?? 'en';
  const store = new Store(state, memoryPersister());
  const api = createApi(calls, { store, latencyMs: 0 });
  const original = api.call.bind(api) as (n: string, i: unknown, m?: unknown) => Promise<unknown>;
  const withLimit = async (name: string, input: unknown, meta?: unknown) => {
    const output = await original(name, input, meta);
    return name === 'session.get' ? { ...(output as object), limits: { maxFileBytes: 50 * MB } } : output;
  };
  api.call = (o.wrap ? o.wrap(withLimit) : withLimit) as typeof api.call;
  initI18n('en');
  window.history.replaceState(null, '', `#${FILES}`);
  const router = createAppRouter();
  onTestFinished(() => router.dispose());
  render(
    <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
      <ToastProvider>
        <AppearanceSync />
        <RouterProvider router={router} />
      </ToastProvider>
    </RuntimeProvider>,
  );
  return { store, api };
}

/** A file over the 50 MB limit of the store and under the 250 MB ceiling of the contract. */
function bigFile(): File {
  const file = new File(['x'], 'Site model.rvt', { type: 'application/octet-stream' });
  Object.defineProperty(file, 'size', { value: 60 * MB });
  return file;
}

describe('the Files tab with the limit of the file store (plan 2b, point 1)', () => {
  it('refuses a file over the store limit before any upload, and names the limit in plain words', async () => {
    const seen: string[] = [];
    const { store } = await renderReal({ wrap: (call) => (name, input, meta) => { seen.push(name); return call(name, input, meta); } });
    await userEvent.upload(await screen.findByLabelText('Upload files'), bigFile());
    expect(await screen.findByText('Site model.rvt is larger than 50 MB.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(seen).not.toContain('files.upload');
    expect(Object.values(store.state.files).some((f) => f.name === 'Site model.rvt')).toBe(false);
  });

  it('says the same in Arabic, right to left, with no Retry for a file that can never fit', async () => {
    await renderReal({ language: 'ar' });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    await userEvent.upload(await screen.findByLabelText('ارفع ملفات'), bigFile());
    expect(await screen.findByText('حجم Site model.rvt أكبر من 50 ميغابايت.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حاول مرة أخرى' })).toBeNull();
  });

  it('shows one Retry when the upload to the store fails, and Retry saves the file', async () => {
    let failures = 1;
    const put: PutSender = async () => (failures-- > 0 ? { status: 0, body: '' } : { status: 200, body: '' });
    const blobs = new Map<string, unknown>();
    const { store } = await renderReal({
      wrap: (call) => {
        // The upload adapter of the real build, over the fake API: files.upload with the upload ID gets its file back here.
        const adapter = uploadAdapter({ makeThumb: async () => null, put });
        const ctx = (meta?: unknown) => ({
          meta: (meta ?? {}) as object,
          call: (name: string, input: unknown) => {
            if (name !== 'files.upload') return call(name, input);
            const { uploadId, ...rest } = input as { uploadId: string };
            return call('files.upload', { ...rest, blob: blobs.get(uploadId) }, meta);
          },
        });
        return async (name, input, meta) => {
          if (name !== 'files.upload') return call(name, input, meta);
          const screenInput = input as { blob: Blob };
          const started = ctx(meta);
          const inner = started.call;
          started.call = async (n: string, i: unknown) => {
            const out = await inner(n, i);
            if (n === 'files.uploadStart') blobs.set((out as { uploadId: string }).uploadId, screenInput.blob);
            return out;
          };
          return adapter(input, started);
        };
      },
    });
    await userEvent.upload(await screen.findByLabelText('Upload files'), new File(['notes'], 'Site notes.txt', { type: 'text/plain' }));
    expect(await screen.findByText('The file did not upload. Try again.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(Object.values(store.state.files).find((f) => f.name === 'Site notes.txt')).toBeDefined());
  });
});
