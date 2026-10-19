/**
 * The parts of the Inbox thread live in their own files (chat design 2026-10-19, base B7): the log in MessageLog.tsx, the bubble in
 * MessageBubble.tsx and the box in Composer.tsx. This file keeps the old import path for the panes and the tests.
 */
export { MessageLog, type EarlierControl } from './MessageLog';
export { MessageBubble, clockTime, type Bubble } from './MessageBubble';
export { Composer } from './Composer';
