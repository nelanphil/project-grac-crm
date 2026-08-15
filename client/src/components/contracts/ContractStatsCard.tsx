"use client";

import { useMemo } from "react";
import { ScrollText } from "lucide-react";
import { ContractListItem } from "@/lib/api";

type KpiTone = "danger" | "info" | "success" | "warning" | "neutral";

const TONE_STYLES: Record<KpiTone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-neutral-200 bg-white text-brand-dark",
};

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: KpiTone;
}) {
  return (
    <div
      className={`block w-full min-w-0 rounded-2xl border px-3 py-3 text-left shadow-sm sm:px-4 sm:py-4 ${TONE_STYLES[tone]}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80 sm:text-xs">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold tracking-tight break-words sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

export default function ContractStatsCard({
  contracts,
  loading,
}: {
  contracts: ContractListItem[];
  loading?: boolean;
}) {
  const contractStats = useMemo(() => {
    let active = 0;
    let dueSoon = 0;
    let expired = 0;
    for (const contract of contracts) {
      if (contract.standing === "active") active += 1;
      else if (contract.standing === "due_soon") dueSoon += 1;
      else if (contract.standing === "expired") expired += 1;
    }
    return { active, dueSoon, expired, total: contracts.length };
  }, [contracts]);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-neutral-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Contract stats
        </h2>
      </div>
      <div className="grid w-full grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Total"
          value={loading ? "—" : String(contractStats.total)}
          tone="neutral"
        />
        <KpiCard
          label="Active"
          value={loading ? "—" : String(contractStats.active)}
          tone="success"
        />
        <KpiCard
          label="Due soon"
          value={loading ? "—" : String(contractStats.dueSoon)}
          tone="warning"
        />
        <KpiCard
          label="Expired"
          value={loading ? "—" : String(contractStats.expired)}
          tone="danger"
        />
      </div>
    </section>
  );
}
