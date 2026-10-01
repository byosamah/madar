// Madar's own icon in the lucide-animated pattern (no ellipsis exists there, 2026-10-01): the three dots of lucide's
// Ellipsis hop one after another.
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "./cx";

export interface EllipsisIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface EllipsisIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const DOT_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: (i: number) => ({
    y: [0, -3, 0],
    transition: { duration: 0.42, delay: i * 0.09, ease: "easeInOut" },
  }),
};

const EllipsisIcon = forwardRef<EllipsisIconHandle, EllipsisIconProps>(
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
          {[5, 12, 19].map((cx, i) => (
            <motion.circle
              animate={controls}
              custom={i}
              cx={cx}
              cy={12}
              key={cx}
              r={1}
              variants={DOT_VARIANTS}
            />
          ))}
        </svg>
      </div>
    );
  }
);

EllipsisIcon.displayName = "EllipsisIcon";

export { EllipsisIcon };
