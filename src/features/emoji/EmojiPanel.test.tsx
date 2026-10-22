import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { applyLanguage, initI18n } from '../../i18n';
import { DEFAULT_RECENT, RECENT_KEY, TONE_KEY } from './recent';
import { EmojiButton, type EmojiButtonHandle } from './EmojiButton';
import { EmojiPanel } from './EmojiPanel';

/** The emoji panel and its button (chat presence design D, track emoji E2). */
function useLanguage(language: 'en' | 'ar') {
  initI18n(language);
  applyLanguage(document.documentElement, language);
}

afterEach(() => {
  initI18n('en');
  vi.unstubAllGlobals();
});

const recentGroup = () => screen.getByRole('group', { name: /^(Recent|استخدمتها مؤخرًا)$/ });
const texts = (buttons: HTMLElement[]) => buttons.map((button) => button.textContent);

function panel(onPick = vi.fn()) {
  render(<EmojiPanel onPick={onPick} layout="panel" />);
  return onPick;
}

describe('the emoji panel', () => {
  it('shows the recent row first, with the defaults on a new device', () => {
    useLanguage('en');
    panel();
    const groups = screen.getAllByRole('group');
    expect(groups[0]).toBe(recentGroup());
    expect(texts(within(recentGroup()).getAllByRole('button'))).toEqual(DEFAULT_RECENT);
    expect(within(recentGroup()).getByRole('button', { name: 'red heart' })).toBeInTheDocument();
  });

  it('has the 8 group buttons, with the names of the groups', async () => {
    useLanguage('en');
    panel();
    const bar = screen.getByRole('toolbar', { name: 'Groups of emoji' });
    expect(within(bar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Smileys and people', 'Animals and nature', 'Food and drink', 'Activities', 'Travel and places', 'Objects', 'Symbols', 'Flags',
    ]);
    // The last group draws at the idle step (RN-8): this pin waited for it at once before.
    expect(await screen.findByRole('group', { name: 'Flags' })).toBeInTheDocument();
  });

  it('finds ❤️ for heart and for قلب', async () => {
    useLanguage('en');
    panel();
    const field = screen.getByRole('searchbox', { name: 'Search emoji' });
    await userEvent.type(field, 'heart');
    expect(texts(screen.getAllByRole('button', { name: /heart/ }))).toContain('❤️');
    await userEvent.clear(field);
    await userEvent.type(field, 'قلب');
    expect(texts(screen.getAllByRole('button'))).toContain('❤️');
    // The groups and Recent make way for the results.
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('says No emoji has this name.', async () => {
    useLanguage('en');
    panel();
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText('No emoji has this name.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-emoji]')).toHaveLength(0);
  });

  it('a pick calls onPick and puts the emoji first in Recent', async () => {
    useLanguage('en');
    const onPick = panel();
    await userEvent.click(within(screen.getByRole('group', { name: 'Smileys and people' })).getByRole('button', { name: 'grinning face' }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith('😀');
    expect(texts(within(recentGroup()).getAllByRole('button')).slice(0, 3)).toEqual(['😀', '👍', '🙏']);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)[0]).toBe('😀');
    // The same emoji again does not repeat it.
    await userEvent.click(within(recentGroup()).getByRole('button', { name: 'grinning face' }));
    expect(texts(within(recentGroup()).getAllByRole('button')).filter((emoji) => emoji === '😀')).toHaveLength(1);
  });

  it('keeps at most 16 recent emoji', async () => {
    useLanguage('en');
    panel();
    const cells = within(screen.getByRole('group', { name: 'Smileys and people' })).getAllByRole('button').slice(0, 20);
    for (const cell of cells) await userEvent.click(cell);
    expect(within(recentGroup()).getAllByRole('button')).toHaveLength(16);
  });

  it('the tone changes 👋 to 👋🏽 and is kept on the device', async () => {
    useLanguage('en');
    const onPick = panel();
    await userEvent.click(screen.getByRole('button', { name: 'Skin tone' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Medium' }));
    // The choice closes the row of tones, and the device keeps it.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(localStorage.getItem(TONE_KEY)).toBe('3');
    await userEvent.click(screen.getByRole('button', { name: 'Skin tone' }));
    expect(screen.getByRole('radio', { name: 'Medium' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Skin tone' }));
    const hand = within(screen.getByRole('group', { name: 'Smileys and people' })).getByRole('button', { name: 'waving hand' });
    expect(hand.textContent).toBe('👋🏽');
    await userEvent.click(hand);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('👋🏽');
    // An emoji with no tones stays as it is.
    expect(within(screen.getByRole('group', { name: 'Smileys and people' })).getByRole('button', { name: 'grinning face' }).textContent).toBe('😀');
  });

  it('starts with the tone of the device', () => {
    useLanguage('en');
    localStorage.setItem(TONE_KEY, '5');
    panel();
    expect(within(screen.getByRole('group', { name: 'Smileys and people' })).getByRole('button', { name: 'waving hand' }).textContent).toBe('👋🏿');
  });

  it('works when the storage is blocked', async () => {
    useLanguage('en');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const onPick = panel();
    expect(texts(within(recentGroup()).getAllByRole('button'))).toEqual(DEFAULT_RECENT);
    await userEvent.click(within(recentGroup()).getAllByRole('button')[1]);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('🙏');
  });

  it('the arrow keys move in the grid, and Enter picks', async () => {
    useLanguage('en');
    const onPick = panel();
    const [first, second] = within(recentGroup()).getAllByRole('button');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(first).toHaveFocus();
    // The recent row has 8 cells, so one row down is the first cell of the first group.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('group')[1].querySelector('button')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledExactlyOnceWith('👍');
  });

  it('the arrow keys move right to left in Arabic', async () => {
    useLanguage('ar');
    panel();
    expect(screen.getByRole('searchbox', { name: 'ابحث عن إيموجي' })).toBeInTheDocument();
    const [first, second] = within(recentGroup()).getAllByRole('button');
    first.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(second).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
    // The names are Arabic.
    expect(within(recentGroup()).getByRole('button', { name: 'قلب أحمر' })).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'الأعلام' })).toBeInTheDocument();
  });

  it('finds ❤️ for احمر in the Arabic screen', async () => {
    useLanguage('ar');
    panel();
    await userEvent.type(screen.getByRole('searchbox'), 'أَحمر');
    expect(texts(screen.getAllByRole('button'))).toContain('❤️');
  });

  it('only one cell is in the tab order', () => {
    useLanguage('en');
    panel();
    const stops = document.querySelectorAll('[data-emoji][tabindex="0"]');
    expect(stops).toHaveLength(1);
  });
});

function Holder({ onPick, handle }: { onPick: (emoji: string) => void; handle?: { current: EmojiButtonHandle | null } }) {
  const ref = useRef<EmojiButtonHandle>(null);
  if (handle) handle.current = ref.current;
  return (
    <div>
      <EmojiButton onPick={onPick} ref={ref} />
      <button type="button" onClick={() => ref.current?.close()}>Close from outside</button>
      <button type="button">Elsewhere</button>
    </div>
  );
}

describe('the emoji button', () => {
  it('loads the panel on the first open, keeps it open after a pick, and puts the focus back on Esc', async () => {
    useLanguage('en');
    const onPick = vi.fn();
    render(<Holder onPick={onPick} />);
    const button = screen.getByRole('button', { name: 'Add an emoji' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Add an emoji' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    // The search field takes the focus once the panel is there.
    expect(await within(dialog).findByRole('searchbox')).toHaveFocus();
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'folded hands' })[0]);
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'thumbs up' })[0]);
    expect(onPick.mock.calls.map((call) => call[0])).toEqual(['🙏', '👍']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(button).toHaveFocus());
    // The second open needs no wait: the panel is there in the same moment.
    await userEvent.click(button);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('closes with a press outside, and with close() from the ref', async () => {
    useLanguage('en');
    render(<Holder onPick={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Add an emoji' });
    await userEvent.click(button);
    await screen.findByRole('searchbox');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(button);
    await screen.findByRole('searchbox');
    await userEvent.click(screen.getByRole('button', { name: 'Close from outside' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // A second press on the button also closes it.
    await userEvent.click(button);
    await screen.findByRole('searchbox');
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has the Arabic label and a sheet on a phone', async () => {
    useLanguage('ar');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width: 639px'), media: query, onchange: null,
      addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
    render(<Holder onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'أضف إيموجي' }));
    const sheet = await screen.findByRole('dialog', { name: 'أضف إيموجي' });
    expect(await within(sheet).findByRole('searchbox', { name: 'ابحث عن إيموجي' })).toBeInTheDocument();
    // The sheet stays open for a second pick.
    await userEvent.click(within(sheet).getAllByRole('button', { name: 'قلب أحمر' })[0]);
    expect(screen.getByRole('dialog', { name: 'أضف إيموجي' })).toBeInTheDocument();
  });
});
