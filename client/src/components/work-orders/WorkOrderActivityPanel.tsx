"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  getWorkOrderActivity,
  type WorkOrderActivityEntry,
  type WorkOrderActivityLog,
} from "@/lib/api";

type Props = {
  token: string;
  workOrderId: string;
  refreshKey?: number;
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function originHeadline(log: WorkOrderActivityLog): string {
  const when = formatWhen(log.createdAt);
  if (log.origin === "legacy_import") {
    return when
      ? `Imported from the legacy system on ${when}`
      : "Imported from the legacy system";
  }
  if (log.origin === "legacy_linked") {
    const who =
      log.createdByName && log.createdByName !== "Unknown"
        ? `Set up by ${log.createdByName}`
        : "Set up in the CRM";
    return `${who}, later linked to a legacy record`;
  }
  if (log.createdByName && log.createdByName !== "Unknown") {
    return when
      ? `Set up by ${log.createdByName} on ${when}`
      : `Set up by ${log.createdByName}`;
  }
  return when ? `Set up in the CRM on ${when}` : "Set up in the CRM";
}

function changeLine(change: WorkOrderActivityEntry["changes"][number]): string {
  if (!change.from) return `${change.field}: ${change.to}`;
  return `${change.field}: ${change.from} → ${change.to}`;
}

export default function WorkOrderActivityPanel({
  token,
  workOrderId,
  refreshKey = 0,
}: Props) {
  const [loaded, setLoaded] = useState<{
    key: string;
    log: WorkOrderActivityLog;
  } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const requestKey = `${workOrderId}:${refreshKey}`;

  useEffect(() => {
    let cancelled = false;
    getWorkOrderActivity(token, workOrderId)
      .then((log) => {
        if (!cancelled) setLoaded({ key: requestKey, log });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed({
          key: requestKey,
          message: err instanceof ApiError ? err.message : "Could not load the activity log.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, workOrderId, requestKey]);

  const log =
    loaded && loaded.key.startsWith(`${workOrderId}:`) ? loaded.log : null;
  const error = failed?.key === requestKey ? failed.message : null;
  const loading = !log && !error;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm print:hidden">
      <h2 className="text-sm font-semibold text-brand-dark">Activity log</h2>
      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : loading ? (
        <p className="mt-3 text-xs text-neutral-500">Loading activity…</p>
      ) : log ? (
        <div className="mt-3">
          <p className="text-sm text-neutral-800">{originHeadline(log)}</p>
          {log.entries.length === 0 ? (
            <p className="mt-3 text-xs text-neutral-500">No actions recorded yet.</p>
          ) : (
            <ol className="mt-4 space-y-3 border-l border-neutral-200 pl-4">
              {log.entries.map((entry) => (
                <li key={entry.id} className="text-sm">
                  <p className="text-neutral-900">{entry.summary}</p>
                  <p className="text-xs text-neutral-500">
                    {entry.actorName}
                    {entry.createdAt ? ` · ${formatWhen(entry.createdAt)}` : ""}
                  </p>
                  {entry.changes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
                      {entry.changes.map((change) => (
                        <li key={`${entry.id}:${change.field}`}>{changeLine(change)}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
