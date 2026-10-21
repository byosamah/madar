import { describe, expect, it, vi } from 'vitest';
import type { DeviceState } from '../live/types';
import type { TypingSignal } from '../../api/remote/wire';
import { officeLive } from './officeLive';

const source = () => {
  const sent: DeviceState[] = [];
  return { sent, sendState: (state: DeviceState) => void sent.push(state) };
};
const typing = (o: Partial<TypingSignal> = {}): TypingSignal => ({ v: 1, conversationId: 'cnv_1', userId: 'usr_002', typing: true, at: '2026-10-21T08:00:00.000Z', ...o });

describe('officeLive: status and typing on the office socket (chat presence design, L4)', () => {
  it('sends the state of this device to the source, each time it is set', () => {
    const s = source();
    const live = officeLive(s, 'usr_001');
    live.setMine('online');
    live.setMine('away');
    expect(s.sent).toEqual(['online', 'away']);
  });

  it('shows everybody Offline before the first snapshot', () => {
    const live = officeLive(source(), 'usr_001');
    expect(live.stateOf('usr_002')).toBe('offline');
  });

  it('takes a snapshot and then each change', () => {
    const live = officeLive(source(), 'usr_001');
    const listener = vi.fn();
    live.subscribeStates(listener);
    live.presence({ v: 1, states: { usr_002: 'online', usr_003: 'away' } });
    expect(live.stateOf('usr_002')).toBe('online');
    expect(live.stateOf('usr_003')).toBe('away');
    expect(live.stateOf('usr_004')).toBe('offline');
    expect(listener).toHaveBeenCalledTimes(1);
    live.presence({ v: 1, userId: 'usr_003', state: 'online' });
    expect(live.stateOf('usr_003')).toBe('online');
    live.presence({ v: 1, userId: 'usr_002', state: 'offline' });
    expect(live.stateOf('usr_002')).toBe('offline');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('a new snapshot replaces the old one: a person who is not in it is Offline', () => {
    const live = officeLive(source(), 'usr_001');
    live.presence({ v: 1, states: { usr_002: 'online', usr_003: 'away' } });
    live.presence({ v: 1, states: { usr_003: 'online' } });
    expect(live.stateOf('usr_002')).toBe('offline');
    expect(live.stateOf('usr_003')).toBe('online');
  });

  it('does not tell a listener when a message leaves the state as it was', () => {
    const live = officeLive(source(), 'usr_001');
    live.presence({ v: 1, states: { usr_002: 'online' } });
    const listener = vi.fn();
    live.subscribeStates(listener);
    live.presence({ v: 1, userId: 'usr_002', state: 'online' });
    live.presence({ v: 1, userId: 'usr_009', state: 'offline' });
    live.presence({ v: 1, states: { usr_002: 'online' } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('shows the own state as the object tells it, so a second device of the person counts', () => {
    const live = officeLive(source(), 'usr_001');
    live.setMine('away');
    expect(live.stateOf('usr_001')).toBe('offline');
    live.presence({ v: 1, userId: 'usr_001', state: 'online' });
    expect(live.stateOf('usr_001')).toBe('online');
  });

  it('shows everybody Offline again after reset (the socket dropped, so the marks may be old)', () => {
    const live = officeLive(source(), 'usr_001');
    const listener = vi.fn();
    live.presence({ v: 1, states: { usr_002: 'online' } });
    live.subscribeStates(listener);
    live.reset();
    expect(live.stateOf('usr_002')).toBe('offline');
    expect(listener).toHaveBeenCalledTimes(1);
    live.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the list and ignores the rest: the object sends every state, and a rest has no quota to save', () => {
    const s = source();
    const live = officeLive(s, 'usr_001');
    live.watch(['usr_002']);
    live.setResting(true);
    live.setResting(false);
    expect(s.sent).toEqual([]);
    live.presence({ v: 1, states: { usr_003: 'online' } });
    expect(live.stateOf('usr_003')).toBe('online');
  });

  it('passes typing and drops its own', () => {
    const live = officeLive(source(), 'usr_001');
    const heard: TypingSignal[] = [];
    const stop = live.subscribeTyping((signal) => heard.push(signal));
    live.typing(typing());
    live.typing(typing({ userId: 'usr_001' }));
    live.typing(typing({ typing: false }));
    expect(heard).toEqual([typing(), typing({ typing: false })]);
    stop();
    live.typing(typing());
    expect(heard).toHaveLength(2);
  });

  it('stops: it forgets the states and sends nothing more', () => {
    const s = source();
    const live = officeLive(s, 'usr_001');
    live.presence({ v: 1, states: { usr_002: 'online' } });
    live.stop();
    expect(live.stateOf('usr_002')).toBe('offline');
    live.setMine('online');
    live.presence({ v: 1, userId: 'usr_002', state: 'online' });
    expect(live.stateOf('usr_002')).toBe('offline');
    expect(s.sent).toEqual([]);
  });
});
