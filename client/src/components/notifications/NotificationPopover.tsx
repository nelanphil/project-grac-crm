"use client";

import { useEffect, useRef } from "react";
import { useNotificationsStore } from "@/store/useNotificationsStore";
import NotificationListItem from "./NotificationItem";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function NotificationPopover({ anchorRef }: Props) {
  const open = useNotificationsStore((s) => s.open);
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen, anchorRef]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full z-[60] mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-neutral-200 bg-white text-brand-dark shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="text-xs font-medium text-brand-orange transition-colors hover:text-brand-dark"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
        {loading && items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No notifications yet.
          </p>
        ) : (
          items.map((item) => (
            <NotificationListItem key={item.id} item={item} />
          ))
        )}
      </div>
    </div>
  );
}
