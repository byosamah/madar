import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { phoneMedia } from '../../test/phoneMedia';
import { renderApp } from '../../test/render';

// Madar enterprises is a separate platform (design 12, D9): the Me tab of a company holds no door to it. The test gives session.get an old
// platformOwner value (a server that still sends it) and checks that the tab ignores it.
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

describe('the Me tab holds no door to the platform (design 12, D9, phone)', () => {
  it('shows no Madar enterprises line, also when session.get still carries a platformOwner value', async () => {
    flag = true;
    const group = await office();
    expect(within(group).queryByRole('link', { name: /enterprises/i })).toBeNull();
    expect([...group.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '').endsWith('/enterprises'))).toBe(false);
    expect(within(group).getByRole('link', { name: /^Admin/ })).toBeInTheDocument();
  });

  it('shows no line for an Admin with no value', async () => {
    flag = false;
    const group = await office();
    expect(within(group).queryByRole('link', { name: /enterprises/i })).toBeNull();
  });

  it('shows no line in the prototype session, which has no value', async () => {
    const group = await office();
    expect(within(group).queryByRole('link', { name: /enterprises/i })).toBeNull();
  });
});
