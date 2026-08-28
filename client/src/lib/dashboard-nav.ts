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
  Package,
  Landmark,
  ClipboardList,
  FileSpreadsheet,
  LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  excludeRoles?: string[];
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
        includeRoles: ["admin", "super-admin", "owner"],
      },
      {
        href: "/dashboard/control-panel",
        label: "Control Panel",
        icon: Settings2,
        includeRoles: ["admin", "super-admin", "owner"],
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
            href: "/dashboard/territory",
            label: "Territory",
            icon: Map,
            includeRoles: ["admin", "super-admin", "owner"],
          },
        ],
      },
      {
        href: "/dashboard/users",
        label: "Users",
        icon: UserCog,
        includeRoles: ["admin", "super-admin", "owner"],
        children: [
          {
            href: "/dashboard/users/roles",
            label: "Roles & Permissions",
            icon: KeyRound,
            includeRoles: ["super-admin"],
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
        href: "/dashboard/financials",
        label: "Financials",
        icon: Landmark,
        excludeRoles: ["customer"],
        includeRoles: ["admin", "super-admin", "owner", "manager"],
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

const NEST_PREFIX = "nest:";

export function nestDroppableId(parentHref: string): string {
  return `${NEST_PREFIX}${parentHref}`;
}

export function parseNestDroppableId(id: string): string | null {
  if (id === ROOT_DROPPABLE_ID) return null;
  return id.startsWith(NEST_PREFIX) ? id.slice(NEST_PREFIX.length) : null;
}

function isItemVisible(
  item: { includeRoles?: string[]; excludeRoles?: string[] },
  role: string | undefined,
): boolean {
  if (item.includeRoles) {
    return item.includeRoles.includes(role ?? "");
  }
  return !item.excludeRoles?.includes(role ?? "");
}

function visibleTree(items: NavItem[], role: string | undefined): NavItem[] {
  return items.flatMap((item) => {
    const kids = visibleTree(item.children ?? [], role);
    if (isItemVisible(item, role)) {
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

export function getVisibleNavSections(role: string | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: visibleTree(section.items, role),
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

  const nested = new Set(Object.values(childrenMap).flat());
  const catalogIds = [...catalog.keys()];
  const preferredDefault = [
    ...defaultOrder,
    ...catalogIds.filter((href) => !defaultOrder.includes(href)),
  ];
  const order = orderByHrefs(preferredDefault, navOrder?.order).filter(
    (href) => catalog.has(href) && !nested.has(href),
  );

  for (const href of catalog.keys()) {
    if (!order.includes(href) && !nested.has(href)) {
      order.push(href);
    }
  }

  const build = (href: string, depth: number): NavItem => {
    const item = catalog.get(href)!;
    if (depth >= MAX_NAV_DEPTH) return { ...item, children: undefined };
    const kids = (childrenMap[href] ?? []).filter(
      (childHref) => catalog.has(childHref) && childHref !== href,
    );
    return {
      ...item,
      children: kids.length
        ? kids.map((childHref) => build(childHref, depth + 1))
        : undefined,
    };
  };

  return order.filter((href) => catalog.has(href)).map((href) => build(href, 0));
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

export function navItemsToOrder(items: NavItem[]): NavOrder {
  const children: Record<string, string[]> = {};
  collectChildren(items, children);
  return { order: items.map((item) => item.href), children };
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
): NavOrder | null {
  if (activeId === overId) return null;

  const from = findContainer(items, activeId);
  const to = findContainer(items, overId);
  if (!from || !to) return null;
  if (to.parentHref === activeId) return null;

  const snapshot = navItemsToOrder(items);
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
    return { order, children };
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

  return { order, children };
}

/** Parent is active only on its exact path (children have their own links). */
export function isNavItemActive(
  pathname: string,
  href: string,
  hasChildren?: boolean,
): boolean {
  if (hasChildren) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavChildActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavSubtreeActive(
  pathname: string,
  item: NavItem,
): boolean {
  if (isNavChildActive(pathname, item.href)) return true;
  return item.children?.some((child) => isNavSubtreeActive(pathname, child)) ?? false;
}
