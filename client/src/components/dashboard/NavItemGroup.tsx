"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  isNavChildActive,
  isNavItemActive,
  type NavItem,
} from "@/lib/dashboard-nav";

type NavItemGroupProps = {
  item: NavItem;
  pathname: string;
  variant: "sidebar" | "mobile";
  onNavigate?: () => void;
};

export default function NavItemGroup({
  item,
  pathname,
  variant,
  onNavigate,
}: NavItemGroupProps) {
  const { href, label, icon: Icon, children } = item;
  const hasChildren = Boolean(children && children.length > 0);
  const active = isNavItemActive(pathname, href, hasChildren);
  const childActive = hasChildren
    ? children!.some((c) => isNavChildActive(pathname, c.href))
    : false;

  // Collapsed by default; open when a child route is active.
  const [expanded, setExpanded] = useState(false);
  const [prevChildActive, setPrevChildActive] = useState(childActive);

  if (childActive !== prevChildActive) {
    setPrevChildActive(childActive);
    if (childActive) {
      setExpanded(true);
    }
  }

  const isSidebar = variant === "sidebar";

  const parentClass = isSidebar
    ? active
      ? "bg-brand-dark text-white"
      : childActive
        ? "bg-neutral-100 text-brand-dark"
        : "text-neutral-600 hover:bg-neutral-100"
    : active
      ? "bg-brand-orange text-white"
      : childActive
        ? "bg-white/15 text-white"
        : "text-white/90 hover:bg-white/10";

  const childIdleClass = isSidebar
    ? "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
    : "text-white/75 hover:bg-white/10 hover:text-white";

  const childActiveClass = isSidebar
    ? "bg-brand-dark text-white"
    : "bg-brand-orange text-white";

  const borderClass = isSidebar ? "border-neutral-200" : "border-white/15";

  return (
    <div>
      <div className="flex items-center gap-0.5">
        <Link
          href={href}
          onClick={onNavigate}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${parentClass} ${
            isSidebar ? "" : "px-3"
          }`}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className={`shrink-0 rounded-md p-2 transition-colors ${
              isSidebar
                ? "text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${
                expanded ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : null}
      </div>

      {hasChildren && expanded ? (
        <div
          className={`mt-1 ml-4 flex flex-col gap-0.5 border-l pl-2 ${borderClass}`}
        >
          {children!.map((child) => {
            const ChildIcon = child.icon;
            const childIsActive = isNavChildActive(pathname, child.href);
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  childIsActive ? childActiveClass : childIdleClass
                }`}
              >
                {ChildIcon ? (
                  <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                ) : null}
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
