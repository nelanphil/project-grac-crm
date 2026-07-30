"use client";

import { useEffect, useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import NotificationListItem from "@/components/notifications/NotificationItem";
import { useAuthStore } from "@/store/useAuthStore";
import { useNotificationsStore } from "@/store/useNotificationsStore";
import {
  ApiError,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "@/lib/api";

const PAGE_SIZE = 100;

export default function NotificationsPage() {
  return (
    <AuthGuard>
      <NotificationsContent />
    </AuthGuard>
  );
}

function NotificationsContent() {
  const token = useAuthStore((s) => s.token);
  const fetchUnreadCount = useNotificationsStore((s) => s.fetchUnreadCount);

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getNotifications(token, { limit: PAGE_SIZE })
      .then(({ items: list, nextCursor: cursor }) => {
        setItems(list);
        setNextCursor(cursor);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load notifications.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleLoadMore() {
    if (!token || !nextCursor) return;
    setLoadingMore(true);
    try {
      const { items: list, nextCursor: cursor } = await getNotifications(
        token,
        { limit: PAGE_SIZE, before: nextCursor },
      );
      setItems((prev) => [...prev, ...list]);
      setNextCursor(cursor);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load more notifications.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  function handleMarkRead(id: string) {
    if (!token) return;
    const wasUnread = items.some((n) => n.id === id && !n.read);
    if (!wasUnread) return;

    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

    markNotificationRead(token, id)
      .then(() => void fetchUnreadCount())
      .catch(() => {
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: false } : n)),
        );
      });
  }

  async function handleMarkAllRead() {
    if (!token) return;
    const prev = items;
    setItems((p) => p.map((n) => ({ ...n, read: true })));

    try {
      await markAllNotificationsRead(token);
      void fetchUnreadCount();
    } catch {
      setItems(prev);
    }
  }

  const hasUnread = items.some((n) => !n.read);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">Notifications</h1>
        {hasUnread && (
          <button
            type="button"
            onClick={() => void handleMarkAllRead()}
            className="text-sm font-medium text-brand-orange transition-colors hover:text-brand-dark"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No notifications yet.
          </p>
        ) : (
          items.map((item) => (
            <NotificationListItem
              key={item.id}
              item={item}
              onMarkRead={handleMarkRead}
              onNavigate={() => {}}
            />
          ))
        )}
      </div>

      {nextCursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={loadingMore}
            className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-brand-dark transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
