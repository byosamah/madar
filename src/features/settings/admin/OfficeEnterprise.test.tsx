import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../../test/render';

// The prototype settings.get gives no usage; the test adds what the real build gives to an Admin.
let usage: Record<string, unknown> | undefined;
vi.mock('../../../app/runtime', async (original) => {
  const real = await original<typeof import('../../../app/runtime')>();
  return {
    ...real,
    useCall: ((name: string, input: unknown, options: unknown) => {
      const out = (real.useCall as (n: string, i: unknown, o?: unknown) => { data?: Record<string, unknown> })(name, input, options);
      return name === 'settings.get' && out.data && usage ? { ...out, data: { ...out.data, usage } } : out;
    }) as typeof real.useCall,
  };
});

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('the Office settings rows of the company (Madar enterprises)', () => {
  it('saves the company name and the Arabic name through settings.update', async () => {
    usage = undefined;
    const { api } = await renderApp('/admin/office');
    const call = vi.spyOn(api, 'call');
    await screen.findByLabelText('Company name');
    await userEvent.type(byId('office-company-name'), 'Acme Co');
    await userEvent.type(byId('office-company-name-ar'), 'أكمي');
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('settings.update', expect.objectContaining({ enterpriseName: 'Acme Co', enterpriseNameAr: 'أكمي' }), expect.anything()));
    const sent = call.mock.calls.find((one) => one[0] === 'settings.update')![1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('enterpriseLogo');
  });

  it('shows the usage lines read only: people and storage against the limits', async () => {
    usage = { people: { used: 3, limit: 5 }, storage: { used: 536870912, limit: 1073741824 } };
    await renderApp('/admin/office');
    expect(await screen.findByText('People: 3 of 5')).toBeInTheDocument();
    expect(screen.getByText('Storage: 0.5 of 1.0 GB')).toBeInTheDocument();
    expect(screen.getByText('Only the Madar team changes these limits.')).toBeInTheDocument();
    const lines = document.querySelector('[data-usage]')!;
    expect(lines.querySelector('input, button, select')).toBeNull();
  });

  it('says No limit for a null limit', async () => {
    usage = { people: { used: 3, limit: null }, storage: { used: 0, limit: null } };
    await renderApp('/admin/office');
    expect(await screen.findByText(/^People: 3/)).toBeInTheDocument();
    expect(screen.getAllByText(/No limit/)).toHaveLength(2);
  });

  it('shows no usage line when the server gave none', async () => {
    usage = undefined;
    await renderApp('/admin/office');
    await screen.findByLabelText('Company name');
    expect(document.querySelector('[data-usage]')).toBeNull();
  });
});
