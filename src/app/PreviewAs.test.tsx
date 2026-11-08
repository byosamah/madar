import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { calls } from '../api/calls';
import { createApi } from '../api/client';
import { defaultDirectory, memoryDirectory } from '../api/fakeDirectory';
import { memoryPersister } from '../api/persist';
import { Store } from '../api/store';
import { buildSecondEnterprise } from '../data/sampleSecondEnterprise';
import { buildSeed } from '../data/seed';
import { initI18n } from '../i18n';
import { setNow } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';
import { PreviewAs } from './PreviewAs';
import { createQueryClient, RuntimeProvider } from './runtime';
import { ToastProvider } from './toasts';

async function show(options: { ent?: string; language?: 'en' | 'ar'; withDirectory?: boolean } = {}) {
  const { ent = 'ent_001', language = 'en', withDirectory = true } = options;
  setNow(NOW);
  const directory = memoryDirectory(defaultDirectory(TODAY));
  const state = ent === 'ent_001' ? await buildSeed(TODAY, async () => undefined) : buildSecondEnterprise(TODAY);
  const store = new Store(state, memoryPersister(ent));
  const api = createApi(calls, {
    store, latencyMs: 0,
    enterprise: () => ({ id: ent, platformOwner: false }),
  });
  initI18n(language);
  const view = render(
    <RuntimeProvider runtime={{ store, api, ...(withDirectory ? { directory } : {}) }} queryClient={createQueryClient()}>
      <ToastProvider><PreviewAs id="preview" /></ToastProvider>
    </RuntimeProvider>,
  );
  return { ...view, store, api };
}

describe('Preview as, with the fake enterprises (Madar enterprises, design 5.19)', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('lists the two fake enterprises before the people', async () => {
    await show();
    const enterprise = await screen.findByRole('combobox', { name: /Company/ });
    expect(Array.from((enterprise as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(["VADOs' Companies", 'Oasis Builders']);
    expect(enterprise).toHaveValue('ent_001');
    const order = screen.getAllByRole('combobox').map((one) => one.id);
    expect(order[0]).toBe('preview-enterprise');
  });

  it('shows the Arabic names on an Arabic screen', async () => {
    await show({ language: 'ar' });
    const enterprise = await screen.findByRole('combobox', { name: /الشركة/ });
    expect(Array.from((enterprise as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['شركات فادو', 'واحة للإنشاءات']);
  });

  it('stores the id and reloads when the enterprise changes', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as unknown as Location);
    await show();
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: /Company/ }), 'ent_002');
    expect(window.localStorage.getItem('madar.fakeEnterprise')).toBe('ent_002');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('has no Platform owner choice in any company (design 12, D12), and turns on no owner view', async () => {
    const first = await show();
    const people = (await screen.findAllByRole('combobox')).find((one) => one.id === 'preview')!;
    expect(Array.from((people as HTMLSelectElement).options).some((option) => /platform/i.test(option.textContent ?? ''))).toBe(false);
    expect((await first.api.call('session.get', {})).platformOwner).toBeUndefined();
    await userEvent.selectOptions(people, 'usr_002');
    expect((await first.api.call('session.get', {})).platformOwner).toBeUndefined();
    first.unmount();
    await show({ ent: 'ent_002' });
    const second = (await screen.findAllByRole('combobox')).find((one) => one.id === 'preview')!;
    expect(Array.from((second as HTMLSelectElement).options).some((option) => /platform/i.test(option.textContent ?? ''))).toBe(false);
    expect(window.localStorage.getItem('madar.fakePlatform')).toBeNull();
  });

  it('shows only the people select when the runtime has no directory', async () => {
    await show({ withDirectory: false });
    await screen.findByRole('combobox');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
  });
});
