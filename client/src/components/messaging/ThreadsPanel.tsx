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
  UNKNOWN_VOICE_KEY,
  VoiceCallRow,
  VoiceContactGroup,
  buildVoiceCallRows,
  formatRelativeTime,
  groupCustomersByRef,
  groupVoiceCustomers,
  voiceContactKey,
  voiceRowFromMessage,
} from "./conversationUtils";
import VoiceCustomerPanel from "./VoiceCustomerPanel";

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
  const [selectedVoiceGroupKey, setSelectedVoiceGroupKey] = useState<
    string | null
  >(null);
  const [selectedVoiceContactKey, setSelectedVoiceContactKey] = useState<
    string | null
  >(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [voiceDetails, setVoiceDetails] = useState<VoiceCallRow[]>([]);
  const [loadingVoiceDetail, setLoadingVoiceDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false);
  const [voiceCollapsed, setVoiceCollapsed] = useState(false);

  const customers = useMemo(() => groupCustomersByRef(threads), [threads]);
  const voiceRows = useMemo(
    () => buildVoiceCallRows(voiceComms, threads),
    [voiceComms, threads],
  );
  const voiceGroups = useMemo(
    () => groupVoiceCustomers(voiceRows),
    [voiceRows],
  );
  const selectedCustomer =
    customers.find((c) => c.customerRef === selectedCustomerRef) ?? null;
  const selectedVoiceGroup =
    voiceGroups.find((g) => g.key === selectedVoiceGroupKey) ?? null;
  const voiceOpen = Boolean(selectedVoiceGroupKey);

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
            setSelectedVoiceGroupKey(UNKNOWN_VOICE_KEY);
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
    if (!selectedVoiceId || selectedVoiceContactKey) return;
    const row = voiceRows.find((r) => r.id === selectedVoiceId);
    if (!row) return;
    const groupKey = row.customerRef ?? UNKNOWN_VOICE_KEY;
    queueMicrotask(() => {
      setSelectedVoiceGroupKey(groupKey);
      setSelectedVoiceContactKey(voiceContactKey(row));
    });
  }, [selectedVoiceId, selectedVoiceContactKey, voiceRows]);

  useEffect(() => {
    if (!selectedVoiceRow) {
      queueMicrotask(() => setVoiceDetails([]));
      return;
    }

    queueMicrotask(() => setVoiceDetails([selectedVoiceRow]));

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
        if (voiceMsgs.length) {
          setVoiceDetails(
            voiceMsgs.map((m) => voiceRowFromMessage(m, res.thread)),
          );
        } else if (match) {
          setVoiceDetails([voiceRowFromMessage(match, res.thread)]);
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

  const shownVoices = voiceDetails.length
    ? voiceDetails
    : selectedVoiceRow
      ? [selectedVoiceRow]
      : [];

  function clearVoice() {
    setSelectedVoiceGroupKey(null);
    setSelectedVoiceContactKey(null);
    setSelectedVoiceId(null);
  }

  function selectCustomer(customerRef: string) {
    setVoiceCollapsed(true);
    setConversationsCollapsed(false);
    clearVoice();
    setSelectedCustomerRef(customerRef);
  }

  function selectVoiceGroup(key: string) {
    setConversationsCollapsed(true);
    setVoiceCollapsed(false);
    setSelectedCustomerRef(null);
    setSelectedVoiceGroupKey(key);
    setSelectedVoiceContactKey(null);
    setSelectedVoiceId(null);
  }

  function selectVoiceContact(contact: VoiceContactGroup) {
    setSelectedVoiceContactKey(contact.key);
    setSelectedVoiceId(contact.calls[0]?.id ?? null);
  }

  function clearVoiceContact() {
    setSelectedVoiceContactKey(null);
    setSelectedVoiceId(null);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section
        className={`flex flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm ${
          conversationsCollapsed
            ? "flex md:min-h-0"
            : `flex h-full ${selectedCustomerRef ? "min-h-0" : "min-h-[420px] md:min-h-[420px]"}`
        }`}
      >
            <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-3 py-2">
              <h2 className="text-sm font-semibold text-brand-dark">
                Conversations
              </h2>
              <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={() => setConversationsCollapsed((c) => !c)}
              className="text-[11px] text-neutral-500 hover:text-brand-dark"
            >
              {conversationsCollapsed ? "Show" : "Hide"}
            </button>
              </div>
            </div>
            {conversationsCollapsed ? null : (
          <>

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
                    Select a customer to see that customer&apos;s contact
                    threads.
                  </div>
                )}
              </div>
            </div>
          </>
            )}
      </section>

      <section
        className={`flex flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm ${
          voiceCollapsed
            ? "flex md:min-h-0"
            : `flex ${voiceOpen ? "min-h-[420px] md:min-h-[480px]" : "min-h-[320px]"}`
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-2">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-brand-orange" />
            <h2 className="text-sm font-semibold text-brand-dark">
              Voice Threads
            </h2>
          </div>
          <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={() => setVoiceCollapsed((c) => !c)}
              className="text-[11px] text-neutral-500 hover:text-brand-dark"
            >
              {voiceCollapsed ? "Show" : "Hide"}
            </button>
          </div>
        </div>

        {voiceCollapsed ? null : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          <div
            className={`overflow-y-auto border-[var(--staff-border)] md:border-r ${
              selectedVoiceGroupKey
                ? "hidden md:block md:max-h-none"
                : "block max-h-[420px]"
            }`}
          >
            {loadingThreads ? (
              <div className="flex items-center gap-2 p-3 text-xs text-neutral-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : voiceGroups.length === 0 ? (
              <p className="p-3 text-xs text-neutral-500">No calls yet.</p>
            ) : (
              <ul>
                {voiceGroups.map((group) => {
                  const active = selectedVoiceGroupKey === group.key;
                  return (
                    <li key={group.key}>
                      <button
                        type="button"
                        onClick={() => selectVoiceGroup(group.key)}
                        className={`w-full border-b border-[var(--staff-border)] px-3 py-2.5 text-left ${
                          active
                            ? "border-l-2 border-l-brand-orange bg-orange-50"
                            : "hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-brand-dark">
                            {group.displayName}
                          </span>
                          {group.unknown || !group.status ? null : (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                group.status === "open"
                                  ? "bg-green-50 text-green-700"
                                  : "bg-neutral-100 text-neutral-500"
                              }`}
                            >
                              {group.status}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-neutral-500">
                          {group.preview || "—"}
                        </div>
                        <div className="text-[10px] text-neutral-400">
                          {formatRelativeTime(group.lastCallAt)}
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
              selectedVoiceGroupKey
                ? "flex min-h-0 flex-1"
                : "hidden min-h-[240px] md:flex"
            }`}
          >
            {selectedVoiceGroup ? (
              <VoiceCustomerPanel
                group={selectedVoiceGroup}
                selectedContactKey={selectedVoiceContactKey}
                selectedVoiceId={selectedVoiceId}
                shownVoices={shownVoices}
                loadingVoiceDetail={loadingVoiceDetail}
                onBack={clearVoice}
                onSelectContact={selectVoiceContact}
                onClearContact={clearVoiceContact}
                onSelectCall={setSelectedVoiceId}
              />
            ) : (
              <div className="flex flex-1 items-center p-4 text-xs text-neutral-500">
                Select a customer to see that customer&apos;s calls.
              </div>
            )}
          </div>
        </div>
        )}
      </section>
    </div>
  );
}
