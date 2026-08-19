"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  isNavItemActive,
  isNavSubtreeActive,
  MAX_NAV_DEPTH,
  type NavItem,
} from "@/lib/dashboard-nav";
import { NestPlaceholder } from "@/components/dashboard/NavDropTargets";

type NavItemGroupProps = {
  item: NavItem;
  pathname: string;
  variant: "sidebar" | "mobile";
  onNavigate?: () => void;
  /** Enables long-press wiggle + drag reordering (staff-only surfaces). */
  editable?: boolean;
  editMode?: boolean;
  depth?: number;
};

export default function NavItemGroup({
  item,
  pathname,
  variant,
  onNavigate,
  editable = false,
  editMode = false,
  depth = 0,
}: NavItemGroupProps) {
  const { href, label, icon: Icon, children } = item;
  const hasChildren = Boolean(children && children.length > 0);
  const active = isNavItemActive(pathname, href, hasChildren);
  const descendantActive = isNavSubtreeActive(pathname, item);
  const canNestInside = depth < MAX_NAV_DEPTH;

  const [expanded, setExpanded] = useState(false);
  const [prevDescendantActive, setPrevDescendantActive] =
    useState(descendantActive);

  if (descendantActive !== prevDescendantActive) {
    setPrevDescendantActive(descendantActive);
    if (descendantActive) setExpanded(true);
  }

  const listOpen = editMode || expanded;
  const showChevron = hasChildren || (editable && editMode && canNestInside);
  const showChildList =
    (hasChildren || (editable && editMode && canNestInside)) && listOpen;

  const isSidebar = variant === "sidebar";

  const parentClass = isSidebar
    ? active
      ? "bg-brand-dark text-white"
      : descendantActive
        ? "bg-neutral-100 text-brand-dark"
        : "text-neutral-600 hover:bg-neutral-100"
    : active
      ? "bg-brand-orange text-white"
      : descendantActive
        ? "bg-white/15 text-white"
        : "text-white/90 hover:bg-white/10";

  const childIdleClass = isSidebar
    ? "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700"
    : "text-white/75 hover:bg-white/10 hover:text-white";

  const childActiveClass = isSidebar
    ? "bg-brand-dark text-white"
    : "bg-brand-orange text-white";

  const borderClass = isSidebar ? "border-neutral-200" : "border-white/15";
  const placeholderClass = isSidebar
    ? "rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-[11px] font-medium text-neutral-400"
    : "rounded-lg border border-dashed border-white/25 px-3 py-2 text-[11px] font-medium text-white/40";

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: href, disabled: !editable });

  const rowClass =
    depth === 0
      ? `flex min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${parentClass} ${
          isSidebar ? "" : "px-3"
        }`
      : `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? childActiveClass : childIdleClass
        }`;

  return (
    <div>
      <div
        ref={editable ? setNodeRef : undefined}
        style={
          editable
            ? {
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.4 : 1,
              }
            : undefined
        }
        {...(editable ? attributes : {})}
        {...(editable ? listeners : {})}
        className={editable ? "nav-draggable" : undefined}
      >
        <div className={editable && editMode ? "nav-wiggle" : undefined}>
          <div className="flex items-center gap-0.5">
            <Link
              href={href}
              onClick={(e) => {
                if (editable && editMode) {
                  e.preventDefault();
                  return;
                }
                onNavigate?.();
              }}
              className={rowClass}
            >
              <Icon
                className={`${depth === 0 ? "h-4 w-4" : "h-3.5 w-3.5"} shrink-0`}
              />
              <span className="truncate">{label}</span>
            </Link>
            {showChevron ? (
              <button
                type="button"
                aria-label={listOpen ? `Collapse ${label}` : `Expand ${label}`}
                aria-expanded={listOpen}
                onClick={() => {
                  if (!editMode) setExpanded((v) => !v);
                }}
                data-nav-allow-click
                className={`shrink-0 rounded-md p-2 transition-colors ${
                  isSidebar
                    ? "text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${
                    listOpen ? "rotate-90" : ""
                  }`}
                />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showChildList ? (
        <div
          className={`mt-1 ml-4 flex flex-col gap-0.5 border-l pl-2 ${borderClass}`}
        >
          {editable ? (
            <SortableContext
              items={(children ?? []).map((child) => child.href)}
              strategy={verticalListSortingStrategy}
            >
              {(children ?? []).map((child) => (
                <NavItemGroup
                  key={child.href}
                  item={child}
                  pathname={pathname}
                  variant={variant}
                  onNavigate={onNavigate}
                  editable
                  editMode={editMode}
                  depth={depth + 1}
                />
              ))}
            </SortableContext>
          ) : (
            (children ?? []).map((child) => (
              <NavItemGroup
                key={child.href}
                item={child}
                pathname={pathname}
                variant={variant}
                onNavigate={onNavigate}
                depth={depth + 1}
              />
            ))
          )}
          {editable && canNestInside ? (
            <NestPlaceholder
              parentHref={href}
              editMode={editMode}
              className={placeholderClass}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
