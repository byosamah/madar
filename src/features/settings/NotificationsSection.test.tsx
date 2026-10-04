import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TRIGGERS, type Trigger } from '../../api/contract/entities';
import { EMAIL_DEFAULT_ON } from '../../api/notify';
import { initI18n } from '../../i18n';
import { ar, en } from '../../i18n/trees';
import { renderWithRuntime } from '../../test/render';
import { expectCalm } from '../auth/calmChecks';
import { NotificationsSection } from './NotificationsSection';

// The build flag, switched per test: the prototype build (the default) or the remote build.
const mode = vi.hoisted(() => ({ REMOTE: false, PROTOTYPE: true }));
vi.mock('../../app/mode', () => mode);

function remote(on: boolean) {
  mode.REMOTE = on;
  mode.PROTOTYPE = !on;
}

afterEach(() => {
  remote(false);
  initI18n('en');
});

type Words = typeof en;
const notices = (words: Words) => (words as unknown as { notices: Record<string, string> }).notices;
const appName = (words: Words, trigger: Trigger) => notices(words).switchInApp.replace('{{trigger}}', words.settings.triggers[trigger]);
const emailName = (words: Words, trigger: Trigger) => notices(words).switchEmail.replace('{{trigger}}', words.settings.triggers[trigger]);

/**
 * The calm checks of plan 6.1, rule 8, for a section of many switches. The fill of a switch shows its state (on or off), so the
 * check removes the switch fills first; every other part of the section still counts as a colored highlight.
 */
function expectCalmSection(section: HTMLElement) {
  const copy = section.cloneNode(true) as HTMLElement;
  for (const toggle of copy.querySelectorAll('[role="switch"]')) toggle.setAttribute('class', '');
  expectCalm(copy, { titleLevel: 2 });
}

async function sectionOf(words: Words) {
  return (await screen.findByRole('heading', { name: words.settings.notifications })).closest('section')!;
}

describe('the Notifications section (moved out of Settings, plan T0.4)', () => {
  it('shows the same switches as before: one for each trigger, with the person\'s choices', async () => {
    await renderWithRuntime(<NotificationsSection />, (state) => {
      state.users.usr_001.preferences.notifications.overdue = false;
    });
    const section = (await screen.findByRole('heading', { name: en.settings.notifications })).closest('section')!;
    const switches = within(section).getAllByRole('switch');
    expect(switches).toHaveLength(TRIGGERS.length);
    for (const trigger of TRIGGERS) {
      const toggle = within(section).getByRole('switch', { name: en.settings.triggers[trigger] });
      expect(toggle).toHaveAttribute('aria-checked', trigger === 'overdue' ? 'false' : 'true');
    }
  });

  it('saves a switch', async () => {
    const { store } = await renderWithRuntime(<NotificationsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: en.settings.triggers.mention }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.notifications.mention).toBe(false));
  });

  it('reads right to left in Arabic', async () => {
    await renderWithRuntime(<div dir="rtl"><NotificationsSection /></div>);
    const ar = initI18n('ar');
    const section = (await screen.findByRole('heading', { name: ar.t('settings.notifications') })).closest('section')!;
    expect(within(section).getByRole('switch', { name: ar.t('settings.triggers.mention') })).toBeInTheDocument();
    initI18n('en');
  });

  it('shows no email switch and no Morning summary in the prototype build', async () => {
    await renderWithRuntime(<NotificationsSection />);
    const section = await sectionOf(en);
    expect(within(section).queryByRole('switch', { name: emailName(en, 'mention') })).toBeNull();
    expect(within(section).queryByRole('switch', { name: notices(en).summary })).toBeNull();
    expectCalmSection(section);
  });
});

describe('the Notifications section in the remote build (plan 5.4; task N2.2)', () => {
  it('shows one row for each trigger with two switches, the email defaults, and the Morning summary on when the field is missing', async () => {
    remote(true);
    await renderWithRuntime(<NotificationsSection />, (state) => {
      delete state.users.usr_001.preferences.email;
      delete state.users.usr_001.preferences.morningSummary;
    });
    const section = await sectionOf(en);
    expect(within(section).getAllByRole('switch')).toHaveLength(TRIGGERS.length * 2 + 1);
    for (const trigger of TRIGGERS) {
      const row = within(section).getByTestId(`notice-row-${trigger}`);
      expect(within(row).getAllByRole('switch')).toHaveLength(2);
      expect(within(row).getByRole('switch', { name: appName(en, trigger) })).toHaveAttribute('aria-checked', 'true');
      expect(within(row).getByRole('switch', { name: emailName(en, trigger) })).toHaveAttribute('aria-checked', String(EMAIL_DEFAULT_ON.has(trigger)));
    }
    expect(within(section).getByRole('switch', { name: notices(en).summary })).toHaveAttribute('aria-checked', 'true');
    // The two column names, once each.
    expect(within(section).getAllByText(notices(en).inApp)).toHaveLength(1);
    expect(within(section).getAllByText(notices(en).email)).toHaveLength(1);
    expectCalmSection(section);
  });

  it('reads right to left in Arabic with the same rows and the calm checks', async () => {
    remote(true);
    await renderWithRuntime(<div dir="rtl"><NotificationsSection /></div>, (state) => {
      delete state.users.usr_001.preferences.morningSummary;
    });
    initI18n('ar');
    const section = await sectionOf(ar as unknown as Words);
    expect(section.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    expect(within(section).getAllByRole('switch')).toHaveLength(TRIGGERS.length * 2 + 1);
    for (const trigger of TRIGGERS) {
      const row = within(section).getByTestId(`notice-row-${trigger}`);
      expect(within(row).getByRole('switch', { name: appName(ar as unknown as Words, trigger) })).toBeInTheDocument();
      expect(within(row).getByRole('switch', { name: emailName(ar as unknown as Words, trigger) })).toBeInTheDocument();
    }
    expect(within(section).getByRole('switch', { name: notices(ar as unknown as Words).summary })).toHaveAttribute('aria-checked', 'true');
    expectCalmSection(section);
  });

  it('keeps the person\'s own email choices over the defaults', async () => {
    remote(true);
    await renderWithRuntime(<NotificationsSection />, (state) => {
      state.users.usr_001.preferences.email = { mention: false, overdue: true };
      state.users.usr_001.preferences.morningSummary = false;
    });
    const section = await sectionOf(en);
    expect(within(section).getByRole('switch', { name: emailName(en, 'mention') })).toHaveAttribute('aria-checked', 'false');
    expect(within(section).getByRole('switch', { name: emailName(en, 'overdue') })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByRole('switch', { name: emailName(en, 'task_assigned') })).toHaveAttribute('aria-checked', 'true');
    expect(within(section).getByRole('switch', { name: notices(en).summary })).toHaveAttribute('aria-checked', 'false');
  });

  it('saves an email switch and the Morning summary', async () => {
    remote(true);
    const { store } = await renderWithRuntime(<NotificationsSection />);
    await userEvent.click(await screen.findByRole('switch', { name: emailName(en, 'mention') }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.email?.mention).toBe(false));
    // The in-app switch of the same trigger stays as it was.
    expect(store.state.users.usr_001.preferences.notifications.mention).toBe(true);
    await userEvent.click(screen.getByRole('switch', { name: notices(en).summary }));
    await waitFor(() => expect(store.state.users.usr_001.preferences.morningSummary).toBe(false));
  });

  it('turns the email switch off and says why while the in-app switch of the same trigger is off', async () => {
    remote(true);
    const { store } = await renderWithRuntime(<NotificationsSection />, (state) => {
      state.users.usr_001.preferences.notifications.mention = false;
      state.users.usr_001.preferences.email = { mention: true };
    });
    const section = await sectionOf(en);
    const row = within(section).getByTestId('notice-row-mention');
    const email = within(row).getByRole('switch', { name: emailName(en, 'mention') });
    expect(email).toBeDisabled();
    expect(email).toHaveAttribute('aria-checked', 'false');
    expect(within(row).getByText(notices(en).emailNeedsApp)).toBeInTheDocument();
    expect(email).toHaveAccessibleDescription(notices(en).emailNeedsApp);
    // Only that row has the note, and the section stays calm with it.
    expect(within(section).getAllByText(notices(en).emailNeedsApp)).toHaveLength(1);
    expectCalmSection(section);
    // A click on the disabled switch sends nothing.
    await userEvent.click(email);
    expect(store.state.users.usr_001.preferences.email?.mention).toBe(true);
    // With the in-app switch on again, the email switch shows the person's choice and the note goes.
    await userEvent.click(within(row).getByRole('switch', { name: appName(en, 'mention') }));
    await waitFor(() => expect(within(row).getByRole('switch', { name: emailName(en, 'mention') })).toBeEnabled());
    expect(within(row).getByRole('switch', { name: emailName(en, 'mention') })).toHaveAttribute('aria-checked', 'true');
    expect(within(row).queryByText(notices(en).emailNeedsApp)).toBeNull();
  });
});
