"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import {
  closestCorners,
  DndContext,
  PointerSensor,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuthStore } from "@/store/useAuthStore";
import {
  applyNavOrder,
  getVisibleNavSections,
  isNavItemActive,
  isNavSubtreeActive,
  MAX_NAV_DEPTH,
  moveNavItem,
  type NavItem,
} from "@/lib/dashboard-nav";
import { COMPANY } from "@/lib/constants";
import { updateNavOrder } from "@/lib/api";
import {
  NestPlaceholder,
  RootDropZone,
} from "@/components/dashboard/NavDropTargets";

/** Press and hold ~500ms (dnd-kit's own activation delay) starts both the wiggle and the drag. */
const LONG_PRESS_ACTIVATION = { delay: 500, tolerance: 8 };
/** Once already wiggling, a small move is enough to grab and drag immediately. */
const WIGGLING_ACTIVATION = { distance: 4 };

const STORAGE_KEY = "grac.staffSidebarExpanded";
const FLYOUT_HIDE_DELAY = 150;
const FLYOUT_GAP = 8;
const HIDDEN_SCROLLBAR =
  "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

type TooltipState = {
  label: string;
  top: number;
  left: number;
} | null;

type FlyoutState = {
  item: NavItem;
  top: number;
  left: number;
} | null;

type HoverTarget =
  | { kind: "tooltip"; label: string }
  | { kind: "flyout"; item: NavItem };

function NavLink({
  href,
  label,
  active,
  expanded,
  editMode,
  hasPopup,
  popupOpen,
  onShowHover,
  onHideHover,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  expanded: boolean;
  editMode?: boolean;
  hasPopup?: boolean;
  popupOpen?: boolean;
  onShowHover: (el: HTMLElement) => void;
  onHideHover: () => void;
  children: ReactNode;
}) {
  const handleEnter = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!expanded || hasPopup) onShowHover(e.currentTarget);
  };
  const handleFocus = (e: FocusEvent<HTMLAnchorElement>) => {
    if (!expanded || hasPopup) onShowHover(e.currentTarget);
  };
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Wiggling items are only for reordering; block navigation until "Done" is pressed.
    if (editMode) e.preventDefault();
  };

  return (
    <Link
      href={href}
      title={expanded || hasPopup ? undefined : label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? popupOpen : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={onHideHover}
      onFocus={handleFocus}
      onBlur={onHideHover}
      onClick={handleClick}
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

const navCollision: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCorners(args);
};

function ChildNavLink({
  href,
  label,
  Icon,
  active,
  editMode,
  depth,
  hasPopup,
  popupOpen,
  onShowHover,
  onHideHover,
}: {
  href: string;
  label: string;
  Icon?: NavItem["icon"];
  active: boolean;
  editMode: boolean;
  depth: number;
  hasPopup?: boolean;
  popupOpen?: boolean;
  onShowHover?: (el: HTMLElement) => void;
  onHideHover?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-haspopup={hasPopup ? "menu" : undefined}
      aria-expanded={hasPopup ? popupOpen : undefined}
      onMouseEnter={
        hasPopup && onShowHover
          ? (e) => onShowHover(e.currentTarget)
          : undefined
      }
      onMouseLeave={hasPopup ? onHideHover : undefined}
      onFocus={
        hasPopup && onShowHover
          ? (e) => onShowHover(e.currentTarget)
          : undefined
      }
      onBlur={hasPopup ? onHideHover : undefined}
      onClick={(e) => {
        if (editMode) e.preventDefault();
      }}
      className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
        depth >= 2 ? "ml-8" : "ml-4"
      } ${
        active
          ? "bg-brand-orange text-white"
          : "text-white/60 hover:bg-white/10 hover:text-white"
      }`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      <span className="truncate font-medium">{label}</span>
    </Link>
  );
}

function FlyoutChildLinks({
  items,
  pathname,
  depth,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  depth: number;
  onNavigate: () => void;
}) {
  return (
    <div
      className={
        depth > 0
          ? "ml-3 flex flex-col gap-0.5 border-l border-white/10 pl-1.5"
          : "flex flex-col gap-0.5"
      }
    >
      {items.map((child) => {
        const hasChildren = Boolean(child.children?.length);
        const descendantActive = isNavSubtreeActive(pathname, child);
        const active =
          isNavItemActive(pathname, child.href, hasChildren) || descendantActive;
        const Icon = child.icon;
        return (
          <div key={child.href} className="flex flex-col gap-0.5">
            <Link
              href={child.href}
              role="menuitem"
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
                active
                  ? "bg-brand-orange text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium">{child.label}</span>
            </Link>
            {hasChildren ? (
              <FlyoutChildLinks
                items={child.children ?? []}
                pathname={pathname}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function StaffNavItem({
  item,
  pathname,
  sidebarExpanded,
  editMode,
  openFlyoutHref,
  onShowHover,
  onHideHover,
  depth = 0,
}: {
  item: NavItem;
  pathname: string;
  sidebarExpanded: boolean;
  editMode: boolean;
  openFlyoutHref?: string;
  onShowHover: (el: HTMLElement, target: HoverTarget) => void;
  onHideHover: () => void;
  depth?: number;
}) {
  const flyoutOpen = openFlyoutHref === item.href;
  const hasChildren = Boolean(item.children?.length);
  const descendantActive = isNavSubtreeActive(pathname, item);
  const parentActive = isNavItemActive(pathname, item.href, hasChildren);
  const Icon = item.icon;
  const canNestInside = depth < MAX_NAV_DEPTH;
  const showChildList =
    editMode &&
    sidebarExpanded &&
    (hasChildren || canNestInside);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href });

  if (depth > 0) {
    return (
      <div className={showChildList ? "flex w-full flex-col gap-0.5" : undefined}>
        <div
          ref={setNodeRef}
          style={{
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.4 : 1,
          }}
          {...attributes}
          {...listeners}
          className={`nav-draggable ${editMode ? "nav-wiggle" : ""}`}
        >
          <ChildNavLink
            href={item.href}
            label={item.label}
            Icon={Icon}
            active={parentActive || descendantActive}
            editMode={editMode}
            depth={depth}
            hasPopup={hasChildren}
            popupOpen={flyoutOpen}
            onShowHover={
              hasChildren
                ? (el) => onShowHover(el, { kind: "flyout", item })
                : undefined
            }
            onHideHover={hasChildren ? onHideHover : undefined}
          />
        </div>
        {showChildList ? (
          <div className="flex flex-col gap-0.5">
            <SortableContext
              items={(item.children ?? []).map((child) => child.href)}
              strategy={verticalListSortingStrategy}
            >
              {(item.children ?? []).map((child) => (
                <StaffNavItem
                  key={child.href}
                  item={child}
                  pathname={pathname}
                  sidebarExpanded={sidebarExpanded}
                  editMode={editMode}
                  openFlyoutHref={openFlyoutHref}
                  onShowHover={onShowHover}
                  onHideHover={onHideHover}
                  depth={depth + 1}
                />
              ))}
            </SortableContext>
            <div className={depth >= 1 ? "ml-8" : "ml-4"}>
              <NestPlaceholder
                parentHref={item.href}
                editMode={editMode && canNestInside}
                className="rounded-lg border border-dashed border-white/25 px-3 py-2 text-[11px] font-medium text-white/40"
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={showChildList ? "flex w-full flex-col gap-0.5" : undefined}>
      <div
        ref={setNodeRef}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.4 : 1,
        }}
        {...attributes}
        {...listeners}
        className="nav-draggable"
      >
        <div className={editMode ? "nav-wiggle" : undefined}>
          <NavLink
            href={item.href}
            label={item.label}
            active={parentActive || descendantActive}
            expanded={sidebarExpanded}
            editMode={editMode}
            hasPopup={hasChildren}
            popupOpen={flyoutOpen}
            onShowHover={(el) =>
              onShowHover(
                el,
                hasChildren
                  ? { kind: "flyout", item }
                  : { kind: "tooltip", label: item.label },
              )
            }
            onHideHover={onHideHover}
          >
            <Icon className="h-5 w-5" />
          </NavLink>
        </div>
      </div>
      {showChildList ? (
        <div className="flex flex-col gap-0.5">
          <SortableContext
            items={(item.children ?? []).map((child) => child.href)}
            strategy={verticalListSortingStrategy}
          >
            {(item.children ?? []).map((child) => (
              <StaffNavItem
                key={child.href}
                item={child}
                pathname={pathname}
                sidebarExpanded={sidebarExpanded}
                editMode={editMode}
                openFlyoutHref={openFlyoutHref}
                onShowHover={onShowHover}
                onHideHover={onHideHover}
                depth={1}
              />
            ))}
          </SortableContext>
          <div className="ml-4">
            <NestPlaceholder
              parentHref={item.href}
              editMode={editMode}
              className="rounded-lg border border-dashed border-white/25 px-3 py-2 text-[11px] font-medium text-white/40"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function StaffIconSidebar() {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  const token = useAuthStore((s) => s.token);
  const navOrder = useAuthStore((s) => s.user?.uiPreferences?.navOrder);
  const setNavOrder = useAuthStore((s) => s.setNavOrder);
  const baseSections = useMemo(() => getVisibleNavSections(role), [role]);
  const items = useMemo(
    () => applyNavOrder(baseSections, navOrder),
    [baseSections, navOrder],
  );
  const settingsActive = pathname.startsWith("/dashboard/settings");

  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [flyout, setFlyout] = useState<FlyoutState>(null);
  const [homeMenu, setHomeMenu] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const hideHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: editMode
        ? WIGGLING_ACTIVATION
        : LONG_PRESS_ACTIVATION,
    }),
  );

  useEffect(() => {
    try {
      // Read persisted preference post-mount to avoid SSR/localStorage mismatch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpanded(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // ignore storage access errors
    }
  }, []);

  const clearHoverChrome = useCallback(() => {
    if (hideHoverTimer.current) {
      clearTimeout(hideHoverTimer.current);
      hideHoverTimer.current = null;
    }
    setTooltip(null);
    setFlyout(null);
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
    clearHoverChrome();
  }, [clearHoverChrome]);

  const cancelHideHover = useCallback(() => {
    if (hideHoverTimer.current) {
      clearTimeout(hideHoverTimer.current);
      hideHoverTimer.current = null;
    }
  }, []);

  const scheduleHideHover = useCallback(() => {
    cancelHideHover();
    hideHoverTimer.current = setTimeout(() => {
      setTooltip(null);
      setFlyout(null);
      hideHoverTimer.current = null;
    }, FLYOUT_HIDE_DELAY);
  }, [cancelHideHover]);

  const showHover = useCallback(
    (el: HTMLElement, target: HoverTarget) => {
      if (editMode) return;
      cancelHideHover();
      const rect = el.getBoundingClientRect();
      if (target.kind === "flyout") {
        setTooltip(null);
        setFlyout({
          item: target.item,
          top: rect.top,
          left: rect.right + FLYOUT_GAP,
        });
        return;
      }
      setFlyout(null);
      setTooltip({
        label: target.label,
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      });
    },
    [editMode, cancelHideHover],
  );

  const handleDragStart = useCallback(() => {
    clearHoverChrome();
    setEditMode(true);
    setExpanded(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore storage access errors
    }
  }, [clearHoverChrome]);

  const exitEditMode = useCallback(() => setEditMode(false), []);

  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!editMode) return;
    // Belt-and-suspenders: dnd-kit's own click-suppression after a drag can race with the
    // browser's click dispatch, so block every click inside the wiggling nav at capture time.
    const blockNavClicks = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-nav-allow-click]")) return;
      if (navRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", blockNavClicks, true);
    return () => document.removeEventListener("click", blockNavClicks, true);
  }, [editMode]);

  const persistNavOrder = useCallback(
    (next: { order: string[]; children: Record<string, string[]> }) => {
      setNavOrder(next);
      if (token) {
        updateNavOrder(token, next).catch((err) => {
          console.error("Failed to save nav order:", err);
        });
      }
    },
    [setNavOrder, token],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const next = moveNavItem(items, String(active.id), String(over.id));
      if (next) persistNavOrder(next);
    },
    [items, persistNavOrder],
  );

  useEffect(() => {
    return () => {
      if (hideHoverTimer.current) clearTimeout(hideHoverTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFlyout(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flyout]);

  useEffect(() => {
    if (!flyout || !flyoutRef.current) return;
    const rect = flyoutRef.current.getBoundingClientRect();
    const pad = 8;
    if (rect.bottom <= window.innerHeight - pad) return;
    const nextTop = Math.max(
      pad,
      flyout.top - (rect.bottom - (window.innerHeight - pad)),
    );
    if (nextTop !== flyout.top) {
      setFlyout((prev) => (prev ? { ...prev, top: nextTop } : null));
    }
  }, [flyout]);

  const handleHomeContextMenu = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      clearHoverChrome();
      setHomeMenu({ top: e.clientY, left: e.clientX });
    },
    [clearHoverChrome],
  );

  const closeHomeMenu = useCallback(() => setHomeMenu(null), []);

  return (
    <aside
      className={`sticky top-0 z-40 flex h-screen shrink-0 flex-col bg-[var(--staff-shell)] py-3 text-white transition-[width] duration-200 ease-out ${
        expanded ? "w-56 items-stretch" : "w-[4.25rem] items-center"
      }`}
    >
      <Link
        href="/dashboard"
        onContextMenu={handleHomeContextMenu}
        className={`mb-4 flex h-11 items-center rounded-xl bg-brand-orange text-sm font-bold tracking-tight text-black shadow-sm ${
          expanded ? "mx-2 justify-center px-3" : "w-11 justify-center"
        }`}
        title={expanded ? undefined : COMPANY.name}
        aria-label="Dashboard home"
      >
        {expanded ? (
          <span className="truncate text-xl font-extrabold tracking-widest">
            GMOF
          </span>
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            {COMPANY.shortName.slice(0, 1)}
          </span>
        )}
      </Link>

      <nav
        ref={navRef}
        className={`flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto overscroll-contain px-2 ${HIDDEN_SCROLLBAR} ${
          expanded ? "items-stretch" : "items-center"
        }`}
      >
        {editMode ? (
          <button
            type="button"
            onClick={exitEditMode}
            aria-label="Done editing nav order"
            data-nav-allow-click
            className={`mb-1 flex h-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange text-xs font-semibold text-white transition-colors hover:bg-brand-orange/90 ${
              expanded ? "w-full gap-1.5 px-3" : "w-11"
            }`}
          >
            <Check className="h-4 w-4 shrink-0" />
            {expanded ? "Done" : null}
          </button>
        ) : null}
        <DndContext
          sensors={sensors}
          collisionDetection={navCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <RootDropZone
            editMode={editMode}
            className="mb-1 rounded-lg border border-dashed border-white/25 px-3 py-2 text-center text-[11px] font-medium text-white/40"
          />
          <SortableContext
            items={items.map((item) => item.href)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((item) => (
              <StaffNavItem
                key={item.href}
                item={item}
                pathname={pathname}
                sidebarExpanded={expanded}
                editMode={editMode}
                openFlyoutHref={flyout?.item.href}
                onShowHover={showHover}
                onHideHover={scheduleHideHover}
              />
            ))}
          </SortableContext>
          <RootDropZone
            editMode={editMode}
            className="mt-1 rounded-lg border border-dashed border-white/25 px-3 py-2 text-center text-[11px] font-medium text-white/40"
          />
        </DndContext>
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
          onShowHover={(el) =>
            showHover(el, { kind: "tooltip", label: "Settings" })
          }
          onHideHover={scheduleHideHover}
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

      {flyout ? (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={`${flyout.item.label} pages`}
          className={`fixed z-50 min-w-[12rem] max-w-[16rem] max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[var(--staff-shell)] p-1.5 shadow-lg ${HIDDEN_SCROLLBAR}`}
          style={{ top: flyout.top, left: flyout.left }}
          onMouseEnter={cancelHideHover}
          onMouseLeave={scheduleHideHover}
        >
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white/40">
            {flyout.item.label}
          </p>
          <FlyoutChildLinks
            items={flyout.item.children ?? []}
            pathname={pathname}
            depth={0}
            onNavigate={clearHoverChrome}
          />
        </div>
      ) : null}

      {homeMenu ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={closeHomeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeHomeMenu();
            }}
          />
          <div
            className="fixed z-50 w-48 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 text-sm text-brand-dark shadow-lg"
            style={{ top: homeMenu.top, left: homeMenu.left }}
          >
            <Link
              href="/"
              className="block px-4 py-2.5 hover:bg-neutral-50"
              onClick={closeHomeMenu}
            >
              Visit main site
            </Link>
          </div>
        </>
      ) : null}
    </aside>
  );
}
