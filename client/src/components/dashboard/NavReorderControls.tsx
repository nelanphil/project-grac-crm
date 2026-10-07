"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  type LucideIcon,
} from "lucide-react";
import type { NavNudge, NavNudgeAvailability } from "@/lib/dashboard-nav";

const CONTROLS: {
  direction: NavNudge;
  label: (name: string) => string;
  icon: LucideIcon;
}[] = [
  { direction: "up", label: (name) => `Move ${name} up`, icon: ArrowUp },
  { direction: "down", label: (name) => `Move ${name} down`, icon: ArrowDown },
  {
    direction: "indent",
    label: (name) => `Nest ${name} under the item above`,
    icon: ArrowRight,
  },
  {
    direction: "outdent",
    label: (name) => `Move ${name} up a level`,
    icon: ArrowLeft,
  },
];

export default function NavReorderControls({
  label,
  availability,
  onNudge,
  tone,
  className,
}: {
  label: string;
  availability: NavNudgeAvailability;
  onNudge: (direction: NavNudge) => void;
  tone: "dark" | "light";
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-0.5 ${className ?? ""}`}
      data-nav-allow-click
      onPointerDown={(e) => e.stopPropagation()}
    >
      {CONTROLS.map(({ direction, label: ariaLabel, icon: Icon }) => {
        const enabled = availability[direction];
        const toneClass =
          tone === "dark"
            ? enabled
              ? "text-white/45 hover:bg-white/10 hover:text-white"
              : "text-white/20"
            : enabled
              ? "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              : "text-neutral-300";
        return (
          <button
            key={direction}
            type="button"
            aria-label={ariaLabel(label)}
            aria-disabled={!enabled}
            data-nav-allow-click
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!enabled) return;
              onNudge(direction);
            }}
            className={`rounded-md p-1 transition-colors ${toneClass}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
