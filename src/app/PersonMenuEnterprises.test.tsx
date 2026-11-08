import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

// The prototype session has no platformOwner; the test sets what session.get adds, and every other call runs as before.
let flag: boolean | undefined;
vi.mock('./runtime', async (original) => {
  const real = await original<typeof import('./runtime')>();
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

async function openMenu() {
  await renderApp('/dashboard');
  await userEvent.click((await screen.findAllByRole('button', { name: 'Hala Nasser' }))[0]!);
  return screen.getByRole('dialog');
}

describe('the person menu line of Madar enterprises', () => {
  it('shows the link "Madar enterprises" to /enterprises for a platform owner, under the Admin line', async () => {
    flag = true;
    const menu = await openMenu();
    const link = within(menu).getByRole('link', { name: 'Madar enterprises' });
    // The prototype router keeps its address in the hash.
    expect(link.getAttribute('href')).toMatch(/\/enterprises$/);
    const places = [...menu.querySelectorAll('[data-menu-group="places"] a')].map((a) => a.textContent);
    expect(places.indexOf('Madar enterprises')).toBe(places.indexOf('Admin') + 1);
  });

  it('draws a building icon for it, not the shield of the Admin line', async () => {
    flag = true;
    const menu = await openMenu();
    const icon = (name: string) => within(menu).getByRole('link', { name }).querySelector('svg')!.innerHTML;
    expect(icon('Madar enterprises')).not.toBe(icon('Admin'));
  });

  it('does not show it to an Admin who is no owner', async () => {
    flag = false;
    const menu = await openMenu();
    expect(within(menu).queryByRole('link', { name: 'Madar enterprises' })).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });

  it('does not show it in the prototype session, which has no flag', async () => {
    const menu = await openMenu();
    expect(within(menu).queryByRole('link', { name: 'Madar enterprises' })).toBeNull();
  });
});
