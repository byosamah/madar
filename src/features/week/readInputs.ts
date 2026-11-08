import { weekStartOf } from '../../lib/dates';

/**
 * The read of the own weekly answers (fbk_088): the Sunday that starts the week of the day. Home starts it under this key in its first
 * request (usePrefetchCall), and the card reads it under the same key, so the card asks the server for nothing more.
 */
export const weekMineInput = (today: string) => ({ week: weekStartOf(today) });
