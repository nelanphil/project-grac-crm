import {
  ShoppingCart,
  Wrench,
  Phone,
  Users,
  ScrollText,
  Settings2,
  MessageSquare,
  MessagesSquare,
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
      { href: "/dashboard/customers", label: "Customers", icon: Users, excludeRoles: ["customer"] },
      { href: "/dashboard/contracts", label: "Contracts", icon: ScrollText, excludeRoles: ["customer"] },
      {
        href: "/dashboard/messaging",
        label: "Messaging",
        icon: MessageSquare,
        includeRoles: ["admin", "super-admin", "owner"],
        children: [
          {
            href: "/dashboard/messaging/history",
            label: "Conversation history",
            icon: MessagesSquare,
            includeRoles: ["admin", "super-admin", "owner"],
          },
        ],
      },
      {
        href: "/dashboard/control-panel",
        label: "Control Panel",
        icon: Settings2,
        includeRoles: ["admin", "super-admin", "owner"],
      },
    ],
  },
  {
    label: "General",
    items: [
      { href: "/dashboard/orders", label: "Orders", icon: ShoppingCart },
      { href: "/dashboard/services", label: "Services", icon: Wrench },
      { href: "/dashboard/contact", label: "Contact", icon: Phone },
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

/** Parent is active only on its exact path (children have their own links). */
export function isNavItemActive(pathname: string, href: string, hasChildren?: boolean): boolean {
  if (hasChildren) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavChildActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
