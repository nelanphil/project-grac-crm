"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Phone, Send, X } from "lucide-react";
import {
  ApiError,
  MessageThreadDetail,
  MessageThreadItem,
  closeMessagingThread,
  getMessagingThreadDetail,
  placeMessagingCall,
  sendMessagingMessages,
} from "@/lib/api";
import MessageBubble from "./MessageBubble";
import {
  contactDisplayName,
  contactThreadKey,
  formatPhone,
  formatRelativeTime,
  uniqueContactThreads,
} from "./conversationUtils";

type CustomerThreadsPanelProps = {
  token: string;
  customerName: string;
  threads: MessageThreadItem[];
  initialThreadId?: string | null;
  initialContactId?: string | null;
  onBack: () => void;
};

export default function CustomerThreadsPanel({
  token,
  customerName,
  threads,
  initialThreadId,
  initialContactId,
  onBack,
}: CustomerThreadsPanelProps) {
  const contactThreads = useMemo(
    () => uniqueContactThreads(threads),
    [threads],
  );

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    null,
  );
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

  useEffect(() => {
    if (initialThreadId) {
      const match = contactThreads.find((t) => t._id === initialThreadId);
      if (match) {
        setSelectedThreadId(match._id);
        return;
      }
    }
    if (initialContactId) {
      const match = contactThreads.find(
        (t) => t.contactRef === initialContactId,
      );
      if (match) setSelectedThreadId(match._id);
    }
  }, [contactThreads, initialThreadId, initialContactId]);

  const selectedThread =
    contactThreads.find((t) => t._id === selectedThreadId) ?? null;

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

  const contactRef = threadDetail?.thread.contactRef ?? null;
  const conversationMessages = threadDetail?.messages ?? [];

  async function handleSendReply() {
    if (!threadDetail || !replyText.trim() || !contactRef) return;
    setSendingReply(true);
    setError(null);
    try {
      await sendMessagingMessages(token, {
        contactIds: [contactRef],
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
    if (!threadDetail || !contactRef) return;
    const label = contactDisplayName(threadDetail.thread);
    if (!window.confirm(`Place an outbound call to ${label}?`)) return;
    setCalling(true);
    setError(null);
    try {
      await placeMessagingCall(token, {
        contactId: contactRef,
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
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div className="mx-3 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[240px_1fr]">
        <div
          className={`max-h-[480px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
            selectedThreadId ? "hidden md:block" : "block"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--staff-border)] px-3 py-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-[var(--staff-surface)] md:hidden"
            >
              Back
            </button>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-brand-dark">
                {customerName}
              </h3>
              <p className="truncate text-[11px] text-neutral-500">
                {contactThreads.length} contact
                {contactThreads.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {contactThreads.length === 0 ? (
            <p className="p-3 text-xs text-neutral-500">
              No conversations yet. Send from Message Wizard to start one.
            </p>
          ) : (
            <ul>
              {contactThreads.map((t) => {
                const active = selectedThreadId === t._id;
                return (
                  <li key={contactThreadKey(t)}>
                    <button
                      type="button"
                      onClick={() => setSelectedThreadId(t._id)}
                      className={`w-full border-b border-[var(--staff-border)] px-3 py-2 text-left ${
                        active
                          ? "border-l-2 border-l-brand-orange bg-orange-50"
                          : "hover:bg-[var(--staff-surface)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-brand-dark">
                          {contactDisplayName(t)}
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
                        <span className="truncate">
                          {formatPhone(t.contactPhoneSnapshot) || t.ourNumber}
                        </span>
                        <span>·</span>
                        <span className="truncate">{t.ourNumber}</span>
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        {formatRelativeTime(t.lastMessageAt)}
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
          <div className="flex items-center justify-between gap-2 border-b border-[var(--staff-border)] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {selectedThreadId ? (
                <button
                  type="button"
                  onClick={() => setSelectedThreadId(null)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-[var(--staff-surface)] md:hidden"
                >
                  Back
                </button>
              ) : null}
              <span className="truncate text-sm font-medium text-brand-dark">
                {threadDetail
                  ? contactDisplayName(threadDetail.thread)
                  : selectedThread
                    ? contactDisplayName(selectedThread)
                    : "Select a contact"}
              </span>
            </div>
            {threadDetail && contactRef ? (
              <div className="flex shrink-0 items-center gap-2">
                {threadDetail.thread.status === "open" ? (
                  <button
                    type="button"
                    onClick={handleCloseThread}
                    disabled={closingThread}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
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
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange disabled:opacity-50"
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
            <div className="flex items-center gap-2 border-b border-[var(--staff-border)] px-3 py-1.5 text-[11px] text-neutral-500">
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
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto bg-[var(--staff-surface)] p-3">
            {loadingThreadDetail ? (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : !threadDetail ? (
              <p className="text-xs text-neutral-500">
                Pick a contact to open that conversation.
              </p>
            ) : conversationMessages.length === 0 ? (
              <p className="text-xs text-neutral-500">No messages yet.</p>
            ) : (
              conversationMessages.map((m) => (
                <MessageBubble key={m._id} msg={m} />
              ))
            )}
          </div>
          {threadDetail ? (
            <div className="flex items-center gap-2 border-t border-[var(--staff-border)] p-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sendingReply) handleSendReply();
                }}
                placeholder={
                  !contactRef
                    ? "No contact to reply to"
                    : threadDetail.thread.status === "closed"
                      ? "Reply to reopen this thread…"
                      : "Type a reply…"
                }
                disabled={!contactRef}
                className="flex-1 rounded-full border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-sm outline-none focus:border-brand-orange disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSendReply}
                disabled={sendingReply || !replyText.trim() || !contactRef}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-orange text-white disabled:opacity-50"
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
  );
}
