import { motion } from 'motion/react';
import { spring } from '../design/motion';
import { projectHue, projectInitials } from '../lib/projectColor';

/**
 * The project's color tile with two letters (redesign spec 2.4). Decorative: the project name sits next to it.
 * A shared tile carries the row into the project header and back (motion moment 1).
 */
export function ProjectTile({ id, name, size = 34, shared = false }: { id: string; name: string; size?: number; shared?: boolean }) {
  const hue = projectHue(id);
  return (
    <motion.span
      layoutId={shared ? `tile-${id}` : undefined}
      transition={spring.expand}
      aria-hidden="true"
      style={{ width: size, height: size, background: `var(--p-${hue}-bg)`, color: `var(--p-${hue}-fg)`, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className="grid shrink-0 place-items-center rounded-[30%] font-bold leading-none tracking-[-0.01em]"
    >
      {projectInitials(name)}
    </motion.span>
  );
}
