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
  isNavChildActive,
  isNavItemActive,
  type NavItem,
} from "@/lib/dashboard-nav";

type NavItemGroupProps = {
  item: NavItem;
  pathname: string;
  variant: "sidebar" | "mobile";
  onNavigate?: () => void;
  /** Enables long-press wiggle + drag reordering (staff-only surfaces). */
  editable?: boolean;
  editMode?: boolean;
};

function SortableChildLink({
  href,
  label,
  Icon,
  active,
  activeClass,
  idleClass,
  editMode,
}: {
  href: string;
  label: string;
  Icon?: NavItem["icon"];
  active: boolean;
  activeClass: string;
  idleClass: string;
  editMode: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: href });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
      className={editMode ? "nav-draggable nav-wiggle" : "nav-draggable"}
    >
      <Link
        href={href}
        onClick={(e) => {
          if (editMode) e.preventDefault();
        }}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? activeClass : idleClass
        }`}
      >
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
        {label}
      </Link>
    </div>
  );
}

export default function NavItemGroup({
  item,
  pathname,
  variant,
  onNavigate,
  editable = false,
  editMode = false,
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

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: href, disabled: !editable });

  return (
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
              // Wiggling items are only for reordering; block navigation until "Done" is pressed.
              if (editable && editMode) {
                e.preventDefault();
                return;
              }
              onNavigate?.();
            }}
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
              data-nav-allow-click
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
      </div>

      {hasChildren && expanded ? (
        <div
          className={`mt-1 ml-4 flex flex-col gap-0.5 border-l pl-2 ${borderClass}`}
        >
          {editable ? (
            <SortableContext
              items={children!.map((child) => child.href)}
              strategy={verticalListSortingStrategy}
            >
              {children!.map((child) => (
                <SortableChildLink
                  key={child.href}
                  href={child.href}
                  label={child.label}
                  Icon={child.icon}
                  active={isNavChildActive(pathname, child.href)}
                  activeClass={childActiveClass}
                  idleClass={childIdleClass}
                  editMode={editMode}
                />
              ))}
            </SortableContext>
          ) : (
            children!.map((child) => {
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
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
