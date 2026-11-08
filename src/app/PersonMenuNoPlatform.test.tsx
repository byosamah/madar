import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

// Madar enterprises is a separate platform (design 12, D9): the menu of a company holds no door to it. The test gives session.get an old platformOwner value
// (a server that still sends it) and checks that the menu ignores it.
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

describe('the person menu holds no door to the platform (design 12, D9)', () => {
  it('shows no link to Madar enterprises, also when session.get still carries a platformOwner value', async () => {
    flag = true;
    const menu = await openMenu();
    expect(within(menu).queryByRole('link', { name: /enterprises/i })).toBeNull();
    expect([...menu.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '').endsWith('/enterprises'))).toBe(false);
    expect(within(menu).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
  });

  it('shows no link to Madar enterprises for an Admin with no value', async () => {
    flag = false;
    const menu = await openMenu();
    expect(within(menu).queryByRole('link', { name: /enterprises/i })).toBeNull();
  });

  it('shows no link in the prototype session, which has no value', async () => {
    const menu = await openMenu();
    expect(within(menu).queryByRole('link', { name: /enterprises/i })).toBeNull();
  });
});
