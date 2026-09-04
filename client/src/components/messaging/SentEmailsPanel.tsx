"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import {
  ApiError,
  EmailCommunicationItem,
  EmailSendAccountItem,
  getEmailSendAccounts,
  getSentEmails,
} from "@/lib/api";
import EmailPreview from "./EmailPreview";

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

type StatusFilter = "" | "sent" | "failed";

type SentEmailsPanelProps = {
  token: string;
};

export default function SentEmailsPanel({ token }: SentEmailsPanelProps) {
  const [rows, setRows] = useState<EmailCommunicationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<EmailSendAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    getEmailSendAccounts(token)
      .then((res) => setAccounts(res.accounts))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getSentEmails(token, {
      status: status || undefined,
      emailAccountId: accountId || undefined,
      page,
      pageSize: 25,
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.emails);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load sent emails.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, status, accountId, page]);

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-dark">Sent Emails</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.friendlyName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sent emails…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-500">
            No sent emails yet.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const open = expandedId === row._id;
              return (
                <li key={row._id}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId((id) => (id === row._id ? null : row._id))
                    }
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium uppercase ${
                            row.status === "sent"
                              ? "bg-green-50 text-green-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {row.status}
                        </span>
                        <span>{row.toEmail}</span>
                        <span>
                          {row.accountFriendlyName ||
                            `${row.fromName} <${row.fromEmail}>`}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-brand-dark">
                        {row.subject || "(no subject)"}
                      </p>
                      {row.errorMessage ? (
                        <p className="mt-1 text-xs text-red-600">
                          {row.errorMessage}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-[11px] text-neutral-400">
                      {formatTime(row.createdAt)}
                    </span>
                  </button>
                  {open ? (
                    <div className="border-t border-neutral-100 bg-neutral-50 px-4 py-4">
                      <EmailPreview
                        fromLabel={`${row.fromName} <${row.fromEmail}>`}
                        toLabel={row.toEmail}
                        subject={row.subject}
                        html={row.html}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-xs text-neutral-500">
          <span>
            {total} email{total === 1 ? "" : "s"}
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
    </div>
  );
}
