import type { ReactNode } from "react";

/**
 * Horizontal, swipeable tab row on small screens. From `md` up it wraps like a
 * normal flex row so desktop layouts stay unchanged.
 */
export default function MobileTabBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-x-4 gap-y-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible ${className}`}
    >
      {children}
    </div>
  );
}
