"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ApiError,
  getInvoices,
  getRecentWorkOrderNotes,
  getReminders,
  type InvoiceItem,
  type RecentWorkOrderNote,
  type ReminderListItem,
} from "@/lib/api";
import { formatDateOnly, parseDateOnly } from "@/lib/contractDates";
import { invoiceCustomerLabel } from "@/lib/formatName";
import { useAuthStore } from "@/store/useAuthStore";
import TechnicianHomeDashboard from "@/components/dashboard/staff/TechnicianHomeDashboard";

const REMINDER_PREVIEW = 4;
const NOTE_PREVIEW = 4;

type BriefingTab = "reminders" | "notes";

function ticketHref(item: ReminderListItem): string {
  return item.source === "estimate"
    ? `/dashboard/estimates/detail?id=${item.ticketId}`
    : `/dashboard/work-orders/detail?id=${item.ticketId}`;
}

function excerpt(content: string): string {
  const text = content
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 160) return text;
  return `${text.slice(0, 157)}…`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function dueTime(invoice: InvoiceItem): number {
  const parsed = parseDateOnly(invoice.dueDate);
  return parsed ? parsed.getTime() : Number.NEGATIVE_INFINITY;
}

function comparePending(a: InvoiceItem, b: InvoiceItem): number {
  const dueDelta = dueTime(b) - dueTime(a);
  if (dueDelta !== 0) return dueDelta;
  return new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime();
}

async function loadInvoicesByStatus(
  token: string,
  status: "open" | "failed",
): Promise<InvoiceItem[]> {
  const pageSize = 500;
  const first = await getInvoices(token, { status, page: 1, pageSize });
  const invoices = [...first.invoices];
  const total = first.total ?? invoices.length;
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return invoices;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      getInvoices(token, { status, page: index + 2, pageSize }),
    ),
  );
  for (const page of rest) invoices.push(...page.invoices);
  return invoices;
}

function BriefingRow({
  href,
  text,
  meta,
}: {
  href: string;
  text: string;
  meta: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block px-4 py-3.5 hover:bg-[var(--staff-cream)] lg:py-2.5"
      >
        <p className="line-clamp-2 text-sm text-[var(--staff-ink)] lg:line-clamp-1">
          {text}
        </p>
        {meta ? (
          <p className="mt-0.5 truncate text-xs text-[var(--staff-muted)]">
            {meta}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

function CardShell({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--staff-border)] px-4 py-3">
        {header}
      </div>
      <div className="max-h-80 overflow-y-auto">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-[var(--staff-muted)]">
      {children}
    </p>
  );
}

const tabClass = (active: boolean) =>
  `text-sm font-semibold uppercase tracking-wide ${
    active
      ? "text-[var(--staff-ink)]"
      : "text-[var(--staff-muted)] hover:text-[var(--staff-ink)]"
  }`;

export default function StaffBriefingHome() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const firstName = user?.first_name?.trim() || "";

  const [tab, setTab] = useState<BriefingTab>("reminders");
  const [reminders, setReminders] = useState<ReminderListItem[] | null>(null);
  const [reminderTotal, setReminderTotal] = useState(0);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [notes, setNotes] = useState<RecentWorkOrderNote[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [payments, setPayments] = useState<InvoiceItem[] | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getReminders(token, {
      page: 1,
      pageSize: 50,
      sort: "created",
      dir: "desc",
    })
      .then((result) => {
        if (cancelled) return;
        setReminders(result.reminders.slice(0, REMINDER_PREVIEW));
        setReminderTotal(result.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setReminders([]);
        setReminderError(
          err instanceof ApiError ? err.message : "Could not load reminders",
        );
      });
    getRecentWorkOrderNotes(token)
      .then((result) => {
        if (cancelled) return;
        setNotes(result.notes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setNotes([]);
        if (err instanceof ApiError && err.status === 403) return;
        setNotesError(
          err instanceof ApiError ? err.message : "Could not load recent notes",
        );
      });
    Promise.all([
      loadInvoicesByStatus(token, "open"),
      loadInvoicesByStatus(token, "failed"),
    ])
      .then(([openInvoices, failedInvoices]) => {
        if (cancelled) return;
        setPayments([...openInvoices, ...failedInvoices].sort(comparePending));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPayments([]);
        setPaymentsError(
          err instanceof ApiError
            ? err.message
            : "Could not load pending payments",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const visibleNotes =
    notes && !showAllNotes ? notes.slice(0, NOTE_PREVIEW) : (notes ?? []);
  const canShowMoreNotes = (notes?.length ?? 0) > NOTE_PREVIEW;

  const remindersLink = (
    <Link
      href="/dashboard/notifications"
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      {reminderTotal > (reminders?.length ?? 0)
        ? `See all ${reminderTotal}`
        : "See all"}
    </Link>
  );
  const notesToggle = canShowMoreNotes ? (
    <button
      type="button"
      onClick={() => setShowAllNotes((value) => !value)}
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      {showAllNotes ? "Show less" : "Show more"}
    </button>
  ) : null;
  const notesLink = (
    <Link
      href="/dashboard/notifications/?tab=notes"
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      See all
    </Link>
  );
  const paymentsLink = (
    <Link
      href="/dashboard/orders"
      className="text-sm font-medium text-brand-orange hover:underline"
    >
      See all
    </Link>
  );

  const tabAction =
    tab === "reminders" ? (
      remindersLink
    ) : (
      <span className="inline-flex items-center gap-3">
        {notesLink}
        {notesToggle}
      </span>
    );

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--staff-ink)]">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-1 text-sm text-[var(--staff-muted)]">{todayLabel()}</p>
      </header>

      <div className="order-last grid gap-4 lg:order-none lg:grid-cols-2">
        <CardShell
          header={
            <>
              <div
                role="tablist"
                aria-label="Reminders and recent notes"
                className="flex min-w-0 flex-1 items-center gap-4"
              >
                <button
                  type="button"
                  role="tab"
                  id="briefing-tab-reminders"
                  aria-selected={tab === "reminders"}
                  aria-controls="briefing-panel"
                  onClick={() => setTab("reminders")}
                  className={tabClass(tab === "reminders")}
                >
                  Reminders
                  {reminders ? (
                    <span className="ml-1 font-medium">({reminderTotal})</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="briefing-tab-notes"
                  aria-selected={tab === "notes"}
                  aria-controls="briefing-panel"
                  onClick={() => setTab("notes")}
                  className={tabClass(tab === "notes")}
                >
                  Recent notes
                </button>
              </div>
              <div className="shrink-0">{tabAction}</div>
            </>
          }
        >
          <div
            role="tabpanel"
            id="briefing-panel"
            aria-labelledby={
              tab === "reminders" ? "briefing-tab-reminders" : "briefing-tab-notes"
            }
          >
            {tab === "reminders" ? (
              reminderError ? (
                <p className="px-4 py-6 text-sm text-red-700">{reminderError}</p>
              ) : !reminders ? (
                <EmptyLine>Loading reminders…</EmptyLine>
              ) : reminders.length === 0 ? (
                <EmptyLine>No reminders.</EmptyLine>
              ) : (
                <ul className="divide-y divide-[var(--staff-border)]">
                  {reminders.map((item) => (
                    <BriefingRow
                      key={`${item.source}-${item.id}`}
                      href={ticketHref(item)}
                      text={excerpt(item.content)}
                      meta={[item.ticketNumber, item.customerName]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  ))}
                </ul>
              )
            ) : notesError ? (
              <p className="px-4 py-6 text-sm text-red-700">{notesError}</p>
            ) : !notes ? (
              <EmptyLine>Loading notes…</EmptyLine>
            ) : visibleNotes.length === 0 ? (
              <EmptyLine>No recent notes.</EmptyLine>
            ) : (
              <ul className="divide-y divide-[var(--staff-border)]">
                {visibleNotes.map((note) => (
                  <BriefingRow
                    key={note.id}
                    href={`/dashboard/work-orders/detail?id=${note.workOrderId}`}
                    text={excerpt(note.content)}
                    meta={[
                      note.authorName || "Staff",
                      note.ticketNumber,
                      note.customerName,
                      formatWhen(note.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                ))}
              </ul>
            )}
          </div>
        </CardShell>

        <CardShell
          header={
            <>
              <h2 className="min-w-0 flex-1 text-sm font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                Pending payments
                {payments ? (
                  <span className="ml-1 font-medium text-[var(--staff-ink)]">
                    ({payments.length})
                  </span>
                ) : null}
              </h2>
              <div className="shrink-0">{paymentsLink}</div>
            </>
          }
        >
          {paymentsError ? (
            <p className="px-4 py-6 text-sm text-red-700">{paymentsError}</p>
          ) : !payments ? (
            <EmptyLine>Loading pending payments…</EmptyLine>
          ) : payments.length === 0 ? (
            <EmptyLine>No pending payments.</EmptyLine>
          ) : (
            <ul className="divide-y divide-[var(--staff-border)]">
              {payments.map((invoice) => (
                <BriefingRow
                  key={invoice._id}
                  href={`/dashboard/orders/detail?id=${invoice._id}`}
                  text={`${invoice.number} · ${formatMoney(invoice.amountCents)}`}
                  meta={[
                    invoiceCustomerLabel(invoice),
                    invoice.dueDate
                      ? `Due ${formatDateOnly(invoice.dueDate)}`
                      : "",
                    invoice.status === "failed" ? "Failed" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </ul>
          )}
        </CardShell>
      </div>

      <TechnicianHomeDashboard />
    </div>
  );
}
