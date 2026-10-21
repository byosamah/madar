import { describe, expect, it, vi } from 'vitest';
import type { TypingSignal } from '../../api/remote/wire';
import { SAMPLE_STATES, prototypeLive } from './prototypeLive';

type Message = { data: unknown };
type TestChannel = { postMessage(m: unknown): void; addEventListener(t: 'message', f: (e: Message) => void): void; close(): void; closed: boolean };

/** Two or more channels of one name in memory: a message goes to every channel but the sender, as BroadcastChannel does. */
function memoryChannels(count: number): TestChannel[] {
  const listeners: ((e: Message) => void)[][] = Array.from({ length: count }, () => []);
  return listeners.map((mine, index) => ({
    closed: false as boolean,
    postMessage(m: unknown) {
      listeners.forEach((others, other) => {
        if (other !== index) others.forEach((listener) => listener({ data: structuredClone(m) }));
      });
    },
    addEventListener(_type, f) {
      mine.push(f);
    },
    close() {
      this.closed = true;
    },
  }));
}

const signal = (userId: string, typing = true): TypingSignal => ({ v: 1, conversationId: 'cnv_1', userId, typing, at: '2026-10-21T08:00:00.000Z' });

describe('prototypeLive (chat presence design, the prototype)', () => {
  it('shows the sample states with no channel', () => {
    const live = prototypeLive({ me: () => 'usr_001', channel: null });
    expect(live.stateOf('usr_002')).toBe(SAMPLE_STATES.usr_002);
    expect(live.stateOf('usr_002')).toBe('online');
    expect(live.stateOf('usr_007')).toBe('away');
    expect(live.stateOf('usr_004')).toBe('offline');
    expect(live.stateOf('usr_nobody')).toBe('offline');
  });

  it('shows the own state of this tab for the person of this tab', () => {
    const live = prototypeLive({ me: () => 'usr_004', channel: null });
    const listener = vi.fn();
    live.subscribeStates(listener);
    live.setMine('away');
    expect(live.stateOf('usr_004')).toBe('away');
    expect(listener).toHaveBeenCalled();
    live.setMine('online');
    expect(live.stateOf('usr_004')).toBe('online');
  });

  it('shows the state of another tab and offline after its leave', () => {
    const [a, b] = memoryChannels(2);
    const one = prototypeLive({ me: () => 'usr_001', channel: a });
    const two = prototypeLive({ me: () => 'usr_004', channel: b });
    const listener = vi.fn();
    one.subscribeStates(listener);
    expect(one.stateOf('usr_004')).toBe('offline');
    two.setMine('online');
    expect(one.stateOf('usr_004')).toBe('online');
    expect(listener).toHaveBeenCalled();
    two.setMine('away');
    expect(one.stateOf('usr_004')).toBe('away');
    two.stop();
    expect(one.stateOf('usr_004')).toBe('offline');
  });

  it('answers a tab that opens later: the new tab sees the state of the old tab', () => {
    const [a, b] = memoryChannels(2);
    const old = prototypeLive({ me: () => 'usr_004', channel: a });
    old.setMine('online');
    const fresh = prototypeLive({ me: () => 'usr_001', channel: b });
    expect(fresh.stateOf('usr_004')).toBe('online');
  });

  it('takes a sample person with a tab from the tabs, not from the samples', () => {
    const [a, b] = memoryChannels(2);
    const one = prototypeLive({ me: () => 'usr_001', channel: a });
    const two = prototypeLive({ me: () => 'usr_002', channel: b });
    expect(one.stateOf('usr_002')).toBe('online');
    two.setMine('away');
    expect(one.stateOf('usr_002')).toBe('away');
    two.stop();
    // With no tab the sample state comes back.
    expect(one.stateOf('usr_002')).toBe('online');
  });

  it('joins two tabs of one person: online wins, then away, then offline', () => {
    const [a, b, c] = memoryChannels(3);
    const watcher = prototypeLive({ me: () => 'usr_001', channel: a });
    const phone = prototypeLive({ me: () => 'usr_004', channel: b });
    const desk = prototypeLive({ me: () => 'usr_004', channel: c });
    phone.setMine('away');
    desk.setMine('online');
    expect(watcher.stateOf('usr_004')).toBe('online');
    desk.setMine('away');
    expect(watcher.stateOf('usr_004')).toBe('away');
    phone.setMine('online');
    expect(watcher.stateOf('usr_004')).toBe('online');
    phone.stop();
    desk.stop();
    expect(watcher.stateOf('usr_004')).toBe('offline');
  });

  it('shows offline after a pagehide', () => {
    const [a, b] = memoryChannels(2);
    const one = prototypeLive({ me: () => 'usr_001', channel: a });
    const two = prototypeLive({ me: () => 'usr_004', channel: b });
    two.setMine('online');
    expect(one.stateOf('usr_004')).toBe('online');
    window.dispatchEvent(new Event('pagehide'));
    expect(one.stateOf('usr_004')).toBe('offline');
    two.stop();
  });

  it('hands a typing signal to the other tab, not back to the sender', () => {
    const [a, b] = memoryChannels(2);
    const sender = prototypeLive({ me: () => 'usr_002', channel: a });
    const reader = prototypeLive({ me: () => 'usr_003', channel: b });
    const heard: TypingSignal[][] = [[], []];
    sender.subscribeTyping((s) => heard[0].push(s));
    reader.subscribeTyping((s) => heard[1].push(s));
    sender.afterTypingCall?.(signal('usr_002'));
    expect(heard[1]).toEqual([signal('usr_002')]);
    expect(heard[0]).toEqual([]);
  });

  it('drops a signal of its own person, and a signal of a chat that the person may not see', () => {
    const [a, b, c] = memoryChannels(3);
    const sender = prototypeLive({ me: () => 'usr_002', channel: a });
    const twin = prototypeLive({ me: () => 'usr_002', channel: b });
    const outsider = prototypeLive({ me: () => 'usr_005', channel: c, accepts: (s) => s.conversationId !== 'cnv_hidden' });
    const heardTwin: TypingSignal[] = [];
    const heardOutsider: TypingSignal[] = [];
    twin.subscribeTyping((s) => heardTwin.push(s));
    outsider.subscribeTyping((s) => heardOutsider.push(s));
    sender.afterTypingCall?.({ ...signal('usr_002'), conversationId: 'cnv_hidden' });
    sender.afterTypingCall?.(signal('usr_002'));
    expect(heardTwin).toEqual([]);
    expect(heardOutsider.map((s) => s.conversationId)).toEqual(['cnv_1']);
  });

  it('ignores a message of a wrong shape', () => {
    const [a, b] = memoryChannels(2);
    const one = prototypeLive({ me: () => 'usr_001', channel: a });
    const heard: TypingSignal[] = [];
    one.subscribeTyping((s) => heard.push(s));
    for (const data of [null, 'x', { t: 'state' }, { t: 'state', tab: 't', userId: 'usr_004', state: 'busy' }, { t: 'typing', signal: { userId: 3 } }, { t: 'other' }]) {
      b.postMessage(data);
    }
    expect(one.stateOf('usr_004')).toBe('offline');
    expect(heard).toEqual([]);
  });

  it('previews as another person: the old person state goes and the new person takes it', () => {
    const [a, b] = memoryChannels(2);
    let me = 'usr_004';
    let tell: () => void = () => undefined;
    const preview = prototypeLive({ me: () => me, channel: a, subscribeMe: (listener) => { tell = listener; return () => undefined; } });
    const watcher = prototypeLive({ me: () => 'usr_001', channel: b });
    preview.setMine('online');
    expect(watcher.stateOf('usr_004')).toBe('online');
    expect(preview.stateOf('usr_004')).toBe('online');
    me = 'usr_005';
    tell();
    expect(watcher.stateOf('usr_004')).toBe('offline');
    expect(watcher.stateOf('usr_005')).toBe('online');
    expect(preview.stateOf('usr_004')).toBe('offline');
    expect(preview.stateOf('usr_005')).toBe('online');
  });

  it('works when the channel is missing (an artifact frame): only the own tab and the samples', () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error A frame with no BroadcastChannel.
    globalThis.BroadcastChannel = undefined;
    try {
      const live = prototypeLive({ me: () => 'usr_004' });
      live.setMine('online');
      expect(live.stateOf('usr_004')).toBe('online');
      expect(live.stateOf('usr_007')).toBe('away');
      live.stop();
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it('does nothing on watch and setResting, and stops cleanly', () => {
    const [a] = memoryChannels(1);
    const live = prototypeLive({ me: () => 'usr_004', channel: a });
    live.watch(['usr_002']);
    live.setResting(true);
    live.setMine('online');
    expect(live.stateOf('usr_004')).toBe('online');
    live.stop();
    expect(a.closed).toBe(true);
    live.setMine('away');
    expect(live.stateOf('usr_004')).toBe('online');
  });
});
