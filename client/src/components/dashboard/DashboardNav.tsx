"use client";

import { usePathname } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { getVisibleNavSections } from "@/lib/dashboard-nav";
import NavItemGroup from "./NavItemGroup";

export default function DashboardNav() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const visibleSections = getVisibleNavSections(user?.role);

  return (
    <aside className="hidden w-56 shrink-0 md:block">
      <nav className="sticky top-24 flex flex-col gap-6">
        {visibleSections.map((section) => (
          <div key={section.label}>
            <p className="mb-2 px-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              {section.label}
            </p>
            <div className="flex flex-col gap-1">
              {section.items.map((item) => (
                <NavItemGroup
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  variant="sidebar"
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
