"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  InboxChannels,
  InboxConversationItem,
  getInboxChannels,
  getInboxConversations,
  markInboxConversationRead,
} from "@/lib/api";
import { subscribeDashboardLive } from "@/lib/dashboardLive";
import { useAuthStore } from "@/store/useAuthStore";
import ConversationList, {
  InboxChannelFilter,
  InboxChip,
  InboxTab,
} from "./ConversationList";
import ConversationThread from "./ConversationThread";
import CustomerContextPanel from "./CustomerContextPanel";

export default function InboxesWorkspace() {
  const token = useAuthStore((state) => state.token);
  const canWrite = useAuthStore((state) => state.hasPermission("messages:write"));
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");

  const [tab, setTab] = useState<InboxTab>("chats");
  const [chip, setChip] = useState<InboxChip>("open");
  const [channel, setChannel] = useState<InboxChannelFilter>("");
  const [closed, setClosed] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [conversations, setConversations] = useState<InboxConversationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = `${closed}|${chip}|${tab}|${channel}|${debouncedQuery}|${refreshKey}`;
  const [loadedKey, setLoadedKey] = useState("");
  const loading = loadedKey !== requestKey;
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<InboxChannels | null>(null);
  const [contextOpen, setContextOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getInboxConversations(token, {
      status: closed ? "closed" : "open",
      filter: chip === "open" ? "" : chip,
      channel: tab === "calls" ? "voice" : channel,
      q: debouncedQuery,
    })
      .then((result) => {
        if (cancelled) return;
        setConversations(result.conversations);
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
  }, [token, closed, chip, tab, channel, debouncedQuery, requestKey]);

  async function loadMore() {
    if (!token || !nextCursor) return;
    const result = await getInboxConversations(token, {
      status: closed ? "closed" : "open",
      filter: chip === "open" ? "" : chip,
      channel: tab === "calls" ? "voice" : channel,
      q: debouncedQuery,
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
    return subscribeDashboardLive(token, () => setRefreshKey((value) => value + 1));
  }, [token]);

  useEffect(() => {
    if (!token || !selectedId) return;
    markInboxConversationRead(token, selectedId)
      .then((result) => {
        setConversations((current) =>
          current.map((item) => (item.id === result.conversation.id ? result.conversation : item)),
        );
      })
      .catch(() => undefined);
  }, [token, selectedId]);

  function select(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("c", id);
    else params.delete("c");
    const qs = params.toString();
    router.replace(qs ? `/dashboard/inboxes?${qs}` : "/dashboard/inboxes", { scroll: false });
    setContextOpen(false);
  }

  if (!token) return null;

  const showList = !selectedId;
  const showThread = Boolean(selectedId);

  return (
    <section className="relative flex h-[calc(100dvh-8.5rem)] min-h-[32rem] overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)]">
      <div className={`min-h-0 w-full lg:w-[320px] lg:shrink-0 ${showList ? "block" : "hidden lg:block"}`}>
        <ConversationList
          tab={tab}
          chip={chip}
          channel={channel}
          closed={closed}
          query={query}
          conversations={conversations}
          selectedId={selectedId}
          loading={loading}
          error={error}
          hasMore={Boolean(nextCursor)}
          onTab={setTab}
          onChip={setChip}
          onChannel={setChannel}
          onClosed={setClosed}
          onQuery={setQuery}
          onSelect={select}
          onMore={() => {
            void loadMore();
          }}
        />
      </div>
      <div className={`min-h-0 min-w-0 flex-1 ${showThread ? "block" : "hidden lg:block"}`}>
        {selectedId ? (
          <ConversationThread
            token={token}
            conversationId={selectedId}
            channels={channels}
            canWrite={canWrite}
            refreshKey={refreshKey}
            onBack={() => select(null)}
            onActivity={() => setRefreshKey((value) => value + 1)}
            onConversation={(conversation) => {
              setConversations((current) =>
                current.map((item) => (item.id === conversation.id ? conversation : item)),
              );
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
            refreshKey={refreshKey}
            onLinked={(id) => {
              select(id);
              setRefreshKey((value) => value + 1);
            }}
            onText={() => setContextOpen(false)}
            onActivity={() => setRefreshKey((value) => value + 1)}
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
    </section>
  );
}
