import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

// The prototype session has no platformOwner; the test sets what session.get adds, and every other call runs as before.
let flag: boolean | undefined;
vi.mock('../../app/runtime', async (original) => {
  const real = await original<typeof import('../../app/runtime')>();
  return {
    ...real,
    useCall: ((name: string, input: unknown, options: unknown) => {
      const out = (real.useCall as (n: string, i: unknown, o?: unknown) => { data?: Record<string, unknown> })(name, input, options);
      return name === 'session.get' && out.data && flag !== undefined ? { ...out, data: { ...out.data, platformOwner: flag } } : out;
    }) as typeof real.useCall,
  };
});

beforeEach(() => {
  flag = undefined;
});

async function office() {
  phoneMedia(true);
  await renderApp('/me');
  await screen.findByRole('link', { name: /Hala Nasser/ });
  return screen.getByRole('group', { name: 'Office' });
}

describe('the Me tab line of Madar enterprises (phone)', () => {
  it('shows the line "Madar enterprises" to /enterprises for a platform owner, right under the Admin line', async () => {
    flag = true;
    const group = await office();
    const link = within(group).getByRole('link', { name: 'Madar enterprises' });
    expect(link).toHaveAttribute('href', '#/enterprises');
    const rows = [...group.querySelectorAll('li a')].map((a) => a.textContent ?? '');
    const admin = rows.findIndex((text) => text.startsWith('Admin'));
    expect(rows.findIndex((text) => text.startsWith('Madar enterprises'))).toBe(admin + 1);
  });

  it('does not show the line to an Admin who is no platform owner', async () => {
    flag = false;
    const group = await office();
    expect(within(group).queryByRole('link', { name: /Madar enterprises/ })).toBeNull();
    expect(within(group).getByRole('link', { name: /^Admin/ })).toBeInTheDocument();
  });

  it('does not show the line in the prototype session, which has no flag', async () => {
    const group = await office();
    expect(within(group).queryByRole('link', { name: /Madar enterprises/ })).toBeNull();
  });

  it('draws another icon than the Admin line (a building, not the shield)', async () => {
    flag = true;
    const group = await office();
    const icon = (name: RegExp) => within(group).getByRole('link', { name }).querySelector('svg')!.innerHTML;
    expect(icon(/^Madar enterprises/)).not.toBe(icon(/^Admin/));
  });
});
