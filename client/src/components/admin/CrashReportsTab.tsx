"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  getCrashReport,
  listCrashReports,
  updateCrashReport,
  ApiError,
  type CrashReportDetail,
  type CrashReportOrigin,
  type CrashReportStatus,
  type CrashReportSummary,
} from "@/lib/api";
import {
  copyText,
  crashReportToMarkdown,
  downloadText,
  isFailingApi,
  relativeSeconds,
  startingPoints,
} from "@/lib/crashReportExport";

type StatusFilter = "all" | CrashReportStatus;
type OriginFilter = "all" | CrashReportOrigin;

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

function reportLink(id: string): string {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "crash-reports");
  url.searchParams.set("report", id);
  return url.toString();
}

function syncReportParam(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("report", id);
  else url.searchParams.delete("report");
  window.history.replaceState(window.history.state, "", url.toString());
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

function OriginBadge({ origin }: { origin: CrashReportOrigin }) {
  const server = origin === "server";
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
        server
          ? "border-violet-200 bg-violet-50 text-violet-800"
          : "border-sky-200 bg-sky-50 text-sky-800"
      }`}
    >
      {server ? "Server" : "Browser"}
    </span>
  );
}

function useCopied(): [string | null, (key: string, action: () => Promise<void> | void) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  function run(key: string, action: () => Promise<void> | void) {
    Promise.resolve(action())
      .then(() => {
        setCopied(key);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => setCopied(`${key}:error`));
  }
  return [copied, run];
}

function ToolbarButton({
  onClick,
  children,
  primary,
}: {
  onClick: () => void;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "inline-flex items-center rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark/90"
          : "inline-flex items-center rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-neutral-50"
      }
    >
      {children}
    </button>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-dark">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ children, tall }: { children: string; tall?: boolean }) {
  return (
    <pre
      className={`mt-2 overflow-auto whitespace-pre rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800 ${
        tall ? "max-h-80" : "max-h-48"
      }`}
    >
      {children}
    </pre>
  );
}

function SmallCopy({
  id,
  text,
  copied,
  onCopy,
}: {
  id: string;
  text: string;
  copied: string | null;
  onCopy: (key: string, action: () => Promise<void>) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(id, () => copyText(text))}
      className="text-xs font-medium text-neutral-500 hover:text-brand-dark"
    >
      {copied === id ? "Copied" : "Copy"}
    </button>
  );
}

function ReportDetail({
  detail,
  onOpen,
  note,
  setNote,
  saving,
  onSetStatus,
}: {
  detail: CrashReportDetail;
  onOpen: (id: string) => void;
  note: string;
  setNote: (value: string) => void;
  saving: boolean;
  onSetStatus: (status: CrashReportStatus) => void;
}) {
  const [copied, runCopy] = useCopied();
  const [showRaw, setShowRaw] = useState(false);
  const crashAt = new Date(detail.occurredAt).getTime();
  const hasDecoded = Boolean(detail.decodedStack) && detail.sourceMapsFound > 0;
  const stackText = hasDecoded && !showRaw ? detail.decodedStack : detail.stack;
  const points = useMemo(() => startingPoints(detail), [detail]);
  const snippets = detail.decodedFrames.filter((frame) => frame.snippet);
  const environment: [string, string][] = [
    ["URL", detail.url || "—"],
    ["Viewport", `${detail.viewport || "—"} · ${detail.online ? "online" : "offline"}`],
    ["Release", detail.release || "—"],
    ...Object.entries(detail.environment ?? {}).map(
      ([key, value]) => [key, String(value)] as [string, string],
    ),
  ];
  if (detail.fingerprint) environment.push(["Fingerprint", detail.fingerprint]);

  function copyLabel(key: string, label: string) {
    if (copied === key) return "Copied";
    if (copied === `${key}:error`) return "Copy failed";
    return label;
  }

  return (
    <div className="space-y-6 px-5 py-5">
      <div className="flex flex-wrap gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
        <ToolbarButton
          primary
          onClick={() =>
            runCopy("md", () =>
              copyText(crashReportToMarkdown(detail, { link: reportLink(detail.id) })),
            )
          }
        >
          {copyLabel("md", "Copy for engineer")}
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            runCopy("json", () => copyText(JSON.stringify(detail, null, 2)))
          }
        >
          {copyLabel("json", "Copy JSON")}
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            runCopy("download", () =>
              downloadText(
                `crash-${detail.id}.md`,
                crashReportToMarkdown(detail, { link: reportLink(detail.id) }),
              ),
            )
          }
        >
          {copied === "download" ? "Downloaded" : "Download .md"}
        </ToolbarButton>
        <ToolbarButton
          onClick={() => runCopy("link", () => copyText(reportLink(detail.id)))}
        >
          {copyLabel("link", "Copy link")}
        </ToolbarButton>
      </div>

      <div>
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          <OriginBadge origin={detail.origin} />
          <span>
            {detail.source} · {formatWhen(detail.occurredAt)}
            {detail.occurrences > 1
              ? ` · seen ${detail.occurrences}× (last ${formatWhen(detail.lastSeenAt)})`
              : ""}
          </span>
        </p>
        <h2 className="mt-1 break-words text-lg font-semibold text-brand-dark">
          {detail.name}: {detail.message}
        </h2>
        <p className="mt-1 text-sm text-neutral-600">
          {who(detail)}
          {detail.userRole ? ` · ${detail.userRole}` : ""} ·{" "}
          {detail.http
            ? `${detail.http.method} ${detail.http.route || detail.http.path} → ${detail.http.status}`
            : detail.pathname || detail.url || "Unknown page"}
        </p>
        {detail.requestId ? (
          <p className="mt-1 text-xs text-neutral-500">Request {detail.requestId}</p>
        ) : null}
      </div>

      {points.length > 0 ? (
        <Section title="Starting points">
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-700">
            {points.map((point) => (
              <li key={point}>{point.replace(/`/g, "")}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.origin !== "server" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Section title="What they were doing">
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
              {detail.whatWereYouDoing || (
                <span className="text-neutral-400">Not provided</span>
              )}
            </p>
          </Section>
          <Section title="What happened">
            <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">
              {detail.whatHappened || (
                <span className="text-neutral-400">Not provided</span>
              )}
            </p>
          </Section>
        </div>
      ) : null}

      <Section
        title={
          hasDecoded
            ? showRaw
              ? "Stack (raw)"
              : "Stack (decoded)"
            : detail.origin === "server"
              ? "Stack"
              : "Stack (minified, no source maps found)"
        }
        action={
          detail.stack ? (
            <div className="flex items-center gap-3">
              {hasDecoded ? (
                <button
                  type="button"
                  onClick={() => setShowRaw((value) => !value)}
                  className="text-xs font-medium text-neutral-500 hover:text-brand-dark"
                >
                  {showRaw ? "Show decoded" : "Show raw"}
                </button>
              ) : null}
              <SmallCopy id="stack" text={stackText} copied={copied} onCopy={runCopy} />
            </div>
          ) : null
        }
      >
        {detail.stack ? (
          <CodeBlock tall>{stackText}</CodeBlock>
        ) : (
          <p className="mt-1 text-sm text-neutral-500">No stack was captured.</p>
        )}
      </Section>

      {hasDecoded && !showRaw && snippets.length > 0 ? (
        <Section title="Source near the top frames">
          {snippets.map((frame, index) => (
            <div key={`${frame.file}-${frame.line}-${index}`} className="mt-2">
              <p className="text-xs font-medium text-neutral-600">
                {frame.file}:{frame.line}
                {frame.fn ? ` in ${frame.fn}` : ""}
              </p>
              <CodeBlock>{frame.snippet ?? ""}</CodeBlock>
            </div>
          ))}
        </Section>
      ) : null}

      {Object.keys(detail.context ?? {}).length > 0 ? (
        <Section title="Error context">
          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-neutral-700 sm:grid-cols-[max-content_1fr]">
            {Object.entries(detail.context).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="font-medium text-neutral-500">{key}</dt>
                <dd className="break-all">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {detail.causes.length > 0 ? (
        <Section title="Cause chain">
          {detail.causes.map((cause, index) => (
            <div key={index} className="mt-2">
              <p className="text-sm text-neutral-700">
                {index + 1}. {cause.name}: {cause.message}
              </p>
              {cause.stack ? <CodeBlock>{cause.stack}</CodeBlock> : null}
            </div>
          ))}
        </Section>
      ) : null}

      {detail.additionalErrors.length > 0 ? (
        <Section title="Additional errors after the first">
          {detail.additionalErrors.map((item, index) => (
            <div key={index} className="mt-2">
              <p className="text-sm text-neutral-700">
                <span className="text-xs uppercase text-neutral-500">{item.source}</span>{" "}
                {item.name}: {item.message}
              </p>
              {item.stack ? <CodeBlock>{item.stack}</CodeBlock> : null}
            </div>
          ))}
        </Section>
      ) : null}

      {detail.componentStack ? (
        <Section
          title="Component stack"
          action={
            <SmallCopy
              id="component"
              text={detail.componentStack}
              copied={copied}
              onCopy={runCopy}
            />
          }
        >
          <CodeBlock>{detail.componentStack}</CodeBlock>
        </Section>
      ) : null}

      {detail.origin !== "server" ? (
        <Section title="Leading up to the crash">
          {detail.breadcrumbs.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-500">No trail recorded.</p>
          ) : (
            <ol className="mt-2 max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-700">
              {detail.breadcrumbs.map((item, index) => {
                const failing = isFailingApi(item);
                return (
                  <li
                    key={`${item.t}-${index}`}
                    className={`flex gap-2 ${failing ? "rounded bg-red-50 text-red-800" : ""}`}
                  >
                    <span className="w-14 shrink-0 text-right text-neutral-400">
                      {relativeSeconds(item.t, crashAt)}
                    </span>
                    <span className="w-16 shrink-0 font-medium uppercase text-neutral-500">
                      {item.type}
                    </span>
                    <span className="min-w-0 break-words">
                      {item.detail}
                      {item.meta?.durationMs !== undefined
                        ? ` (${item.meta.durationMs}ms)`
                        : ""}
                      {item.meta?.message ? ` — ${item.meta.message}` : ""}
                      {item.meta?.requestId ? (
                        <span className="text-neutral-400"> req={item.meta.requestId}</span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      ) : null}

      {detail.relatedServerErrors.length > 0 ? (
        <Section title="Related server errors">
          <ul className="mt-2 space-y-2">
            {detail.relatedServerErrors.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-violet-200 bg-violet-50/40 p-3"
              >
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="text-left text-sm font-medium text-brand-dark hover:underline"
                >
                  {item.name}: {item.message}
                </button>
                <p className="mt-0.5 text-xs text-neutral-600">
                  {item.http
                    ? `${item.http.method} ${item.http.route || item.http.path} → ${item.http.status}`
                    : ""}
                  {item.occurrences > 1 ? ` · seen ${item.occurrences}×` : ""}
                </p>
                {item.stack ? <CodeBlock>{item.stack}</CodeBlock> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.relatedClientReports.length > 0 ? (
        <Section title="Browser reports that hit this error">
          <ul className="mt-2 space-y-1 text-sm">
            {detail.relatedClientReports.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="text-left text-brand-dark hover:underline"
                >
                  {formatWhen(item.occurredAt)} · {who(item)} · {item.message}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {detail.http?.bodyKeys.length ? (
        <Section title="Request body fields">
          <p className="mt-1 text-xs text-neutral-700">{detail.http.bodyKeys.join(", ")}</p>
        </Section>
      ) : null}

      <dl className="grid gap-2 text-xs text-neutral-600 sm:grid-cols-2">
        {environment.map(([key, value]) => (
          <div key={key}>
            <dt className="font-medium text-neutral-500">{key}</dt>
            <dd className="break-all">{value}</dd>
          </div>
        ))}
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
              onClick={() => onSetStatus("resolved")}
              className="inline-flex items-center rounded-md bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Mark resolved"}
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => onSetStatus("open")}
              className="inline-flex items-center rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Reopen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CrashReportsTab({ token }: { token: string | null }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<CrashReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("report") || null,
  );
  const [detail, setDetail] = useState<CrashReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(
    () => Boolean(searchParams.get("report")),
  );
  const [detailError, setDetailError] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listCrashReports(token, { page, pageSize, status: filter, origin })
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
  }, [token, page, filter, origin, listVersion]);

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

  function openReport(id: string) {
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setSelectedId(id);
    syncReportParam(id);
  }

  function closeReport() {
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
    syncReportParam(null);
  }

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
  const origins: { id: OriginFilter; label: string }[] = [
    { id: "all", label: "Browser + Server" },
    { id: "client", label: "Browser" },
    { id: "server", label: "Server" },
  ];

  if (selectedId) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <button
            type="button"
            onClick={closeReport}
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
          <ReportDetail
            detail={detail}
            onOpen={openReport}
            note={note}
            setNote={setNote}
            saving={saving}
            onSetStatus={(status) => void setStatus(status)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-neutral-100 p-0.5">
          {origins.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setLoading(true);
                setOrigin(item.id);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                origin === item.id
                  ? "bg-white text-brand-dark shadow-sm"
                  : "text-neutral-600 hover:text-brand-dark"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
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
                <th className="px-5 py-3 font-medium">Origin</th>
                <th className="px-5 py-3 font-medium">Who</th>
                <th className="px-5 py-3 font-medium">Page</th>
                <th className="px-5 py-3 font-medium">Error</th>
                <th className="px-5 py-3 font-medium">Seen</th>
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
                  onClick={() => openReport(report.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openReport(report.id);
                  }}
                >
                  <td className="whitespace-nowrap px-5 py-3 text-neutral-600">
                    {formatWhen(report.lastSeenAt ?? report.occurredAt)}
                  </td>
                  <td className="px-5 py-3">
                    <OriginBadge origin={report.origin} />
                  </td>
                  <td className="px-5 py-3 text-neutral-800">{who(report)}</td>
                  <td className="max-w-[12rem] truncate px-5 py-3 text-neutral-600">
                    {report.pathname || "—"}
                  </td>
                  <td className="max-w-xs truncate px-5 py-3 text-brand-dark">
                    {report.message}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-neutral-600">
                    {report.occurrences > 1 ? `${report.occurrences}×` : "1×"}
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
