"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, LogOut, Menu, Plus, X } from "lucide-react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { applyNavOrder, getVisibleNavSections } from "@/lib/dashboard-nav";
import { useAuthStore } from "@/store/useAuthStore";
import { updateNavOrder } from "@/lib/api";
import NotificationBell from "@/components/notifications/NotificationBell";
import NavItemGroup from "@/components/dashboard/NavItemGroup";
import CustomerHeaderSearch from "@/components/dashboard/staff/CustomerHeaderSearch";

export default function StaffTopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const navOrder = useAuthStore((s) => s.user?.uiPreferences?.navOrder);
  const setNavOrder = useAuthStore((s) => s.setNavOrder);
  const logout = useAuthStore((s) => s.logout);
  const canWriteCustomers = useAuthStore((s) =>
    s.hasPermission("customers:write"),
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const baseSections = useMemo(
    () => getVisibleNavSections(user?.role),
    [user?.role],
  );
  const visibleItems = useMemo(
    () => applyNavOrder(baseSections, navOrder),
    [baseSections, navOrder],
  );
  const sensors = useSensors(
    // Press and hold ~500ms to start wiggling; once wiggling, a small move re-grabs instantly.
    useSensor(PointerSensor, {
      activationConstraint: editMode
        ? { distance: 4 }
        : { delay: 500, tolerance: 8 },
    }),
  );
  const initials =
    `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase() ||
    "U";

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

  const handleDragStart = useCallback(() => {
    setEditMode(true);
  }, []);

  const mobileNavRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!editMode) return;
    // Belt-and-suspenders: dnd-kit's own click-suppression after a drag can race with the
    // browser's click dispatch, so block every click inside the wiggling nav at capture time.
    const blockNavClicks = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-nav-allow-click]")) return;
      if (mobileNavRef.current?.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", blockNavClicks, true);
    return () => document.removeEventListener("click", blockNavClicks, true);
  }, [editMode]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      const current = navOrder ?? { order: [], children: {} };

      const hrefs = visibleItems.map((i) => i.href);
      if (hrefs.includes(activeId) && hrefs.includes(overId)) {
        const newHrefs = arrayMove(
          hrefs,
          hrefs.indexOf(activeId),
          hrefs.indexOf(overId),
        );
        persistNavOrder({ ...current, order: newHrefs });
        return;
      }

      for (const item of visibleItems) {
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
    [navOrder, visibleItems, persistNavOrder],
  );

  function handleLogout() {
    logout();
    router.push("/auth/login");
  }

  function closeMenus() {
    setMobileOpen(false);
    setNewOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-[var(--staff-border)] bg-[var(--staff-surface)]/95 backdrop-blur">
      <div className="relative flex w-full items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5 lg:px-6">
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--staff-muted)] transition-colors hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)] md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>

        <div className="absolute left-1/2 hidden w-full max-w-2xl -translate-x-1/2 items-center gap-2 px-3 md:flex">
          <CustomerHeaderSearch className="min-w-0 max-w-xl flex-1" />

          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setNewOpen((v) => !v)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[var(--staff-ink)] px-3 text-sm font-semibold text-white transition hover:bg-black sm:h-auto sm:py-2"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            {newOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close new menu"
                  onClick={() => setNewOpen(false)}
                />
                <div className="absolute left-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-white py-1 shadow-lg">
                  {canWriteCustomers ? (
                    <Link
                      href="/dashboard/customers/create"
                      className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                      onClick={closeMenus}
                    >
                      Customer
                    </Link>
                  ) : null}
                  <Link
                    href="/dashboard/contracts"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Contracts
                  </Link>
                  <Link
                    href="/dashboard/orders"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Invoices
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="relative md:hidden">
            <button
              type="button"
              onClick={() => setNewOpen((v) => !v)}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[var(--staff-ink)] px-3 text-sm font-semibold text-white transition hover:bg-black sm:h-auto sm:py-2"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            {newOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close new menu"
                  onClick={() => setNewOpen(false)}
                />
                <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--staff-border)] bg-white py-1 shadow-lg">
                  {canWriteCustomers ? (
                    <Link
                      href="/dashboard/customers/create"
                      className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                      onClick={closeMenus}
                    >
                      Customer
                    </Link>
                  ) : null}
                  <Link
                    href="/dashboard/contracts"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Contracts
                  </Link>
                  <Link
                    href="/dashboard/orders"
                    className="block px-4 py-2.5 text-sm text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
                    onClick={closeMenus}
                  >
                    Invoices
                  </Link>
                </div>
              </>
            )}
          </div>

          <NotificationBell variant="light" />

          <Link
            href="/dashboard/settings"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--staff-cream)] text-xs font-bold text-[var(--staff-ink)] ring-1 ring-[var(--staff-border)] transition hover:ring-brand-orange"
            title="Settings"
            aria-label="Account settings"
          >
            {initials}
          </Link>

          <button
            type="button"
            onClick={handleLogout}
            className="hidden rounded-lg p-2 text-[var(--staff-muted)] transition-colors hover:bg-[var(--staff-cream)] hover:text-[var(--staff-ink)] sm:inline-flex"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CustomerHeaderSearch
        className="w-full border-t border-[var(--staff-border)] px-3 py-2 md:hidden"
        inputClassName="w-full rounded-xl border border-[var(--staff-border)] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/20"
      />

      {mobileOpen && (
        <div className="border-t border-[var(--staff-border)] bg-[var(--staff-surface)] md:hidden max-h-[min(70dvh,calc(100dvh-7.5rem))] overflow-y-auto overscroll-contain">
          <nav
            ref={mobileNavRef}
            className="flex flex-col gap-5 px-4 pb-4 pt-4"
          >
            <Link
              href="/dashboard"
              className={`rounded-lg px-3 py-2.5 text-sm font-medium ${
                pathname === "/dashboard"
                  ? "bg-[var(--staff-ink)] text-white"
                  : "text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
              }`}
              onClick={closeMenus}
            >
              Home
            </Link>
            {editMode ? (
              <button
                type="button"
                onClick={() => setEditMode(false)}
                data-nav-allow-click
                className="flex items-center justify-center gap-1.5 rounded-lg bg-brand-orange px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-orange/90"
              >
                <Check className="h-4 w-4" />
                Done
              </button>
            ) : null}
            {visibleItems.length ? (
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={visibleItems.map((item) => item.href)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-1">
                    {visibleItems.map((item) => (
                      <NavItemGroup
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        variant="sidebar"
                        onNavigate={closeMenus}
                        editable
                        editMode={editMode}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : null}
            <button
              type="button"
              onClick={() => {
                closeMenus();
                handleLogout();
              }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
