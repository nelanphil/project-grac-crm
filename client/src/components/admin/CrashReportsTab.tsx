"use client";

import { useEffect, useState } from "react";
import {
  getCrashReport,
  listCrashReports,
  updateCrashReport,
  ApiError,
  type CrashReportDetail,
  type CrashReportStatus,
  type CrashReportSummary,
} from "@/lib/api";

type StatusFilter = "all" | CrashReportStatus;

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function who(report: { userEmail: string; reporterEmail: string }): string {
  return report.userEmail || report.reporterEmail || "Anonymous";
}

function StatusBadge({ status }: { status: CrashReportStatus }) {
  const open = status === "open";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
        open
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-green-200 bg-green-50 text-green-800"
      }`}
    >
      {open ? "Open" : "Resolved"}
    </span>
  );
}

export default function CrashReportsTab({ token }: { token: string | null }) {
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<CrashReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrashReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listCrashReports(token, { page, pageSize, status: filter })
      .then((data) => {
        if (cancelled) return;
        setReports(data.reports);
        setTotal(data.total);
        setOpenCount(data.openCount);
        setResolvedCount(data.resolvedCount);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load reports.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, filter, listVersion]);

  useEffect(() => {
    if (!token || !selectedId) return;
    let cancelled = false;
    getCrashReport(token, selectedId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data.report);
        setNote(data.report.resolutionNote);
        setDetailError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setDetailError(
          err instanceof ApiError ? err.message : "Could not load this report.",
        );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, selectedId]);

  async function setStatus(status: CrashReportStatus) {
    if (!token || !detail || saving) return;
    setSaving(true);
    setDetailError("");
    try {
      const data = await updateCrashReport(token, detail.id, {
        status,
        resolutionNote: note,
      });
      setDetail(data.report);
      setNote(data.report.resolutionNote);
      setLoading(true);
      setListVersion((version) => version + 1);
    } catch (err) {
      setDetailError(
        err instanceof ApiError ? err.message : "Could not update this report.",
      );
    } finally {
      setSaving(false);
    }
  }

  const filters: { id: StatusFilter; label: string; count?: number }[] = [
    { id: "open", label: "Open", count: openCount },
    { id: "resolved", label: "Resolved", count: resolvedCount },
    { id: "all", label: "All", count: openCount + resolvedCount },
  ];

  if (selectedId) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <button
            type="button"
            onClick={() => {
              setSelectedId(null);
              setDetail(null);
              setDetailError("");
            }}
            className="text-sm font-medium text-neutral-600 hover:text-brand-dark"
          >
            Back to reports
          </button>
          {detail ? <StatusBadge status={detail.status} /> : null}
        </div>

        {detailLoading ? (
          <p className="px-5 py-8 text-sm text-neutral-500">Loading report…</p>
        ) : null}

        {detailError ? (
          <p className="mx-5 my-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {detailError}
          </p>
        ) : null}

        {detail ? (
          <div className="space-y-6 px-5 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {detail.source} · {formatWhen(detail.occurredAt)}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-brand-dark">
                {detail.name}: {detail.message}
              </h2>
              <p className="mt-1 text-sm text-neutral-600">
                {who(detail)}
                {detail.userRole ? ` · ${detail.userRole}` : ""} ·{" "}
                {detail.pathname || detail.url || "Unknown page"}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-brand-dark">
                  What they were doing
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
                  {detail.whatWereYouDoing}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-brand-dark">
                  What happened
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
                  {detail.whatHappened}
                </p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-brand-dark">
                Leading up to the crash
              </h3>
              {detail.breadcrumbs.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-500">No trail recorded.</p>
              ) : (
                <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
                  {detail.breadcrumbs.map((item, index) => (
                    <li key={`${item.t}-${index}`}>
                      <span className="font-medium uppercase text-neutral-500">
                        {item.type}
                      </span>{" "}
                      {item.detail}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {detail.stack ? (
              <div>
                <h3 className="text-sm font-semibold text-brand-dark">Stack</h3>
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">
                  {detail.stack}
                </pre>
              </div>
            ) : null}

            {detail.componentStack ? (
              <div>
                <h3 className="text-sm font-semibold text-brand-dark">
                  Component stack
                </h3>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">
                  {detail.componentStack}
                </pre>
              </div>
            ) : null}

            <dl className="grid gap-2 text-xs text-neutral-600 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-neutral-500">URL</dt>
                <dd className="break-all">{detail.url || "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-neutral-500">Viewport</dt>
                <dd>
                  {detail.viewport || "—"} · {detail.online ? "online" : "offline"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-medium text-neutral-500">Browser</dt>
                <dd className="break-all">{detail.userAgent || "—"}</dd>
              </div>
            </dl>

            <div className="border-t border-neutral-200 pt-4">
              <label className="block text-sm font-medium text-brand-dark">
                Resolution note
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm font-normal text-brand-dark outline-none focus:border-brand-orange"
                />
              </label>
              {detail.resolvedAt ? (
                <p className="mt-2 text-xs text-neutral-500">
                  Resolved {formatWhen(detail.resolvedAt)}
                  {detail.resolvedByName ? ` by ${detail.resolvedByName}` : ""}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.status === "open" ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void setStatus("resolved")}
                    className="inline-flex items-center rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Mark resolved"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void setStatus("open")}
                    className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Reopen"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-5 py-4">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setLoading(true);
              setFilter(item.id);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              filter === item.id
                ? "bg-brand-dark text-white"
                : "bg-neutral-100 text-neutral-600 hover:text-brand-dark"
            }`}
          >
            {item.label}
            {item.count !== undefined ? ` (${item.count})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mx-5 my-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="px-5 py-8 text-sm text-neutral-500">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="px-5 py-8 text-sm text-neutral-500">No crash reports.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Page</th>
                <th className="px-5 py-3 font-medium">Error</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${report.message}, ${who(report)}`}
                  className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                  onClick={() => {
                    setDetail(null);
                    setDetailError("");
                    setDetailLoading(true);
                    setSelectedId(report.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setDetail(null);
                    setDetailError("");
                    setDetailLoading(true);
                    setSelectedId(report.id);
                  }}
                >
                  <td className="whitespace-nowrap px-5 py-3 text-neutral-600">
                    {formatWhen(report.occurredAt)}
                  </td>
                  <td className="px-5 py-3 text-neutral-800">{who(report)}</td>
                  <td className="max-w-[12rem] truncate px-5 py-3 text-neutral-600">
                    {report.pathname || "—"}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3 text-brand-dark">
                    {report.message}
                  </td>
                  <td className="px-5 py-3">
                    <StatusBadge status={report.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3 text-sm text-neutral-600">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                setLoading(true);
                setPage((current) => current + 1);
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
