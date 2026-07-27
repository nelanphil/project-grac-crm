"use client";

import { useEffect, useState } from "react";
import { Loader2, Phone, RefreshCw } from "lucide-react";
import {
  ApiError,
  MessagingConversationItem,
  TwilioCommunicationItem,
  getMessagingConversationThread,
  getMessagingConversations,
  placeMessagingCall,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";

function truncateSid(sid: string): string {
  if (sid.length <= 10) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function AccountBadge({ name, sid }: { name: string | null; sid: string }) {
  return (
    <span
      className="inline-flex max-w-[140px] truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
      title={sid}
    >
      {name || truncateSid(sid)}
    </span>
  );
}

function MessageBubble({ msg }: { msg: TwilioCommunicationItem }) {
  const outbound = msg.direction === "outbound";
  if (msg.channel === "voice") {
    return (
      <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[90%] rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Phone className="h-3 w-3" />
            Voice call · {msg.status}
            {msg.durationSeconds != null ? ` · ${msg.durationSeconds}s` : ""}
          </div>
          {msg.body ? (
            <p className="text-neutral-500 whitespace-pre-wrap">{msg.body}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-400">
            <AccountBadge name={msg.accountFriendlyName} sid={msg.accountSid} />
            <span>{formatTime(msg.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
          outbound
            ? "rounded-br-md bg-[#34c759] text-white"
            : "rounded-bl-md bg-neutral-200 text-neutral-800"
        }`}
      >
        {msg.body || (msg.mediaUrls.length ? "(media)" : "")}
        {msg.mediaUrls.length > 0 ? (
          <div className="mt-2 space-y-1">
            {msg.mediaUrls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className={`block truncate text-[11px] underline ${
                  outbound ? "text-white/90" : "text-brand-orange"
                }`}
              >
                {url}
              </a>
            ))}
          </div>
        ) : null}
        <div
          className={`mt-1 flex items-center gap-2 text-[10px] ${
            outbound ? "text-white/70" : "text-neutral-500"
          }`}
        >
          <span className="uppercase">{msg.channel}</span>
          <AccountBadge name={msg.accountFriendlyName} sid={msg.accountSid} />
          <span>{formatTime(msg.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

type ConversationPanelProps = {
  token: string;
  twilioAccountId: string;
  fromNumber: string;
  focusedContactId?: string | null;
  onFocusContact?: (contactId: string) => void;
  refreshKey?: number;
};

export default function ConversationPanel({
  token,
  twilioAccountId,
  fromNumber,
  focusedContactId,
  onFocusContact,
  refreshKey = 0,
}: ConversationPanelProps) {
  const [conversations, setConversations] = useState<
    MessagingConversationItem[]
  >([]);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [prevFocusedContactId, setPrevFocusedContactId] = useState(
    focusedContactId ?? null,
  );
  const [messages, setMessages] = useState<TwilioCommunicationItem[]>([]);
  const [contactLabel, setContactLabel] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if ((focusedContactId ?? null) !== prevFocusedContactId) {
    setPrevFocusedContactId(focusedContactId ?? null);
    if (focusedContactId) setActiveContactId(focusedContactId);
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingList(true);
    });
    getMessagingConversations(token, {
      twilioAccountId: twilioAccountId || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setConversations(res.conversations);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load conversations.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, twilioAccountId, refreshKey]);

  useEffect(() => {
    if (!activeContactId) {
      queueMicrotask(() => setMessages([]));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingThread(true);
    });
    getMessagingConversationThread(token, activeContactId, {
      twilioAccountId: twilioAccountId || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages);
        setContactLabel(
          formatCustomerName(res.contact.first, res.contact.last) ||
            res.contact.phone,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load thread.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeContactId, twilioAccountId, refreshKey]);

  async function handleCall() {
    if (!activeContactId) return;
    if (!window.confirm(`Place an outbound call to ${contactLabel}?`)) return;
    setCalling(true);
    setError(null);
    try {
      await placeMessagingCall(token, {
        contactId: activeContactId,
        twilioAccountId: twilioAccountId || undefined,
        fromNumber: fromNumber || undefined,
      });
      const res = await getMessagingConversationThread(token, activeContactId, {
        twilioAccountId: twilioAccountId || undefined,
      });
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Call failed.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-brand-dark">
          Conversation history
        </h2>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[200px_1fr]">
        <div className="max-h-[420px] overflow-y-auto border-r border-neutral-100">
          {loadingList ? (
            <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-3 text-xs text-neutral-500">
              No conversations yet. Send a message to start a thread.
            </p>
          ) : (
            <ul>
              {conversations.map((c) => {
                const active = activeContactId === c.contactId;
                return (
                  <li key={c.contactId}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveContactId(c.contactId);
                        onFocusContact?.(c.contactId);
                      }}
                      className={`w-full border-b border-neutral-50 px-3 py-2 text-left ${
                        active ? "bg-orange-50" : "hover:bg-neutral-50"
                      }`}
                    >
                      <div className="truncate text-sm font-medium text-brand-dark">
                        {formatCustomerName(c.contact.first, c.contact.last) ||
                          "Contact"}
                      </div>
                      <div className="truncate text-[11px] text-neutral-500">
                        {c.lastMessage.body || c.lastMessage.channel}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-[280px] flex-col">
          <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
            <span className="text-sm font-medium text-brand-dark">
              {activeContactId
                ? contactLabel || "Thread"
                : "Select a conversation"}
            </span>
            {activeContactId ? (
              <button
                type="button"
                onClick={handleCall}
                disabled={calling || !fromNumber}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange disabled:opacity-50"
              >
                {calling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Phone className="h-3.5 w-3.5" />
                )}
                Call
              </button>
            ) : null}
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#f2f2f7] p-3">
            {loadingThread ? (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading thread…
              </div>
            ) : !activeContactId ? (
              <p className="text-xs text-neutral-500">
                Pick a conversation or select a single recipient to open their
                thread.
              </p>
            ) : messages.length === 0 ? (
              <p className="text-xs text-neutral-500">No messages yet.</p>
            ) : (
              messages.map((m) => <MessageBubble key={m._id} msg={m} />)
            )}
          </div>
          {activeContactId ? (
            <button
              type="button"
              className="flex items-center justify-center gap-1 border-t border-neutral-100 py-1.5 text-[11px] text-neutral-500 hover:text-brand-dark"
              onClick={() => {
                // trigger parent refresh by re-fetching locally
                setActiveContactId((id) => (id ? `${id}` : id));
                getMessagingConversationThread(token, activeContactId, {
                  twilioAccountId: twilioAccountId || undefined,
                }).then((res) => setMessages(res.messages));
              }}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh thread
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
