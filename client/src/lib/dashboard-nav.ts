import {
  ShoppingCart,
  Wrench,
  Phone,
  Users,
  UserPlus,
  UserCog,
  ScrollText,
  Settings2,
  MessageSquare,
  Map,
  ShieldCheck,
  LucideIcon,
} from "lucide-react";

export interface NavChildItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  excludeRoles?: string[];
  includeRoles?: string[];
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  excludeRoles?: string[];
  includeRoles?: string[];
  children?: NavChildItem[];
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Admin",
    items: [
      {
        href: "/dashboard/customers",
        label: "Customers",
        icon: Users,
        excludeRoles: ["customer"],
      },
      {
        href: "/dashboard/leads",
        label: "Leads",
        icon: UserPlus,
        excludeRoles: ["customer"],
      },
      {
        href: "/dashboard/contracts",
        label: "Contracts",
        icon: ScrollText,
        excludeRoles: ["customer"],
      },
      {
        href: "/dashboard/territory",
        label: "Territory",
        icon: Map,
        includeRoles: ["admin", "super-admin", "owner"],
      },
      {
        href: "/dashboard/messaging",
        label: "Messaging",
        icon: MessageSquare,
        includeRoles: ["admin", "super-admin", "owner"],
      },
      {
        href: "/dashboard/control-panel",
        label: "Control Panel",
        icon: Settings2,
        includeRoles: ["admin", "super-admin", "owner"],
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
      { href: "/dashboard/orders", label: "Invoices", icon: ShoppingCart },
      { href: "/dashboard/services", label: "Services", icon: Wrench },
      {
        href: "/dashboard/contact",
        label: "Contacts",
        icon: Phone,
        excludeRoles: ["customer"],
      },
    ],
  },
];

function isItemVisible(
  item: { includeRoles?: string[]; excludeRoles?: string[] },
  role: string | undefined,
): boolean {
  if (item.includeRoles) {
    return item.includeRoles.includes(role ?? "");
  }
  return !item.excludeRoles?.includes(role ?? "");
}

export function getVisibleNavSections(role: string | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => isItemVisible(item, role))
      .map((item) => ({
        ...item,
        children: item.children?.filter((child) => isItemVisible(child, role)),
      })),
  })).filter((section) => section.items.length > 0);
}

/** Order items by a stored hrefs list, appending anything not yet in that list. */
function orderByHrefs<T extends { href: string }>(
  items: T[],
  order: string[] | undefined,
): T[] {
  if (!order?.length) return items;
  const byHref = new globalThis.Map(items.map((item) => [item.href, item]));
  const ordered: T[] = [];
  for (const href of order) {
    const item = byHref.get(href);
    if (item) {
      ordered.push(item);
      byHref.delete(href);
    }
  }
  return [...ordered, ...byHref.values()];
}

export interface NavOrder {
  /** Flat order of top-level item hrefs across every section. */
  order: string[];
  /** parentHref -> ordered child item hrefs within that parent. */
  children: Record<string, string[]>;
}

/**
 * Flattens all sections into a single reorderable list (no section boundaries) and applies
 * the user's custom order. Section labels are dropped since items may move between them.
 */
export function applyNavOrder(
  sections: NavSection[],
  navOrder: NavOrder | undefined,
): NavItem[] {
  const allItems = sections.flatMap((section) => section.items);
  return orderByHrefs(allItems, navOrder?.order).map((item) =>
    item.children?.length
      ? {
          ...item,
          children: orderByHrefs(
            item.children,
            navOrder?.children?.[item.href],
          ),
        }
      : item,
  );
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
