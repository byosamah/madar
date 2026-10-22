import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { State } from '../../api/store';
import { initI18n } from '../../i18n';
import { renderWithRuntime } from '../../test/render';
import { useMeSummary } from './useMeSummary';

const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../../app/mode', () => mode);

afterEach(() => {
  mode.REMOTE = false;
  mode.PROTOTYPE = true;
  initI18n('en');
});

/** Writes the summary as JSON, so a test reads every line at once. */
function Probe() {
  return <pre data-testid="summary">{JSON.stringify(useMeSummary())}</pre>;
}
const read = async (prepare?: (state: State) => void, language: 'en' | 'ar' = 'en') => {
  await renderWithRuntime(<Probe />, prepare);
  // The render starts in English; the language turns after it, as the app does for a person who reads Arabic.
  if (language === 'ar') act(() => { initI18n('ar'); });
  // The quiet line is null until settings.get answers.
  await waitFor(() => expect(JSON.parse(screen.getByTestId('summary').textContent!).quiet).not.toBeNull());
  return JSON.parse(screen.getByTestId('summary').textContent!) as { role: string; quiet: string | null; notices: string; reach: string | null; gcal: string | null };
};

describe('the lines under the titles of the Me hub', () => {
  it('names the role and the quiet range of an Admin with the defaults', async () => {
    const summary = await read();
    expect(summary.quiet).toBe('Sunday to Thursday, outside 9:00 AM to 5:00 PM');
    expect(summary.role).toBe('Admin');
    expect(summary.reach).toBe('My work, and the rest in the list');
    expect(summary.notices).toBe('In the app');
  });

  it('says Off when the person turned quiet hours off', async () => {
    const summary = await read((state) => {
      state.users.usr_001.preferences.workHours = { quiet: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' };
    });
    expect(summary.quiet).toBe('Off');
  });

  it('widens the range to the office lock', async () => {
    const summary = await read((state) => {
      state.settings.workHours = { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: true, days: [6], from: '08:00', to: '18:00' } };
    });
    expect(summary.quiet).toContain('Saturday');
    expect(summary.quiet).toContain('8:00 AM');
    expect(summary.quiet).toContain('6:00 PM');
  });

  it('gives the name of a custom role in Arabic', async () => {
    const summary = await read((state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Site engineer', nameAr: 'مهندس موقع', rights: [] }] };
      state.users.usr_005.roleId = 'rol_001';
    }, 'ar');
    expect(summary.role).toBe('مهندس موقع');
  });

  it('gives the name of a custom role in English', async () => {
    const summary = await read((state) => {
      state.session.currentUserId = 'usr_005';
      state.settings.roles = { custom: [{ id: 'rol_001', name: 'Site engineer', nameAr: 'مهندس موقع', rights: [] }] };
      state.users.usr_005.roleId = 'rol_001';
    });
    expect(summary.role).toBe('Site engineer');
  });

  it('gives no reach to a Member', async () => {
    const summary = await read((state) => {
      state.session.currentUserId = 'usr_005';
    });
    expect(summary.reach).toBeNull();
    expect(summary.role).toBe('Member');
  });

  it('reads the Google state in the real build only', async () => {
    const prototype = await read();
    expect(prototype.gcal).toBeNull();
  });

  it('says that notices also go by email in the real build', async () => {
    mode.REMOTE = true;
    mode.PROTOTYPE = false;
    const summary = await read();
    expect(summary.notices).toBe('In the app and by email');
  });
});
