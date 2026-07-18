import { ShoppingCart, Wrench, Phone, Users, ScrollText, Settings2, LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  excludeRoles?: string[];
  includeRoles?: string[];
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

export function getVisibleNavSections(role: string | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.includeRoles) {
        return item.includeRoles.includes(role ?? "");
      }
      return !item.excludeRoles?.includes(role ?? "");
    }),
  })).filter((section) => section.items.length > 0);
}
