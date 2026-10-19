import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../api/errors';
import { initI18n } from '../../i18n';
import { en, ar } from '../../i18n/trees';
import { WHATS_NEW } from '../../whatsNew/entries';
import { expectCalm } from '../auth/calmChecks';
import { fakeAuth } from '../auth/fakeAuth';
import { renderAuth, SAMPLE_ACCOUNTS } from '../auth/renderAuth';
import { GoogleCalendarSection } from './GoogleCalendarSection';

/** Settings, Google Calendar (fbk_022, owner 2026-10-19): the states, the one control of each, the way back from Google, and the Disconnect question. */

// The build flag, switched per test: the prototype build or the remote build.
const mode = vi.hoisted(() => ({ REMOTE: true, PROTOTYPE: false }));
vi.mock('../../app/mode', () => mode);

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=made-up&state=signed.state';
type Status = { ready: boolean; state: 'none' | 'ok' | 'not_synced' | 'broken'; connectedAt: string | null };

function setup(first: Partial<Status> = {}, o: { connect?: () => unknown; start?: () => unknown } = {}) {
  let status: Status = { ready: true, state: 'none', connectedAt: null, ...first };
  const order: string[] = [];
  const sent: { name: string; input: unknown }[] = [];
  const leave = vi.fn();
  const answer = (name: string, input: unknown) => {
    if (!name.startsWith('google.')) return undefined;
    sent.push({ name, input });
    order.push(name);
    if (name === 'google.status') return { ...status };
    if (name === 'google.connectStart') return o.start ? o.start() : { url: GOOGLE_URL };
    if (name === 'google.connect') {
      const given = o.connect ? o.connect() : { state: 'ok', meetings: 3 };
      if (!(given instanceof Promise)) status = { ready: true, state: 'ok', connectedAt: '2026-10-21T09:00:00.000+03:00' };
      return given;
    }
    if (name === 'google.disconnect') {
      status = { ready: true, state: 'none', connectedAt: null };
      return { state: 'none' };
    }
    return undefined;
  };
  return { answer, order, sent, leave, set: (next: Partial<Status>) => { status = { ...status, ...next }; } };
}

const signedIn = () => fakeAuth({ accounts: [{ ...SAMPLE_ACCOUNTS.hala }], signedInAs: SAMPLE_ACCOUNTS.hala.email });

async function open(s: ReturnType<typeof setup>, language: 'en' | 'ar' = 'en') {
  const element = <GoogleCalendarSection leave={s.leave} />;
  return renderAuth('/settings', { auth: signedIn(), routes: [{ path: '*', element }], answer: s.answer, language });
}

/** One text of a word tree by its dotted key. The track files are merged at run time, so the type of the tree does not know them. */
const pick = (tree: unknown, key: string): string => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], tree) as string;
const words = (language: 'en' | 'ar') => (language === "en" ? (en as unknown as Record<string, unknown>) : (ar as unknown as Record<string, unknown>)).gcal as Record<string, string>;
const sectionOf = async (language: 'en' | 'ar' = 'en') => (await screen.findByRole('heading', { name: words(language).title })).closest('section')!;

function comeBackWith(fragment: string) {
  window.history.replaceState(null, '', `/settings${fragment}`);
}

beforeEach(() => {
  mode.REMOTE = true;
  mode.PROTOTYPE = false;
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  initI18n('en');
});

describe('the Google Calendar section: the states', () => {
  it('shows one line and no control in the prototype, and asks nothing', async () => {
    mode.REMOTE = false;
    mode.PROTOTYPE = true;
    const s = setup();
    await open(s);
    const section = await sectionOf();
    expect(within(section).getByText(words('en').prototype)).toBeInTheDocument();
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
    expect(s.sent).toEqual([]);
  });

  it('says it is not set up, with no control, when this copy has no Google values', async () => {
    await open(setup({ ready: false }));
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').notReady)).toBeInTheDocument();
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  });

  it('none: the intro, the three things Google gets, and one main button Connect Google Calendar', async () => {
    await open(setup());
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').intro)).toBeInTheDocument();
    expect(within(section).getByText(words('en').onlyThree)).toBeInTheDocument();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([words('en').connect]);
    expect(buttons[0].className).toContain('signature');
    expectCalm(section, { titleLevel: 2 });
  });

  it('ok: the connected line and a quiet Disconnect, no main button', async () => {
    await open(setup({ state: 'ok', connectedAt: '2026-10-21T09:00:00.000+03:00' }));
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').connected)).toBeInTheDocument();
    expect(within(section).queryByText(words('en').intro)).toBeNull();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([words('en').disconnect]);
    expect(buttons[0].className).not.toContain('signature');
    expectCalm(section, { titleLevel: 2 });
  });

  it('not_synced: the connected line, the note that Madar tries again, and a quiet Disconnect', async () => {
    await open(setup({ state: 'not_synced', connectedAt: '2026-10-21T09:00:00.000+03:00' }));
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').connected)).toBeInTheDocument();
    expect(within(section).getByText(words('en').notSynced)).toBeInTheDocument();
    expect(within(section).getAllByRole('button').map((button) => button.textContent)).toEqual([words('en').disconnect]);
    expectCalm(section, { titleLevel: 2 });
  });

  it('broken: the stopped line and one main button Connect again', async () => {
    await open(setup({ state: 'broken', connectedAt: '2026-10-21T09:00:00.000+03:00' }));
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').broken)).toBeInTheDocument();
    const buttons = within(section).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([words('en').connectAgain]);
    expect(buttons[0].className).toContain('signature');
    expectCalm(section, { titleLevel: 2 });
  });
});

describe('Connect', () => {
  it('asks the server for the Google address and leaves for it once, also after a double press', async () => {
    const s = setup();
    await open(s);
    const button = await screen.findByRole('button', { name: words('en').connect });
    await userEvent.dblClick(button);
    await waitFor(() => expect(s.leave).toHaveBeenCalledTimes(1));
    expect(s.leave).toHaveBeenCalledWith(GOOGLE_URL);
    expect(s.sent.filter((call) => call.name === 'google.connectStart')).toHaveLength(1);
  });

  it('leaves only for the sign-in address of Google: another address shows an error and nothing moves', async () => {
    const s = setup({}, { start: () => ({ url: 'https://evil.example/o/oauth2/v2/auth' }) });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: words('en').connect }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(s.leave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: words('en').connect })).toBeEnabled();
  });

  it('shows the words of the reason when the server refuses to start, and keeps the Connect button', async () => {
    const s = setup({}, { start: () => Promise.reject(new ApiError('invalid_input', 'Not set up.', { reason: 'google_not_ready' })) });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: words('en').connect }));
    expect(await screen.findByRole('alert')).toHaveTextContent(pick(en, 'errors.reasons.google_not_ready'));
    expect(screen.getByRole('button', { name: words('en').connect })).toBeEnabled();
  });
});

describe('back from Google', () => {
  it('takes the fragment away before it calls google.connect, and calls it once with the code and the state', async () => {
    const s = setup();
    comeBackWith('#google=finish&code=4%2F0AbC&state=signed.state');
    const replace = vi.spyOn(window.history, 'replaceState');
    replace.mockImplementation((...args: Parameters<History['replaceState']>) => {
      s.order.push('replaceState');
      return History.prototype.replaceState.apply(window.history, args);
    });
    await open(s);
    await waitFor(() => expect(s.sent.filter((call) => call.name === 'google.connect')).toHaveLength(1));
    expect(s.order.indexOf('replaceState')).toBeGreaterThanOrEqual(0);
    expect(s.order.indexOf('replaceState')).toBeLessThan(s.order.indexOf('google.connect'));
    expect(s.sent.find((call) => call.name === 'google.connect')?.input).toEqual({ code: '4/0AbC', state: 'signed.state' });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/settings');
  });

  it('shows the done line with the number of meetings, then the state ok, and calls google.connect once even when the section renders again', async () => {
    const s = setup();
    comeBackWith('#google=finish&code=abc&state=signed.state');
    await open(s);
    const section = await sectionOf();
    expect(await within(section).findByText('Connected. 3 meetings are on their way to Google.')).toBeInTheDocument();
    // The note and the new status rendered the section again: the step ran once.
    expect(s.sent.filter((call) => call.name === 'google.connect')).toHaveLength(1);
    expect(within(section).queryByRole('alert')).toBeNull();
    // The status was read again: it says connected, so the section has the quiet Disconnect and no Connect button.
    expect(await within(section).findByRole('button', { name: words('en').disconnect })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: words('en').connect })).toBeNull();
    expect(s.sent.filter((call) => call.name === 'google.connect')).toHaveLength(1);
  });

  it('says plain Connected when no meeting is on its way', async () => {
    const s = setup({}, { connect: () => ({ state: 'ok', meetings: 0 }) });
    comeBackWith('#google=finish&code=abc&state=signed.state');
    await open(s);
    const section = await sectionOf();
    expect(await within(section).findByText(words('en').connected)).toBeInTheDocument();
    expect(within(section).queryByText(/on their way/)).toBeNull();
  });

  it('shows the word of denied, failed, old and not_ready, and keeps the Connect button', async () => {
    const cases: [string, string][] = [
      ['denied', words('en').denied], ['failed', words('en').failed], ['old', pick(en, 'errors.reasons.google_link_old')], ['not_ready', words('en').notReady],
    ];
    for (const [word, text] of cases) {
      cleanup();
      const s = setup();
      comeBackWith(`#google=${word}`);
      await open(s);
      const section = await sectionOf();
      await waitFor(() => expect(within(section).getAllByText(text).length).toBeGreaterThan(0));
      expect(window.location.hash, word).toBe('');
      expect(s.sent.some((call) => call.name === 'google.connect'), word).toBe(false);
      expect(await within(section).findByRole('button', { name: words('en').connect }), word).toBeInTheDocument();
    }
  });

  it('shows failed for a finish word with no code or state, and for a word it does not know', async () => {
    for (const fragment of ['#google=finish', '#google=finish&code=abc', '#google=surprise']) {
      cleanup();
      const s = setup();
      comeBackWith(fragment);
      await open(s);
      expect(await screen.findByText(words('en').failed), fragment).toBeInTheDocument();
      expect(s.sent.some((call) => call.name === 'google.connect'), fragment).toBe(false);
    }
  });

  it('shows the words of the reason when google.connect is refused, with no toast, and keeps the Connect button', async () => {
    const s = setup({}, { connect: () => Promise.reject(new ApiError('forbidden', 'Another sign-in.', { reason: 'google_link_person' })) });
    comeBackWith('#google=finish&code=abc&state=signed.state');
    await open(s);
    const section = await sectionOf();
    expect(await within(section).findByRole('alert')).toHaveTextContent(pick(en, 'errors.reasons.google_link_person'));
    expect(within(section).getByRole('button', { name: words('en').connect })).toBeEnabled();
  });

  it('does nothing when the address has no google word', async () => {
    const s = setup();
    comeBackWith('#something-else');
    await open(s);
    await sectionOf();
    expect(s.sent.some((call) => call.name === 'google.connect')).toBe(false);
    expect(window.location.hash).toBe('#something-else');
  });
});

describe('Disconnect', () => {
  it('asks first: Keep has the focus and Disconnect sits at the start side; Keep closes the question and calls nothing', async () => {
    const s = setup({ state: 'ok', connectedAt: '2026-10-21T09:00:00.000+03:00' });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: words('en').disconnect }));
    const sheet = await screen.findByRole('dialog', { name: words('en').disconnectTitle });
    expect(within(sheet).getByText(words('en').disconnectBody)).toBeInTheDocument();
    const keep = within(sheet).getByRole('button', { name: words('en').keep });
    await waitFor(() => expect(keep).toHaveFocus());
    const buttons = within(sheet).getAllByRole('button').filter((button) => [words('en').disconnect, words('en').keep].includes(button.textContent ?? ''));
    expect(buttons.map((button) => button.textContent)).toEqual([words('en').disconnect, words('en').keep]);
    expect(buttons[0].className).toContain('me-auto');
    await userEvent.click(keep);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: words('en').disconnectTitle })).toBeNull());
    expect(s.sent.some((call) => call.name === 'google.disconnect')).toBe(false);
  });

  it('disconnects after the question, shows the toast, and reads the state again: the Connect button comes back', async () => {
    const s = setup({ state: 'ok', connectedAt: '2026-10-21T09:00:00.000+03:00' });
    await open(s);
    await userEvent.click(await screen.findByRole('button', { name: words('en').disconnect }));
    const sheet = await screen.findByRole('dialog', { name: words('en').disconnectTitle });
    await userEvent.click(within(sheet).getByText(words('en').disconnect, { selector: 'button' }));
    await waitFor(() => expect(s.sent.filter((call) => call.name === 'google.disconnect')).toHaveLength(1));
    expect(await screen.findByText(words('en').disconnected)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: words('en').connect })).toBeInTheDocument();
  });
});

describe('the Arabic screen', () => {
  it('shows the Arabic words of the none state and of the Disconnect question', async () => {
    await open(setup(), 'ar');
    const section = await sectionOf('ar');
    expect(await within(section).findByText(words('ar').intro)).toBeInTheDocument();
    expect(within(section).getByText(words('ar').onlyThree)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: words('ar').connect })).toBeInTheDocument();
    cleanup();
    await open(setup({ state: 'ok', connectedAt: '2026-10-21T09:00:00.000+03:00' }), 'ar');
    expect(await screen.findByText(words('ar').connected)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: words('ar').disconnect }));
    expect(await screen.findByRole('dialog', { name: words('ar').disconnectTitle })).toBeInTheDocument();
  });

  it('shows the Arabic done line with the right plural form', async () => {
    for (const [meetings, text] of [[1, 'تم الربط. اجتماع واحد في الطريق إلى Google.'], [2, 'تم الربط. اجتماعان في الطريق إلى Google.'], [5, 'تم الربط. 5 اجتماعات في الطريق إلى Google.'], [12, 'تم الربط. 12 اجتماعًا في الطريق إلى Google.']] as const) {
      cleanup();
      comeBackWith('#google=finish&code=abc&state=signed.state');
      await open(setup({}, { connect: () => ({ state: 'ok', meetings }) }), 'ar');
      expect(await screen.findByText(text), String(meetings)).toBeInTheDocument();
    }
  });
});

describe('What\'s new (fbk_022)', () => {
  it('has the entry 2026-10-23-25 at the top, with the Settings link, and its words in both languages', () => {
    expect(WHATS_NEW[0]).toEqual({ id: '2026-10-23-25', day: '2026-10-23', to: '/settings' });
    expect(pick(en, 'whatsNew.items.2026-10-23-25.title')).toBe('Your meetings in Google Calendar');
    expect(pick(en, 'whatsNew.items.2026-10-23-25.body')).toBe(
      'Connect Google Calendar once in Settings. Madar then puts each of your meetings there and keeps it up to date. Google gets only the title, the time and the place.',
    );
    expect(pick(ar, 'whatsNew.items.2026-10-23-25.title')).toBe('اجتماعاتك في تقويم Google');
  });
});
