"use client";

import { DynamicIcon, type IconName } from "lucide-react/dynamic";

type LucideIconByNameProps = {
  name: string;
  className?: string;
  size?: number;
};

/** Renders a Lucide icon by kebab-case name (catalog / CMS-driven). */
export default function LucideIconByName({
  name,
  className,
  size = 16,
}: LucideIconByNameProps) {
  if (!name) return null;

  return (
    <DynamicIcon
      name={name as IconName}
      className={className}
      size={size}
      fallback={() => (
        <span
          className={`inline-block rounded bg-neutral-200 ${className ?? ""}`}
          style={{ width: size, height: size }}
          aria-hidden
        />
      )}
    />
  );
}
