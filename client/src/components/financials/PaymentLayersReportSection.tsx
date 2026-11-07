"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  HelpCircle,
  Link2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";
import {
  ApiError,
  getFinancialsPaymentLayerCandidates,
  getFinancialsPaymentLayers,
  LayerMatchCandidate,
  linkFinancialsPaymentLayerTransaction,
  PaymentLayerReportItem,
  PaymentLayerTransactionRow,
} from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type MatchFilter = "all" | "matched" | "possible_match" | "unmatched";

function TxStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls =
    "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700";
  if (s === "paid") {
    cls =
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60";
  } else if (s === "refunded") {
    cls =
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60";
  } else if (s === "failed") {
    cls =
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60";
  } else if (s === "pending") {
    cls =
      "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60";
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const p = provider.toLowerCase();
  let cls =
    "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900";
  if (p === "stripe") {
    cls = "bg-indigo-600 text-white";
  } else if (p === "paypal") {
    cls = "bg-sky-600 text-white";
  }
  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold uppercase shadow-xs ${cls}`}
    >
      {p === "square" ? "Sq" : p === "stripe" ? "St" : "PP"}
    </span>
  );
}

interface LinkModalTarget {
  layer: PaymentLayerReportItem;
  tx: PaymentLayerTransactionRow;
}

function LinkTransactionModal({
  token,
  ownerId,
  target,
  onClose,
  onLinked,
}: {
  token: string;
  ownerId?: string;
  target: LinkModalTarget;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [candidates, setCandidates] = useState<LayerMatchCandidate[]>(
    target.tx.candidates,
  );
  const [loading, setLoading] = useState(true);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveOwnerId = target.layer.owner?.id || ownerId || undefined;

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setDebouncedSearch(search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getFinancialsPaymentLayerCandidates(token, {
          owner: effectiveOwnerId,
          search: debouncedSearch || undefined,
          amountCents: target.tx.amountCents,
        });
        if (!cancelled) {
          // Merge initial row candidates at top if no search query
          if (!debouncedSearch && target.tx.candidates.length > 0) {
            const seen = new Set(
              target.tx.candidates.map(
                (c) => `${c.recordType}:${c.invoiceId ?? c.workOrderId}`,
              ),
            );
            const merged = [
              ...target.tx.candidates,
              ...res.candidates.filter(
                (c) =>
                  !seen.has(`${c.recordType}:${c.invoiceId ?? c.workOrderId}`),
              ),
            ];
            setCandidates(merged);
          } else {
            setCandidates(res.candidates);
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load CRM records",
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    token,
    effectiveOwnerId,
    debouncedSearch,
    target.tx.amountCents,
    target.tx.candidates,
  ]);

  const handleLink = async (candidate: LayerMatchCandidate) => {
    const key = `${candidate.recordType}:${candidate.invoiceId ?? candidate.workOrderId}`;
    setLinkingId(key);
    setError(null);
    try {
      await linkFinancialsPaymentLayerTransaction(token, {
        accountId: target.layer.accountId,
        providerPaymentId: target.tx.providerPaymentId,
        providerOrderId: target.tx.providerOrderId,
        invoiceId: candidate.invoiceId,
        workOrderId: candidate.workOrderId,
        owner: effectiveOwnerId,
      });
      onLinked();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to link transaction to CRM record.",
      );
      setLinkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-xl overflow-hidden">
        <div className="flex items-start justify-between border-b border-[var(--staff-border)] px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-brand-dark">
              Link {target.layer.layerTitle} Charge to CRM Record
            </h3>
            <p className="mt-0.5 text-xs text-neutral-500">
              {formatDateTime(target.tx.createdAt)} ·{" "}
              <span className="font-semibold text-brand-dark">
                {formatMoney(target.tx.grossCents)}
              </span>{" "}
              {target.tx.payerName ? `· ${target.tx.payerName}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by invoice #, work order #, or customer name…"
              className="w-full rounded-lg border border-[var(--staff-border)] bg-[var(--staff-canvas)] py-2 pl-9 pr-8 text-xs text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </div>
          ) : null}

          <div className="max-h-80 overflow-y-auto divide-y divide-neutral-100 rounded-xl border border-[var(--staff-border)] dark:divide-neutral-800">
            {loading ? (
              <div className="p-6 text-center text-xs text-neutral-500">
                Searching CRM invoices & work orders…
              </div>
            ) : candidates.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-500">
                No matching open invoices or work orders found.
              </div>
            ) : (
              candidates.map((cand) => {
                const key = `${cand.recordType}:${cand.invoiceId ?? cand.workOrderId}`;
                const isExactAmount =
                  cand.amountCents === target.tx.amountCents ||
                  cand.amountCents === target.tx.grossCents;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-brand-dark">
                          {cand.number}
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {cand.recordType === "work_order"
                            ? "Work Order"
                            : "Invoice"}
                        </span>
                        {isExactAmount ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60">
                            Exact Amount
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-neutral-600 dark:text-neutral-300">
                        {cand.customerName} · {formatDateShort(cand.date)}
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        {cand.reason}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-bold text-brand-dark">
                        {formatMoney(cand.amountCents)}
                      </span>
                      <button
                        type="button"
                        disabled={linkingId !== null}
                        onClick={() => void handleLink(cand)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {linkingId === key ? "Linking…" : "Link"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-[var(--staff-border)] bg-neutral-50/50 px-6 py-3 dark:bg-neutral-900/40">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LayerReportTableCard({
  layer,
  showOwnerBadge,
  token,
  onOpenLinkModal,
  onQuickLinked,
}: {
  layer: PaymentLayerReportItem;
  showOwnerBadge: boolean;
  token: string;
  onOpenLinkModal: (target: LinkModalTarget) => void;
  onQuickLinked: () => void;
}) {
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [quickLinkingId, setQuickLinkingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return layer.transactions.filter((tx) => {
      if (matchFilter !== "all" && tx.matchStatus !== matchFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        tx.providerPaymentId,
        tx.providerOrderId,
        tx.customerName,
        tx.payerName,
        tx.payerEmail,
        tx.methodLabel,
        tx.last4,
        tx.note,
        tx.matchedRecord?.number,
        tx.matchedRecord?.workOrderNumber,
        ...tx.candidates.map((c) => c.number),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [layer.transactions, matchFilter, search]);

  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    filtered.length,
  );

  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total: filtered.length,
    pageSize,
    safePage,
    totalPages,
    onPageSizeChange: (newSize: PageSize) => {
      setPageSize(newSize);
      setPage(1);
    },
    onPrev: () => setPage((p) => Math.max(1, p - 1)),
    onNext: () => setPage((p) => Math.min(totalPages, p + 1)),
  };

  const handleQuickConfirm = async (
    tx: PaymentLayerTransactionRow,
    candidate: LayerMatchCandidate,
  ) => {
    setQuickLinkingId(tx.providerPaymentId);
    try {
      await linkFinancialsPaymentLayerTransaction(token, {
        accountId: layer.accountId,
        providerPaymentId: tx.providerPaymentId,
        providerOrderId: tx.providerOrderId,
        invoiceId: candidate.invoiceId,
        workOrderId: candidate.workOrderId,
        owner: layer.owner?.id,
      });
      onQuickLinked();
    } catch {
      onOpenLinkModal({ layer, tx });
    } finally {
      setQuickLinkingId(null);
    }
  };

  const { pnl } = layer;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm">
      {/* Layer Title Header — Named after the Layer: Square, Stripe, PayPal */}
      <div className="flex flex-col gap-3 border-b border-[var(--staff-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <ProviderBadge provider={layer.provider} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-brand-dark">
                {layer.layerTitle}
              </h3>
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {layer.friendlyName}
              </span>
              {layer.environment === "sandbox" ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60">
                  Sandbox
                </span>
              ) : null}
              {showOwnerBadge && layer.owner ? (
                <span className="rounded-full bg-brand-orange/10 px-2.5 py-0.5 text-xs font-semibold text-brand-orange">
                  Owner: {layer.owner.name}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              Complete charge breakdown, processor fees, net P&amp;L, and CRM
              application matching for {layer.layerTitle}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", `All (${layer.transactions.length})`],
              ["matched", `In-App (${pnl.matchedCount})`],
              ["possible_match", `Possible Match (${pnl.possibleMatchCount})`],
              ["unmatched", `Off-App (${pnl.unmatchedCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMatchFilter(id);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                matchFilter === id
                  ? "bg-brand-dark text-white shadow-xs"
                  : "border border-[var(--staff-border)] text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sync warning banner if live API returned an error */}
      {layer.syncError ? (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50/80 px-6 py-2.5 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            Live {layer.layerTitle} sync notice: {layer.syncError}. Showing
            recorded CRM transactions for this layer.
          </span>
        </div>
      ) : null}

      {/* P&L Breakdown Summary Strip */}
      <div className="grid grid-cols-2 gap-3 border-b border-[var(--staff-border)] bg-neutral-50/60 px-4 py-3.5 sm:grid-cols-3 lg:grid-cols-6 sm:px-6 dark:bg-neutral-900/30">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Gross Charges
          </p>
          <p className="mt-0.5 text-base font-bold text-brand-dark">
            {formatMoney(pnl.grossCents)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {pnl.paidCount} paid charge(s)
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {layer.layerTitle} Fees
          </p>
          <p className="mt-0.5 text-base font-bold text-rose-600 dark:text-rose-400">
            -{formatMoney(pnl.feeCents)}
          </p>
          <p className="text-[11px] text-neutral-500">Processor fees</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Refunds
          </p>
          <p className="mt-0.5 text-base font-bold text-amber-700 dark:text-amber-400">
            {pnl.refundedCents > 0
              ? `-${formatMoney(pnl.refundedCents)}`
              : formatMoney(0)}
          </p>
          <p className="text-[11px] text-neutral-500">
            {pnl.refundedCount} refunded
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Net Layer P&amp;L
          </p>
          <p className="mt-0.5 text-base font-bold text-emerald-700 dark:text-emerald-400">
            {formatMoney(pnl.netCents)}
          </p>
          <p className="text-[11px] text-neutral-500">After fees &amp; refunds</p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Matched (In-App)
          </p>
          <p className="mt-0.5 text-base font-bold text-brand-dark">
            {formatMoney(pnl.matchedCents)}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
            {pnl.matchedCount} matched to CRM
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Unmatched (Off-App)
          </p>
          <p className="mt-0.5 text-base font-bold text-brand-dark">
            {formatMoney(pnl.unmatchedCents + pnl.possibleMatchCents)}
          </p>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {pnl.unmatchedCount} off-app
            {pnl.possibleMatchCount > 0
              ? ` · ${pnl.possibleMatchCount} possible`
              : ""}
          </p>
        </div>
      </div>

      {/* Search bar inside layer table */}
      <div className="flex flex-col gap-3 border-b border-[var(--staff-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={`Search ${layer.layerTitle} charges by customer, card, invoice #, or ID…`}
            className="w-full rounded-lg border border-[var(--staff-border)] bg-[var(--staff-canvas)] py-1.5 pl-9 pr-8 text-xs text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
          />
          {search ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <p className="text-xs text-neutral-500">
          Showing {filtered.length} of {layer.transactions.length}{" "}
          {layer.layerTitle} transaction(s)
        </p>
      </div>

      <TablePagination {...paginationProps} position="top" />

      <ResponsiveDataView
        isEmpty={pageRows.length === 0}
        empty={
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
              <CreditCard className="h-5 w-5 text-neutral-400" />
            </div>
            <p className="mt-3 text-sm font-medium text-brand-dark">
              No {layer.layerTitle} transactions found
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {search || matchFilter !== "all"
                ? "Try clearing your search or switching the match filter above."
                : `No charges were returned by ${layer.layerTitle} for this timeframe.`}
            </p>
          </div>
        }
        mobile={
          <div className="divide-y divide-neutral-100 p-2 dark:divide-neutral-800">
            {pageRows.map((tx) => (
              <MobileDataCard
                key={tx.providerPaymentId}
                title={
                  <span className="font-semibold text-brand-dark">
                    {formatMoney(tx.grossCents)} ·{" "}
                    {tx.customerName || "Unidentified Buyer"}
                  </span>
                }
                subtitle={`${formatDateTime(tx.createdAt)} · ${tx.methodLabel}`}
                badges={<TxStatusBadge status={tx.status} />}
                fields={
                  <>
                    <DataField
                      label="Fee / Net"
                      value={`${formatMoney(tx.feeCents)} fee → ${formatMoney(tx.netCents)} net`}
                    />
                    <DataField
                      label="CRM Match"
                      value={
                        tx.matchStatus === "matched" && tx.matchedRecord ? (
                          <Link
                            href={tx.matchedRecord.detailUrl}
                            className="font-semibold text-emerald-700 underline dark:text-emerald-400"
                          >
                            In-App: {tx.matchedRecord.number}
                          </Link>
                        ) : tx.matchStatus === "possible_match" &&
                          tx.candidates[0] ? (
                          <button
                            type="button"
                            onClick={() => onOpenLinkModal({ layer, tx })}
                            className="font-semibold text-amber-700 underline dark:text-amber-400"
                          >
                            Possible: {tx.candidates[0].number} (Review)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onOpenLinkModal({ layer, tx })}
                            className="font-medium text-brand-orange underline"
                          >
                            Off-App · Link to CRM
                          </button>
                        )
                      }
                    />
                  </>
                }
              />
            ))}
          </div>
        }
        desktop={
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Charge / Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Customer / Payer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    App Match &amp; CRM Record
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Gross
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Fee
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Net P&amp;L
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {pageRows.map((tx) => {
                  const topCandidate = tx.candidates[0] ?? null;
                  return (
                    <tr
                      key={tx.providerPaymentId}
                      className="transition hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-neutral-600 dark:text-neutral-300">
                        <div>{formatDateTime(tx.createdAt)}</div>
                        <div
                          className="mt-0.5 font-mono text-[11px] text-neutral-400"
                          title={tx.providerPaymentId}
                        >
                          ID: {tx.providerPaymentId.slice(0, 14)}
                          {tx.providerPaymentId.length > 14 ? "…" : ""}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-xs font-medium text-brand-dark">
                          {tx.methodLabel}
                        </div>
                        {tx.note ? (
                          <div className="mt-0.5 max-w-xs truncate text-xs text-neutral-500">
                            {tx.note}
                          </div>
                        ) : null}
                        {tx.receiptUrl ? (
                          <a
                            href={tx.receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-orange hover:underline"
                          >
                            Provider receipt
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </td>

                      <td className="px-6 py-4">
                        <div className="text-xs font-semibold text-brand-dark">
                          {tx.customerName || "—"}
                        </div>
                        {tx.payerEmail ? (
                          <div className="mt-0.5 text-xs text-neutral-500">
                            {tx.payerEmail}
                          </div>
                        ) : null}
                        {tx.payerName &&
                        tx.customerName &&
                        tx.payerName.toLowerCase() !==
                          tx.customerName.toLowerCase() ? (
                          <div className="mt-0.5 text-[11px] text-neutral-400">
                            Cardholder: {tx.payerName}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-6 py-4">
                        {tx.matchStatus === "matched" && tx.matchedRecord ? (
                          <div className="space-y-1">
                            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              In-App · Matched
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Link
                                href={tx.matchedRecord.detailUrl}
                                className="inline-flex items-center gap-0.5 font-semibold text-brand-dark hover:text-brand-orange hover:underline"
                              >
                                {tx.matchedRecord.number}
                                <ArrowUpRight className="h-3 w-3" />
                              </Link>
                              {tx.matchedRecord.workOrderNumber &&
                              tx.matchedRecord.workOrderDetailUrl ? (
                                <Link
                                  href={tx.matchedRecord.workOrderDetailUrl}
                                  className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-brand-dark hover:underline"
                                >
                                  ({tx.matchedRecord.workOrderNumber})
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        ) : tx.matchStatus === "possible_match" &&
                          topCandidate ? (
                          <div className="space-y-1.5">
                            <div className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60">
                              <Sparkles className="h-3.5 w-3.5" />
                              Possible CRM Match
                            </div>
                            <div className="text-xs text-neutral-600 dark:text-neutral-300">
                              Suggested:{" "}
                              <Link
                                href={topCandidate.detailUrl}
                                className="font-semibold text-brand-dark hover:underline"
                              >
                                {topCandidate.number}
                              </Link>{" "}
                              ({topCandidate.reason})
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                disabled={
                                  quickLinkingId === tx.providerPaymentId
                                }
                                onClick={() =>
                                  void handleQuickConfirm(tx, topCandidate)
                                }
                                className="inline-flex items-center gap-1 rounded-md bg-brand-dark px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50 cursor-pointer"
                              >
                                <Link2 className="h-3 w-3" />
                                {quickLinkingId === tx.providerPaymentId
                                  ? "Linking…"
                                  : `Confirm ${topCandidate.number}`}
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenLinkModal({ layer, tx })}
                                className="rounded-md border border-[var(--staff-border)] px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800 cursor-pointer"
                              >
                                Other…
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 border border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700">
                              <HelpCircle className="h-3.5 w-3.5 text-neutral-400" />
                              Off-App / Unmatched
                            </div>
                            {tx.status !== "failed" ? (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => onOpenLinkModal({ layer, tx })}
                                  className="inline-flex items-center gap-1 rounded-md border border-[var(--staff-border)] bg-[var(--staff-canvas)] px-2.5 py-1 text-[11px] font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange cursor-pointer"
                                >
                                  <Link2 className="h-3 w-3" />
                                  Link to Invoice / WO
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="font-semibold text-brand-dark">
                          {formatMoney(tx.grossCents)}
                        </div>
                        {tx.tipCents > 0 ? (
                          <div className="text-[11px] text-neutral-400">
                            incl. {formatMoney(tx.tipCents)} tip
                          </div>
                        ) : null}
                        {tx.refundedCents > 0 ? (
                          <div className="text-[11px] text-amber-600">
                            -{formatMoney(tx.refundedCents)} refunded
                          </div>
                        ) : null}
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap text-xs text-rose-600 dark:text-rose-400">
                        {tx.feeCents > 0
                          ? `-${formatMoney(tx.feeCents)}`
                          : formatMoney(0)}
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatMoney(tx.netCents)}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <TxStatusBadge status={tx.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        }
      />

      <TablePagination {...paginationProps} position="bottom" />
    </div>
  );
}

export default function PaymentLayersReportSection({
  token,
  from,
  to,
  ownerId,
  ownersReady,
  canChooseOwner,
  onTransactionLinked,
}: {
  token: string | null;
  from?: string;
  to?: string;
  ownerId: string;
  ownersReady: boolean;
  canChooseOwner: boolean;
  onTransactionLinked?: () => void;
}) {
  const [layers, setLayers] = useState<PaymentLayerReportItem[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [linkModalTarget, setLinkModalTarget] =
    useState<LinkModalTarget | null>(null);

  const requestKey = `${token ?? ""}:${ownersReady ? "1" : "0"}:${from ?? ""}:${to ?? ""}:${ownerId}:${refreshTick}`;
  const loading = !ownersReady || loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    if (!token || !ownersReady) return;

    void (async () => {
      try {
        const res = await getFinancialsPaymentLayers(token, {
          from,
          to,
          owner: ownerId || undefined,
        });
        if (!cancelled) {
          setLayers(res.layers);
          setError(null);
          setLoadedKey(requestKey);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load payment layer reports.",
          );
          setLoadedKey(requestKey);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, from, to, ownerId, ownersReady, refreshTick, requestKey]);

  const handleRefresh = () => {
    setRefreshTick((t) => t + 1);
  };

  const handleLinkedSuccess = () => {
    setLinkModalTarget(null);
    setRefreshTick((t) => t + 1);
    onTransactionLinked?.();
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-brand-dark">
            Payment Ledger
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Active payment layers loaded for{" "}
            {canChooseOwner && !ownerId
              ? "each owner"
              : "this territory owner"}{" "}
            — matching live processor transactions against CRM invoices and
            work orders.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-3 py-1.5 text-xs font-medium text-brand-dark hover:border-neutral-400 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Sync Layers
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] px-6 py-8 text-sm text-neutral-500">
          Loading active payment layers (Square, Stripe, PayPal)…
        </div>
      ) : layers.length === 0 ? (
        <div className="rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] px-6 py-8 text-center">
          <p className="text-sm font-medium text-brand-dark">
            No active payment layers loaded
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Connect Square, Stripe, or PayPal in{" "}
            <Link
              href="/dashboard/control-panel?tab=payments"
              className="font-medium text-brand-orange underline"
            >
              Control Panel → Payment accounts
            </Link>{" "}
            to view live charge breakdowns and P&amp;L here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {layers.map((layer) => (
            <LayerReportTableCard
              key={layer.accountId}
              layer={layer}
              showOwnerBadge={canChooseOwner}
              token={token!}
              onOpenLinkModal={(target) => setLinkModalTarget(target)}
              onQuickLinked={handleLinkedSuccess}
            />
          ))}
        </div>
      )}

      {linkModalTarget && token ? (
        <LinkTransactionModal
          token={token}
          ownerId={ownerId || undefined}
          target={linkModalTarget}
          onClose={() => setLinkModalTarget(null)}
          onLinked={handleLinkedSuccess}
        />
      ) : null}
    </section>
  );
}

