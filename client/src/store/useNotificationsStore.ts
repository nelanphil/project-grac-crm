import { create } from "zustand";
import {
  getNotificationUnreadCount,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NotificationItem,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

interface NotificationsStore {
  items: NotificationItem[];
  unreadCount: number;
  open: boolean;
  loading: boolean;
  nextCursor: string | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  fetchUnreadCount: () => Promise<void>;
  fetchList: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reset: () => void;
}

export const useNotificationsStore = create<NotificationsStore>((set, get) => ({
  items: [],
  unreadCount: 0,
  open: false,
  loading: false,
  nextCursor: null,

  setOpen: (open) => {
    set({ open });
    if (open) void get().fetchList();
  },

  toggleOpen: () => {
    const next = !get().open;
    set({ open: next });
    if (next) void get().fetchList();
  },

  fetchUnreadCount: async () => {
    const token = useAuthStore.getState().token;
    if (!token) {
      set({ unreadCount: 0 });
      return;
    }
    try {
      const { count } = await getNotificationUnreadCount(token);
      set({ unreadCount: count });
    } catch {
      // ignore poll errors
    }
  },

  fetchList: async () => {
    const token = useAuthStore.getState().token;
    if (!token) {
      set({ items: [], nextCursor: null, unreadCount: 0 });
      return;
    }
    set({ loading: true });
    try {
      const [{ items, nextCursor }, { count }] = await Promise.all([
        getNotifications(token, { limit: 40 }),
        getNotificationUnreadCount(token),
      ]);
      set({ items, nextCursor, unreadCount: count });
    } catch {
      // keep previous list on error
    } finally {
      set({ loading: false });
    }
  },

  markRead: async (id: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const prev = get().items;
    const wasUnread = prev.some((n) => n.id === id && !n.read);
    if (!wasUnread) return;

    set({
      items: prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unreadCount: Math.max(0, get().unreadCount - 1),
    });

    try {
      await markNotificationRead(token, id);
    } catch {
      set({ items: prev });
      void get().fetchUnreadCount();
    }
  },

  markAllRead: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const prev = get().items;
    set({
      items: prev.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    });

    try {
      await markAllNotificationsRead(token);
    } catch {
      void get().fetchList();
    }
  },

  reset: () =>
    set({
      items: [],
      unreadCount: 0,
      open: false,
      loading: false,
      nextCursor: null,
    }),
}));
