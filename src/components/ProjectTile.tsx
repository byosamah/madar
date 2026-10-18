import { motion } from 'motion/react';
import { useSubCompany } from '../app/subCompanies';
import { spring } from '../design/motion';
import { decodeMark, formPath, markGlow, markOf } from '../lib/projectMark';
import { SubCompanyLogo } from './SubCompanyLogo';

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
export function ProjectTile({ id, mark, size = 34, shared = false, subCompanyId = null }: {
  id: string; mark?: number; size?: number; shared?: boolean; subCompanyId?: string | null;
}) {
  const value = markOf({ id, mark });
  const sub = useSubCompany(subCompanyId);
  // The badge is 45% of the tile. Its center sits on the end corner, so half of it stays outside the tile (fbk_007).
  const badge = Math.round(size * 0.45);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
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
      {sub && (
        <span
          data-sub-company-badge
          style={{ insetBlockEnd: -badge / 2, insetInlineEnd: -badge / 2, boxShadow: '0 0 0 2px var(--c-panel)' }}
          className="absolute rounded-full"
        >
          <SubCompanyLogo subCompanyId={sub.id} size={badge} />
        </span>
      )}
    </span>
  );
}
