import { describe, expect, it, vi } from 'vitest';
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
/** The useIsPhone query answers true: the screen takes its phone shape (under 640 px). */
const phoneWidth = () => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: query === '(max-width: 639px)', media: query, onchange: null,
  addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
}) as MediaQueryList);
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

  it('loads a thumbnail only near the view, and decodes it off the main work (review, 2026-10-07, S4)', async () => {
    const { api } = remoteApi();
    renderRemote(api);
    const thumb = await screen.findByRole('img', { name: 'Screenshot 1' });
    expect(thumb).toHaveAttribute('loading', 'lazy');
    expect(thumb).toHaveAttribute('decoding', 'async');
  });

  it('signs the screenshot links of a report only when its row comes near the view (code review 2026-10-27)', async () => {
    let seen: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { seen = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    try {
      const { api, signs } = remoteApi();
      renderRemote(api);
      await screen.findByRole('heading', { name: 'Requests and bugs' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(signs).toEqual([]);
      act(() => seen([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
      await waitFor(() => expect(signs).toHaveLength(2));
    } finally {
      vi.unstubAllGlobals();
    }
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

/** The status control is one menu: open it by its current status, then pick the new one. */
async function chooseStatus(section: HTMLElement, from: string, to: string) {
  await userEvent.click(await within(section).findByRole('button', { name: `Status: ${from}` }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: to }));
}

describe('Requests and bugs in the prototype (spec 4.3)', () => {
  const oneReport = (state: State) => {
    state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
  };

  it('puts the status control under the message on a phone, so the message keeps the width of the row (2026-10-12)', async () => {
    const spy = phoneWidth();
    try {
      await renderApp('/admin/feedback', oneReport);
      const section = await screen.findByRole('region', { name: /Requests and bugs/ });
      const button = await within(section).findByRole('button', { name: 'Status: New' });
      const message = within(section).getByText(REPORT.message);
      expect(message.parentElement).toContainElement(button);
      expect(message.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the status control beside the message on a wider screen', async () => {
    await renderApp('/admin/feedback', oneReport);
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    const button = await within(section).findByRole('button', { name: 'Status: New' });
    expect(within(section).getByText(REPORT.message).parentElement).not.toContainElement(button);
  });

  it('shows the stored picture and opens it in a sheet', async () => {
    const { store } = await renderApp('/admin/feedback', withShot);
    await store.persister.putBlob('blob_shot_1', new Blob(['x'], { type: 'image/png' }));
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByRole('img', { name: 'Screenshot 1' })).toHaveAttribute('src', 'blob:madar-test');
    await userEvent.click(within(section).getByRole('button', { name: 'Screenshot 1' }));
    const sheet = await screen.findByRole('dialog', { name: 'Screenshot 1' });
    expect(within(sheet).getByRole('link', { name: 'Open screenshot 1 at full size' })).toHaveAttribute('href', 'blob:madar-test');
  });

  // role-rights (owner, 2026-10-23): the right feedback.manage opens the reports for a person who is not the Admin.
  it('shows the reports to a Member with the feedback right, and lets that person mark one done', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [], createdBy: 'usr_004' } };
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Reports reader', nameAr: 'قارئ البلاغات', rights: ['feedback.manage'] }] };
      state.users.usr_003.roleId = 'rol_001';
      state.session.currentUserId = 'usr_003';
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByText(REPORT.message)).toBeInTheDocument();
    await chooseStatus(section, 'New', 'Done');
    await waitFor(() => expect(store.state.feedback?.fbk_001.status).toBe('done'));
    expect(store.state.feedback?.fbk_001.doneBy).toBe('usr_003');
  });

  it('keeps the reports from a Member without the feedback right', async () => {
    await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [], createdBy: 'usr_004' } };
      state.session.currentUserId = 'usr_003';
    });
    expect((await screen.findAllByText('Office')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: /Requests and bugs/ })).toBeNull();
    expect(screen.queryByText(REPORT.message)).toBeNull();
  });

  it('offers Undo after Done, and the report is open again after Undo (rule B20)', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
    });
    const doneNotices = () => Object.values(store.state.notifications).filter((n) => n.trigger === 'feedback_done' && n.targetId === 'fbk_001');
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await chooseStatus(section, 'New', 'Done');
    expect(await screen.findByText('Status is now Done.')).toBeInTheDocument();
    // A done report moves from the Open tab to the Done tab.
    await userEvent.click(within(section).getByRole('radio', { name: /^Done/ }));
    expect(await within(section).findByRole('button', { name: 'Status: Done' })).toBeInTheDocument();
    expect(store.state.feedback?.fbk_001.status).toBe('done');
    // The sender gets the done notice (rule B4), and the Undo takes it back (rule B15).
    expect(doneNotices().map((n) => n.userId)).toEqual(['usr_003']);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(within(section).getByRole('radio', { name: /^Open/ }));
    expect(await within(section).findByRole('button', { name: 'Status: New' })).toBeInTheDocument();
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
    await userEvent.click(await within(section).findByRole('radio', { name: /^Done/ }));
    await chooseStatus(section, 'Done', 'New');
    // The report is open again, so it moves to the Open tab.
    await userEvent.click(within(section).getByRole('radio', { name: /^Open/ }));
    expect(await within(section).findByRole('button', { name: 'Status: New' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('shows the open reports on the Open tab, the done ones on the Done tab and the rejected ones on the Rejected tab', async () => {
    await renderApp('/admin/feedback', (state) => {
      state.feedback = {
        fbk_001: { ...REPORT, screenshots: [] },
        fbk_002: { ...REPORT, id: 'fbk_002', message: 'Already fixed in the last release.', screenshots: [], status: 'done', doneBy: 'usr_001', doneAt: '2026-09-29T10:00:00.000+03:00' },
        fbk_003: { ...REPORT, id: 'fbk_003', message: 'A report in review.', screenshots: [], status: 'in_review' },
        fbk_004: { ...REPORT, id: 'fbk_004', message: 'Not for this office.', screenshots: [], status: 'rejected', rejectReason: 'We do not plan this.' },
      };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    expect(await within(section).findByRole('radio', { name: 'Open (2)' })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByText('The board does not scroll on my phone.')).toBeInTheDocument();
    expect(within(section).getByText('A report in review.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Status: In review' })).toBeInTheDocument();
    expect(within(section).queryByText('Already fixed in the last release.')).toBeNull();
    await userEvent.click(within(section).getByRole('radio', { name: 'Done (1)' }));
    expect(within(section).getByText('Already fixed in the last release.')).toBeInTheDocument();
    expect(within(section).queryByText('The board does not scroll on my phone.')).toBeNull();
    await userEvent.click(within(section).getByRole('radio', { name: 'Rejected (1)' }));
    expect(within(section).getByText('Not for this office.')).toBeInTheDocument();
    expect(within(section).getByText(/^Reason: \u2068We do not plan this\.\u2069$/)).toBeInTheDocument();
  });

  it('moves a report to In review and In progress with no notice and no toast, and it stays on the Open tab', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await chooseStatus(section, 'New', 'In review');
    await waitFor(() => expect(store.state.feedback?.fbk_001.status).toBe('in_review'));
    await chooseStatus(section, 'In review', 'In progress');
    await waitFor(() => expect(store.state.feedback?.fbk_001.status).toBe('in_progress'));
    expect(await within(section).findByRole('button', { name: 'Status: In progress' })).toBeInTheDocument();
    expect(Object.values(store.state.notifications).filter((n) => n.trigger === 'feedback_done')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('asks for a reason before it rejects: the Reject button waits for text, and the sender gets the reason in a notice', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await chooseStatus(section, 'New', 'Rejected');
    const sheet = await screen.findByRole('dialog', { name: 'Reject this report' });
    const reject = within(sheet).getByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    expect(store.state.feedback?.fbk_001.status).toBe('new');
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Reason' }), '   ');
    expect(reject).toBeDisabled();
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Reason' }), 'We plan this for the next release.');
    await userEvent.click(reject);
    await waitFor(() => expect(store.state.feedback?.fbk_001).toMatchObject({ status: 'rejected', rejectReason: 'We plan this for the next release.' }));
    expect(Object.values(store.state.notifications).filter((n) => n.trigger === 'feedback_done')).toEqual([
      expect.objectContaining({ userId: 'usr_003', feedback: expect.objectContaining({ reason: 'We plan this for the next release.' }) }),
    ]);
    expect(await screen.findByText('Status is now Rejected.')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('radio', { name: /^Rejected/ }));
    expect(await within(section).findByText(/^Reason: \u2068We plan this for the next release\.\u2069$/)).toBeInTheDocument();
    // The Undo takes the rejection and its notice back.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.state.feedback?.fbk_001.status).toBe('new'));
    expect(Object.values(store.state.notifications).filter((n) => n.trigger === 'feedback_done')).toEqual([]);
  });

  it('opens the reject sheet again with the old reason, so the Admin can change the words', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [], status: 'rejected', rejectReason: 'Old reason' } };
    });
    const section = await screen.findByRole('region', { name: /Requests and bugs/ });
    await userEvent.click(await within(section).findByRole('radio', { name: /^Rejected/ }));
    await chooseStatus(section, 'Rejected', 'Rejected');
    const sheet = await screen.findByRole('dialog', { name: 'Reject this report' });
    const box = within(sheet).getByRole('textbox', { name: 'Reason' });
    expect(box).toHaveValue('Old reason');
    await userEvent.clear(box);
    await userEvent.type(box, 'New reason');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(store.state.feedback?.fbk_001.rejectReason).toBe('New reason'));
  });

  it('shows the reject sheet and the tabs in Arabic', async () => {
    const { store } = await renderApp('/admin/feedback', (state) => {
      state.feedback = { fbk_001: { ...REPORT, screenshots: [] } };
      state.users.usr_001.preferences.language = 'ar';
    });
    const section = await screen.findByRole('region', { name: /الطلبات والبلاغات/ });
    expect(await within(section).findByRole('radio', { name: 'مفتوحة (1)' })).toBeInTheDocument();
    expect(within(section).getByRole('radio', { name: 'مرفوضة (0)' })).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'الحالة: جديد' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'مرفوض' }));
    const sheet = await screen.findByRole('dialog', { name: 'ارفض الطلب أو البلاغ' });
    expect(within(sheet).getByRole('button', { name: 'ارفض' })).toBeDisabled();
    expect(store.state.feedback?.fbk_001.status).toBe('new');
  });
});
