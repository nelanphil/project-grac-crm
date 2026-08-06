"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getVisibleNavSections,
  isNavChildActive,
  isNavItemActive,
} from "@/lib/dashboard-nav";
import { COMPANY } from "@/lib/constants";

function IconLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-brand-orange text-white"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
      <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md bg-brand-dark px-2 py-1 text-xs font-medium text-white shadow-lg group-hover:block">
        {label}
      </span>
    </Link>
  );
}

export default function StaffIconSidebar() {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);
  const sections = getVisibleNavSections(role);
  const homeActive = pathname === "/dashboard";
  const settingsActive = pathname.startsWith("/dashboard/settings");

  return (
    <aside className="sticky top-0 z-40 flex h-screen w-[4.25rem] shrink-0 flex-col items-center bg-[var(--staff-shell)] py-3 text-white">
      <Link
        href="/dashboard"
        className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-orange text-sm font-bold tracking-tight text-white shadow-sm"
        title={COMPANY.name}
        aria-label="Dashboard home"
      >
        {COMPANY.shortName.slice(0, 1)}
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2">
        <IconLink href="/dashboard" label="Home" active={homeActive}>
          <Home className="h-5 w-5" />
        </IconLink>

        {sections.map((section) =>
          section.items.map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const active =
              isNavItemActive(pathname, item.href, hasChildren) ||
              Boolean(
                item.children?.some((child) =>
                  isNavChildActive(pathname, child.href),
                ),
              );
            const Icon = item.icon;
            return (
              <IconLink
                key={item.href}
                href={item.href}
                label={item.label}
                active={active}
              >
                <Icon className="h-5 w-5" />
              </IconLink>
            );
          }),
        )}
      </nav>

      <div className="mt-auto flex flex-col items-center gap-1 px-2 pb-2">
        <IconLink
          href="/dashboard/settings"
          label="Settings"
          active={settingsActive}
        >
          <Settings className="h-5 w-5" />
        </IconLink>
      </div>
    </aside>
  );
}
