import { motion } from 'motion/react';
import { spring } from '../design/motion';
import { decodeMark, formPath, markGlow, markOf } from '../lib/projectMark';

/** The mark's drawing symbol in ink, turned about its center. It fills its box, so the caller sets the size. */
export function MarkForm({ mark, className = '' }: { mark: number; className?: string }) {
  const { form } = decodeMark(mark);
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={`block shrink-0 text-ink ${className}`}>
      <path d={formPath(form, 0, 0, 18)} transform={`rotate(${form.turn * 90} 9 9)`} fill="currentColor" fillOpacity={0.86} />
    </svg>
  );
}

/**
 * The project's picture (owner's choice "Glow forms", 2026-10-01): the Glow light of the people pictures in the
 * project's own color and a second color, with one drawing symbol in ink. Decorative: the project name sits next to it.
 * A shared tile carries the row into the project header and back (motion moment 1).
 */
export function ProjectTile({ id, mark, size = 34, shared = false }: { id: string; mark?: number; size?: number; shared?: boolean }) {
  const value = markOf({ id, mark });
  return (
    <motion.span
      layoutId={shared ? `tile-${id}` : undefined}
      transition={spring.expand}
      aria-hidden="true"
      data-project-mark={value}
      style={{ width: size, height: size, background: markGlow(id, value) }}
      className="grid shrink-0 place-items-center rounded-[30%] ring-1 ring-inset ring-ink/10"
    >
      <MarkForm mark={value} className="size-[45%]" />
    </motion.span>
  );
}
