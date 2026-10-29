"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  CustomerNotificationRow,
  getCustomerNotifications,
} from "@/lib/api";
import { formatPhone } from "@/components/messaging/conversationUtils";

function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function textOptOutHow(source: string): string {
  if (source === "keyword") return "replied STOP";
  if (source === "staff_confirmed") return "staff confirmed an opt-out request";
  if (source === "settings") return "turned off in account settings";
  return "";
}

function StatusLine({
  on,
  onLabel,
  offLabel,
  detail,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  detail?: string;
}) {
  return (
    <p className={`text-sm ${on ? "text-emerald-700" : "text-red-700"}`}>
      <span className="font-medium">{on ? onLabel : offLabel}</span>
      {detail ? <span className="text-neutral-500"> · {detail}</span> : null}
    </p>
  );
}

export default function CustomerNotificationsPanel({
  customerId,
  token,
  onAlertChange,
}: {
  customerId: string;
  token: string;
  onAlertChange?: (anyOff: boolean) => void;
}) {
  const [rows, setRows] = useState<CustomerNotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCustomerNotifications(token, customerId)
      .then((result) => {
        if (cancelled) return;
        setRows(result.contacts);
        setError(null);
        const anyOff = result.contacts.some(
          (row) =>
            (row.email &&
              (!row.email.generalNotifications || !row.email.billingAlerts)) ||
            (row.text && !row.text.textNotifications),
        );
        onAlertChange?.(anyOff);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load notifications");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, customerId, onAlertChange]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading notifications…</p>;
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Only the customer can turn notifications back on, from their account Settings
        after they log in.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No contacts on this account yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-neutral-200 px-4 py-3"
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-2">
                <p className="text-sm font-medium text-brand-dark">{row.name}</p>
                {row.label ? (
                  <span className="text-xs text-neutral-400">{row.label}</span>
                ) : null}
                {row.isPrimary ? (
                  <span className="text-xs text-neutral-400">Primary</span>
                ) : null}
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    Email
                  </p>
                  {row.email ? (
                    <>
                      <p className="text-sm text-neutral-700">{row.email.address}</p>
                      <StatusLine
                        on={row.email.generalNotifications}
                        onLabel="General: subscribed"
                        offLabel="General: unsubscribed"
                        detail={
                          !row.email.generalNotifications
                            ? formatWhen(row.email.unsubscribedAt)
                            : undefined
                        }
                      />
                      <StatusLine
                        on={row.email.billingAlerts}
                        onLabel="Billing: subscribed"
                        offLabel="Billing: unsubscribed"
                        detail={
                          !row.email.billingAlerts && row.email.generalNotifications
                            ? formatWhen(row.email.unsubscribedAt)
                            : undefined
                        }
                      />
                      <p className="text-xs text-neutral-500">
                        {row.email.hasPortalLogin
                          ? "Has a login and can turn email back on in Settings."
                          : "No login yet, so this address cannot be turned back on from the app."}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-neutral-500">No email on file</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    Texts
                  </p>
                  {row.text ? (
                    <>
                      <p className="text-sm text-neutral-700">
                        {formatPhone(row.text.phone)}
                      </p>
                      <StatusLine
                        on={row.text.textNotifications}
                        onLabel="Subscribed"
                        offLabel="Opted out"
                        detail={
                          row.text.textNotifications
                            ? undefined
                            : [formatWhen(row.text.optedOutAt), textOptOutHow(row.text.optOutSource)]
                                .filter(Boolean)
                                .join(" · ")
                        }
                      />
                    </>
                  ) : (
                    <p className="text-sm text-neutral-500">No mobile number on file</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
