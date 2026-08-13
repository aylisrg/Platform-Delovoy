import type { WebAppIconName } from "@/lib/webapp/icon-names";
import { ICON_PATHS } from "./icons";

interface IconProps {
  name: WebAppIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/** Единая точка рендера иконок (AC-7.3). Цвет — через currentColor. */
export function Icon({ name, size = 24, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
