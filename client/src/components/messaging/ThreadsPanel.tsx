"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Phone } from "lucide-react";
import {
  ApiError,
  MessageThreadDetail,
  MessageThreadItem,
  TwilioAccountItem,
  TwilioCommunicationItem,
  getMessagingCommunications,
  getMessagingThreadDetail,
  getMessagingThreads,
} from "@/lib/api";
import CustomerThreadsPanel from "./CustomerThreadsPanel";
import {
  VoiceCallRow,
  buildVoiceCallRows,
  formatDuration,
  formatRelativeTime,
  groupCustomersByRef,
  unknownVoiceRows,
  voiceRowFromMessage,
  voiceTranscript,
} from "./conversationUtils";

type ThreadsPanelProps = {
  token: string;
  accounts: TwilioAccountItem[];
};

export default function ThreadsPanel({ token, accounts }: ThreadsPanelProps) {
  const searchParams = useSearchParams();
  const initialThreadId = searchParams.get("threadId");
  const initialContactId = searchParams.get("contactId");
  const consumedDeepLink = useRef(false);

  const [filterAccountId, setFilterAccountId] = useState("");
  const [threads, setThreads] = useState<MessageThreadItem[]>([]);
  const [voiceComms, setVoiceComms] = useState<TwilioCommunicationItem[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedCustomerRef, setSelectedCustomerRef] = useState<string | null>(
    null,
  );
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [voiceDetail, setVoiceDetail] = useState<VoiceCallRow | null>(null);
  const [loadingVoiceDetail, setLoadingVoiceDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useMemo(() => groupCustomersByRef(threads), [threads]);
  const voiceRows = useMemo(
    () => unknownVoiceRows(buildVoiceCallRows(voiceComms, threads)),
    [voiceComms, threads],
  );
  const selectedCustomer =
    customers.find((c) => c.customerRef === selectedCustomerRef) ?? null;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingThreads(true);
    });

    const threadOpts = {
      twilioAccountId: filterAccountId || undefined,
      pageSize: 100,
    };

    Promise.all([
      getMessagingThreads(token, threadOpts),
      getMessagingCommunications(token, {
        twilioAccountId: filterAccountId || undefined,
        channel: "voice",
        pageSize: 100,
      }).catch(() => ({ communications: [] as TwilioCommunicationItem[] })),
    ])
      .then(([threadRes, commRes]) => {
        if (cancelled) return;
        setThreads(threadRes.threads);
        setVoiceComms(commRes.communications);
        if (!consumedDeepLink.current) {
          consumedDeepLink.current = true;
          const match = initialThreadId
            ? threadRes.threads.find((t) => t._id === initialThreadId)
            : initialContactId
              ? threadRes.threads.find((t) => t.contactRef === initialContactId)
              : undefined;
          if (match?.customerRef) {
            setSelectedCustomerRef(match.customerRef);
          } else if (match && !match.customerRef) {
            const voiceMatch =
              commRes.communications.find(
                (c) =>
                  c.threadRef === match._id || c.contactRef === match.contactRef,
              ) ?? null;
            setSelectedVoiceId(voiceMatch?._id ?? match._id);
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
  }, [token, filterAccountId]);

  const selectedVoiceRow =
    voiceRows.find((row) => row.id === selectedVoiceId) ?? null;

  useEffect(() => {
    if (!selectedVoiceRow) {
      queueMicrotask(() => setVoiceDetail(null));
      return;
    }

    queueMicrotask(() => setVoiceDetail(selectedVoiceRow));

    const threadId = selectedVoiceRow.thread?._id;
    if (!threadId) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoadingVoiceDetail(true);
    });
    getMessagingThreadDetail(token, threadId)
      .then((res: MessageThreadDetail) => {
        if (cancelled) return;
        const voiceMsgs = res.messages.filter((m) => m.channel === "voice");
        const match =
          voiceMsgs.find((m) => m._id === selectedVoiceRow.id) ??
          (selectedVoiceRow.communication
            ? voiceMsgs.find(
                (m) =>
                  m.twilioSid === selectedVoiceRow.communication?.twilioSid,
              )
            : undefined) ??
          voiceMsgs[voiceMsgs.length - 1];
        if (match) {
          setVoiceDetail(voiceRowFromMessage(match, res.thread));
        }
      })
      .catch(() => {
        /* list payload is enough to render a missing-transcript state */
      })
      .finally(() => {
        if (!cancelled) setLoadingVoiceDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedVoiceRow]);

  const shownVoice = voiceDetail ?? selectedVoiceRow;
  const transcriptText = shownVoice
    ? voiceTranscript({
        transcript: shownVoice.transcript,
        body: shownVoice.communication?.body,
      })
    : "";

  function selectCustomer(customerRef: string) {
    setSelectedVoiceId(null);
    setSelectedCustomerRef(customerRef);
  }

  function selectVoice(id: string) {
    setSelectedCustomerRef(null);
    setSelectedVoiceId(id);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section
        className={`flex h-full flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm md:min-h-[420px] ${
          selectedVoiceId ? "hidden md:flex" : "flex"
        } ${selectedCustomerRef ? "min-h-0" : "min-h-[420px] md:min-h-[420px]"}`}
      >
        <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-3 py-2">
          <h2 className="text-sm font-semibold text-brand-dark">
            Conversations
          </h2>
          {accounts.length > 0 ? (
            <select
              value={filterAccountId}
              onChange={(e) => setFilterAccountId(e.target.value)}
              className="rounded-md border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2 py-1 text-[11px] text-neutral-600 outline-none focus:border-brand-orange"
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

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          <div
            className={`max-h-[480px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
              selectedCustomerRef ? "hidden md:block" : "block"
            }`}
          >
            {loadingThreads ? (
              <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : customers.length === 0 ? (
              <p className="p-3 text-xs text-neutral-500">
                No conversations yet. Send from Message Wizard to start one.
              </p>
            ) : (
              <ul>
                {customers.map((row) => {
                  const active = selectedCustomerRef === row.customerRef;
                  return (
                    <li key={row.customerRef}>
                      <button
                        type="button"
                        onClick={() => selectCustomer(row.customerRef)}
                        className={`w-full border-b border-[var(--staff-border)] px-3 py-2.5 text-left ${
                          active
                            ? "border-l-2 border-l-brand-orange bg-orange-50"
                            : "hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-brand-dark">
                            {row.displayName}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              row.status === "open"
                                ? "bg-green-50 text-green-700"
                                : "bg-neutral-100 text-neutral-500"
                            }`}
                          >
                            {row.status}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-neutral-500">
                          {row.preview || "—"}
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          {formatRelativeTime(row.lastMessageAt)}
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
              selectedCustomerRef ? "flex" : "hidden md:flex"
            }`}
          >
            {selectedCustomer ? (
              <CustomerThreadsPanel
                token={token}
                customerName={selectedCustomer.displayName}
                threads={selectedCustomer.threads}
                initialThreadId={initialThreadId}
                initialContactId={initialContactId}
                onBack={() => setSelectedCustomerRef(null)}
              />
            ) : (
              <div className="flex flex-1 items-center p-4 text-xs text-neutral-500">
                Select a customer to see that customer&apos;s contact threads.
              </div>
            )}
          </div>
        </div>
      </section>

      <section
        className={`flex flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-cream,#faf4ee)] shadow-sm ${
          selectedCustomerRef ? "hidden md:flex" : "flex"
        } ${selectedVoiceId ? "min-h-0 md:min-h-[320px]" : "min-h-[320px]"}`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2">
          <Phone className="h-4 w-4 text-brand-orange" />
          <h2 className="text-sm font-semibold text-brand-dark">
            Voice Threads
          </h2>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          <div
            className={`max-h-[420px] overflow-y-auto border-[var(--staff-border)] md:border-r ${
              selectedVoiceId ? "hidden md:block" : "block"
            }`}
          >
            {loadingThreads ? (
              <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : voiceRows.length === 0 ? (
              <p className="p-3 text-xs text-neutral-500">
                No unknown callers. Identified calls appear under Conversations.
              </p>
            ) : (
              <ul>
                {voiceRows.map((row) => {
                  const active = selectedVoiceId === row.id;
                  const duration = formatDuration(row.durationSeconds);
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => selectVoice(row.id)}
                        className={`flex w-full items-start gap-2 border-b border-[var(--staff-border)] px-3 py-2.5 text-left ${
                          active
                            ? "border-l-2 border-l-brand-orange bg-orange-50"
                            : "hover:bg-[var(--staff-surface)]"
                        }`}
                      >
                        <Phone className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-brand-dark">
                            {row.displayName}
                          </div>
                          <div className="truncate text-[11px] text-neutral-500">
                            {row.phone || "—"}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {row.direction === "outbound"
                              ? "Outbound call"
                              : "Inbound call"}
                            {duration ? ` · ${duration}` : ""}
                          </div>
                          <div className="text-[10px] text-neutral-400">
                            {formatRelativeTime(row.createdAt)}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            className={`flex-col bg-[var(--staff-surface)] ${
              selectedVoiceId ? "flex min-h-0 flex-1" : "hidden min-h-[240px] md:flex"
            }`}
          >
            <div className="flex items-center gap-2 border-b border-[var(--staff-border)] px-3 py-2">
              {selectedVoiceId ? (
                <button
                  type="button"
                  onClick={() => setSelectedVoiceId(null)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--staff-border)] px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-white md:hidden"
                >
                  Back
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-brand-dark">
                  {shownVoice ? shownVoice.displayName : "Select a call"}
                </p>
                {shownVoice ? (
                  <p className="text-[11px] text-neutral-500">
                    {new Date(shownVoice.createdAt).toLocaleString()}
                    {shownVoice.durationSeconds != null
                      ? ` · ${formatDuration(shownVoice.durationSeconds)}`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingVoiceDetail && !shownVoice ? (
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              ) : !shownVoice ? (
                <p className="text-xs text-neutral-500">
                  Pick a call to read its transcript.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-neutral-500">
                    {shownVoice.phone || "Unknown caller"}
                  </p>
                  {transcriptText ? (
                    <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-brand-dark sm:text-base">
                      {transcriptText}
                    </p>
                  ) : (
                    <p className="text-[15px] text-neutral-500 sm:text-base">
                      Transcript isn&apos;t available yet.
                    </p>
                  )}
                  {shownVoice.recordingUrl ? (
                    <audio
                      controls
                      src={shownVoice.recordingUrl}
                      className="w-full"
                    >
                      <a href={shownVoice.recordingUrl}>Download recording</a>
                    </audio>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
