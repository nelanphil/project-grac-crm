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
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuthStore } from "@/store/useAuthStore";
import {
  applyNavOrder,
  getVisibleNavSections,
  isNavChildActive,
  isNavItemActive,
  type NavItem,
} from "@/lib/dashboard-nav";
import { COMPANY } from "@/lib/constants";
import { updateNavOrder } from "@/lib/api";

/** Press and hold ~500ms (dnd-kit's own activation delay) starts both the wiggle and the drag. */
const LONG_PRESS_ACTIVATION = { delay: 500, tolerance: 8 };
/** Once already wiggling, a small move is enough to grab and drag immediately. */
const WIGGLING_ACTIVATION = { distance: 4 };

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
  editMode,
  onShowTooltip,
  onHideTooltip,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  expanded: boolean;
  editMode?: boolean;
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
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Wiggling items are only for reordering; block navigation until "Done" is pressed.
    if (editMode) e.preventDefault();
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

function SortableChild({
  href,
  label,
  active,
  editMode,
}: {
  href: string;
  label: string;
  active: boolean;
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
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          if (editMode) e.preventDefault();
        }}
        className={`ml-4 flex h-9 items-center rounded-lg px-3 text-sm transition-colors ${
          active
            ? "bg-brand-orange text-white"
            : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className="truncate font-medium">{label}</span>
      </Link>
    </div>
  );
}

function StaffNavItem({
  item,
  pathname,
  sidebarExpanded,
  editMode,
  onShowTooltip,
  onHideTooltip,
}: {
  item: NavItem;
  pathname: string;
  sidebarExpanded: boolean;
  editMode: boolean;
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

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.href });

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
      className={`nav-draggable ${sidebarExpanded && hasChildren ? "flex w-full flex-col gap-0.5" : ""}`}
    >
      <div className={editMode ? "nav-wiggle" : undefined}>
        <div
          className={
            sidebarExpanded && hasChildren
              ? "flex w-full items-center gap-0.5"
              : undefined
          }
        >
          <div
            className={
              sidebarExpanded && hasChildren ? "min-w-0 flex-1" : undefined
            }
          >
            <NavLink
              href={item.href}
              label={item.label}
              active={
                hasChildren
                  ? parentActive || (!sidebarExpanded && childActive)
                  : parentActive || childActive
              }
              expanded={sidebarExpanded}
              editMode={editMode}
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
              data-nav-allow-click
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
      </div>
      {sidebarExpanded && hasChildren && childrenOpen ? (
        <SortableContext
          items={item.children!.map((child) => child.href)}
          strategy={verticalListSortingStrategy}
        >
          {item.children!.map((child) => (
            <SortableChild
              key={child.href}
              href={child.href}
              label={child.label}
              active={isNavChildActive(pathname, child.href)}
              editMode={editMode}
            />
          ))}
        </SortableContext>
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
  const [homeMenu, setHomeMenu] = useState<{
    top: number;
    left: number;
  } | null>(null);

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

  const showTooltip = useCallback(
    (label: string, el: HTMLElement) => {
      if (editMode) return;
      const rect = el.getBoundingClientRect();
      setTooltip({
        label,
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      });
    },
    [editMode],
  );

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDragStart = useCallback(() => {
    setTooltip(null);
    setEditMode(true);
  }, []);

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
      const activeId = String(active.id);
      const overId = String(over.id);
      const current = navOrder ?? { order: [], children: {} };

      const hrefs = items.map((i) => i.href);
      if (hrefs.includes(activeId) && hrefs.includes(overId)) {
        const newHrefs = arrayMove(
          hrefs,
          hrefs.indexOf(activeId),
          hrefs.indexOf(overId),
        );
        persistNavOrder({ ...current, order: newHrefs });
        return;
      }

      for (const item of items) {
        const childHrefs = item.children?.map((c) => c.href) ?? [];
        if (childHrefs.includes(activeId) && childHrefs.includes(overId)) {
          const newHrefs = arrayMove(
            childHrefs,
            childHrefs.indexOf(activeId),
            childHrefs.indexOf(overId),
          );
          persistNavOrder({
            ...current,
            children: { ...current.children, [item.href]: newHrefs },
          });
          return;
        }
      }
    },
    [navOrder, items, persistNavOrder],
  );

  const handleHomeContextMenu = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      setTooltip(null);
      setHomeMenu({ top: e.clientY, left: e.clientX });
    },
    [],
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
        className={`flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-2 ${
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
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
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
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            ))}
          </SortableContext>
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
