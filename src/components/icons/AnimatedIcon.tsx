import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ForwardRefExoticComponent, type HTMLAttributes, type RefAttributes } from 'react';

/*
 * A rule for every file in `animated/`: each animated element sets `initial` to its rest variant ("normal" or "initial"), so
 * every animated value has a start value. With no start value, a re-render in the same moment as the first animation wrote
 * "undefined" into the icon, and the browser logged an error for each value (audit 2026-10-03, S-3 and V-31).
 */

/** The ref API that every file in `animated/` exposes. */
export type IconHandle = { startAnimation: () => void; stopAnimation: () => void };

/** The shape of every component in `animated/`. */
export type AnimatedIconComponent = ForwardRefExoticComponent<
  HTMLAttributes<HTMLDivElement> & { size?: number } & RefAttributes<IconHandle>
>;

/** The nearest control that holds the icon. The icon plays when this control is hovered or focused. */
const CONTROL = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], summary, label';

type Props = {
  icon: AnimatedIconComponent;
  size: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
  /** The icon plays once each time this turns true (for example the tab that becomes active). */
  playWhen?: boolean;
};

/**
 * An animated icon. It listens on the control that holds it (button or link), not on the tiny icon.
 * With reduced motion it never animates. An icon with no control around it listens on itself.
 */
export function AnimatedIcon({ icon: Icon, size, className, playWhen, ...aria }: Props) {
  const reduced = useReducedMotion() ?? false;
  const handle = useRef<IconHandle>(null);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = holder.current;
    if (!node || reduced) return;
    const target = node.closest<HTMLElement>(CONTROL) ?? node;
    const start = () => handle.current?.startAnimation();
    const stop = () => handle.current?.stopAnimation();
    target.addEventListener('mouseenter', start);
    target.addEventListener('mouseleave', stop);
    target.addEventListener('focusin', start);
    target.addEventListener('focusout', stop);
    return () => {
      target.removeEventListener('mouseenter', start);
      target.removeEventListener('mouseleave', stop);
      target.removeEventListener('focusin', start);
      target.removeEventListener('focusout', stop);
      handle.current?.stopAnimation();
    };
  }, [reduced]);

  useEffect(() => {
    if (!playWhen || reduced) return;
    handle.current?.stopAnimation();
    handle.current?.startAnimation();
  }, [playWhen, reduced]);

  return (
    <span ref={holder} data-animated-icon className={className} role={aria['aria-label'] ? 'img' : undefined} {...aria}>
      <Icon ref={handle} size={size} />
    </span>
  );
}
