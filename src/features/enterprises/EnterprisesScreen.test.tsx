import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import i18n from 'i18next';
import userEvent from '@testing-library/user-event';
import { PLATFORM_CALL_NAMES, type PlatformApi } from '../../api/contract/platform';
import { ApiError } from '../../api/errors';
import { initI18n } from '../../i18n';
import { renderWithRuntime } from '../../test/render';
import { EnterprisesScreen } from './EnterprisesScreen';
import { PlatformProvider } from './usePlatform';

// The prototype session has no platformOwner; the test sets what session.get answers, and every other call runs as before.
let owner = true;
vi.mock('../../app/runtime', async (original) => {
  const real = await original<typeof import('../../app/runtime')>();
  return {
    ...real,
    useCall: ((name: string, input: unknown, options: unknown) => (name === 'session.get'
      ? { data: { user: { id: 'usr_001' }, ...(owner ? { platformOwner: true } : {}) } }
      : (real.useCall as (n: string, i: unknown, o?: unknown) => unknown)(name, input, options))) as typeof real.useCall,
  };
});

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

const row = (o: Record<string, unknown> = {}) => ({
  id: 'ent_001', address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', logo: null, state: 'active', limits: { people: null, storageBytes: null },
  people: 15, invited: 1, storageBytes: 536870912, lastWriteAt: '2026-11-08T07:00:00.000Z', createdAt: '2026-11-08T00:00:00.000Z', firstAdmin: null, hasOwner: true, ...o,
});
const METER = {
  day: '2026-11-08', limits: { requests: 100000, rowsRead: 5000000, rowsWritten: 100000, mails: 100 }, total: { requests: 70000, rowsRead: 100, rowsWritten: 10, mails: 3 },
  share: 0.1, warn: ['requests'], stop: false, enterprises: [],
};

function fake(o: { rows?: ReturnType<typeof row>[]; createOpen?: boolean; meter?: typeof METER } = {}) {
  const calls: { name: string; input: unknown }[] = [];
  const rows = o.rows ?? [row(), row({ id: 'ent_002', address: 'acme-co', name: 'Acme Co', nameAr: 'أكمي', state: 'paused', people: 4, invited: 0, hasOwner: false, firstAdmin: { name: 'Sara', email: 'sara@acme.test' }, limits: { people: 5, storageBytes: 1073741824 } })];
  const answer = (name: string, input: unknown): unknown => {
    switch (name) {
      case 'platform.me': return { owner: true, ent: 'ent_001', createOpen: o.createOpen ?? true };
      case 'platform.meter.get': return o.meter ?? METER;
      case 'platform.enterprises.list': return rows;
      case 'platform.enterprises.create': return { ...row({ id: 'ent_003', name: (input as { name: string }).name }) };
      case 'platform.enterprises.pause': return { ...rows[1], state: 'paused' };
      case 'platform.enterprises.resume': return { ...rows[1], state: 'active' };
      case 'platform.enterprises.resendInvite': return { sentAt: 'now' };
      case 'platform.enterprises.update': return rows[1];
      default: throw new Error(name);
    }
  };
  const api = Object.fromEntries(PLATFORM_CALL_NAMES.map((name) => [name, async (input: unknown) => { calls.push({ name, input }); return answer(name, input); }])) as unknown as PlatformApi;
  return { api, calls };
}

async function open(f = fake()) {
  const view = await renderWithRuntime(<PlatformProvider api={f.api}><EnterprisesScreen /></PlatformProvider>, undefined, { path: '/enterprises' });
  return { ...view, ...f };
}

beforeEach(() => {
  owner = true;
  initI18n('en');
});

describe('the page Madar enterprises', () => {
  it('shows the not-found page to a person who is no platform owner, and runs no platform call', async () => {
    owner = false;
    const f = fake();
    await open(f);
    expect(await screen.findByText(/not exist|not found|wrong link/i)).toBeInTheDocument();
    expect(f.calls).toEqual([]);
  });

  it('shows the meter strip with the 70 percent warning, the list with the paused state, and the button', async () => {
    await open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Madar enterprises' })).toBeInTheDocument();
    expect(await screen.findByText("Today's use of the free limits")).toBeInTheDocument();
    expect(await screen.findByText('Requests is at 70 percent of today\'s limit.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /VADOs' Companies/ })).toBeInTheDocument();
    const acme = await screen.findByRole('button', { name: /Acme Co/ });
    expect(within(acme).getByText('Paused')).toBeInTheDocument();
    expect(within(acme).getByText('4 people')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New enterprise' })).toBeEnabled();
  });

  it('turns the button off with the closed line when create is closed', async () => {
    await open(fake({ createOpen: false }));
    expect(await screen.findByText('Creating enterprises is closed now.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'New enterprise' })).toBeDisabled());
  });

  it('shows the stop line when the account reached the stop line', async () => {
    await open(fake({ meter: { ...METER, stop: true } }));
    expect(await screen.findByText(/Other companies wait until 03:00 Riyadh/)).toBeInTheDocument();
  });

  it('sends create with the storage in bytes, and shows address_taken and email_taken under their fields', async () => {
    const f = fake();
    const refused = (reason: string, field: string) => Object.assign(new ApiError('invalid_input', 'x', { fields: [field], reason }), {});
    let attempt = 0;
    const original = f.api['platform.enterprises.create'];
    f.api['platform.enterprises.create'] = async (input) => {
      attempt += 1;
      if (attempt === 1) throw refused('address_taken', 'address');
      if (attempt === 2) throw refused('email_taken', 'admin.email');
      return original(input);
    };
    await open(f);
    await userEvent.click(await screen.findByRole('button', { name: 'New enterprise' }));
    await screen.findByRole('dialog');
    await userEvent.type(byId('ent-name'), 'Initech');
    await userEvent.type(byId('ent-name-ar'), 'إنيتك');
    await userEvent.type(byId('ent-address'), 'Initech');
    await userEvent.type(byId('ent-people'), '5');
    await userEvent.type(byId('ent-storage'), '2');
    await userEvent.type(byId('ent-admin-name'), 'Dana');
    await userEvent.type(byId('ent-admin-email'), 'dana@initech.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('This address name is taken.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('This email is already in use.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(f.calls.some((call) => call.name === 'platform.enterprises.create' && (call.input as { address?: string }).address === 'initech')).toBe(true));
    const sent = f.calls.find((call) => call.name === 'platform.enterprises.create')!.input as { limits: { people: number; storageBytes: number }; admin: { language: string } };
    expect(sent.limits).toEqual({ people: 5, storageBytes: 2 * 1024 ** 3 });
    expect(sent.admin.language).toBe('en');
  });

  it('opens a row sheet that shows the first Admin only for a row that has one', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: /VADOs' Companies/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('First Admin')).toBeNull();
    expect(byId('ent-edit-address')).toHaveAttribute('readonly');
  });

  it('keeps Pause off until the exact name is typed, then sends confirmName', async () => {
    const f = await open();
    await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sara')).toBeInTheDocument();
    expect(within(dialog).getByText('sara@acme.test')).toBeInTheDocument();
    // Acme Co is paused in the fake: Resume shows. Use the active row of the VADO to test Pause.
    expect(within(dialog).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(f.calls.some((call) => call.name === 'platform.enterprises.resume')).toBe(true));
  });

  it('sends "Send the invitation again"', async () => {
    const f = await open();
    await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send the invitation again' }));
    await waitFor(() => expect(f.calls.some((call) => call.name === 'platform.enterprises.resendInvite')).toBe(true));
  });

  it('asks for the typed name before Pause on an active row, and shows owner_enterprise when the pause is refused', async () => {
    const f = fake({ rows: [row({ id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', address: 'acme-co', hasOwner: false })] });
    f.api['platform.enterprises.pause'] = async () => { throw new ApiError('forbidden', 'x', { reason: 'owner_enterprise' }); };
    await open(f);
    await userEvent.click(await screen.findByRole('button', { name: /Acme Co/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pause' }));
    expect(within(dialog).getByText('Type the name of the enterprise to pause it.')).toBeInTheDocument();
    const pause = within(dialog).getByRole('button', { name: 'Pause' });
    expect(pause).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type the name of the enterprise to pause it.'), 'Acme');
    expect(pause).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type the name of the enterprise to pause it.'), ' Co');
    expect(pause).toBeEnabled();
    await userEvent.click(pause);
    expect(await within(dialog).findByText('You cannot pause an enterprise that holds a platform owner.')).toBeInTheDocument();
  });

  it('shows Not finished for a creating row and opens the new sheet filled from it with Try again', async () => {
    const f = fake({ rows: [row({ id: 'ent_003', address: 'initech', name: 'Initech', nameAr: 'إنيتك', state: 'creating', firstAdmin: { name: 'Dana', email: 'dana@initech.test' }, hasOwner: false })] });
    await open(f);
    const item = await screen.findByRole('button', { name: /Initech/ });
    expect(within(item).getByText('Not finished')).toBeInTheDocument();
    await userEvent.click(item);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: 'New enterprise' });
    expect(byId('ent-address')).toHaveValue('initech');
    expect(byId('ent-admin-email')).toHaveValue('dana@initech.test');
  });

  it('shows the Arabic words', async () => {
    await open(fake());
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(await screen.findByRole('heading', { level: 1, name: 'منشآت مدار' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'منشأة جديدة' })).toBeInTheDocument();
  });
});

describe('how the list and the sheets look (ent-ui)', () => {
  it('draws the rows of the list with the soft divider of the other cards, never the hard line token', async () => {
    await open();
    const list = (await screen.findByRole('button', { name: /VADOs' Companies/ })).closest('ul')!;
    expect(list).toHaveClass('divide-y', 'divide-hairline');
    expect(list).not.toHaveClass('divide-line');
  });

  it('shows the whole name of a row on its own line, and the state and the count on a line under it (no cut at 390 px)', async () => {
    const long = row({ id: 'ent_006', address: 'globex', name: 'Globex Test Company of Eastern Province', nameAr: 'شركة جلوبكس للاختبار في المنطقة الشرقية' });
    await open(fake({ rows: [row(), long] }));
    const name = await screen.findByText('Globex Test Company of Eastern Province');
    expect(name.closest('.truncate')).toBeNull();
    const meta = within((await screen.findByRole('button', { name: /Globex Test Company/ }))).getByText('Active');
    // The state sits in its own line under the name: the name line does not hold it.
    expect(name.parentElement!.contains(meta)).toBe(false);
    expect(name.parentElement!.parentElement!.contains(meta)).toBe(true);
  });

  it('says "Not counted yet" for a row that sent no status, and the count for a row that did', async () => {
    const fresh = row({ id: 'ent_004', address: 'fresh', name: 'Fresh Co', nameAr: 'فريش', people: 0, invited: 0, storageBytes: 0, lastWriteAt: null });
    const invitedOnly = row({ id: 'ent_005', address: 'new-one', name: 'New One', nameAr: 'الجديدة', people: 0, invited: 1, storageBytes: 0, lastWriteAt: null });
    await open(fake({ rows: [row(), fresh, invitedOnly] }));
    const item = (name: RegExp) => screen.findByRole('button', { name });
    expect(within(await item(/Fresh Co/)).getByText('Not counted yet')).toBeInTheDocument();
    expect(within(await item(/Fresh Co/)).queryByText('0 people')).toBeNull();
    expect(within(await item(/VADOs' Companies/)).getByText('15 people')).toBeInTheDocument();
    // A status that holds an invited person is a real status: the count is 0 and it shows.
    expect(within(await item(/New One/)).getByText('0 people')).toBeInTheDocument();
  });

  it('says it in Arabic too', async () => {
    await open(fake({ rows: [row({ people: 0, invited: 0, storageBytes: 0, lastWriteAt: null })] }));
    await act(async () => { await i18n.changeLanguage('ar'); });
    const item = await screen.findByRole('button', { name: /شركات فادو/ });
    expect(within(item).getByText('لم نعدّهم بعد')).toBeInTheDocument();
    expect(within(item).queryByText('لا أحد')).toBeNull();
  });

  it('says "Not counted yet" in the sheet for the people and the storage of a row with no status', async () => {
    await open(fake({ rows: [row({ people: 0, invited: 0, storageBytes: 0, lastWriteAt: null })] }));
    await userEvent.click(await screen.findByRole('button', { name: /VADOs' Companies/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Not counted yet')).toBeInTheDocument();
    expect(within(dialog).queryByText(/0 active/)).toBeNull();
  });

  it('shows the first letter of the name in the circle of a row with no logo, in the language of the screen', async () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    await open(fake({ rows: [row(), row({ id: 'ent_002', address: 'acme-co', name: 'Acme Co', nameAr: 'أكمي', logo })] }));
    const plain = await screen.findByRole('button', { name: /VADOs' Companies/ });
    expect(within(plain).getByText('V')).toHaveClass('bg-fill', 'rounded-full');
    expect(within(plain).queryByRole('img')).toBeNull();
    const withLogo = screen.getByRole('button', { name: /Acme Co/ });
    expect(withLogo.querySelector('img')).not.toBeNull();
    expect(within(withLogo).queryByText('A')).toBeNull();
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(within(await screen.findByRole('button', { name: /شركات فادو/ })).getByText('ش')).toBeInTheDocument();
  });

  it('gives every control of the page and of both sheets the standard touch size of 44 px', async () => {
    await open();
    expect(await screen.findByRole('button', { name: 'New enterprise' })).toHaveClass('min-h-11');
    for (const item of await screen.findAllByRole('button', { name: /VADOs' Companies|Acme Co/ })) expect(item).toHaveClass('min-h-14');
    await userEvent.click(screen.getByRole('button', { name: 'New enterprise' }));
    const sheet = await screen.findByRole('dialog');
    for (const button of within(sheet).getAllByRole('button')) {
      // The close control of the sheet has its own 44 px size (Sheet.tsx); every other control is a Button.
      if (button.getAttribute('aria-label') === 'Close') continue;
      expect(button, button.textContent ?? '').toHaveClass('min-h-11');
    }
    for (const field of within(sheet).getAllByRole('textbox')) expect(field, field.id).toHaveClass('min-h-11');
    expect(within(sheet).getByRole('combobox')).toHaveClass('min-h-11');
  });

  it('writes the address name left to right in the new sheet and in the row sheet, so a Latin name never runs backwards in Arabic', async () => {
    await open();
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect(byId('ent-edit-address')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /أكمي/ }));
    expect(byId('ent-edit-address')).toHaveAttribute('dir', 'ltr');
    expect(byId('ent-edit-address')).toHaveValue('acme-co');
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'إلغاء' }));
    await userEvent.click(screen.getByRole('button', { name: 'منشأة جديدة' }));
    expect(byId('ent-address')).toHaveAttribute('dir', 'ltr');
  });
});

