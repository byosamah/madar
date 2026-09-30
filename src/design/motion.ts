import type { Transition } from 'motion/react';

/** Spring presets from spec 10.6. Motion follows "Reduce motion" through MotionConfig reducedMotion="user". */
export const spring = {
  standard: { type: 'spring', bounce: 0, duration: 0.35 },
  expand: { type: 'spring', bounce: 0, duration: 0.45 },
  flick: { type: 'spring', bounce: 0.15, duration: 0.4 },
  drop: { type: 'spring', bounce: 0.15, duration: 0.35 },
} satisfies Record<string, Transition>;

export const fade: Transition = { duration: 0.2, ease: 'easeOut' };
