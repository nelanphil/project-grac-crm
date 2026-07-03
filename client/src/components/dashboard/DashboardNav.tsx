"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, Wrench, Phone, Users, ScrollText, LucideIcon } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  excludeRoles?: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Admin",
    items: [
      { href: "/dashboard/customers", label: "Customers", icon: Users, excludeRoles: ["customer"] },
      { href: "/dashboard/contracts", label: "Contracts", icon: ScrollText, excludeRoles: ["customer"] },
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

export default function DashboardNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.excludeRoles?.includes(user?.role ?? "")
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <aside className="w-56 shrink-0">
      <nav className="sticky top-24 flex flex-col gap-6">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {section.label}
            </p>
            <div className="flex flex-col gap-1">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "bg-brand-dark text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
