import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../i18n';
import type { TypingSignal } from '../../api/remote/wire';
import { fakeLive } from '../../test/fakeLive';
import { renderWithRuntime } from '../../test/render';
import { TypingLine } from './TypingLine';

/** The typing line above the message box (chat presence design B2, F4). Reem is usr_003, Faisal usr_002, Sara usr_005. */
afterEach(() => {
  vi.useRealTimers();
});

const signal = (userId: string, typing = true, conversationId = 'cnv_001'): TypingSignal => ({ v: 1, conversationId, userId, typing, at: new Date().toISOString() });
const region = () => screen.getByTestId('typing-line');

async function setup(prepare?: () => void) {
  prepare?.();
  const live = fakeLive();
  await renderWithRuntime(<TypingLine conversationId="cnv_001" />, undefined, { live: live.port });
  // The names come from the office list, which loads after the first render.
  await waitFor(() => expect(live.log.watched.length).toBeGreaterThan(0));
  return live;
}

describe('the typing line', () => {
  it('names one, two, and several typists', async () => {
    const live = await setup();
    act(() => live.emitTyping(signal('usr_003')));
    expect(await screen.findByText('Reem is typing...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_002')));
    expect(await screen.findByText('Reem and Faisal are typing...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_005')));
    expect(await screen.findByText('Several people are typing...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_003', false)));
    act(() => live.emitTyping(signal('usr_002', false)));
    expect(await screen.findByText('Sara is typing...')).toBeInTheDocument();
  });

  it('names the typists in Arabic with the right forms', async () => {
    const live = await setup();
    await act(async () => { initI18n('ar'); });
    act(() => live.emitTyping(signal('usr_003')));
    expect(await screen.findByText('ريم تكتب...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_003', false)));
    act(() => live.emitTyping(signal('usr_002')));
    expect(await screen.findByText('فيصل يكتب...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_003')));
    expect(await screen.findByText('فيصل وريم يكتبان...')).toBeInTheDocument();
    act(() => live.emitTyping(signal('usr_005')));
    expect(await screen.findByText('عدة أشخاص يكتبون...')).toBeInTheDocument();
  });

  it('keeps its height when empty, and speaks politely', async () => {
    const live = await setup();
    expect(region()).toHaveClass('h-6');
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toHaveTextContent('');
    act(() => live.emitTyping(signal('usr_003')));
    await screen.findByText('Reem is typing...');
    expect(region()).toHaveClass('h-6');
  });

  it('shows the line for its own chat only, and never for the person on the screen', async () => {
    const live = await setup();
    act(() => live.emitTyping(signal('usr_003', true, 'cnv_002')));
    act(() => live.emitTyping(signal('usr_001')));
    await act(async () => undefined);
    expect(region()).toHaveTextContent('');
  });

  it('hides the line after 8 s with no signal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const live = await setup();
    act(() => live.emitTyping(signal('usr_003')));
    expect(await screen.findByText('Reem is typing...')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(7_000); });
    expect(screen.getByText('Reem is typing...')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect(screen.queryByText('Reem is typing...')).toBeNull();
    expect(region()).toHaveClass('h-6');
  });

  it('uses motion classes only behind motion-safe, so Reduce motion keeps the dots still', async () => {
    const live = await setup();
    act(() => live.emitTyping(signal('usr_003')));
    await screen.findByText('Reem is typing...');
    const dots = Array.from(region().querySelectorAll('[data-typing-dot]'));
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(dot).toHaveAttribute('aria-hidden', 'true');
      expect(dot).toHaveClass('motion-safe:animate-pulse');
      expect(dot.className).not.toMatch(/(^|\s)animate-/);
    }
  });
});
