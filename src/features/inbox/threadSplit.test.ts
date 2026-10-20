import { describe, expect, it } from 'vitest';
import * as Thread from './Thread';
import { MessageLog, useDayLabel } from './MessageLog';
import { MessageBubble, clockTime } from './MessageBubble';
import { Composer } from './Composer';

// Base B7 (chat design 2026-10-19): Thread.tsx splits into the log, the bubble and the box with no change of behaviour. The old
// import path keeps working, so the panes and the date tests change nothing.
describe('the split of Thread.tsx', () => {
  it('keeps every export of Thread.tsx as the same part of the new files', () => {
    expect(Thread.MessageLog).toBe(MessageLog);
    expect(Thread.MessageBubble).toBe(MessageBubble);
    expect(Thread.Composer).toBe(Composer);
    expect(Thread.clockTime).toBe(clockTime);
    expect(typeof useDayLabel).toBe('function');
  });

  it('keeps the old exports and adds nothing else to Thread.tsx', () => {
    expect(Object.keys(Thread).sort()).toEqual(['Composer', 'MessageBubble', 'MessageLog', 'clockTime']);
  });
});
