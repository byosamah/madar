import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { MadarApi } from '../../../api/calls';
import type { Feedback } from '../../../api/contract/entities';
import { ApiError } from '../../../api/errors';
import type { State } from '../../../api/store';
import { RuntimeProvider, createQueryClient, type Runtime } from '../../../app/runtime';
import { ToastProvider } from '../../../app/toasts';
import { initI18n } from '../../../i18n';
import { renderApp } from '../../../test/render';
import { FeedbackSection } from './FeedbackSection';

const REPORT: Feedback = {
  id: 'fbk_001', kind: 'bug', message: 'The board does not scroll on my phone.', page: '/projects',
  screenshots: [{ blobKey: 'blob_shot_1', type: 'image/png' }, { blobKey: 'blob_shot_2', type: 'image/png' }],
  status: 'new', createdBy: 'usr_003', createdAt: '2026-09-29T09:00:00.000+03:00', doneBy: null, doneAt: null,
};
const SENDER = { id: 'usr_003', name: 'Reem Al-Ghamdi', avatarUrl: null, kind: 'human' as const, discipline: 'Architect', gender: 'female' as const };

type Sign = { id: string; index: number };

/**
 * A remote API stub. feedback.screenshot answers as the real build does (wire.output, a signed link), with a new URL for each
 * sign of the same picture. failSign makes every sign fail with not_found; failFrom makes sign number failFrom of a picture
 * and each later one fail.
 */
function remoteApi(o: { failSign?: boolean; failFrom?: number } = {}) {
  const signs: Sign[] = [];
  const api = {
    call: async (name: string, input: unknown) => {
      if (name === 'feedback.list') return [{ item: REPORT, sender: SENDER, screenshots: REPORT.screenshots.length }];
      if (name === 'feedback.screenshot') {
        const { id, index } = input as Sign;
        signs.push({ id, index });
        const n = signs.filter((sign) => sign.index === index).length;
        if (o.failSign || (o.failFrom !== undefined && n >= o.failFrom)) throw new ApiError('not_found', `Report ${id} was not found.`);
        return { url: `https://store.test/shot-${index + 1}${n > 1 ? `?sign=${n}` : ''}`, expiresAt: '2026-09-30T06:10:00.000Z' };
      }
      throw new Error(`unexpected ${name}`);
    },
    run: async () => { throw new Error('not used'); },
  } as unknown as MadarApi;
  return { api, signs };
}

function renderRemote(api: MadarApi) {
  initI18n('en');
  const runtime: Runtime = { api, mode: 'remote' };
  return render(
    <RuntimeProvider runtime={runtime} queryClient={createQueryClient({ remote: true })}>
      <ToastProvider>
        <MemoryRouter><FeedbackSection /></MemoryRouter>
      </ToastProvider>
    </RuntimeProvider>,
  );
}

const shotsOf = (signs: Sign[], index: number) => signs.filter((sign) => sign.index === index);

describe('Requests and bugs in the real build: the screenshots (spec 4.3)', () => {
  it('shows each picture from its signed link', async () => {
    const { api, signs } = remoteApi();
    renderRemote(api);
    expect(await screen.findByRole('img', { name: 'Screenshot 1' })).toHaveAttribute('src', 'https://store.test/shot-1');
    expect(await screen.findByRole('img', { name: 'Screenshot 2' })).toHaveAttribute('src', 'https://store.test/shot-2');
    expect([...signs].sort((a, b) => a.index - b.index)).toEqual([{ id: 'fbk_001', index: 0 }, { id: 'fbk_001', index: 1 }]);
  });

  it('asks for one new link when a picture breaks', async () => {
    const { api, signs } = remoteApi();
    renderRemote(api);
    fireEvent.error(await screen.findByRole('img', { name: 'Screenshot 1' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Screenshot 1' })).toHaveAttribute('src', 'https://store.test/shot-1?sign=2'));
    expect(shotsOf(signs, 0)).toHaveLength(2);
  });

  it('shows the fallback when the new link breaks too, after exactly 2 signs', async () => {
    const { api, signs } = remoteApi();
    renderRemote(api);
    fireEvent.error(await screen.findByRole('img', { name: 'Screenshot 1' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Screenshot 1' })).toHaveAttribute('src', 'https://store.test/shot-1?sign=2'));
    fireEvent.error(screen.getByRole('img', { name: 'Screenshot 1' }));
    const broken = await screen.findByRole('img', { name: 'Screenshot 1 did not load.' });
    expect(broken.tagName).not.toBe('IMG');
    expect(broken.closest('button')).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(shotsOf(signs, 0)).toHaveLength(2);
    // The other picture of the report still shows.
    expect(screen.getByRole('img', { name: 'Screenshot 2' })).toHaveAttribute('src', 'https://store.test/shot-2');
  });

  it('shows the fallback when the sign fails', async () => {
    const { api } = remoteApi({ failSign: true });
    renderRemote(api);
    expect(await screen.findByRole('img', { name: 'Screenshot 1 did not load.' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Screenshot 2 did not load.' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Screenshot 1' })).toBeNull();
  });

  it('opens the bigger view in a sheet with the same link and no new sign, and links the full size', async () => {
    const { api, signs } = remoteApi();
    renderRemote(api);
    const thumb = await screen.findByRole('button', { name: 'Screenshot 1' });
    expect(thumb).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(thumb);
    const sheet = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    const full = within(sheet).getByRole('link', { name: 'Open screenshot 1 at full size' });
    expect(full).toHaveAttribute('href', 'https://store.test/shot-1');
    expect(full).toHaveAttribute('target', '_blank');
    expect(full).toHaveAttribute('rel', 'noopener noreferrer');
    expect(full.querySelector('img')).toHaveAttribute('src', 'https://store.test/shot-1');
    expect(signs).toHaveLength(2);
  });

  it('counts a strike against a link, not each error: one bad link that breaks in the thumbnail and in the sheet asks once (review, 2026-10-07, S3)', async () => {
    const { api, signs } = remoteApi();
    renderRemote(api);
    const thumbImg = await screen.findByRole('img', { name: 'Screenshot 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Screenshot 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    const fullLink = () => within(sheet).getByRole('link', { name: 'Open screenshot 1 at full size' });
    const bigImg = fullLink().querySelector('img') as HTMLImageElement;
    // The old link breaks in both pictures before the new link comes.
    fireEvent.error(thumbImg);
    fireEvent.error(bigImg);
    await waitFor(() => expect(fullLink()).toHaveAttribute('href', 'https://store.test/shot-1?sign=2'));
    expect(screen.queryByText('Screenshot 1 did not load.')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Screenshot 1 did not load.', hidden: true })).toBeNull();
    expect(shotsOf(signs, 0)).toHaveLength(2);
    // The new link breaks too: now the screen gives up, after exactly 2 signs.
    fireEvent.error(fullLink().querySelector('img') as HTMLImageElement);
    expect(await within(sheet).findByText('Screenshot 1 did not load.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('link')).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(shotsOf(signs, 0)).toHaveLength(2);
  });

  it('shows the fallback in the sheet, not the dead link, when the new sign fails (review, 2026-10-07, S2)', async () => {
    const { api, signs } = remoteApi({ failFrom: 2 });
    renderRemote(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Screenshot 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    const full = within(sheet).getByRole('link', { name: 'Open screenshot 1 at full size' });
    fireEvent.error(full.querySelector('img') as HTMLImageElement);
    expect(await within(sheet).findByText('Screenshot 1 did not load.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('link')).toBeNull();
    expect(sheet.querySelector('img')).toBeNull();
    expect(shotsOf(signs, 0)).toHaveLength(2);
  });

  it('opens the sheet with Enter, closes it with Escape, and gives the focus back to the thumbnail', async () => {
    const { api } = remoteApi();
    renderRemote(api);
    const thumb = await screen.findByRole('button', { name: 'Screenshot 1' });
    thumb.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Screenshot 1' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Screenshot 1' })).toBeNull());
    await waitFor(() => expect(thumb).toHaveFocus());
  });
});

const withShot = (state: State) => {
  state.feedback = { fbk_001: { ...REPORT, screenshots: [REPORT.screenshots[0]] } };
};

describe('Requests and bugs in the prototype (spec 4.3)', () => {
  it('shows the stored picture and opens it in a sheet', async () => {
    const { store } = await renderApp('/admin/feedback', withShot);
    await store.persister.putBlob('blob_shot_1', new Blob(['x'], { type: 'image/png' }));
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByRole('img', { name: 'Screenshot 1' })).toHaveAttribute('src', 'blob:madar-test');
    await userEvent.click(within(section).getByRole('button', { name: 'Screenshot 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    expect(within(sheet).getByRole('link', { name: 'Open screenshot 1 at full size' })).toHaveAttribute('href', 'blob:madar-test');
  });

  it('offers Undo after Mark done, and the report is open again after Undo (rule B20)', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
    });
    const doneNotices = () => Object.values(store.state.notifications).filter((n) => n.trigger === 'feedback_done' && n.targetId === 'fbk_001');
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await userEvent.click(await within(section).findByRole('button', { name: 'Mark done' }));
    expect(await screen.findByText('Marked done.')).toBeInTheDocument();
    expect(await within(section).findByRole('button', { name: 'Open again' })).toBeInTheDocument();
    expect(store.state.feedback?.fbk_001.status).toBe('done');
    // The sender gets the done notice (rule B4), and the Undo takes it back (rule B15).
    expect(doneNotices().map((n) => n.userId)).toEqual(['usr_003']);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await within(section).findByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(store.state.feedback?.fbk_001.status).toBe('new');
    await waitFor(() => expect(doneNotices()).toEqual([]));
  });

  it('links a Madar screen, and shows a stored page with a tab as plain text (review, 2026-10-07, L-F1)', async () => {
    await renderApp('/admin/feedback', (state) => {
      state.feedback = {
        fbk_001: { ...REPORT, screenshots: [] },
        fbk_002: { ...REPORT, id: 'fbk_002', message: 'Old report with a bad page.', page: '/\t/evil.com', screenshots: [] },
      };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await within(section).findByText('Old report with a bad page.');
    // The browser drops the tab from a link, so "/\t/evil.com" would open evil.com.
    expect(within(section).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#/projects']);
    expect(section.textContent).toContain('/\t/evil.com');
  });

  it('opens a done report again with no toast and no Undo', async () => {
    await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [], status: 'done', doneBy: 'usr_001', doneAt: '2026-09-29T10:00:00.000+03:00' } };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await userEvent.click(await within(section).findByRole('button', { name: 'Open again' }));
    expect(await within(section).findByRole('button', { name: 'Mark done' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
