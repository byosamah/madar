import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeSource } from '../../app/runtime';
import { StorageBanner } from '../../app/StorageBanner';
import { PreviewAs } from '../../app/PreviewAs';
import { expectCalm } from '../auth/calmChecks';
import { fakeAuth } from '../auth/fakeAuth';
import { renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { PasswordSection } from './PasswordSection';
import { SettingsScreen } from './SettingsScreen';
import { PeopleSection } from './admin/PeopleSection';

// The remote build: no prototype controls, and the real people and password parts.
vi.mock('../../app/mode', () => ({ REMOTE: true, PROTOTYPE: false }));

const signedIn = () => fakeAuth({ accounts: [{ ...SAMPLE_ACCOUNTS.hala }], signedInAs: SAMPLE_ACCOUNTS.hala.email });
const only = (element: ReactElement) => [{ path: '*', element }];
// Faisal waits for his invitation; Hala has signed in.
const invites = (name: string) => (name === 'users.invites'
  ? [{ userId: 'usr_002', state: 'invited', sentAt: '2026-09-29T09:00:00.000+03:00' }, { userId: 'usr_001', state: 'active', sentAt: null }]
  : undefined);
const source = (status: 'open' | 'closed'): ChangeSource => ({ subscribe: () => () => undefined, status: () => status });

describe('the prototype controls in the remote build (plan U3, client map 6)', () => {
  it('shows no Prototype section, no Preview as, no Simulate errors and no Reset in Settings', async () => {
    await renderAuth('/settings', { auth: signedIn(), routes: only(<SettingsScreen />) });
    // The title draws again once the session loads, so the test waits for a section first.
    await screen.findByRole('heading', { level: 2, name: 'Password' });
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Prototype' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Preview as/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Simulate errors' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset sample data' })).toBeNull();
  });

  it('draws no Preview as even where a screen mounts it', async () => {
    const { container } = await renderAuth('/', { auth: signedIn(), routes: only(<div data-testid="holder"><PreviewAs id="x" /></div>) });
    await screen.findByTestId('holder');
    expect(container.querySelector('select')).toBeNull();
  });

  it('adds a person with no agent fields and a Language choice that starts at the language of the Admin', async () => {
    const { api } = await renderAuth('/admin', { auth: signedIn(), routes: only(<PeopleSection />), prepare: (state) => { state.users.usr_001.preferences.language = 'ar'; } });
    const call = vi.spyOn(api, 'call');
    await userEvent.click(await screen.findByRole('button', { name: 'Add person' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add person' });
    expect(within(sheet).queryByLabelText('Kind')).toBeNull();
    expect(within(sheet).queryByLabelText('Acts for')).toBeNull();
    const language = within(sheet).getByLabelText('Language');
    // The Admin reads Arabic; the labels stay English because the test renders in English.
    expect(language).toHaveValue('ar');
    expect(within(sheet).getByText('Madar uses this language for the invitation email and the first sign-in.')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Name in English *'), 'Noura Al-Qahtani');
    await userEvent.type(within(sheet).getByLabelText('Name in Arabic *'), 'نورة القحطاني');
    await userEvent.type(within(sheet).getByLabelText('Email'), 'noura@madar.test');
    await userEvent.type(within(sheet).getByLabelText('Discipline'), 'Interiors');
    await userEvent.selectOptions(language, 'en');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    // useAction sends the idempotency key of the attempt as the third argument (track R1).
    await waitFor(() => expect(call).toHaveBeenCalledWith('users.create', expect.objectContaining({ email: 'noura@madar.test', kind: 'human', language: 'en' }), expect.objectContaining({ key: expect.any(String) })));
  }, 20000);

  it('marks an invited person and sends the invitation again, with a toast', async () => {
    const { api } = await renderAuth('/admin', { auth: signedIn(), routes: only(<PeopleSection />), answer: invites });
    const call = vi.spyOn(api, 'call');
    const faisal = (await screen.findByText('Faisal Al-Harbi')).closest('li')!;
    expect(await within(faisal).findByText('Invited')).toBeInTheDocument();
    const hala = screen.getByText('Hala Nasser').closest('li')!;
    expect(within(hala).queryByText('Invited')).toBeNull();
    await userEvent.click(within(faisal).getByRole('button', { name: 'Actions for Faisal Al-Harbi' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Send the invitation again' }));
    // On its way, not sent: on a full mail day the mail waits for the next day (wave 6, V), and the words stay true.
    expect(await screen.findByText('The invitation is on its way to Faisal Al-Harbi.')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('users.resendInvite', { id: 'usr_002' }, expect.objectContaining({ key: expect.any(String) }));
  });

  it('shows an invitation that waits for a day with mail room as a calm Invited mark only: no alarm, no date, no new button (EN and AR)', async () => {
    // The mail of Faisal's invitation did not go out yet (sentAt null): the daily mail quota was full (wave 6, V).
    const waiting = (name: string) => (name === 'users.invites'
      ? [{ userId: 'usr_002', state: 'invited', sentAt: null }, { userId: 'usr_001', state: 'active', sentAt: null }]
      : undefined);
    for (const language of ['en', 'ar'] as const) {
      const { container, unmount } = await renderAuth('/admin', { auth: signedIn(), routes: only(<PeopleSection />), answer: waiting, language });
      const people = await screen.findByRole('heading', { level: 2 });
      // An Arabic screen names him in Arabic (owner item 12).
      const faisal = (await screen.findByText(language === 'ar' ? 'فيصل الحربي' : 'Faisal Al-Harbi')).closest('li')!;
      expect(await within(faisal).findByText(language === 'ar' ? 'مدعو' : 'Invited')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      // One main button for the section (Add person); each row has only its Actions menu.
      expect(within(faisal).getAllByRole('button')).toHaveLength(1);
      expect(faisal.textContent).not.toMatch(/quota|limit|failed|error|الحصة|فشل|خطأ/i);
      expectCalm(container, { titleLevel: 2 });
      expect(people).toBeInTheDocument();
      if (language === 'ar') {
        await userEvent.click(within(faisal).getByRole('button'));
        await userEvent.click(await screen.findByRole('menuitem', { name: 'إرسال الدعوة مرة أخرى' }));
        expect(await screen.findByText('الدعوة في طريقها إلى فيصل الحربي.')).toBeInTheDocument();
      }
      unmount();
    }
  }, 20000);

  it('offers no new invitation to a person who has signed in', async () => {
    await renderAuth('/admin', { auth: signedIn(), routes: only(<PeopleSection />), answer: invites });
    const hala = (await screen.findByText('Hala Nasser')).closest('li')!;
    await userEvent.click(within(hala).getByRole('button', { name: 'Actions for Hala Nasser' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Send the invitation again' })).toBeNull();
  });

  it('shows the No connection banner at once when the browser is offline', async () => {
    await renderAuth('/', { auth: signedIn(), routes: only(<StorageBanner />), changes: source('open') });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    // The prototype line about browser storage never shows in the real build.
    expect(screen.queryByRole('status')).toBeNull();
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(await screen.findByRole('status')).toHaveTextContent('No connection. Madar cannot save changes until it connects again.');
    online.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('says live updates paused only when the change channel stays closed for two checks, and that changes still save', async () => {
    // Only the checks of the banner run on the fake clock; the screen loads on the real one.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let status: 'open' | 'closed' = 'closed';
      await renderAuth('/', { auth: signedIn(), routes: only(<StorageBanner />), changes: { subscribe: () => () => undefined, status: () => status } });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      const check = () => act(() => { vi.advanceTimersByTime(3000); });
      // A channel that still joins at the start, or joins again after a hidden tab, shows nothing.
      expect(screen.queryByRole('status')).toBeNull();
      check();
      expect(screen.queryByRole('status')).toBeNull();
      status = 'open';
      check();
      expect(screen.queryByRole('status')).toBeNull();
      status = 'closed';
      check();
      expect(screen.queryByRole('status')).toBeNull();
      check();
      expect(screen.getByRole('status')).toHaveTextContent('Live updates paused. Your changes still save.');
      status = 'open';
      check();
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Settings, Password (plan 5.1)', () => {
  async function change(current: string, next: string) {
    await userEvent.type(await screen.findByLabelText('Current password'), current);
    await userEvent.type(screen.getByLabelText('New password'), next);
    await userEvent.click(screen.getByRole('button', { name: 'Change the password' }));
  }

  it('sends the current and the new password in one change, then signs out the other devices', async () => {
    const auth = signedIn();
    await renderAuth('/settings', { auth, routes: only(<PasswordSection />) });
    await change(SAMPLE_ACCOUNTS.hala.password, 'green-field-77');
    expect(await screen.findByText('Password changed. Your other devices sign out.')).toBeInTheDocument();
    // The port checks the current password inside changePassword (proof.md Z0a, item 2), so the section signs in nowhere itself.
    // A person who changes the password because someone else may know it signs that person out of the other devices.
    expect(auth.log).toEqual(['changePassword', 'signOut:others']);
    expect(auth.status()).toBe('signed_in');
    expect(auth.current()?.password).toBe('green-field-77');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('says a wrong current password under its field and changes nothing', async () => {
    const auth = signedIn();
    await renderAuth('/settings', { auth, routes: only(<PasswordSection />) });
    await change('not-the-password', 'green-field-77');
    expect(await screen.findByText('The password is not right.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAccessibleDescription('The password is not right.');
    expect(auth.log).toEqual(['changePassword']);
    expect(auth.current()?.password).toBe(SAMPLE_ACCOUNTS.hala.password);
    expect(screen.getByLabelText('New password')).toHaveValue('green-field-77');
  });

  it('says a wrong current password in Arabic under its field', async () => {
    const auth = signedIn();
    await renderAuth('/settings', { auth, routes: only(<PasswordSection />), language: 'ar' });
    await userEvent.type(await screen.findByLabelText('كلمة المرور الحالية'), 'not-the-password');
    await userEvent.type(screen.getByLabelText('كلمة المرور الجديدة'), 'green-field-77');
    await userEvent.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));
    expect(await screen.findByText('كلمة المرور غير صحيحة.')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(auth.current()?.password).toBe(SAMPLE_ACCOUNTS.hala.password);
  });

  it('refuses a short new password before it checks anything', async () => {
    const auth = signedIn();
    await renderAuth('/settings', { auth, routes: only(<PasswordSection />) });
    await change(SAMPLE_ACCOUNTS.hala.password, 'short');
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(auth.log).toEqual([]);
  });

  it('passes the calm checks in English and in Arabic right to left', async () => {
    const english = await renderAuth('/settings', { auth: signedIn(), routes: only(<PasswordSection />) });
    await screen.findByRole('heading', { level: 2, name: 'Password' });
    expectCalm(english.container, { titleLevel: 2 });
    english.unmount();
    const arabic = await renderAuth('/settings', { auth: signedIn(), routes: only(<PasswordSection />), language: 'ar' });
    expect(await screen.findByRole('heading', { level: 2, name: 'كلمة المرور' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('button', { name: 'تغيير كلمة المرور' })).toBeInTheDocument();
    expectCalm(arabic.container, { titleLevel: 2 });
  });
});

describe('Admin, People in the remote build: calm checks', () => {
  it('passes in English and in Arabic right to left, with the Invited badge', async () => {
    const english = await renderAuth('/admin', { auth: signedIn(), routes: only(<PeopleSection />), answer: invites });
    await within((await screen.findByText('Faisal Al-Harbi')).closest('li')!).findByText('Invited');
    expectCalm(english.container, { titleLevel: 2 });
    english.unmount();
    const arabic = await renderAuth('/admin', {
      auth: signedIn(), routes: only(<PeopleSection />), answer: invites, language: 'ar',
      prepare: (state) => { state.users.usr_001.preferences.language = 'ar'; },
    });
    expect(await screen.findByRole('heading', { level: 2, name: 'الأشخاص' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    await within((await screen.findByText('فيصل الحربي')).closest('li')!).findByText('مدعو');
    expectCalm(arabic.container, { titleLevel: 2 });
  });

  it('uses the female Arabic form of Invited for a woman', async () => {
    await renderAuth('/admin', {
      auth: signedIn(), routes: only(<PeopleSection />), language: 'ar',
      answer: (name) => (name === 'users.invites' ? [{ userId: 'usr_001', state: 'invited', sentAt: null }] : undefined),
    });
    const hala = (await screen.findByText('هالة ناصر')).closest('li')!;
    expect(await within(hala).findByText('مدعوة')).toBeInTheDocument();
  });
});
