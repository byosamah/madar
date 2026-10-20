import { motion } from 'motion/react';
import { useLang } from '../app/lang';
import { useSubCompany } from '../app/subCompanies';
import { spring } from '../design/motion';
import { decodeMark, formPath, markGlow, markOf } from '../lib/projectMark';
import { SubCompanyLogo } from './SubCompanyLogo';

/** The smallest badge of a sub-company, in pixels. */
const MIN_BADGE = 18;

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
  const lang = useLang();
  // The badge is 45% of the tile, and 18 px at least, so a mark still reads on a small tile (PRJ-11). Its center sits on the end
  // corner, so half of it stays outside the tile (fbk_007).
  const badge = Math.max(MIN_BADGE, Math.round(size * 0.45));
  // The tile loses a circle 2 px wider than the badge (tile-cut in tokens.css), so the surface under the tile shows around the badge.
  // A ring in one color showed as a dark or white edge on the other surfaces (owner, 2026-10-20).
  const cut = sub ? { '--cut': `${badge / 2 + 2}px` } : {};
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <motion.span
        layoutId={shared ? `tile-${id}` : undefined}
        transition={spring.expand}
        aria-hidden="true"
        data-project-mark={value}
        style={{ width: size, height: size, background: markGlow(id, value), ...cut }}
        className={`grid shrink-0 place-items-center rounded-[30%] ring-1 ring-inset ring-ink/10 ${sub ? 'tile-cut' : ''}`}
      >
        <MarkForm mark={value} className="size-[45%]" />
      </motion.span>
      {sub && (
        // A flex box, so its height is the logo, not a line of text: an inline box drew the old ring as a pill (owner, 2026-10-20).
        <span
          data-sub-company-badge
          title={lang === 'ar' ? sub.nameAr : sub.name}
          style={{ width: badge, height: badge, insetBlockEnd: -badge / 2, insetInlineEnd: -badge / 2 }}
          className="absolute flex rounded-full"
        >
          <SubCompanyLogo subCompanyId={sub.id} size={badge} />
        </span>
      )}
    </span>
  );
}
