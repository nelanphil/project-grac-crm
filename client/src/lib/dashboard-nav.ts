import {
  ShoppingCart,
  Calendar,
  Phone,
  Users,
  UserPlus,
  UserCog,
  ScrollText,
  Settings2,
  MessageSquare,
  Map,
  ShieldCheck,
  KeyRound,
  Briefcase,
  Package,
  TicketPercent,
  Landmark,
  ClipboardList,
  FileSpreadsheet,
  Copy,
  CreditCard,
  LayoutDashboard,
  LucideIcon,
} from "lucide-react";
import { hasRole, isStaffRole } from "@/lib/dashboard-role";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Kept as the historical audience. Live visibility is the nav permission. */
  excludeRoles?: string[];
  /** Kept as the historical audience. Live visibility is the nav permission. */
  includeRoles?: string[];
  children?: NavItem[];
}

/** @deprecated Use NavItem — children are recursive. */
export type NavChildItem = NavItem;

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Root (0) → child (1) → grandchild (2). */
export const MAX_NAV_DEPTH = 2;

export const ROOT_DROPPABLE_ID = "nav-root";

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Admin",
    items: [
      {
        href: "/dashboard/leads",
        label: "Leads",
        icon: UserPlus,
        excludeRoles: ["customer"],
      },
      {
        href: "/dashboard/messaging",
        label: "Messages",
        icon: MessageSquare,
        includeRoles: ["admin", "super-admin"],
      },
      {
        href: "/dashboard/control-panel",
        label: "Control Panel",
        icon: Settings2,
        includeRoles: ["admin", "super-admin"],
        children: [
          {
            href: "/dashboard/customers",
            label: "Customers",
            icon: Users,
            excludeRoles: ["customer"],
          },
          {
            href: "/dashboard/contact",
            label: "Contacts",
            icon: Phone,
            excludeRoles: ["customer"],
          },
          {
            href: "/dashboard/contracts",
            label: "Contracts",
            icon: ScrollText,
            excludeRoles: ["customer"],
          },
          {
            href: "/dashboard/products",
            label: "Products",
            icon: Package,
            excludeRoles: ["customer"],
          },
          {
            href: "/dashboard/discount-codes",
            label: "Discount codes",
            icon: TicketPercent,
            excludeRoles: ["customer"],
          },
          {
            href: "/dashboard/territory",
            label: "Territory",
            icon: Map,
            includeRoles: ["admin", "super-admin"],
          },
        ],
      },
      {
        href: "/dashboard/users",
        label: "Users",
        icon: UserCog,
        includeRoles: ["admin", "super-admin"],
        children: [
          {
            href: "/dashboard/users/roles",
            label: "Roles & Permissions",
            icon: KeyRound,
            includeRoles: ["super-admin"],
          },
          {
            href: "/dashboard/users/job-roles",
            label: "Job Roles",
            icon: Briefcase,
            includeRoles: ["admin", "super-admin"],
          },
        ],
      },
      {
        href: "/dashboard/admin",
        label: "Admin",
        icon: ShieldCheck,
        includeRoles: ["super-admin"],
      },
    ],
  },
  {
    label: "General",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        includeRoles: ["customer"],
      },
      {
        href: "/dashboard/checkout",
        label: "Pay",
        icon: CreditCard,
        includeRoles: ["customer"],
      },
      {
        href: "/dashboard/financials",
        label: "Financials",
        icon: Landmark,
        excludeRoles: ["customer"],
        includeRoles: ["admin", "super-admin", "manager"],
        children: [
          { href: "/dashboard/orders", label: "Invoices", icon: ShoppingCart },
          {
            href: "/dashboard/work-orders",
            label: "Work Orders",
            icon: ClipboardList,
            excludeRoles: ["customer", "agent"],
          },
          {
            href: "/dashboard/estimates",
            label: "Estimates",
            icon: FileSpreadsheet,
            excludeRoles: ["customer", "agent"],
            children: [
              {
                href: "/dashboard/estimates/templates",
                label: "Templates",
                icon: Copy,
                excludeRoles: ["customer", "agent"],
              },
            ],
          },
        ],
      },
      {
        href: "/dashboard/schedule",
        label: "Schedule",
        icon: Calendar,
        excludeRoles: ["customer", "agent"],
      },
    ],
  },
];

/** Staff and customer account link pinned outside {@link NAV_SECTIONS}. */
export const SETTINGS_NAV_HREF = "/dashboard/settings";

const HOME_NAV_HREF = "/dashboard";

export interface NavPermissionEntry {
  key: string;
  href: string;
  label: string;
}

export interface NavViewer {
  role?: string | null;
  roles?: string[] | null;
  userType?: string | null;
  permissions?: readonly string[] | null;
}

export function navPermissionKey(href: string): string {
  return `nav:${href}`;
}

function collectNavPermissions(
  items: NavItem[],
  parentLabel: string | undefined,
  into: NavPermissionEntry[],
): void {
  for (const item of items) {
    const label = parentLabel ? `${parentLabel} / ${item.label}` : item.label;
    into.push({ key: navPermissionKey(item.href), href: item.href, label });
    if (item.children?.length) {
      collectNavPermissions(item.children, item.label, into);
    }
  }
}

/** Every left-hand link, including ones added to {@link NAV_SECTIONS} later. */
export function listNavPermissions(): NavPermissionEntry[] {
  const entries: NavPermissionEntry[] = [];
  for (const section of NAV_SECTIONS) {
    collectNavPermissions(section.items, undefined, entries);
  }
  if (!entries.some((entry) => entry.href === SETTINGS_NAV_HREF)) {
    entries.push({
      key: navPermissionKey(SETTINGS_NAV_HREF),
      href: SETTINGS_NAV_HREF,
      label: "Settings",
    });
  }
  return entries;
}

export function navPermissionLabel(permission: string): string | null {
  return (
    listNavPermissions().find((entry) => entry.key === permission)?.label ??
    null
  );
}

/** Super-admin sees every link. Other roles need the nav permission. */
export function canSeeNavHref(
  viewer: NavViewer | null | undefined,
  href: string,
): boolean {
  if (!viewer) return false;
  if (hasRole(viewer, "super-admin")) return true;
  return viewer.permissions?.includes(navPermissionKey(href)) ?? false;
}

/**
 * Longest nav href that owns this path. The staff home (`/dashboard`) is not
 * a prefix, so it stays open without the customer Dashboard permission.
 */
export function navHrefForPath(pathname: string): string | null {
  let best: string | null = null;
  for (const entry of listNavPermissions()) {
    if (entry.href === HOME_NAV_HREF) continue;
    const matches =
      pathname === entry.href || pathname.startsWith(`${entry.href}/`);
    if (matches && (!best || entry.href.length > best.length)) {
      best = entry.href;
    }
  }
  return best;
}

/** Signed-out visitors are left to the auth guard. */
export function canAccessNavPath(
  viewer: NavViewer | null | undefined,
  pathname: string,
): boolean {
  if (!viewer) return true;
  const href = navHrefForPath(pathname);
  if (!href) return true;
  return canSeeNavHref(viewer, href);
}

const NEST_PREFIX = "nest:";

export function nestDroppableId(parentHref: string): string {
  return `${NEST_PREFIX}${parentHref}`;
}

export function parseNestDroppableId(id: string): string | null {
  if (id === ROOT_DROPPABLE_ID) return null;
  return id.startsWith(NEST_PREFIX) ? id.slice(NEST_PREFIX.length) : null;
}

function visibleTree(items: NavItem[], viewer: NavViewer): NavItem[] {
  return items.flatMap((item) => {
    const kids = visibleTree(item.children ?? [], viewer);
    // Staff reach home from the logo. Customers keep the Dashboard link.
    if (item.href === "/dashboard" && isStaffRole(viewer)) return kids;
    if (canSeeNavHref(viewer, item.href)) {
      return [
        {
          ...item,
          children: kids.length ? kids : undefined,
        },
      ];
    }
    return kids;
  });
}

export function getVisibleNavSections(
  viewer: NavViewer | null | undefined,
): NavSection[] {
  if (!viewer) return [];
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: visibleTree(section.items, viewer),
  })).filter((section) => section.items.length > 0);
}

function normalizeHref(href: string): string {
  return href === "/dashboard/services" ? "/dashboard/schedule" : href;
}

/** Order ids by a stored hrefs list, appending anything not yet in that list. */
function orderByHrefs(ids: string[], order: string[] | undefined): string[] {
  if (!order?.length) return ids;
  const mapped = order.map(normalizeHref);
  const remaining = new Set(ids);
  const ordered: string[] = [];
  for (const href of mapped) {
    if (remaining.has(href)) {
      ordered.push(href);
      remaining.delete(href);
    }
  }
  for (const href of ids) {
    if (remaining.has(href)) ordered.push(href);
  }
  return ordered;
}

export interface NavOrder {
  /** Flat order of top-level item hrefs across every section. */
  order: string[];
  /** parentHref -> ordered child item hrefs within that parent. */
  children: Record<string, string[]>;
  /** Hrefs removed from the nav. Omitted or empty means every visible item is shown. */
  hidden?: string[];
}

function flattenCatalog(sections: NavSection[]): {
  catalog: globalThis.Map<string, NavItem>;
  defaultChildren: Record<string, string[]>;
  defaultOrder: string[];
} {
  const catalog = new globalThis.Map<string, NavItem>();
  const defaultChildren: Record<string, string[]> = {};
  const defaultOrder: string[] = [];

  const indexItem = (item: NavItem, isTopLevel: boolean) => {
    const { children, ...rest } = item;
    catalog.set(item.href, rest);
    if (isTopLevel) defaultOrder.push(item.href);
    if (children?.length) {
      defaultChildren[item.href] = children.map((child) => child.href);
      for (const child of children) indexItem(child, false);
    }
  };

  for (const section of sections) {
    for (const item of section.items) indexItem(item, true);
  }

  return { catalog, defaultChildren, defaultOrder };
}

/**
 * Flattens all sections into a single reorderable list (no section boundaries) and applies
 * the user's custom nest/order. Section labels are dropped since items may move between them.
 *
 * A missing `children[parentHref]` key means "use defaults." An empty array means the user
 * un-nested everything under that parent.
 */
export function applyNavOrder(
  sections: NavSection[],
  navOrder: NavOrder | undefined,
): NavItem[] {
  const { catalog, defaultChildren, defaultOrder } = flattenCatalog(sections);
  const savedChildren = navOrder?.children ?? {};
  const childrenMap: Record<string, string[]> = {};

  for (const href of catalog.keys()) {
    if (Object.prototype.hasOwnProperty.call(savedChildren, href)) {
      childrenMap[href] = savedChildren[href].filter(
        (childHref) => catalog.has(childHref) && childHref !== href,
      );
    } else if (defaultChildren[href]) {
      childrenMap[href] = defaultChildren[href].filter(
        (childHref) => catalog.has(childHref) && childHref !== href,
      );
    }
  }

  for (const parent of Object.keys(childrenMap)) {
    if (!catalog.has(parent)) childrenMap[parent] = [];
  }

  const parentOf: Record<string, string> = {};
  for (const [parent, kids] of Object.entries(childrenMap)) {
    const kept: string[] = [];
    for (const childHref of kids) {
      if (parentOf[childHref] || childHref === parent) continue;
      parentOf[childHref] = parent;
      kept.push(childHref);
    }
    childrenMap[parent] = kept;
  }

  const depthOf = (href: string): number => {
    let depth = 0;
    let current = parentOf[href];
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current)) break;
      seen.add(current);
      depth += 1;
      current = parentOf[current];
    }
    return depth;
  };

  for (const href of [...catalog.keys()]) {
    if (depthOf(href) <= MAX_NAV_DEPTH) continue;
    const parent = parentOf[href];
    if (!parent) continue;
    childrenMap[parent] = (childrenMap[parent] ?? []).filter((k) => k !== href);
    delete parentOf[href];
  }

  const hiddenSet = new Set(
    (navOrder?.hidden ?? []).filter((href) => catalog.has(href)),
  );

  const nested = new Set(Object.values(childrenMap).flat());
  const catalogIds = [...catalog.keys()];
  const preferredDefault = [
    ...defaultOrder,
    ...catalogIds.filter((href) => !defaultOrder.includes(href)),
  ];
  const order = orderByHrefs(preferredDefault, navOrder?.order).filter(
    (href) =>
      catalog.has(href) && !nested.has(href) && !hiddenSet.has(href),
  );

  for (const href of catalog.keys()) {
    if (hiddenSet.has(href)) continue;
    if (!order.includes(href) && !nested.has(href)) {
      order.push(href);
    }
  }

  const childHrefs = (href: string): string[] =>
    (childrenMap[href] ?? []).filter(
      (childHref) => catalog.has(childHref) && childHref !== href,
    );

  const build = (href: string, depth: number): NavItem => {
    const item = catalog.get(href)!;
    if (depth >= MAX_NAV_DEPTH) return { ...item, children: undefined };
    const kids = visibleItems(childHrefs(href), depth + 1);
    return {
      ...item,
      children: kids.length ? kids : undefined,
    };
  };

  const visibleItems = (hrefs: string[], depth: number): NavItem[] => {
    const out: NavItem[] = [];
    for (const href of hrefs) {
      if (!catalog.has(href)) continue;
      if (hiddenSet.has(href)) {
        out.push(...visibleItems(childHrefs(href), depth));
        continue;
      }
      out.push(build(href, depth));
    }
    return out;
  };

  return visibleItems(
    order.filter((href) => catalog.has(href)),
    0,
  );
}

function collectChildren(
  items: NavItem[],
  children: Record<string, string[]>,
): void {
  for (const item of items) {
    children[item.href] = item.children?.map((child) => child.href) ?? [];
    if (item.children?.length) collectChildren(item.children, children);
  }
}

export function navItemsToOrder(
  items: NavItem[],
  hidden: string[] = [],
): NavOrder {
  const children: Record<string, string[]> = {};
  collectChildren(items, children);
  return {
    order: items.map((item) => item.href),
    children,
    hidden: [...new Set(hidden)],
  };
}

function promoteItem(items: NavItem[], href: string): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    const children = item.children?.length
      ? promoteItem(item.children, href)
      : undefined;
    if (item.href === href) {
      out.push(...(children ?? []));
      continue;
    }
    out.push({
      ...item,
      children: children?.length ? children : undefined,
    });
  }
  return out;
}

function detachHref(navOrder: NavOrder, href: string): NavOrder {
  const children: Record<string, string[]> = {};
  for (const [parent, kids] of Object.entries(navOrder.children)) {
    children[parent] = kids.filter((id) => id !== href);
  }
  // An explicit empty list blocks the catalog default from nesting items back
  // under a label that was removed.
  children[href] = [];
  return {
    ...navOrder,
    order: navOrder.order.filter((id) => id !== href),
    children,
  };
}

/** Remove a label from the visible tree. Its children take its place. */
export function hideNavItem(
  items: NavItem[],
  href: string,
  hidden: string[] = [],
): NavOrder | null {
  if (hidden.includes(href) || !findNode(items, href)) return null;
  return detachHref(
    navItemsToOrder(promoteItem(items, href), [...hidden, href]),
    href,
  );
}

/** Put a hidden label back at the bottom of the nav as a top-level item. */
export function showNavItem(
  items: NavItem[],
  href: string,
  hidden: string[] = [],
): NavOrder | null {
  if (!hidden.includes(href)) return null;
  const next = detachHref(
    navItemsToOrder(
      items,
      hidden.filter((id) => id !== href),
    ),
    href,
  );
  next.order.push(href);
  return next;
}

/** Role-visible labels the user has removed, in the order they were hidden. */
export function hiddenNavItems(
  sections: NavSection[],
  navOrder: NavOrder | undefined,
): NavItem[] {
  const { catalog } = flattenCatalog(sections);
  const seen = new Set<string>();
  const items: NavItem[] = [];
  for (const href of navOrder?.hidden ?? []) {
    if (seen.has(href)) continue;
    seen.add(href);
    const item = catalog.get(href);
    if (item) items.push(item);
  }
  return items;
}

function findNode(items: NavItem[], href: string): NavItem | undefined {
  for (const item of items) {
    if (item.href === href) return item;
    if (item.children?.length) {
      const found = findNode(item.children, href);
      if (found) return found;
    }
  }
  return undefined;
}

function findContainerIn(
  items: NavItem[],
  id: string,
  parentHref: string | null,
): { parentHref: string | null; index: number } | null {
  const index = items.findIndex((item) => item.href === id);
  if (index >= 0) return { parentHref, index };
  for (const item of items) {
    if (!item.children?.length) continue;
    const found = findContainerIn(item.children, id, item.href);
    if (found) return found;
  }
  return null;
}

function findContainer(
  items: NavItem[],
  id: string,
): { parentHref: string | null; index: number } | null {
  if (id === ROOT_DROPPABLE_ID) {
    return { parentHref: null, index: items.length };
  }
  const nestParent = parseNestDroppableId(id);
  if (nestParent) {
    const parent = findNode(items, nestParent);
    if (!parent) return null;
    return { parentHref: nestParent, index: parent.children?.length ?? 0 };
  }
  return findContainerIn(items, id, null);
}

function depthOfContainer(
  items: NavItem[],
  parentHref: string | null,
): number {
  if (parentHref === null) return -1;
  for (const item of items) {
    if (item.href === parentHref) return 0;
    for (const child of item.children ?? []) {
      if (child.href === parentHref) return 1;
    }
  }
  return 0;
}

function isDescendantOf(
  children: Record<string, string[]>,
  ancestor: string,
  href: string,
): boolean {
  const kids = children[ancestor] ?? [];
  for (const kid of kids) {
    if (kid === href || isDescendantOf(children, kid, href)) return true;
  }
  return false;
}

function takeSubtreeKids(
  children: Record<string, string[]>,
  href: string,
): string[] {
  const kids = children[href] ?? [];
  children[href] = [];
  const out: string[] = [];
  for (const kid of kids) {
    out.push(kid, ...takeSubtreeKids(children, kid));
  }
  return out;
}

function moveIndex<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [spliced] = next.splice(from, 1);
  if (spliced === undefined) return next;
  next.splice(to, 0, spliced);
  return next;
}

/**
 * Nest / un-nest / reorder up to {@link MAX_NAV_DEPTH}. Returns a full navOrder
 * snapshot, or null if nothing changed.
 *
 * Dropping onto `nest:{parentHref}` nests under that parent. Dropping onto
 * {@link ROOT_DROPPABLE_ID} (or a top-level item) un-nests / reorders at root.
 */
export function moveNavItem(
  items: NavItem[],
  activeId: string,
  overId: string,
  hidden: string[] = [],
): NavOrder | null {
  if (activeId === overId) return null;

  const from = findContainer(items, activeId);
  const to = findContainer(items, overId);
  if (!from || !to) return null;
  if (to.parentHref === activeId) return null;

  const snapshot = navItemsToOrder(items, hidden);
  let { order } = snapshot;
  const children: Record<string, string[]> = {};
  for (const [href, kids] of Object.entries(snapshot.children)) {
    children[href] = [...kids];
  }

  if (
    to.parentHref &&
    (to.parentHref === activeId ||
      isDescendantOf(children, activeId, to.parentHref))
  ) {
    return null;
  }

  const listOf = (parentHref: string | null) =>
    parentHref === null ? order : (children[parentHref] ??= []);

  const placedDepth = depthOfContainer(items, to.parentHref) + 1;
  if (placedDepth > MAX_NAV_DEPTH) return null;

  if (from.parentHref === to.parentHref) {
    const list = listOf(from.parentHref);
    const oldIndex = list.indexOf(activeId);
    const nestOver =
      overId === ROOT_DROPPABLE_ID || Boolean(parseNestDroppableId(overId));
    const newIndex = nestOver ? list.length - 1 : list.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;
    const moved = moveIndex(list, oldIndex, newIndex);
    if (from.parentHref === null) {
      order = moved;
    } else {
      children[from.parentHref] = moved;
    }
    return { order, children, hidden: snapshot.hidden };
  }

  const fromList = listOf(from.parentHref);
  const fromIdx = fromList.indexOf(activeId);
  if (fromIdx >= 0) fromList.splice(fromIdx, 1);

  const flattened =
    placedDepth === MAX_NAV_DEPTH ? takeSubtreeKids(children, activeId) : [];

  const toList = listOf(to.parentHref);
  const nestOver =
    overId === ROOT_DROPPABLE_ID || Boolean(parseNestDroppableId(overId));
  let insertAt = nestOver ? toList.length : toList.indexOf(overId);
  if (insertAt < 0) insertAt = toList.length;
  toList.splice(insertAt, 0, activeId, ...flattened);

  if (to.parentHref === null) {
    order = toList;
  } else {
    children[to.parentHref] = toList;
  }
  if (from.parentHref === null) {
    order = fromList;
  } else {
    children[from.parentHref] = fromList;
  }

  return { order, children, hidden: snapshot.hidden };
}

/** Parent is active only on its exact path (children have their own links). */
export function isNavItemActive(
  pathname: string,
  href: string,
  hasChildren?: boolean,
): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (hasChildren) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavChildActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavSubtreeActive(
  pathname: string,
  item: NavItem,
): boolean {
  if (isNavChildActive(pathname, item.href)) return true;
  return item.children?.some((child) => isNavSubtreeActive(pathname, child)) ?? false;
}
