"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  MessageSquare,
  ScrollText,
} from "lucide-react";
import {
  ApiError,
  ContractListItem,
  getContracts,
  getInvoices,
  getMessagingThreads,
  InvoiceItem,
  MessageThreadItem,
} from "@/lib/api";
import { formatContractCatalogLabel } from "@/lib/contractTypes";
import { formatDateOnly, parseDateOnly } from "@/lib/contractDates";
import { formatCustomerRecordName } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";
import UpcomingRenewalsTable from "@/components/dashboard/UpcomingRenewalsTable";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function isPastDue(invoice: InvoiceItem, today: Date): boolean {
  if (invoice.status !== "open" || !invoice.dueDate) return false;
  const due = parseDateOnly(invoice.dueDate);
  if (!due) return false;
  return due.getTime() < today.getTime();
}

type StandingBucket = "pastDue" | "outstanding" | "failed" | "paid";

const STANDING_LABELS: Record<StandingBucket, string> = {
  pastDue: "Past due",
  outstanding: "Outstanding",
  failed: "Failed",
  paid: "Paid",
};

function matchesStandingBucket(
  invoice: InvoiceItem,
  bucket: StandingBucket,
  today: Date,
): boolean {
  if (bucket === "paid") return invoice.status === "paid";
  if (bucket === "failed") return invoice.status === "failed";
  if (invoice.status !== "open") return false;
  const pastDue = isPastDue(invoice, today);
  return bucket === "pastDue" ? pastDue : !pastDue;
}

function standingRowDate(
  invoice: InvoiceItem,
  bucket: StandingBucket,
): string {
  if (bucket === "paid") {
    return formatDateOnly(invoice.paidAt ?? invoice.updatedAt);
  }
  if (bucket === "pastDue" || bucket === "outstanding") {
    return formatDateOnly(invoice.dueDate ?? invoice.issuedAt);
  }
  return formatDateOnly(invoice.issuedAt);
}

type KpiTone = "danger" | "info" | "success" | "warning" | "neutral";

const TONE_STYLES: Record<KpiTone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-[var(--staff-border)] bg-white text-[var(--staff-ink)]",
};

function KpiCard({
  label,
  value,
  hint,
  tone,
  onClick,
  expanded,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: KpiTone;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const className = `block w-full min-w-0 rounded-2xl border px-3 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:px-4 sm:py-4 ${TONE_STYLES[tone]} ${
    expanded ? "ring-2 ring-offset-2 ring-[var(--staff-ink)]" : ""
  }`;

  const content = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80 sm:text-xs">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold tracking-tight break-words sm:text-2xl">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs opacity-70 break-words">{hint}</p>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-expanded={expanded ?? false}
        className={className}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function QueueCard({
  title,
  href,
  empty,
  count,
  children,
}: {
  title: string;
  href: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[16rem] flex-col rounded-2xl border border-[var(--staff-border)] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--staff-ink)]">{title}</h3>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange hover:underline"
        >
          See all
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex-1 px-2 py-2">
        {count > 0 ? (
          <ul className="divide-y divide-[var(--staff-border)]">{children}</ul>
        ) : (
          <p className="px-3 py-8 text-center text-sm text-[var(--staff-muted)]">
            {empty}
          </p>
        )}
      </div>
    </section>
  );
}

export default function StaffHomeDashboard() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canReadContracts = useAuthStore((s) =>
    s.hasPermission("contracts:read"),
  );
  const canReadMessages = useAuthStore((s) => s.hasPermission("messages:read"));
  const showRenewalsTable = useAuthStore((s) =>
    s.hasRole("super-admin", "admin", "owner", "manager"),
  );

  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [threads, setThreads] = useState<MessageThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStanding, setExpandedStanding] =
    useState<StandingBucket | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    const tasks: Promise<void>[] = [
      getInvoices(token)
        .then(({ invoices: list }) => {
          if (!cancelled) setInvoices(list);
        })
        .catch(() => {
          if (!cancelled) setInvoices([]);
        }),
    ];

    if (canReadContracts) {
      tasks.push(
        getContracts(token)
          .then(({ contracts: list }) => {
            if (!cancelled) setContracts(list);
          })
          .catch(() => {
            if (!cancelled) setContracts([]);
          }),
      );
    }

    if (canReadMessages) {
      tasks.push(
        getMessagingThreads(token, { status: "open", pageSize: 8 })
          .then(({ threads: list }) => {
            if (!cancelled) setThreads(list);
          })
          .catch(() => {
            if (!cancelled) setThreads([]);
          }),
      );
    }

    Promise.all(tasks)
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load dashboard data.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, canReadContracts, canReadMessages]);

  const today = useMemo(() => startOfTodayUtc(), []);

  const accountStanding = useMemo(() => {
    let pastDueCents = 0;
    let pastDueCount = 0;
    let outstandingCents = 0;
    let outstandingCount = 0;
    let paidCents = 0;
    let paidCount = 0;
    let failedCount = 0;

    for (const invoice of invoices) {
      if (matchesStandingBucket(invoice, "paid", today)) {
        paidCents += invoice.amountCents;
        paidCount += 1;
        continue;
      }
      if (matchesStandingBucket(invoice, "failed", today)) {
        failedCount += 1;
        continue;
      }
      if (matchesStandingBucket(invoice, "pastDue", today)) {
        pastDueCents += invoice.amountCents;
        pastDueCount += 1;
      } else if (matchesStandingBucket(invoice, "outstanding", today)) {
        outstandingCents += invoice.amountCents;
        outstandingCount += 1;
      }
    }

    return {
      pastDueCents,
      pastDueCount,
      outstandingCents,
      outstandingCount,
      paidCents,
      paidCount,
      failedCount,
    };
  }, [invoices, today]);

  const expandedStandingInvoices = useMemo(() => {
    if (!expandedStanding) return [];
    const list = invoices.filter((invoice) =>
      matchesStandingBucket(invoice, expandedStanding, today),
    );
    return list.sort((a, b) => {
      if (expandedStanding === "paid") {
        const aTime = new Date(a.paidAt ?? a.updatedAt).getTime();
        const bTime = new Date(b.paidAt ?? b.updatedAt).getTime();
        return bTime - aTime;
      }
      const aDue = parseDateOnly(a.dueDate)?.getTime() ?? 0;
      const bDue = parseDateOnly(b.dueDate)?.getTime() ?? 0;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime();
    });
  }, [expandedStanding, invoices, today]);

  function toggleStanding(bucket: StandingBucket) {
    setExpandedStanding((current) => (current === bucket ? null : bucket));
  }

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

  const upcomingRenewals = useMemo(() => {
    return contracts
      .filter((c) => c.standing === "due_soon" || c.standing === "expired")
      .sort((a, b) => {
        const aTime = parseDateOnly(a.renewalDueDate)?.getTime() ?? 0;
        const bTime = parseDateOnly(b.renewalDueDate)?.getTime() ?? 0;
        return aTime - bTime;
      })
      .slice(0, 6);
  }, [contracts]);

  const openInvoices = useMemo(() => {
    return invoices
      .filter((i) => i.status === "open" || i.status === "failed")
      .slice(0, 6);
  }, [invoices]);

  const recentPayments = useMemo(() => {
    return invoices
      .filter((i) => i.status === "paid")
      .sort((a, b) => {
        const aTime = new Date(a.paidAt ?? a.updatedAt).getTime();
        const bTime = new Date(b.paidAt ?? b.updatedAt).getTime();
        return bTime - aTime;
      })
      .slice(0, 8);
  }, [invoices]);

  return (
    <div className="w-full max-w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-[var(--staff-muted)]">Welcome back</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--staff-ink)] sm:text-3xl">
            {user?.first_name} {user?.last_name}
          </h1>
          <p className="mt-1 text-sm text-[var(--staff-muted)]">
            Your command center for accounts, contracts, and collections.
          </p>
        </div>
        <Link
          href="/dashboard/customers"
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--staff-ink)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black sm:w-auto"
        >
          View customers
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--staff-muted)]" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
            Account standing
          </h2>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="Past due"
            value={loading ? "—" : formatMoney(accountStanding.pastDueCents)}
            hint={
              loading ? "Loading…" : `${accountStanding.pastDueCount} invoices`
            }
            tone="danger"
            expanded={expandedStanding === "pastDue"}
            onClick={() => toggleStanding("pastDue")}
          />
          <KpiCard
            label="Outstanding"
            value={
              loading ? "—" : formatMoney(accountStanding.outstandingCents)
            }
            hint={
              loading
                ? "Loading…"
                : `${accountStanding.outstandingCount} open invoices`
            }
            tone="info"
            expanded={expandedStanding === "outstanding"}
            onClick={() => toggleStanding("outstanding")}
          />
          <KpiCard
            label="Failed"
            value={loading ? "—" : String(accountStanding.failedCount)}
            hint="Needs follow-up"
            tone="warning"
            expanded={expandedStanding === "failed"}
            onClick={() => toggleStanding("failed")}
          />
          <KpiCard
            label="Paid"
            value={loading ? "—" : formatMoney(accountStanding.paidCents)}
            hint={
              loading ? "Loading…" : `${accountStanding.paidCount} payments`
            }
            tone="success"
            expanded={expandedStanding === "paid"}
            onClick={() => toggleStanding("paid")}
          />
        </div>

        {expandedStanding ? (
          <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--staff-border)] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--staff-ink)]">
                {STANDING_LABELS[expandedStanding]} invoices
              </h3>
              <Link
                href="/dashboard/orders"
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange hover:underline"
              >
                See all invoices
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <ResponsiveDataView
              className="p-3 md:p-0"
              isEmpty={expandedStandingInvoices.length === 0}
              empty={
                <p className="px-4 py-8 text-center text-sm text-[var(--staff-muted)]">
                  No invoices in this category.
                </p>
              }
              mobile={expandedStandingInvoices.map((invoice) => (
                <MobileDataCard
                  key={invoice._id}
                  title={invoice.number}
                  subtitle={`Customer #${invoice.customerId}`}
                  badges={
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">
                      {invoice.status}
                    </span>
                  }
                  fields={
                    <>
                      <DataField
                        label="Date"
                        value={standingRowDate(invoice, expandedStanding)}
                      />
                      <DataField
                        label="Amount"
                        value={formatMoney(invoice.amountCents)}
                      />
                    </>
                  }
                  actions={
                    <Link
                      href={`/dashboard/orders/detail?id=${invoice._id}`}
                      className="text-xs font-semibold text-brand-orange hover:underline"
                    >
                      View
                    </Link>
                  }
                />
              ))}
              desktop={
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[var(--staff-border)] text-sm">
                    <thead className="bg-[var(--staff-cream)]/70">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                          Invoice
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                          Status
                        </th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--staff-border)]">
                      {expandedStandingInvoices.map((invoice) => (
                        <tr
                          key={invoice._id}
                          className="transition hover:bg-[var(--staff-cream)]/50"
                        >
                          <td className="px-4 py-3 font-medium text-[var(--staff-ink)]">
                            {invoice.number}
                          </td>
                          <td className="px-4 py-3 text-[var(--staff-muted)]">
                            #{invoice.customerId}
                          </td>
                          <td className="px-4 py-3 text-[var(--staff-muted)]">
                            {standingRowDate(invoice, expandedStanding)}
                          </td>
                          <td className="px-4 py-3 font-semibold text-[var(--staff-ink)]">
                            {formatMoney(invoice.amountCents)}
                          </td>
                          <td className="px-4 py-3 capitalize text-[var(--staff-muted)]">
                            {invoice.status}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/dashboard/orders/detail?id=${invoice._id}`}
                              className="text-xs font-semibold text-brand-orange hover:underline"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            />
          </div>
        ) : null}
      </section>

      {canReadContracts ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[var(--staff-muted)]" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
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
      ) : null}

      <section className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {canReadContracts ? (
          <QueueCard
            title="Upcoming renewals"
            href="/dashboard/contracts"
            empty="No renewals due right now."
            count={upcomingRenewals.length}
          >
            {upcomingRenewals.map((contract) => {
              const name = contract.customer
                ? formatCustomerRecordName(contract.customer)
                : `Customer #${contract.customerId}`;
              return (
                <li key={contract._id}>
                  <Link
                    href={`/dashboard/contracts/edit?id=${contract._id}`}
                    className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-[var(--staff-cream)]"
                  >
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--staff-ink)]">
                        {name}
                      </p>
                      <p className="truncate text-xs text-[var(--staff-muted)]">
                        {formatContractCatalogLabel(contract)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-[var(--staff-muted)]">
                      {formatDateOnly(contract.renewalDueDate)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </QueueCard>
        ) : null}

        <QueueCard
          title="Invoices in review"
          href="/dashboard/orders"
          empty="No open invoices."
          count={openInvoices.length}
        >
          {openInvoices.map((invoice) => {
            const pastDue = isPastDue(invoice, today);
            return (
              <li key={invoice._id}>
                <Link
                  href="/dashboard/orders"
                  className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-[var(--staff-cream)]"
                >
                  {pastDue || invoice.status === "failed" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  ) : (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--staff-ink)]">
                      {invoice.number}
                    </p>
                    <p className="truncate text-xs text-[var(--staff-muted)]">
                      Customer #{invoice.customerId}
                      {pastDue ? " · Past due" : ` · ${invoice.status}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-[var(--staff-ink)]">
                    {formatMoney(invoice.amountCents)}
                  </span>
                </Link>
              </li>
            );
          })}
        </QueueCard>

        {canReadMessages ? (
          <QueueCard
            title="Open message threads"
            href="/dashboard/messaging"
            empty="No open threads."
            count={threads.length}
          >
            {threads.map((thread) => {
              const name = thread.customer
                ? formatCustomerRecordName(thread.customer)
                : thread.contact
                  ? `${thread.contact.first} ${thread.contact.last}`.trim()
                  : thread.contactPhoneSnapshot;
              return (
                <li key={thread._id}>
                  <Link
                    href="/dashboard/messaging"
                    className="flex items-start gap-3 rounded-xl px-3 py-3 transition hover:bg-[var(--staff-cream)]"
                  >
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--staff-ink)]">
                        {name || "Unknown contact"}
                      </p>
                      <p className="truncate text-xs text-[var(--staff-muted)]">
                        {thread.lastMessagePreview || "No messages yet"}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </QueueCard>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--staff-border)] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--staff-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-semibold text-[var(--staff-ink)]">
              Recent payments
            </h3>
          </div>
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-orange hover:underline"
          >
            See all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-sm text-[var(--staff-muted)]">
            Loading payments…
          </p>
        ) : (
          <ResponsiveDataView
            className="p-3 md:p-0"
            isEmpty={recentPayments.length === 0}
            empty={
              <p className="px-4 py-8 text-center text-sm text-[var(--staff-muted)]">
                No payments recorded yet.
              </p>
            }
            mobile={recentPayments.map((invoice) => (
              <MobileDataCard
                key={invoice._id}
                title={invoice.number}
                subtitle={`Customer #${invoice.customerId}`}
                badges={
                  <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                    Accepted
                  </span>
                }
                fields={
                  <>
                    <DataField
                      label="Date"
                      value={formatDateOnly(
                        invoice.paidAt ?? invoice.updatedAt,
                      )}
                    />
                    <DataField
                      label="Amount"
                      value={formatMoney(invoice.amountCents)}
                    />
                    <DataField
                      label="Method"
                      value={
                        <span className="capitalize">
                          {invoice.paymentProvider ?? "—"}
                        </span>
                      }
                      className="col-span-2"
                    />
                  </>
                }
              />
            ))}
            desktop={
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--staff-border)] text-sm">
                  <thead className="bg-[var(--staff-cream)]/70">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Payment
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Customer
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Method
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--staff-border)]">
                    {recentPayments.map((invoice) => (
                      <tr
                        key={invoice._id}
                        className="transition hover:bg-[var(--staff-cream)]/50"
                      >
                        <td className="px-4 py-3 font-medium text-[var(--staff-ink)]">
                          {invoice.number}
                        </td>
                        <td className="px-4 py-3 text-[var(--staff-muted)]">
                          #{invoice.customerId}
                        </td>
                        <td className="px-4 py-3 text-[var(--staff-muted)]">
                          {formatDateOnly(invoice.paidAt ?? invoice.updatedAt)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-[var(--staff-ink)]">
                          {formatMoney(invoice.amountCents)}
                        </td>
                        <td className="px-4 py-3 capitalize text-[var(--staff-muted)]">
                          {invoice.paymentProvider ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            Accepted
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </section>

      {showRenewalsTable ? (
        <section className="rounded-2xl border border-[var(--staff-border)] bg-white p-4 shadow-sm sm:p-6">
          <UpcomingRenewalsTable />
        </section>
      ) : null}
    </div>
  );
}
