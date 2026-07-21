"use client";

import { useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";
import { useNotificationsStore } from "@/store/useNotificationsStore";
import NotificationPopover from "./NotificationPopover";

const POLL_MS = 30_000;

interface Props {
  className?: string;
}

export default function NotificationBell({ className = "" }: Props) {
  const hydrated = useHasHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const token = useAuthStore((s) => s.token);
  const open = useNotificationsStore((s) => s.open);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const toggleOpen = useNotificationsStore((s) => s.toggleOpen);
  const fetchUnreadCount = useNotificationsStore((s) => s.fetchUnreadCount);
  const reset = useNotificationsStore((s) => s.reset);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !token) {
      reset();
      return;
    }

    void fetchUnreadCount();
    const id = window.setInterval(() => {
      void fetchUnreadCount();
    }, POLL_MS);

    return () => window.clearInterval(id);
  }, [hydrated, isAuthenticated, token, fetchUnreadCount, reset]);

  if (!hydrated || !isAuthenticated) return null;

  const badgeLabel =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => toggleOpen()}
        className="relative rounded-md p-2 text-white/80 transition-colors hover:text-brand-orange"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="h-5 w-5" />
        {badgeLabel && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-orange px-1 text-[10px] font-bold leading-none text-white">
            {badgeLabel}
          </span>
        )}
      </button>
      <NotificationPopover anchorRef={buttonRef} />
    </div>
  );
}
