import type { ReactNode } from "react";

type FadeInSectionProps = {
  children?: ReactNode;
  delay?: number;
  className?: string;
};

/**
 * Reveal-on-load wrapper for marketing sections.
 *
 * Implemented as a pure-CSS animation (no client JS) so the content is ALWAYS
 * visible even if scripts are slow, blocked, or fail to hydrate. The previous
 * framer-motion version rendered `opacity: 0` in the SSR HTML and only revealed
 * content once `whileInView` fired client-side — on slow/flaky mobile Safari
 * that left ~40% of the homepage permanently blank ("сайт не открывается").
 *
 * The resting state is fully visible: the fade is a progressive enhancement,
 * and if CSS animations are unsupported or reduced-motion is requested the
 * content simply shows immediately.
 */
export function FadeInSection({
  children,
  delay = 0,
  className,
}: FadeInSectionProps) {
  return (
    <div
      className={className ? `fade-in-section ${className}` : "fade-in-section"}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
