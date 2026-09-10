"use client";

import {
  ChangeEvent,
  DragEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Database, Upload } from "lucide-react";
import {
  ApiError,
  auditLegacyDump,
  executeLegacyDump,
  getLegacyDumpTargets,
  LegacyDumpResponse,
  LegacyDumpTargetResult,
} from "@/lib/api";

const MAX_FILES = 2;
const MAX_BYTES = 10 * 1024 * 1024;

function detectKindHint(file: File): string {
  const name = file.name.toLowerCase();
  if (name.includes("customer")) return "customers";
  if (name.includes("work_order") || name.includes("work-order")) {
    return "work_orders";
  }
  return "unknown";
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

function AuditSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(count > 0 && count <= 20);
  return (
    <div className="rounded-md border border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-brand-dark"
      >
        <span>
          {title}{" "}
          <span className="font-normal text-neutral-500">
            ({formatCount(count)})
          </span>
        </span>
        <span className="text-xs text-neutral-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-neutral-100 px-3 py-2">{children}</div>}
    </div>
  );
}

function TargetReport({
  heading,
  result,
  error,
}: {
  heading: string;
  result?: LegacyDumpTargetResult;
  error?: string;
}) {
  if (!result) {
    if (error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {heading}: {error}
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
        {heading}: not available
      </div>
    );
  }
  const { audit } = result;
  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 px-4 py-4">
      <div>
        <h3 className="text-base font-semibold text-brand-dark">{heading}</h3>
        <p className="mt-0.5 text-xs text-neutral-500">{result.targetLabel}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-neutral-500">Customers missing</dt>
          <dd className="font-medium text-brand-dark">
            {formatCount(audit.customersMissing.length)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Identity-linked</dt>
          <dd className="font-medium text-brand-dark">
            {formatCount(audit.customersIdentityLinked.length)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Collisions</dt>
          <dd className="font-medium text-brand-dark">
            {formatCount(audit.customersCollisions.length)}
          </dd>
        </div>
        <div>
          <dt className="text-neutral-500">Work orders missing</dt>
          <dd className="font-medium text-brand-dark">
            {formatCount(audit.wosMissing.length)}
          </dd>
        </div>
      </dl>
      <div className="space-y-2">
        <AuditSection title="Customers missing" count={audit.customersMissing.length}>
          {audit.customersMissing.length === 0 ? (
            <p className="text-sm text-neutral-500">None</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-neutral-700">
              {audit.customersMissing.map((row) => (
                <li key={row.sqlId}>
                  #{row.sqlId} {row.sqlName}
                  {row.phone ? ` · ${row.phone}` : ""}
                </li>
              ))}
            </ul>
          )}
        </AuditSection>
        <AuditSection
          title="Customers identity-linked"
          count={audit.customersIdentityLinked.length}
        >
          {audit.customersIdentityLinked.length === 0 ? (
            <p className="text-sm text-neutral-500">None</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-neutral-700">
              {audit.customersIdentityLinked.map((row) => (
                <li key={row.sqlId}>
                  #{row.sqlId} {row.sqlName} → #{row.mongoLegacyId} {row.mongoName}{" "}
                  ({row.reason})
                </li>
              ))}
            </ul>
          )}
        </AuditSection>
        <AuditSection
          title="Customer collisions"
          count={audit.customersCollisions.length}
        >
          {audit.customersCollisions.length === 0 ? (
            <p className="text-sm text-neutral-500">None</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-neutral-700">
              {audit.customersCollisions.map((row) => (
                <li key={row.sqlId}>
                  #{row.sqlId} {row.sqlName} occupied by {row.occupiedBy} (#
                  {row.occupiedLegacyId}); would assign {row.assignedId}
                </li>
              ))}
            </ul>
          )}
        </AuditSection>
        <AuditSection title="Work orders missing" count={audit.wosMissing.length}>
          {audit.wosMissing.length === 0 ? (
            <p className="text-sm text-neutral-500">None</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-neutral-700">
              {audit.wosMissing.map((row) => (
                <li key={row.woId}>
                  WO {row.woId} · customer #{row.customerId} {row.customerName}
                  {row.date ? ` · ${row.date}` : ""}
                </li>
              ))}
            </ul>
          )}
        </AuditSection>
      </div>
    </div>
  );
}

export default function LegacyDatabaseUploadCard({
  token,
}: {
  token: string | null;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<LegacyDumpResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<LegacyDumpResponse | null>(
    null,
  );
  const [runProduction, setRunProduction] = useState(true);
  const [runDevelopment, setRunDevelopment] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targets, setTargets] = useState<LegacyDumpResponse["targets"] | null>(
    null,
  );
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getLegacyDumpTargets(token)
      .then((res) => {
        if (!cancelled) setTargets(res.targets);
      })
      .catch(() => {
        /* audit response also includes targets */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const selectedTargets = useMemo(
    () => targets ?? audit?.targets ?? null,
    [targets, audit],
  );

  function applyFiles(next: File[]) {
    setFileError(null);
    setAudit(null);
    setExecuteResult(null);
    setConfirmOpen(false);
    if (next.length === 0) {
      setFiles([]);
      return;
    }
    if (next.length > MAX_FILES) {
      setFileError("Choose at most two SQL files.");
      setFiles([]);
      return;
    }
    const oversized = next.find((f) => f.size > MAX_BYTES);
    if (oversized) {
      setFileError("Each file must be 10 MB or smaller.");
      setFiles([]);
      return;
    }
    const notSql = next.find((f) => !f.name.toLowerCase().endsWith(".sql"));
    if (notSql) {
      setFileError("Only .sql dumps are accepted.");
      setFiles([]);
      return;
    }
    setFiles(next);
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    applyFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDragActive(true);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    applyFiles(Array.from(e.dataTransfer.files ?? []));
  }

  async function runAudit() {
    if (!token || files.length === 0) {
      setFileError("Choose one or two .sql dumps first.");
      return;
    }
    setAuditing(true);
    setError(null);
    setExecuteResult(null);
    try {
      const result = await auditLegacyDump(token, files);
      setAudit(result);
      setTargets(result.targets);
      if (
        !result.targets.production.available ||
        result.errors?.production ||
        !result.production
      ) {
        setRunProduction(false);
      }
      if (
        !result.targets.development.available ||
        result.errors?.development ||
        !result.development
      ) {
        setRunDevelopment(false);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Audit failed. Try again.",
      );
    } finally {
      setAuditing(false);
    }
  }

  const productionCounts = audit?.production?.audit;
  const canExecute =
    Boolean(audit) &&
    ((runProduction && Boolean(audit?.production)) ||
      (runDevelopment && Boolean(audit?.development))) &&
    !executing &&
    Boolean(token);

  function requestExecute() {
    setError(null);
    if (runProduction) {
      setConfirmOpen(true);
      return;
    }
    void doExecute(false);
  }

  async function doExecute(confirmProduction: boolean) {
    if (!token) return;
    setConfirmOpen(false);
    setExecuting(true);
    setError(null);
    try {
      const result = await executeLegacyDump(token, files, {
        production: runProduction,
        development: runDevelopment,
        confirmProduction,
      });
      setExecuteResult(result);
      setAudit((prev) => ({
        files: result.files,
        targets: result.targets,
        production: result.production ?? prev?.production,
        development: result.development ?? prev?.development,
        errors: result.errors ?? prev?.errors,
      }));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Import failed. Try again.",
      );
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-100 px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-brand-orange">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-dark">
              Legacy Database Upload
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Upload the latest phpMyAdmin dumps of the <code>customers</code>{" "}
              and/or <code>work_orders</code> tables. The server audits
              production and development, then you can insert only the missing
              records. Do not upload the older June work-orders dump if a newer
              export exists.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <span className="text-xs font-medium text-neutral-600">
            SQL dumps (up to 2 files)
          </span>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`mt-1 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragActive
                ? "border-brand-orange bg-orange-50"
                : "border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100/80"
            }`}
          >
            <Upload
              className={`mb-2 h-6 w-6 ${
                dragActive ? "text-brand-orange" : "text-neutral-400"
              }`}
            />
            <p className="text-sm font-medium text-brand-dark">
              {dragActive
                ? "Drop SQL dumps here"
                : "Drag and drop .sql files here"}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              or click to choose up to two files
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,application/sql,text/plain"
              multiple
              onChange={onFiles}
              className="sr-only"
            />
          </div>
        </div>
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        {files.length > 0 && (
          <ul className="text-sm text-neutral-600">
            {files.map((file) => (
              <li key={file.name}>
                {file.name}{" "}
                <span className="text-neutral-400">
                  ({detectKindHint(file)}, {(file.size / 1024).toFixed(0)} KB)
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => void runAudit()}
          disabled={auditing || files.length === 0 || !token}
          className="inline-flex items-center gap-2 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {auditing ? "Auditing…" : "Run audit"}
        </button>

        {audit && (
          <div className="space-y-4">
            <p className="text-sm text-neutral-600">
              Parsed{" "}
              {audit.files
                .map((f) => `${f.filename} (${f.kind})`)
                .join(" and ")}
              .
            </p>
            <TargetReport
              heading="Production"
              result={audit.production}
              error={audit.errors?.production}
            />
            <TargetReport
              heading="Development"
              result={audit.development}
              error={audit.errors?.development}
            />

            <div className="space-y-3 rounded-lg border border-neutral-200 px-4 py-4">
              <h3 className="text-base font-semibold text-brand-dark">
                Execute import
              </h3>
              <p className="text-sm text-neutral-500">
                Inserts only records that are not already in the selected
                database. Existing customers and work orders are not updated.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={runProduction}
                  disabled={!selectedTargets?.production.available || !audit.production}
                  onChange={(e) => setRunProduction(e.target.checked)}
                />
                <span>
                  Production
                  {selectedTargets?.production.label
                    ? ` (${selectedTargets.production.label})`
                    : ""}
                  {!selectedTargets?.production.available && (
                    <span className="block text-xs text-neutral-400">
                      {selectedTargets?.production.reason ?? "URI not configured"}
                    </span>
                  )}
                  {selectedTargets?.production.available && !audit.production && (
                    <span className="block text-xs text-neutral-400">
                      Audit did not complete for this target
                    </span>
                  )}
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={runDevelopment}
                  disabled={!selectedTargets?.development.available || !audit.development}
                  onChange={(e) => setRunDevelopment(e.target.checked)}
                />
                <span>
                  Development
                  {selectedTargets?.development.label
                    ? ` (${selectedTargets.development.label})`
                    : ""}
                  {!selectedTargets?.development.available && (
                    <span className="block text-xs text-neutral-400">
                      {selectedTargets?.development.reason ?? "URI not configured"}
                    </span>
                  )}
                  {selectedTargets?.development.available && !audit.development && (
                    <span className="block text-xs text-neutral-400">
                      Audit did not complete for this target
                    </span>
                  )}
                </span>
              </label>
              <button
                type="button"
                onClick={requestExecute}
                disabled={!canExecute}
                className="rounded-md bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {executing ? "Importing…" : "Execute import"}
              </button>
            </div>
          </div>
        )}

        {executeResult && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${
              executeResult.errors
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {executeResult.errors ? "Import finished with errors." : "Import finished."}
            {executeResult.production && (
              <span>
                {" "}
                Production inserted{" "}
                {executeResult.production.summary.customersInserted} customers
                and {executeResult.production.summary.workOrdersInserted} work
                orders.
              </span>
            )}
            {executeResult.development && (
              <span>
                {" "}
                Development inserted{" "}
                {executeResult.development.summary.customersInserted} customers
                and {executeResult.development.summary.workOrdersInserted} work
                orders.
              </span>
            )}
            {executeResult.errors?.production && (
              <p className="mt-1">Production: {executeResult.errors.production}</p>
            )}
            {executeResult.errors?.development && (
              <p className="mt-1">
                Development: {executeResult.errors.development}
              </p>
            )}
          </div>
        )}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-brand-dark">
              Confirm production import
            </h3>
            <p className="mt-2 text-sm text-neutral-600">
              This will insert{" "}
              <strong>
                {formatCount(productionCounts?.customersMissing.length ?? 0)}
              </strong>{" "}
              customers and{" "}
              <strong>{formatCount(productionCounts?.wosMissing.length ?? 0)}</strong>{" "}
              work orders into production
              {selectedTargets?.production.label
                ? ` (${selectedTargets.production.label})`
                : ""}
              . Existing records are not overwritten.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void doExecute(true)}
                className="rounded-md bg-brand-orange px-3 py-2 text-sm font-medium text-white hover:bg-brand-orange/90"
              >
                Insert into production
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
