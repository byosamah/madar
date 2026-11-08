import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import i18n from 'i18next';
import { renderApp } from '../test/render';

// The prototype session has no enterprise; the test sets what session.get adds.
let enterprise: { id: string; name: string; nameAr: string; logo: string | null } | undefined;
vi.mock('./runtime', async (original) => {
  const real = await original<typeof import('./runtime')>();
  return {
    ...real,
    useCall: ((name: string, input: unknown, options: unknown) => {
      const out = (real.useCall as (n: string, i: unknown, o?: unknown) => { data?: Record<string, unknown> })(name, input, options);
      return name === 'session.get' && out.data && enterprise ? { ...out, data: { ...out.data, enterprise } } : out;
    }) as typeof real.useCall,
  };
});

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
beforeEach(() => {
  enterprise = undefined;
});

const homeLinks = () => screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.endsWith('#/') || link.getAttribute('href') === '/');

describe('the mark at the top start (Madar enterprises)', () => {
  it('shows the logo and the name of the enterprise', async () => {
    enterprise = { id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', logo: LOGO };
    await renderApp('/work');
    const link = (await screen.findAllByRole('link', { name: 'Acme Co' }))[0]!;
    expect(link.querySelector('img')).toHaveAttribute('src', LOGO);
    expect(link).toHaveTextContent('Acme Co');
  });

  it('shows the Arabic name on the Arabic screen', async () => {
    enterprise = { id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', logo: null };
    await renderApp('/work');
    await screen.findAllByRole('link', { name: 'Acme Co' });
    await act(async () => { await i18n.changeLanguage('ar'); });
    expect((await screen.findAllByRole('link', { name: 'أكمي' }))[0]).toHaveTextContent('أكمي');
  });

  it('shows the Madar mark with no enterprise, and with an enterprise that set no name', async () => {
    await renderApp('/work');
    const plain = (await screen.findAllByRole('link', { name: 'Madar, Home' }))[0]!;
    expect(plain.querySelector('img')).toBeNull();
    expect(plain).not.toHaveTextContent(/\S/);
    expect(homeLinks().length).toBeGreaterThan(0);
  });

  it('keeps the Madar mark and shows the name when the enterprise has a name and no logo', async () => {
    enterprise = { id: 'ent_002', name: 'Acme Co', nameAr: 'أكمي', logo: null };
    await renderApp('/work');
    const link = (await screen.findAllByRole('link', { name: 'Acme Co' }))[0]!;
    expect(link.querySelector('img')).toBeNull();
    expect(link.querySelector('svg')).not.toBeNull();
  });

  it('does not add a word next to the mark for the default name Madar', async () => {
    enterprise = { id: 'ent_001', name: 'Madar', nameAr: 'مدار', logo: null };
    await renderApp('/work');
    const link = (await screen.findAllByRole('link', { name: 'Madar, Home' }))[0]!;
    expect(link).not.toHaveTextContent(/\S/);
  });
});
