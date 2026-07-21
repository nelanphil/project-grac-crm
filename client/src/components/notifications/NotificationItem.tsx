"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { NotificationItem } from "@/lib/api";
import {
  formatNotificationTime,
  notificationEntityLabel,
  notificationHref,
} from "@/lib/notification-utils";
import { useNotificationsStore } from "@/store/useNotificationsStore";

interface Props {
  item: NotificationItem;
}

export default function NotificationListItem({ item }: Props) {
  const router = useRouter();
  const markRead = useNotificationsStore((s) => s.markRead);
  const setOpen = useNotificationsStore((s) => s.setOpen);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  function handleMouseEnter() {
    if (item.read) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      void markRead(item.id);
    }, 300);
  }

  function handleMouseLeave() {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function handleClick() {
    if (!item.read) void markRead(item.id);
    const href = notificationHref(item);
    setOpen(false);
    if (href) router.push(href);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex w-full flex-col gap-1 border-b border-neutral-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-neutral-50 ${
        item.read ? "bg-white" : "bg-brand-orange/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-sm leading-snug text-brand-dark ${
            item.read ? "font-normal" : "font-semibold"
          }`}
        >
          {item.summary}
        </p>
        {!item.read && (
          <span
            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-orange"
            aria-hidden
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
          {notificationEntityLabel(item.entityType)}
        </span>
        <span className="capitalize">{item.action}</span>
        <span aria-hidden>·</span>
        <span>{item.actorName}</span>
        <span aria-hidden>·</span>
        <time dateTime={item.createdAt}>
          {formatNotificationTime(item.createdAt)}
        </time>
      </div>
    </button>
  );
}
