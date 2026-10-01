// Madar's own icon in the lucide-animated pattern (2026-10-01): an empty tick box. On hover a faint tick draws in,
// so the box shows that one press ticks it.
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "./cx";

export interface CircleIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CircleIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const TICK_VARIANTS: Variants = {
  normal: { pathLength: 0, opacity: 0 },
  animate: { pathLength: [0, 1], opacity: 0.45, transition: { duration: 0.3, ease: "easeOut" } },
};

const CircleIcon = forwardRef<CircleIconHandle, CircleIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );
    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="10" />
          <motion.path
            animate={controls}
            d="m9 12 2 2 4-4"
            style={{ opacity: 0 }}
            variants={TICK_VARIANTS}
          />
        </svg>
      </div>
    );
  }
);

CircleIcon.displayName = "CircleIcon";

export { CircleIcon };
