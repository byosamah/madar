// Madar's own icon in the lucide-animated pattern (none exists there, 2026-10-01): lucide's Inbox tray. On hover the
// tray's inner edge dips and comes back, as if a message drops in.
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "./cx";

export interface InboxIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface InboxIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const WELL_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: [0, 2.5, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};

const TRAY_VARIANTS: Variants = {
  normal: { y: 0 },
  animate: { y: [0, 0.8, 0], transition: { duration: 0.5, ease: "easeInOut", delay: 0.08 } },
};

const InboxIcon = forwardRef<InboxIconHandle, InboxIconProps>(
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
          <motion.path
            animate={controls}
            d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
            variants={TRAY_VARIANTS}
          />
          <motion.polyline
            animate={controls}
            points="22 12 16 12 14 15 10 15 8 12 2 12"
            variants={WELL_VARIANTS}
          />
        </svg>
      </div>
    );
  }
);

InboxIcon.displayName = "InboxIcon";

export { InboxIcon };
