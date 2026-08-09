"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Home,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getVisibleNavSections,
  isNavChildActive,
  isNavItemActive,
  type NavItem,
} from "@/lib/dashboard-nav";
import { COMPANY } from "@/lib/constants";

const STORAGE_KEY = "grac.staffSidebarExpanded";

type TooltipState = {
  label: string;
  top: number;
  left: number;
} | null;

function NavLink({
  href,
  label,
  active,
  expanded,
  onShowTooltip,
  onHideTooltip,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  expanded: boolean;
  onShowTooltip: (label: string, el: HTMLElement) => void;
  onHideTooltip: () => void;
  children: ReactNode;
}) {
  const handleEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!expanded) onShowTooltip(label, e.currentTarget);
  };
  const handleFocus = (e: FocusEvent<HTMLAnchorElement>) => {
    if (!expanded) onShowTooltip(label, e.currentTarget);
  };

  return (
    <Link
      href={href}
      title={expanded ? undefined : label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={onHideTooltip}
      onFocus={handleFocus}
      onBlur={onHideTooltip}
      className={`flex h-11 items-center rounded-xl transition-colors ${
        expanded ? "w-full gap-3 px-3" : "w-11 justify-center"
      } ${
        active
          ? "bg-brand-orange text-white"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {children}
      </span>
      {expanded ? (
        <span className="truncate text-sm font-medium">{label}</span>
      ) : null}
    </Link>
  );
}

function StaffNavItem({
  item,
  pathname,
  sidebarExpanded,
  onShowTooltip,
  onHideTooltip,
}: {
  item: NavItem;
  pathname: string;
  sidebarExpanded: boolean;
  onShowTooltip: (label: string, el: HTMLElement) => void;
  onHideTooltip: () => void;
}) {
  const hasChildren = Boolean(item.children?.length);
  const childActive = Boolean(
    item.children?.some((child) => isNavChildActive(pathname, child.href)),
  );
  const parentActive = isNavItemActive(pathname, item.href, hasChildren);
  const Icon = item.icon;

  // Collapsed by default; open when a child route is active.
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [prevChildActive, setPrevChildActive] = useState(childActive);

  if (childActive !== prevChildActive) {
    setPrevChildActive(childActive);
    if (childActive) {
      setChildrenOpen(true);
    }
  }

  return (
    <div
      className={
        sidebarExpanded && hasChildren
          ? "flex w-full flex-col gap-0.5"
          : undefined
      }
    >
      <div
        className={
          sidebarExpanded && hasChildren
            ? "flex w-full items-center gap-0.5"
            : undefined
        }
      >
        <div className={sidebarExpanded && hasChildren ? "min-w-0 flex-1" : undefined}>
          <NavLink
            href={item.href}
            label={item.label}
            active={
              hasChildren
                ? parentActive || (!sidebarExpanded && childActive)
                : parentActive || childActive
            }
            expanded={sidebarExpanded}
            onShowTooltip={onShowTooltip}
            onHideTooltip={onHideTooltip}
          >
            <Icon className="h-5 w-5" />
          </NavLink>
        </div>
        {sidebarExpanded && hasChildren ? (
          <button
            type="button"
            aria-label={
              childrenOpen ? `Collapse ${item.label}` : `Expand ${item.label}`
            }
            aria-expanded={childrenOpen}
            onClick={() => setChildrenOpen((v) => !v)}
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${
                childrenOpen ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : null}
      </div>
      {sidebarExpanded && hasChildren && childrenOpen
        ? item.children!.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              aria-current={
                isNavChildActive(pathname, child.href) ? "page" : undefined
              }
              className={`ml-4 flex h-9 items-center rounded-lg px-3 text-sm transition-colors ${
                isNavChildActive(pathname, child.href)
                  ? "bg-brand-orange text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="truncate font-medium">{child.label}</span>
            </Link>
          ))
        : null}
    </div>
  );
}

export default function StaffIconSidebar() {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  const sections = getVisibleNavSections(role);
  const homeActive = pathname === "/dashboard";
  const settingsActive = pathname.startsWith("/dashboard/settings");

  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  useEffect(() => {
    try {
      // Read persisted preference post-mount to avoid SSR/localStorage mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore storage access errors
    }
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage access errors
      }
      return next;
    });
    setTooltip(null);
  }, []);

  const showTooltip = useCallback((label: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 12,
    });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  return (
    <aside
      className={`sticky top-0 z-40 flex h-screen shrink-0 flex-col bg-[var(--staff-shell)] py-3 text-white transition-[width] duration-200 ease-out ${
        expanded ? "w-56 items-stretch" : "w-[4.25rem] items-center"
      }`}
    >
      <Link
        href="/dashboard"
        className={`mb-4 flex h-11 items-center rounded-xl bg-brand-orange text-sm font-bold tracking-tight text-white shadow-sm ${
          expanded ? "mx-2 gap-3 px-3" : "w-11 justify-center"
        }`}
        title={expanded ? undefined : COMPANY.name}
        aria-label="Dashboard home"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {COMPANY.shortName.slice(0, 1)}
        </span>
        {expanded ? (
          <span className="truncate">{COMPANY.shortName}</span>
        ) : null}
      </Link>

      <nav
        className={`flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-2 ${
          expanded ? "items-stretch" : "items-center"
        }`}
      >
        <NavLink
          href="/dashboard"
          label="Home"
          active={homeActive}
          expanded={expanded}
          onShowTooltip={showTooltip}
          onHideTooltip={hideTooltip}
        >
          <Home className="h-5 w-5" />
        </NavLink>

        {sections.map((section) =>
          section.items.map((item) => (
            <StaffNavItem
              key={item.href}
              item={item}
              pathname={pathname}
              sidebarExpanded={expanded}
              onShowTooltip={showTooltip}
              onHideTooltip={hideTooltip}
            />
          )),
        )}
      </nav>

      <div
        className={`mt-auto flex flex-col gap-1 px-2 pb-2 ${
          expanded ? "items-stretch" : "items-center"
        }`}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className={`flex h-11 items-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white ${
            expanded ? "w-full gap-3 px-3" : "w-11 justify-center"
          }`}
        >
          {expanded ? (
            <PanelLeftClose className="h-5 w-5 shrink-0" />
          ) : (
            <PanelLeftOpen className="h-5 w-5 shrink-0" />
          )}
          {expanded ? (
            <span className="truncate text-sm font-medium">Collapse</span>
          ) : null}
        </button>

        <NavLink
          href="/dashboard/settings"
          label="Settings"
          active={settingsActive}
          expanded={expanded}
          onShowTooltip={showTooltip}
          onHideTooltip={hideTooltip}
        >
          <Settings className="h-5 w-5" />
        </NavLink>
      </div>

      {!expanded && tooltip ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-brand-dark px-2 py-1 text-xs font-medium text-white shadow-lg"
          style={{ top: tooltip.top, left: tooltip.left }}
        >
          {tooltip.label}
        </span>
      ) : null}
    </aside>
  );
}
