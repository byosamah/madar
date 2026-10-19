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
import { Store, type State } from '../../api/store';
import { RuntimeProvider, createQueryClient } from '../../app/runtime';
import { ToastProvider } from '../../app/toasts';
import { buildSeed } from '../../data/seed';
import { initI18n } from '../../i18n';
import { formatDay, setNow, todayISO } from '../../lib/dates';
import { monthGrid } from '../../lib/calendar';
import { NOW, TODAY } from '../../test/factories';
import { textFieldsOf } from '../../test/browserMemory';

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
  it('checks each field when the person leaves it after a change', async () => {
    const { sheet } = await openSheet();
    await userEvent.type(within(sheet).getByLabelText('Name'), 'x');
    await userEvent.clear(within(sheet).getByLabelText('Name'));
    await userEvent.tab();
    expect(within(sheet).getByText('Enter a name.')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Start date'), { target: { value: '2026-10-10' } });
    const end = within(sheet).getByLabelText('Target end date');
    fireEvent.change(end, { target: { value: '2026-10-01' } });
    fireEvent.blur(end);
    expect(await within(sheet).findByText('The end date must be after the start date.')).toBeInTheDocument();
  });

  it('keeps a field quiet when the focus only passes through it, so the first press on New client opens the box (2026-10-05)', async () => {
    // A message that came on blur moved New client 23 px down during the press, and the press was lost on a desk screen.
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByLabelText('Name'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    expect(within(sheet).queryByText('Enter a name.')).toBeNull();
    expect(await within(sheet).findByRole('button', { name: 'Add client' })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByLabelText('Building type'));
    await userEvent.tab();
    expect(within(sheet).queryByText(/building type/i, { selector: '[id$="-error"], [role="alert"]' })).toBeNull();
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

  it('keeps one main button while the New client box is open: Create project (calm rule, 2026-10-05)', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await within(sheet).findByRole('button', { name: 'Add client' });
    const main = within(sheet).getAllByRole('button').filter((button) => button.classList.contains('signature'));
    expect(main.map((button) => button.textContent)).toEqual(['Create project']);
  });

  it('draws the New client box as an outlined group, so its grey fields stand out (2026-10-05)', async () => {
    // Grey fields on a grey box looked faint. The box has a thin outline and no fill, like the cards of the template editor.
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    const box = await within(sheet).findByRole('group', { name: 'New client' });
    expect(box.className.split(' ')).toEqual(expect.arrayContaining(['border', 'border-separator']));
    expect(box.className.split(' ')).not.toContain('bg-fill');
  });
});

describe('the New Project sheet: no browser memory (fbk_010)', () => {
  it('turns off the browser memory on every text field of the project form and of the New client part', async () => {
    const { sheet } = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'New client' }));
    await within(sheet).findByRole('button', { name: 'Add client' });
    await waitFor(() => expect(sheet.querySelector('input[aria-label="Stage 1"]')).not.toBeNull());
    const fields = textFieldsOf(sheet);
    expect(fields.map((field) => field.id || field.getAttribute('aria-label'))).toEqual(expect.arrayContaining([
      'project-location', 'project-area', 'Stage 1', 'project-folder', 'project-description', 'client-contact', 'client-phone', 'client-email',
    ]));
    for (const field of fields) {
      expect(field, field.id || field.getAttribute('aria-label') || 'a field').toHaveAttribute('autocomplete', 'off');
    }
    expect(sheet.querySelector('form')).toHaveAttribute('autocomplete', 'off');
  });
});

// fbk_009 on a computer: Madar's calendar opens from the start date inside the sheet. The calendar sits on the page body.
// A sheet that blocks the page turns the pointer off there. So the calendar needs its own pointer events (Popover).
describe("the New Project sheet: Madar's calendar on a computer (fbk_009)", () => {
  it('picks a start date from the calendar that opens inside the sheet', async () => {
    const real = window.matchMedia;
    window.matchMedia = (query: string) => {
      const base = real(query);
      return query === '(pointer: fine)' ? ({ ...base, matches: true } as MediaQueryList) : base;
    };
    try {
      const { sheet } = await openSheet();
      await userEvent.click(within(sheet).getByLabelText('Start date'));
      const calendar = await screen.findByRole('dialog', { name: 'Pick a date' });
      const firstDay = within(calendar)
        .getAllByRole('button')
        .find((button) => /^\d+$/.test(button.textContent ?? '') && !(button as HTMLButtonElement).disabled)!;
      const picked = monthGrid(todayISO().slice(0, 7)).find((day) => formatDay(day, 'en', 'long') === firstDay.getAttribute('aria-label'))!;
      await userEvent.click(firstDay);
      expect(within(sheet).getByLabelText('Start date')).toHaveValue(picked);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull());
      expect(screen.getByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
    } finally {
      window.matchMedia = real;
    }
  });

  // A sheet that blocks the page keeps the focus in the date field. Escape closes the calendar only, not the sheet.
  it('closes only the calendar with Escape, and keeps the New Project sheet open', async () => {
    const real = window.matchMedia;
    window.matchMedia = (query: string) => {
      const base = real(query);
      return query === '(pointer: fine)' ? ({ ...base, matches: true } as MediaQueryList) : base;
    };
    try {
      const { sheet } = await openSheet();
      await userEvent.click(within(sheet).getByLabelText('Start date'));
      await screen.findByRole('dialog', { name: 'Pick a date' });
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pick a date' })).toBeNull());
      expect(screen.getByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
    } finally {
      window.matchMedia = real;
    }
  });
});

describe('the sub-company of a new project (fbk_007, PRJ-17)', () => {
  const sub = (id: string, name: string) => ({ id, name, nameAr: `${name} ar`, logo: null, createdBy: 'usr_001', createdAt: '2026-10-18T09:00:00.000+03:00' });
  const two = (state: State) => {
    state.subCompanies = { sub_001: sub('sub_001', 'Vado'), sub_002: sub('sub_002', 'Bunah') };
    // The seed office names no sub-company, so the new project has no smart default.
    for (const project of Object.values(state.projects)) delete project.subCompanyId;
  };

  it('shows one row of choices, needs one, and sends the one that the person taps', async () => {
    const { store } = await renderWithRuntime(<Harness />, two, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Kiosk');
    await fillCode(sheet);
    const group = await within(sheet).findByRole('radiogroup', { name: 'Sub-company' });
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Bunah', 'Vado']);
    expect(within(group).getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText('Choose a sub-company for this project.')).toBeInTheDocument();
    expect(Object.values(store.state.projects).some((project) => project.name === 'Kiosk')).toBe(false);
    await userEvent.click(within(group).getByRole('radio', { name: 'Bunah' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).find((project) => project.name === 'Kiosk')?.subCompanyId).toBe('sub_002'));
  });

  it('picks the only sub-company of the office, so a new project needs no tap', async () => {
    const { store } = await renderWithRuntime(<Harness />, (state) => {
      state.subCompanies = { sub_001: sub('sub_001', 'Vado') };
    }, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Kiosk');
    await fillCode(sheet);
    expect(await within(sheet).findByRole('radio', { name: 'Vado' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(Object.values(store.state.projects).find((project) => project.name === 'Kiosk')?.subCompanyId).toBe('sub_001'));
  });

  it('picks the sub-company of the last project of the client, and never changes a choice the person made', async () => {
    await renderWithRuntime(<Harness />, (state) => {
      two(state);
      state.clients.cli_900 = { id: 'cli_900', name: 'Azmeel Holding', contactName: '', phone: '', email: '' };
      Object.assign(state.projects.prj_001, { clientId: 'cli_900', subCompanyId: 'sub_001', createdAt: '2026-01-01T09:00:00.000+03:00' });
      Object.assign(state.projects.prj_002, { clientId: 'cli_900', subCompanyId: 'sub_002', createdAt: '2026-06-01T09:00:00.000+03:00' });
    }, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await userEvent.selectOptions(await within(sheet).findByLabelText('Client'), 'Azmeel Holding');
    expect(await within(sheet).findByRole('radio', { name: 'Bunah' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Vado' }));
    await userEvent.selectOptions(within(sheet).getByLabelText('Client'), '');
    await userEvent.selectOptions(within(sheet).getByLabelText('Client'), 'Azmeel Holding');
    expect(within(sheet).getByRole('radio', { name: 'Vado' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps a select when the office has more than five sub-companies', async () => {
    await renderWithRuntime(<Harness />, (state) => {
      state.subCompanies = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id, n) => [`sub_00${n + 1}`, sub(`sub_00${n + 1}`, `Co ${id}`)]));
    }, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    expect(await within(sheet).findByRole('option', { name: 'Choose a sub-company' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('radiogroup', { name: 'Sub-company' })).toBeNull();
  });

  it('shows no sub-company choice when the office has none', async () => {
    await renderWithRuntime(<Harness />, undefined, { path: '/' });
    await userEvent.click(screen.getByText('Start'));
    const sheet = await screen.findByRole('dialog', { name: 'New Project' });
    await waitFor(() => expect(within(sheet).getByLabelText('Client')).toBeInTheDocument());
    expect(within(sheet).queryByLabelText('Sub-company')).toBeNull();
    expect(within(sheet).queryByRole('radiogroup', { name: 'Sub-company' })).toBeNull();
  });
});
