/**
 * The inputs of the two reads of the Work list. The screen, the press on a tab and the Me hub send the same input, so they
 * fill the same cache key (a read and its prefetch must match).
 */

/** My open to-dos from all projects and the office. */
export const MINE_OPEN = { filter: 'mine', includeDone: false } as const;

/** The to-dos that wait for my review. */
export const REVIEW_FOR_ME = { filter: 'review_for_me' } as const;
