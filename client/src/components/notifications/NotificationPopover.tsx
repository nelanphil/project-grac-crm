"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useNotificationsStore } from "@/store/useNotificationsStore";
import NotificationListItem from "./NotificationItem";

interface Props {
  anchorRef: React.RefObject<HTMLElement | null>;
}

const MOBILE_MQ = "(max-width: 767px)";
const MOBILE_GUTTER = 12;

export default function NotificationPopover({ anchorRef }: Props) {
  const open = useNotificationsStore((s) => s.open);
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetTop, setSheetTop] = useState(72);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;

    function place() {
      const anchor = anchorRef.current;
      const top = anchor
        ? Math.min(anchor.getBoundingClientRect().bottom + 8, window.innerHeight - 160)
        : 72;
      setSheetTop(Math.max(MOBILE_GUTTER, top));
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, isMobile, anchorRef]);

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

  const body = (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <h2 className="min-w-0 text-sm font-semibold">Notifications</h2>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="shrink-0 text-xs font-medium text-brand-orange transition-colors hover:text-brand-dark"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-[min(24rem,70vh)] overflow-y-auto overflow-x-hidden">
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

      <div className="border-t border-neutral-100 px-4 py-2 text-center">
        <Link
          href="/dashboard/notifications"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-brand-orange transition-colors hover:text-brand-dark"
        >
          View all notifications
        </Link>
      </div>
    </>
  );

  if (isMobile && typeof document !== "undefined") {
    return createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifications"
        style={{
          top: sheetTop,
          left: MOBILE_GUTTER,
          right: MOBILE_GUTTER,
          width: `calc(100vw - ${MOBILE_GUTTER * 2}px)`,
          maxWidth: `calc(100vw - ${MOBILE_GUTTER * 2}px)`,
        }}
        className="fixed z-[60] box-border max-h-[min(28rem,calc(100dvh-6rem))] overflow-hidden rounded-lg border border-neutral-200 bg-white text-brand-dark shadow-lg"
      >
        {body}
      </div>,
      document.body,
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-full z-[60] mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-neutral-200 bg-white text-brand-dark shadow-lg"
    >
      {body}
    </div>
  );
}
