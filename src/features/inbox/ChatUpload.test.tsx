import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../../test/render';

afterEach(() => vi.restoreAllMocks());

const list = async () => within(await screen.findByRole('list', { name: 'Chats' }));
const rowLink = async (name: RegExp) => (await list()).getByRole('link', { name });
const PICKED = 'Files to send';

describe('upload progress in the chat box (design item 14)', () => {
  it('shows a thin grey bar on each chip while it uploads, keeps Send and Remove locked, and sends after the upload', async () => {
    const { api, store } = await renderApp('/inbox');
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation((async (name: string, input: unknown, meta?: { onProgress?: (sent: number, total: number) => void }) => {
      if (name === 'files.upload') { meta?.onProgress?.(30, 60); await gate; }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call);
    await userEvent.click(await rowLink(/Corniche Office Tower/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Message' }), 'The door sketch.');
    await userEvent.upload(screen.getByLabelText('Attach files'), new File(['x'], 'Door sketch.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const bar = await within(screen.getByRole('list', { name: PICKED })).findByRole('progressbar', { name: 'Door sketch.pdf: 50% uploaded' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar.className).toMatch(/bg-fill-strong/);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Door sketch.pdf' })).toBeDisabled();
    release();
    await waitFor(() => expect(Object.values(store.state.messages).some((m) => m.body === 'The door sketch.' && (m.fileIds?.length ?? 0) === 1)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });
  it('names the progress in Arabic', async () => {
    const { api } = await renderApp('/inbox', (state) => { state.users.usr_001.preferences.language = 'ar'; });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = api.call.bind(api);
    vi.spyOn(api, 'call').mockImplementation((async (name: string, input: unknown, meta?: { onProgress?: (sent: number, total: number) => void }) => {
      if (name === 'files.upload') { meta?.onProgress?.(30, 60); await gate; }
      return (original as (n: string, i: unknown, m?: unknown) => Promise<unknown>)(name, input, meta);
    }) as typeof api.call);
    await userEvent.click(await within(await screen.findByRole('list', { name: 'المحادثات' })).findByRole('link', { name: /Corniche Office Tower|برج/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'الرسالة' }), 'رسم الباب.');
    await userEvent.upload(screen.getByLabelText('أرفق ملفات'), new File(['x'], 'Door sketch.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'أرسل' }));
    expect(await screen.findByRole('progressbar', { name: 'Door sketch.pdf: رُفع 50%' })).toHaveAttribute('aria-valuenow', '50');
    release();
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });
});
