"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  ApiError,
  ContactFormSubmissionItem,
  getContactFormSubmissions,
  importContactFormSubmissions,
  markContactFormSubmissionRead,
} from "@/lib/api";

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type ContactFormSubmissionsPanelProps = {
  token: string;
};

function monthBounds(year: number, month: number): { from: string; to: string } {
  return {
    from: new Date(year, month, 1).toISOString(),
    to: new Date(year, month + 1, 1).toISOString(),
  };
}

export default function ContactFormSubmissionsPanel({
  token,
}: ContactFormSubmissionsPanelProps) {
  const [rows, setRows] = useState<ContactFormSubmissionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const searchParams = useSearchParams();
  const yearQuery = Number(searchParams.get("year"));
  const monthQuery = Number(searchParams.get("month"));
  const requestedMonth =
    Number.isInteger(yearQuery) &&
    yearQuery >= 2000 &&
    Number.isInteger(monthQuery) &&
    monthQuery >= 1 &&
    monthQuery <= 12
      ? `${yearQuery}-${monthQuery}`
      : "";
  const now = new Date();
  const [viewYear, setViewYear] = useState(
    requestedMonth ? yearQuery : now.getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    requestedMonth ? monthQuery - 1 : now.getMonth(),
  );
  const [appliedMonthRequest, setAppliedMonthRequest] =
    useState(requestedMonth);
  if (requestedMonth && requestedMonth !== appliedMonthRequest) {
    setAppliedMonthRequest(requestedMonth);
    setViewYear(yearQuery);
    setViewMonth(monthQuery - 1);
    setPage(1);
    setExpandedId(null);
  }
  const range = useMemo(
    () => monthBounds(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  function shiftMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setPage(1);
    setExpandedId(null);
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });

    getContactFormSubmissions(token, { page, pageSize: 25, ...range })
      .then((res) => {
        if (cancelled) return;
        setRows(res.submissions);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load contact form submissions.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, page, reloadKey, range]);

  const openRow = useCallback(
    async (row: ContactFormSubmissionItem) => {
      if (expandedId === row._id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(row._id);
      if (row.readAt) return;
      try {
        const res = await markContactFormSubmissionRead(token, row._id);
        setRows((prev) =>
          prev.map((item) =>
            item._id === row._id ? res.submission : item,
          ),
        );
      } catch {
        // The row stays unread so it can be opened again.
      }
    },
    [expandedId, token],
  );

  async function handleImport() {
    setImporting(true);
    setImportNote(null);
    setError(null);
    try {
      const res = await importContactFormSubmissions(token);
      setImportNote(
        `Imported ${res.imported}. Skipped ${res.skipped}.`,
      );
      setPage(1);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to import contact form mail.",
      );
    } finally {
      setImporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-dark">
          Contact Form
        </h2>
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-brand-dark">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-brand-dark"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-brand-dark hover:border-brand-orange disabled:opacity-60"
        >
          {importing ? "Importing…" : "Import from mailbox"}
        </button>
      </div>

      {importNote ? (
        <p className="text-sm text-neutral-600">{importNote}</p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading contact form submissions…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-neutral-500">
            No contact form submissions in {MONTH_NAMES[viewMonth]} {viewYear}.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const open = expandedId === row._id;
              const unread = !row.readAt;
              const name = `${row.firstName} ${row.lastName}`.trim();
              return (
                <li key={row._id}>
                  <button
                    type="button"
                    onClick={() => void openRow(row)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-sm text-brand-dark ${
                            unread ? "font-semibold" : "font-medium"
                          }`}
                        >
                          {name}
                        </span>
                        {unread ? (
                          <span className="rounded bg-brand-orange/10 px-1.5 py-0.5 text-[11px] font-medium text-brand-orange">
                            Unread
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-neutral-500">
                        {row.email}
                        {row.phone ? ` · ${row.phone}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-neutral-400">
                      {formatTime(row.createdAt)}
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-3 border-t border-neutral-100 bg-neutral-50 px-4 py-4 text-sm">
                      <p>
                        <span className="font-medium text-brand-dark">
                          Email:{" "}
                        </span>
                        <a
                          href={`mailto:${row.email}`}
                          className="text-brand-orange hover:underline"
                        >
                          {row.email}
                        </a>
                      </p>
                      <p>
                        <span className="font-medium text-brand-dark">
                          Phone:{" "}
                        </span>
                        {row.phone ? (
                          <a
                            href={`tel:${row.phone}`}
                            className="text-brand-orange hover:underline"
                          >
                            {row.phone}
                          </a>
                        ) : (
                          <span className="text-neutral-500">Not provided</span>
                        )}
                      </p>
                      <p className="whitespace-pre-wrap text-brand-dark">
                        {row.message}
                      </p>
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
            {total} submission{total === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
              onClick={() => setPage((current) => current + 1)}
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
