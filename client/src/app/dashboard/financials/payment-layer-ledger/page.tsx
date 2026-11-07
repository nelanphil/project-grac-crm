"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import PaymentLayersReportSection from "@/components/financials/PaymentLayersReportSection";
import { getFinancialsOwners } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

type Period = "month" | "last-month" | "ytd" | "all";

function periodBounds(period: Period): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "all") return {};
  if (period === "ytd") {
    return {
      from: new Date(Date.UTC(y, 0, 1)).toISOString(),
      to: now.toISOString(),
    };
  }
  if (period === "month") {
    return {
      from: new Date(Date.UTC(y, m, 1)).toISOString(),
      to: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
    };
  }
  const last = m === 0 ? 11 : m - 1;
  const lastYear = m === 0 ? y - 1 : y;
  return {
    from: new Date(Date.UTC(lastYear, last, 1)).toISOString(),
    to: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

const PERIODS = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["ytd", "Year to date"],
  ["all", "All time"],
] as const;

export default function PaymentLayerLedgerPage() {
  return (
    <AuthGuard>
      <PaymentLayerLedgerContent />
    </AuthGuard>
  );
}

function PaymentLayerLedgerContent() {
  const token = useAuthStore((s) => s.token);
  const canRead = useAuthStore((s) => s.hasPermission("reports:read"));
  const [period, setPeriod] = useState<Period>("month");
  const [ownersReady, setOwnersReady] = useState(false);
  const [canChooseOwner, setCanChooseOwner] = useState(false);
  const [ownerChoices, setOwnerChoices] = useState<
    { id: string; name: string }[]
  >([]);
  const [ownerId, setOwnerId] = useState("");

  const bounds = useMemo(() => periodBounds(period), [period]);

  useEffect(() => {
    let cancelled = false;
    if (!token || !canRead) return;

    void (async () => {
      try {
        const data = await getFinancialsOwners(token);
        if (cancelled) return;
        setCanChooseOwner(data.canChoose);
        setOwnerChoices(data.owners);
        setOwnerId(data.canChoose ? "" : data.ownerId ?? "");
      } catch {
        if (!cancelled) {
          setCanChooseOwner(false);
          setOwnerChoices([]);
        }
      } finally {
        if (!cancelled) setOwnersReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, canRead]);

  if (!canRead) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-brand-dark">
          Payment Ledger
        </h1>
        <p className="text-sm text-neutral-500">
          You do not have access to billing analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canChooseOwner ? (
          <label className="flex items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Owner
            <select
              value={ownerId}
              onChange={(event) => setOwnerId(event.target.value)}
              className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-dark dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">All owners</option>
              {ownerChoices.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {PERIODS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
              period === id
                ? "bg-brand-dark text-white shadow-sm"
                : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <PaymentLayersReportSection
        token={token}
        from={bounds.from}
        to={bounds.to}
        ownerId={ownerId}
        ownersReady={ownersReady}
        canChooseOwner={canChooseOwner}
      />
    </div>
  );
}
