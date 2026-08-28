"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Phone, Send, X } from "lucide-react";
import {
  ApiError,
  MessageThreadDetail,
  MessageThreadItem,
  TwilioAccountItem,
  closeMessagingThread,
  getMessagingThreadDetail,
  getMessagingThreads,
  placeMessagingCall,
  sendMessagingMessages,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import MessageBubble, { formatTime } from "./MessageBubble";

type ThreadsPanelProps = {
  token: string;
  accounts: TwilioAccountItem[];
};

export default function ThreadsPanel({ token, accounts }: ThreadsPanelProps) {
  const searchParams = useSearchParams();
  const initialThreadId = searchParams.get("threadId");
  const initialContactId = searchParams.get("contactId");
  const consumedDeepLink = useRef(false);

  // Independent account filter for browsing threads. Defaults to "All
  // accounts" so threads from every Twilio account are visible here,
  // regardless of which account is selected for sending on the Create tab.
  const [filterAccountId, setFilterAccountId] = useState("");

  const [threads, setThreads] = useState<MessageThreadItem[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<MessageThreadDetail | null>(
    null,
  );
  const [loadingThreadDetail, setLoadingThreadDetail] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [calling, setCalling] = useState(false);
  const [closingThread, setClosingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load thread list
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingThreads(true);
    });
    getMessagingThreads(token, {
      twilioAccountId: filterAccountId || undefined,
      pageSize: 100,
    })
      .then((res) => {
        if (cancelled) return;
        setThreads(res.threads);
        if (!consumedDeepLink.current) {
          consumedDeepLink.current = true;
          if (initialThreadId) {
            setSelectedThreadId(initialThreadId);
          } else if (initialContactId) {
            const match = res.threads.find(
              (t) => t.contactRef === initialContactId,
            );
            if (match) setSelectedThreadId(match._id);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load threads.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingThreads(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filterAccountId, refreshKey]);

  // Load selected thread detail
  useEffect(() => {
    if (!selectedThreadId) {
      queueMicrotask(() => setThreadDetail(null));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingThreadDetail(true);
    });
    getMessagingThreadDetail(token, selectedThreadId)
      .then((res) => {
        if (cancelled) return;
        setThreadDetail(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load thread.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingThreadDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedThreadId, refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  async function handleSendReply() {
    if (!threadDetail || !replyText.trim()) return;
    const contactId = threadDetail.thread.contactRef;
    if (!contactId) return;
    setSendingReply(true);
    setError(null);
    try {
      await sendMessagingMessages(token, {
        contactIds: [contactId],
        body: replyText,
        threadId: threadDetail.thread._id,
        twilioAccountId: threadDetail.thread.twilioAccountRef,
        fromNumber: threadDetail.thread.ourNumber,
      });
      setReplyText("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send reply.");
    } finally {
      setSendingReply(false);
    }
  }

  async function handleCall() {
    if (!threadDetail) return;
    const contactId = threadDetail.thread.contactRef;
    if (!contactId) return;
    const label =
      formatCustomerName(
        threadDetail.thread.contact?.first,
        threadDetail.thread.contact?.last,
      ) || "this contact";
    if (!window.confirm(`Place an outbound call to ${label}?`)) return;
    setCalling(true);
    setError(null);
    try {
      await placeMessagingCall(token, {
        contactId,
        twilioAccountId: threadDetail.thread.twilioAccountRef,
        fromNumber: threadDetail.thread.ourNumber,
      });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Call failed.");
    } finally {
      setCalling(false);
    }
  }

  async function handleCloseThread() {
    if (!threadDetail) return;
    setClosingThread(true);
    setError(null);
    try {
      await closeMessagingThread(token, threadDetail.thread._id);
      refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to close thread.",
      );
    } finally {
      setClosingThread(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* Thread browser */}
      <div className="flex h-full min-h-[420px] flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
          <h2 className="text-sm font-semibold text-brand-dark">Threads</h2>
          {accounts.length > 0 ? (
            <select
              value={filterAccountId}
              onChange={(e) => setFilterAccountId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 outline-none focus:border-brand-orange"
            >
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a._id} value={a._id}>
                  {a.friendlyName}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr]">
          <div
            className={`max-h-[480px] overflow-y-auto border-neutral-100 md:border-r ${
              selectedThreadId ? "hidden md:block" : "block"
            }`}
          >
            {loadingThreads ? (
              <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : threads.length === 0 ? (
              <p className="p-3 text-xs text-neutral-500">
                No threads yet. Pick recipients in the Create tab and send a
                message to start one.
              </p>
            ) : (
              <ul>
                {threads.map((t) => {
                  const active = selectedThreadId === t._id;
                  return (
                    <li key={t._id}>
                      <button
                        type="button"
                        onClick={() => setSelectedThreadId(t._id)}
                        className={`w-full border-b border-neutral-50 px-3 py-2 text-left ${
                          active ? "bg-orange-50" : "hover:bg-neutral-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-brand-dark">
                            {formatCustomerName(
                              t.contact?.first,
                              t.contact?.last,
                            ) || "Contact"}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              t.status === "open"
                                ? "bg-green-50 text-green-700"
                                : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-neutral-500">
                          {t.lastMessagePreview || t.lastMessageChannel || "—"}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-neutral-400">
                          <span className="truncate" title={t.accountSid}>
                            {t.accountFriendlyName || t.accountSid}
                          </span>
                          <span>·</span>
                          <span className="truncate">{t.ourNumber}</span>
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          {formatTime(t.lastMessageAt)}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            className={`min-h-[280px] flex-col ${
              selectedThreadId ? "flex" : "hidden md:flex"
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                {selectedThreadId ? (
                  <button
                    type="button"
                    onClick={() => setSelectedThreadId(null)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 md:hidden"
                  >
                    Back
                  </button>
                ) : null}
                <span className="truncate text-sm font-medium text-brand-dark">
                  {threadDetail
                    ? formatCustomerName(
                        threadDetail.thread.contact?.first,
                        threadDetail.thread.contact?.last,
                      ) || "Thread"
                    : "Select a thread"}
                </span>
              </div>
              {threadDetail ? (
                <div className="flex shrink-0 items-center gap-2">
                  {threadDetail.thread.status === "open" ? (
                    <button
                      type="button"
                      onClick={handleCloseThread}
                      disabled={closingThread}
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                    >
                      {closingThread ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">Close</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCall}
                    disabled={calling}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange disabled:opacity-50"
                  >
                    {calling ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Phone className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">Call</span>
                  </button>
                </div>
              ) : null}
            </div>
            {threadDetail ? (
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500">
                <span
                  className="truncate rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600"
                  title={threadDetail.thread.accountSid}
                >
                  {threadDetail.thread.accountFriendlyName ||
                    threadDetail.thread.accountSid}
                </span>
                <span className="truncate">
                  via {threadDetail.thread.ourNumber}
                </span>
              </div>
            ) : null}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[#f2f2f7] p-3">
              {loadingThreadDetail ? (
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading thread…
                </div>
              ) : !threadDetail ? (
                <p className="text-xs text-neutral-500">
                  Pick a thread on the left, or start one from the Create tab.
                </p>
              ) : threadDetail.messages.length === 0 ? (
                <p className="text-xs text-neutral-500">No messages yet.</p>
              ) : (
                threadDetail.messages.map((m) => (
                  <MessageBubble key={m._id} msg={m} />
                ))
              )}
            </div>
            {threadDetail ? (
              <div className="flex items-center gap-2 border-t border-neutral-100 p-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !sendingReply) handleSendReply();
                  }}
                  placeholder={
                    threadDetail.thread.status === "closed"
                      ? "Reply to reopen this thread…"
                      : "Type a reply…"
                  }
                  className="flex-1 rounded-full border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-brand-orange"
                />
                <button
                  type="button"
                  onClick={handleSendReply}
                  disabled={sendingReply || !replyText.trim()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#34c759] text-white disabled:opacity-50"
                >
                  {sendingReply ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
