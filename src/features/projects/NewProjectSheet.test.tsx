import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { renderWithRuntime } from '../../test/render';
import { NewProjectSheet } from './NewProjectSheet';
import { ApiError } from '../../api/errors';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { calls, type MadarApi } from '../../api/calls';
import { createApi } from '../../api/client';
import { memoryPersister } from '../../api/persist';
import { Store } from '../../api/store';
import { RuntimeProvider, createQueryClient } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { buildSeed } from '../../data/seed';
import { initI18n } from '../../i18n';
import { setNow } from '../../lib/dates';
import { NOW, TODAY } from '../../test/factories';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Start</button>
      <NewProjectSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The code parts that every new project needs (owner, 2026-10-05). Locked initials of a client stay as they are. */
async function fillCode(sheet: HTMLElement, initials = 'HGO') {
  const field = within(sheet).getByLabelText('Client initials') as HTMLInputElement;
  if (!field.readOnly) await userEvent.type(field, initials);
  await userEvent.selectOptions(within(sheet).getByLabelText('Classification'), 'COM');
  await userEvent.type(within(sheet).getByLabelText('Building type'), 'Offices');
}

async function openSheet() {
  const view = await renderWithRuntime(<Harness />, undefined, { path: '/' });
  await userEvent.click(screen.getByText('Start'));
  return { ...view, sheet: await screen.findByRole('dialog', { name: 'New Project' }) };
}

describe('the New Project sheet', () => {
  it('checks each field when the person leaves it', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByLabelText('Name'));
    await userEvent.tab();
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-10-10' } });
    const end = within(sheet).getByLabelText('Target end date');
    fireEvent.change(end, { target: { value: '2026-10-01' } });
    fireEvent.blur(end);
    expect(await within(sheet).findByText('The end date must be after the start date.')).toBeInTheDocument();
  });

  it('shows every error on submit and creates nothing', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    await waitFor(() => expect(within(sheet).getByLabelText('Name')).toHaveFocus());
    expect(Object.keys(store.state.projects)).toHaveLength(12);
  });

  // Enter in a client field adds the client; it never sends the project form and loses the client (audit PER-7).
  it('adds the client with Enter in a client field, and does not create the project', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('English name (or Arabic)'), 'Harbour Holding');
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'hrb{Enter}');
    await waitFor(() => expect((within(sheet).getByLabelText('Client') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Harbour Holding'));
    expect(Object.keys(store.state.projects)).toHaveLength(12);
    expect(screen.getByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
  });

  // A sheet closed by accident (Escape, a tap outside, a swipe) keeps what the person typed. Cancel and Create start
  // a fresh form (audit PER-8).
  it('keeps the typed values after an accidental close, and starts empty after Cancel', async () => {
    const { sheet } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
    await userEvent.click(screen.getByText('Start'));
    const again = await screen.findByRole('dialog', { name: 'New Project' });
    expect(within(again).getByLabelText('Name')).toHaveValue('Harbour Gate Offices');
    await userEvent.click(within(again).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
    await userEvent.click(screen.getByText('Start'));
    expect(within(await screen.findByRole('dialog', { name: 'New Project' })).getByLabelText('Name')).toHaveValue('');
  });

  it('creates a project with a new client, another leader and a team', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('English name (or Arabic)'), 'Harbour Holding');
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'HRB');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect((within(sheet).getByLabelText('Client') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Harbour Holding'));
    await userEvent.selectOptions(within(sheet).getByLabelText('Leader'), 'Faisal Al-Harbi');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Sara Al-Qahtani/ }));
    await waitFor(() => expect(within(sheet).getByLabelText('Client initials')).toHaveValue('HRB'));
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('260900HRB created.')).toBeInTheDocument();
    const project = Object.values(store.state.projects).find((p) => p.name === 'Harbour Gate Offices');
    expect(project?.leaderId).toBe('usr_002');
    expect(store.state.clients[project!.clientId!].name).toBe('Harbour Holding');
    expect(store.state.members[`${project!.id}:usr_005`]).toBeDefined();
  });

  it('adds a client with an Arabic name and the contact the same as the client (colleague comments 10 and 11)', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await userEvent.type(within(sheet).getByLabelText('English name (or Arabic)'), 'Villa Owner');
    await userEvent.type(within(sheet).getByLabelText('Arabic name (or English)'), 'مالك الفيلا');
    await userEvent.type(within(sheet).getByLabelText('Initials'), 'VLO');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Same as client' }));
    expect(within(sheet).getByLabelText('Contact name')).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add client' }));
    await waitFor(() => expect(Object.values(store.state.clients).some((c) => c.name === 'Villa Owner')).toBe(true));
    const client = Object.values(store.state.clients).find((c) => c.name === 'Villa Owner')!;
    expect(client.nameAr).toBe('مالك الفيلا');
    expect(client.contactName).toBe('Villa Owner');
  });

  it('keeps what the person typed when the office settings change while the sheet is open', async () => {
    const { sheet, api } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await api.call('settings.update', { workloadLimit: 12 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(sheet).getByLabelText('Name')).toHaveValue('Harbour Gate Offices');
  });

  it('creates the project once when the cover upload fails, and retries the upload alone', async () => {
    const { sheet, store, api } = await openSheet();
    const original = api.call.bind(api);
    let failed = false;
    api.call = ((name: string, input: unknown, meta?: { correlationId?: string }) => {
      if (name === 'files.upload' && !failed) {
        failed = true;
        return Promise.reject(new ApiError('failed', 'The call failed. Try again.'));
      }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call;
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Harbour Gate Offices');
    await fillCode(sheet);
    await userEvent.upload(within(sheet).getByLabelText('Cover image'), new File(['x'], 'cover.png', { type: 'image/png' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New Project' })).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    const made = Object.values(store.state.projects).filter((p) => p.name === 'Harbour Gate Offices');
    expect(made).toHaveLength(1);
    await waitFor(() => expect(store.state.projects[made[0].id].coverFileId).not.toBeNull());
  });
});

describe('the New Project sheet: contract start date', () => {
  it('has the field, and saves the date on the project', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Contract Test Villa');
    await fillCode(sheet);
    fireEvent.change(within(sheet).getByLabelText('Contract start date'), { target: { value: '2026-10-05' } });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).find((p) => p.name === 'Contract Test Villa')?.contractStartDate).toBe('2026-10-05'));
  });

  it('leaves the date empty when none is chosen', async () => {
    const { sheet, store } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'No Contract Villa');
    await fillCode(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).some((p) => p.name === 'No Contract Villa')).toBe(true));
    expect(Object.values(store.state.projects).find((p) => p.name === 'No Contract Villa')?.contractStartDate).toBeNull();
  });

  // The real build: session.get names the limit of the active store, and a cover over it never goes to files.upload.
  it.each([
    ['en', 'Cover.png is larger than 50 MB.'],
    ['ar', 'حجم Cover.png أكبر من 50 ميغابايت.'],
  ] as const)('refuses a cover over the store limit before the upload and names the limit (%s)', async (lang, message) => {
    setNow(NOW);
    const store = new Store(await buildSeed(TODAY, async () => undefined), memoryPersister());
    const fake = createApi(calls, { store, latencyMs: 0 });
    const uploads: unknown[] = [];
    const api = {
      ...fake,
      call: async (name: string, input: unknown, meta?: unknown) => {
        if (name === 'files.upload') uploads.push(input);
        const output = await (fake.call as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
        return name === 'session.get' ? { ...(output as object), limits: { maxFileBytes: 50 * 1024 * 1024 } } : output;
      },
    } as MadarApi;
    initI18n(lang);
    render(
      <RuntimeProvider runtime={{ store, api }} queryClient={createQueryClient()}>
        <ToastProvider><RouterProvider router={createMemoryRouter([{ path: '*', element: <NewProjectSheet open onOpenChange={() => undefined} /> }])} /></ToastProvider>
      </RuntimeProvider>,
    );
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getAllByRole('textbox').length).toBeGreaterThan(0));
    await userEvent.type(within(sheet).getAllByRole('textbox')[0], 'Harbour Gate Offices');
    fireEvent.change(sheet.querySelector('#code-initials') as HTMLInputElement, { target: { value: 'HGO' } });
    fireEvent.change(sheet.querySelector('#code-class') as HTMLSelectElement, { target: { value: 'COM' } });
    fireEvent.change(sheet.querySelector('#code-type') as HTMLInputElement, { target: { value: 'Offices' } });
    const cover = new File(['png'], 'Cover.png', { type: 'image/png' });
    Object.defineProperty(cover, 'size', { value: 60 * 1024 * 1024 });
    // Wait for session.get, so the limit of the store is known.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fireEvent.change(sheet.querySelector('#project-cover') as HTMLInputElement, { target: { files: [cover] } });
    fireEvent.submit(sheet.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(uploads).toEqual([]);
    initI18n('en');
  });
});
