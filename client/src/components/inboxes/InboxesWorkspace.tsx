"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  InboxChannels,
  InboxConversationItem,
  blockInboxConversation,
  callInboxConversation,
  closeInboxConversation,
  deleteInboxConversation,
  getInboxChannels,
  getInboxConversations,
  getInboxTimeline,
  markInboxConversationRead,
  markInboxConversationUnread,
  pinInboxConversation,
  reopenInboxConversation,
  unblockInboxConversation,
  unpinInboxConversation,
} from "@/lib/api";
import { subscribeDashboardLive } from "@/lib/dashboardLive";
import { useAuthStore } from "@/store/useAuthStore";
import TaskDialog from "@/components/tasks/TaskDialog";
import ConversationList, {
  InboxChannelFilter,
  InboxChip,
  InboxTab,
} from "./ConversationList";
import ConversationContextMenu, { ConversationMenuAction } from "./ConversationContextMenu";
import ConversationThread from "./ConversationThread";
import CustomerContextPanel from "./CustomerContextPanel";
import NewCallDialog from "./NewCallDialog";
import { conversationMarkdown } from "./inboxFormat";

export default function InboxesWorkspace() {
  const token = useAuthStore((state) => state.token);
  const canWrite = useAuthStore((state) => state.hasPermission("messages:write"));
  const canTasks = useAuthStore((state) => state.hasPermission("tasks:write"));
  const canReadTasks = useAuthStore((state) => state.hasPermission("tasks:read"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");

  const [tab, setTab] = useState<InboxTab>("chats");
  const [newCallOpen, setNewCallOpen] = useState(false);
  const [chip, setChip] = useState<InboxChip>("open");
  const [channel, setChannel] = useState<InboxChannelFilter>("");
  const [closed, setClosed] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [conversations, setConversations] = useState<InboxConversationItem[]>([]);
  const [pinned, setPinned] = useState<InboxConversationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = `${closed}|${chip}|${tab}|${channel}|${debouncedQuery}|${showBlocked}|${refreshKey}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== requestKey;
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<InboxChannels | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InboxConversationItem | null>(null);
  const [taskFor, setTaskFor] = useState<InboxConversationItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ignoreRead = useRef<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!toast) return;
    const handle = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInboxConversations(token, {
      status: closed ? "closed" : "open",
      filter: chip === "open" ? "" : chip,
      channel: tab === "calls" ? "voice" : channel,
      q: debouncedQuery,
      blocked: showBlocked,
    })
      .then((result) => {
        if (cancelled) return;
        setConversations(result.conversations);
        setPinned(result.pinned ?? []);
        setNextCursor(result.nextCursor);
        setError(null);
        setLoadedKey(requestKey);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load inboxes");
        setLoadedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [token, closed, chip, tab, channel, debouncedQuery, showBlocked, requestKey]);

  async function loadMore() {
    if (!token || !nextCursor) return;
    const result = await getInboxConversations(token, {
      status: closed ? "closed" : "open",
      filter: chip === "open" ? "" : chip,
      channel: tab === "calls" ? "voice" : channel,
      q: debouncedQuery,
      blocked: showBlocked,
      cursor: nextCursor,
    });
    setConversations((current) => [...current, ...result.conversations]);
    setNextCursor(result.nextCursor);
  }

  useEffect(() => {
    if (!token) return;
    getInboxChannels(token)
      .then(setChannels)
      .catch(() => setChannels(null));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeDashboardLive(token, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setRefreshKey((value) => value + 1);
      }, 750);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [token]);

  useEffect(() => {
    if (ignoreRead.current && ignoreRead.current !== selectedId) {
      ignoreRead.current = null;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!token || !selectedId || ignoreRead.current === selectedId) return;
    let cancelled = false;
    markInboxConversationRead(token, selectedId)
      .then((result) => {
        if (cancelled || ignoreRead.current === result.conversation.id) return;
        setConversations((current) =>
          current.map((item) => (item.id === result.conversation.id ? result.conversation : item)),
        );
        setPinned((current) =>
          current.map((item) => (item.id === result.conversation.id ? result.conversation : item)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, selectedId]);

  function select(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("c", id);
    else params.delete("c");
    const qs = params.toString();
    router.replace(qs ? `/dashboard/inboxes?${qs}` : "/dashboard/inboxes", { scroll: false });
    setContextOpen(false);
  }

  function remember(next: InboxConversationItem) {
    setConversations((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
    setPinned((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  function drop(id: string) {
    setConversations((current) => current.filter((item) => item.id !== id));
    setPinned((current) => current.filter((item) => item.id !== id));
  }

  function findItem(id: string): InboxConversationItem | null {
    return [...pinned, ...conversations].find((item) => item.id === id) ?? null;
  }

  async function placeCall(item: InboxConversationItem) {
    if (!token) return;
    const numbers =
      channels?.twilioAccounts.flatMap((account) =>
        account.numbers.map((number) => ({
          phoneNumber: number.phoneNumber,
          accountId: account.id,
        })),
      ) ?? [];
    const from =
      (item.ourNumber && numbers.some((number) => number.phoneNumber === item.ourNumber)
        ? item.ourNumber
        : numbers[0]?.phoneNumber) || undefined;
    await callInboxConversation(token, item.id, {
      fromNumber: from,
      twilioAccountId: numbers.find((number) => number.phoneNumber === from)?.accountId,
    });
    setRefreshKey((value) => value + 1);
  }

  async function toggleDone(item: InboxConversationItem) {
    if (!token) return;
    const result =
      item.status === "closed"
        ? await reopenInboxConversation(token, item.id)
        : await closeInboxConversation(token, item.id);
    const stays =
      showBlocked
        ? result.conversation.blocked
        : !result.conversation.blocked &&
          result.conversation.status === (closed ? "closed" : "open");
    if (!stays) drop(item.id);
    else remember(result.conversation);
    setRefreshKey((value) => value + 1);
  }

  async function markUnread(item: InboxConversationItem) {
    if (!token) return;
    ignoreRead.current = item.id;
    if (selectedId === item.id) select(null);
    const result = await markInboxConversationUnread(token, item.id);
    remember(result.conversation);
  }

  async function togglePin(item: InboxConversationItem) {
    if (!token) return;
    const result = item.pinned
      ? await unpinInboxConversation(token, item.id)
      : await pinInboxConversation(token, item.id);
    if (result.conversation.pinned) {
      setConversations((current) => current.filter((row) => row.id !== item.id));
      setPinned((current) => [
        result.conversation,
        ...current.filter((row) => row.id !== item.id),
      ]);
    } else {
      setPinned((current) => current.filter((row) => row.id !== item.id));
      setConversations((current) => [
        result.conversation,
        ...current.filter((row) => row.id !== item.id),
      ]);
    }
    setRefreshKey((value) => value + 1);
  }

  async function copyLink(item: InboxConversationItem) {
    const url = `${window.location.origin}/dashboard/inboxes?c=${item.id}`;
    await navigator.clipboard.writeText(url);
    setToast("Copied");
  }

  async function copyMarkdown(item: InboxConversationItem) {
    if (!token) return;
    setToast("Copying…");
    const result = await getInboxTimeline(token, item.id, undefined, 100);
    await navigator.clipboard.writeText(
      conversationMarkdown(result.conversation ?? item, result.messages),
    );
    setToast("Copied");
  }

  async function toggleBlock(item: InboxConversationItem) {
    if (!token) return;
    const result = item.blocked
      ? await unblockInboxConversation(token, item.id)
      : await blockInboxConversation(token, item.id);
    if (showBlocked ? !result.conversation.blocked : result.conversation.blocked) {
      drop(item.id);
      if (selectedId === item.id) select(null);
    } else {
      remember(result.conversation);
    }
    setRefreshKey((value) => value + 1);
  }

  async function confirmDelete() {
    if (!token || !pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteInboxConversation(token, id);
    drop(id);
    if (selectedId === id) select(null);
    setRefreshKey((value) => value + 1);
  }

  async function onMenuAction(action: ConversationMenuAction, item: InboxConversationItem) {
    setMenu(null);
    try {
      if (action === "call") await placeCall(item);
      else if (action === "done") await toggleDone(item);
      else if (action === "unread") await markUnread(item);
      else if (action === "task") setTaskFor(item);
      else if (action === "pin") await togglePin(item);
      else if (action === "link") await copyLink(item);
      else if (action === "markdown") await copyMarkdown(item);
      else if (action === "block") await toggleBlock(item);
      else if (action === "delete") setPendingDelete(item);
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Could not update the conversation");
    }
  }

  if (!token) return null;

  const showList = !selectedId;
  const showThread = Boolean(selectedId);
  const menuItem = menu ? findItem(menu.id) : null;
  const selectedItem = selectedId ? findItem(selectedId) : null;

  return (
    <section className="relative flex h-[calc(100dvh-8.5rem)] min-h-[32rem] overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)]">
      <div className={`min-h-0 w-full lg:w-[320px] lg:shrink-0 ${showList ? "block" : "hidden lg:block"}`}>
        <ConversationList
          tab={tab}
          chip={chip}
          channel={channel}
          closed={closed}
          showBlocked={showBlocked}
          query={query}
          conversations={conversations}
          pinned={pinned}
          selectedId={selectedId}
          loading={loading}
          error={error}
          hasMore={Boolean(nextCursor)}
          onTab={setTab}
          onChip={setChip}
          onChannel={setChannel}
          onClosed={setClosed}
          onShowBlocked={setShowBlocked}
          onQuery={setQuery}
          onSelect={select}
          onMore={() => {
            void loadMore();
          }}
          onContextMenu={(item, x, y) => setMenu({ x, y, id: item.id })}
          canWrite={canWrite}
          onNewCall={() => setNewCallOpen(true)}
        />
      </div>
      <div className={`min-h-0 min-w-0 flex-1 ${showThread ? "block" : "hidden lg:block"}`}>
        {selectedId ? (
          <ConversationThread
            token={token}
            conversationId={selectedId}
            channels={channels}
            canWrite={canWrite}
            canTasks={canTasks}
            refreshKey={refreshKey}
            onBack={() => select(null)}
            onActivity={() => setRefreshKey((value) => value + 1)}
            onConversation={(conversation) => {
              remember(conversation);
            }}
            onAction={(action, conversation) => {
              void onMenuAction(action, conversation);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--staff-muted)]">
            Select a conversation
          </div>
        )}
      </div>
      {selectedId ? (
        <div
          className={`min-h-0 w-full lg:w-[300px] lg:shrink-0 ${
            contextOpen ? "absolute inset-0 z-10 lg:static" : "hidden lg:block"
          }`}
        >
          <CustomerContextPanel
            token={token}
            conversationId={selectedId}
            canWrite={canWrite}
            canTasks={canTasks}
            canReadTasks={canReadTasks}
            refreshKey={refreshKey}
            onLinked={(id) => {
              select(id);
              setRefreshKey((value) => value + 1);
            }}
            onText={() => setContextOpen(false)}
            onActivity={() => setRefreshKey((value) => value + 1)}
            onCreateTask={() => {
              setTaskFor(
                selectedItem ?? {
                  id: selectedId,
                  customerId: null,
                  displayName: "",
                  handle: "",
                  handleKind: "phone",
                  phone: "",
                  email: "",
                  lastMessageAt: null,
                  lastPreview: "",
                  lastChannel: null,
                  lastDirection: null,
                  unreadCount: 0,
                  status: "open",
                  readAt: null,
                  readByName: null,
                  pinned: false,
                  blocked: false,
                  openTaskCount: 0,
                  ourNumber: "",
                  emailAccountId: null,
                },
              );
            }}
          />
        </div>
      ) : null}
      {selectedId ? (
        <button
          type="button"
          onClick={() => setContextOpen((open) => !open)}
          className="absolute bottom-28 right-4 rounded-full bg-[var(--staff-ink)] px-3 py-2 text-xs font-medium text-[var(--staff-surface)] lg:hidden"
        >
          {contextOpen ? "Hide details" : "Details"}
        </button>
      ) : null}
      {menu && menuItem ? (
        <ConversationContextMenu
          x={menu.x}
          y={menu.y}
          item={menuItem}
          canWrite={canWrite}
          canTasks={canTasks}
          onClose={() => setMenu(null)}
          onAction={(action) => {
            void onMenuAction(action, menuItem);
          }}
        />
      ) : null}
      {pendingDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-[var(--staff-ink)]">Delete conversation</h2>
            <p className="mt-2 text-sm text-[var(--staff-muted)]">
              This removes the chat from the inbox. The messages stay on file, and a new message
              brings the chat back.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--staff-muted)] hover:bg-[var(--staff-cream)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void confirmDelete();
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {taskFor ? (
        <TaskDialog
          token={token}
          draft={{
            conversationId: taskFor.id,
            customerId: taskFor.customerId || undefined,
            title: `Follow up with ${taskFor.displayName || "customer"}`,
            description: [
              taskFor.lastPreview,
              `${window.location.origin}/dashboard/inboxes?c=${taskFor.id}`,
            ]
              .filter(Boolean)
              .join("\n"),
          }}
          onClose={() => setTaskFor(null)}
          onSaved={() => {
            setTaskFor(null);
            setToast("Task created");
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
      {newCallOpen && token ? (
        <NewCallDialog
          token={token}
          channels={channels}
          onClose={() => setNewCallOpen(false)}
          onStarted={(conversationId) => {
            setTab("calls");
            select(conversationId);
            setNewCallOpen(false);
            setRefreshKey((value) => value + 1);
          }}
        />
      ) : null}
      {toast ? (
        <p className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-[var(--staff-ink)] px-3 py-1.5 text-xs text-[var(--staff-surface)]">
          {toast}
        </p>
      ) : null}
    </section>
  );
}
