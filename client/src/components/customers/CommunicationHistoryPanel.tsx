"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquare, Phone } from "lucide-react";
import {
  ApiError,
  CommunicationChannel,
  CustomerContact,
  TwilioAccountItem,
  TwilioCommunicationItem,
  getMessagingCommunications,
  getTwilioAccounts,
  placeMessagingCall,
} from "@/lib/api";
import { formatCustomerName } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";

type ChannelFilter = "all" | CommunicationChannel;

function truncateSid(sid: string): string {
  if (sid.length <= 10) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

type CommunicationHistoryPanelProps = {
  customerId: string;
  contacts: CustomerContact[];
  token: string;
};

export default function CommunicationHistoryPanel({
  customerId,
  contacts,
  token,
}: CommunicationHistoryPanelProps) {
  const canWrite = useAuthStore((s) => s.hasPermission("messages:write"));
  const isAdmin = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );

  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [contactId, setContactId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<TwilioAccountItem[]>([]);
  const [rows, setRows] = useState<TwilioCommunicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callingContactId, setCallingContactId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getTwilioAccounts(token)
      .then((res) => setAccounts(res.accounts.filter((a) => a.isActive)))
      .catch(() => undefined);
  }, [token, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getMessagingCommunications(token, {
      customerId,
      contactId: contactId || undefined,
      twilioAccountId: accountId || undefined,
      channel,
      page,
      pageSize: 25,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.communications);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load communication history.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, customerId, contactId, accountId, channel, page, isAdmin]);

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of contacts) {
      map.set(
        c._id,
        formatCustomerName(c.first, c.last) || c.phone || "Contact",
      );
    }
    return map;
  }, [contacts]);

  if (!isAdmin) return null;

  async function handleCall(targetContactId: string) {
    const account = accounts.find((a) => a._id === accountId) || accounts[0];
    if (!account) {
      setError("Configure an active Twilio account first.");
      return;
    }
    const from = account.phoneNumbers[0];
    if (!from) {
      setError("Selected Twilio account has no phone numbers.");
      return;
    }
    const label = contactNameById.get(targetContactId) || "contact";
    if (!window.confirm(`Place an outbound call to ${label}?`)) return;

    setCallingContactId(targetContactId);
    setError(null);
    try {
      await placeMessagingCall(token, {
        contactId: targetContactId,
        twilioAccountId: account._id,
        fromNumber: from,
      });
      setPage(1);
      const res = await getMessagingCommunications(token, {
        customerId,
        contactId: contactId || undefined,
        twilioAccountId: accountId || undefined,
        channel,
        page: 1,
        pageSize: 25,
      });
      setRows(res.communications);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Call failed.");
    } finally {
      setCallingContactId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-brand-dark">
          Communication history
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["all", "sms", "mms", "voice"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setChannel(c);
                setPage(1);
              }}
              className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${
                channel === c
                  ? "bg-orange-50 text-brand-orange"
                  : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">All Twilio accounts</option>
          {accounts.map((a) => (
            <option key={a._id} value={a._id}>
              {a.friendlyName} ({truncateSid(a.accountSid)})
            </option>
          ))}
        </select>
        <select
          value={contactId}
          onChange={(e) => {
            setContactId(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        >
          <option value="">All contacts</option>
          {contacts.map((c) => (
            <option key={c._id} value={c._id}>
              {formatCustomerName(c.first, c.last) || c.phone || "Contact"}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading history…
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-sm text-neutral-500">
          No communications logged for this customer yet.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {rows.map((row) => (
            <li key={row._id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium uppercase text-neutral-700">
                      {row.channel}
                    </span>
                    <span className="capitalize">{row.direction}</span>
                    <span>{row.status}</span>
                    <span
                      className="rounded bg-neutral-50 px-1.5 py-0.5"
                      title={row.accountSid}
                    >
                      {row.accountFriendlyName || truncateSid(row.accountSid)}
                    </span>
                    {row.contactRef ? (
                      <span>
                        {contactNameById.get(row.contactRef) || "Contact"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-brand-dark whitespace-pre-wrap">
                    {row.channel === "voice"
                      ? row.transcript || row.body || "Voice call"
                      : row.body || "(no text)"}
                  </p>
                  {row.mediaUrls.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                      {row.mediaUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-xs text-brand-orange underline"
                        >
                          {url}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {row.errorMessage ? (
                    <p className="mt-1 text-xs text-red-600">
                      {row.errorMessage}
                    </p>
                  ) : null}
                </div>
                <div className="text-right text-[11px] text-neutral-400">
                  <div>{formatTime(row.createdAt)}</div>
                  {row.durationSeconds != null ? (
                    <div>{row.durationSeconds}s</div>
                  ) : null}
                </div>
              </div>
              {canWrite && row.contactRef ? (
                <div className="mt-2 flex gap-2">
                  <Link
                    href={`/dashboard/messaging?tab=threads&contactId=${row.contactRef}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-orange hover:underline"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    History
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleCall(row.contactRef!)}
                    disabled={callingContactId === row.contactRef}
                    className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-brand-dark disabled:opacity-50"
                  >
                    {callingContactId === row.contactRef ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Phone className="h-3.5 w-3.5" />
                    )}
                    Call
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
          <span>
            {total} event{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
