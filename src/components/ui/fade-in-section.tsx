"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type FadeInSectionProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

/**
 * Wraps content with a fade-in + slight upward motion on scroll into view.
 * Respects prefers-reduced-motion — renders children as-is when reduced motion is on.
 */
export function FadeInSection({
  children,
  delay = 0,
  className,
}: FadeInSectionProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
