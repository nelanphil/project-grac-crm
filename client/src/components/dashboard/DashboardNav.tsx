"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, Wrench, Phone } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard/orders",   label: "Orders",   icon: ShoppingCart },
  { href: "/dashboard/services", label: "Services", icon: Wrench },
  { href: "/dashboard/contact",  label: "Contact",  icon: Phone },
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0">
      <nav className="sticky top-24 flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
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
      </nav>
    </aside>
  );
}
