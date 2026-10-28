"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Eye,
  Link2,
  Mail,
  MessageSquare,
  MousePointerClick,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import {
  ApiError,
  getInvoiceActivity,
  getInvoiceVisit,
  getInvoiceVisitSnapshot,
  type InvoiceActivity,
  type InvoiceContactEntry,
  type InvoiceContactKind,
  type InvoicePaymentEntry,
  type InvoicePaymentKind,
  type JourneyEntry,
  type JourneyVisitDetail,
  type JourneyVisitEvent,
  type JourneyVisitOutcome,
  type JourneyVisitSummary,
} from "@/lib/api";

type Props = {
  token: string;
  invoiceId: string;
  refreshKey?: number;
  className?: string;
};

const CONTACT_ICON: Record<InvoiceContactKind, LucideIcon> = {
  email: Mail,
  sms: MessageSquare,
  mms: MessageSquare,
  viewed: Eye,
  pay_link_opened: Link2,
  checkout_started: ShoppingCart,
};

const CONTACT_TITLE: Record<InvoiceContactKind, string> = {
  email: "Email",
  sms: "Text",
  mms: "Picture text",
  viewed: "Viewed the invoice",
  pay_link_opened: "Opened the payment link",
  checkout_started: "Started checkout",
};

const PAYMENT_TITLE: Record<InvoicePaymentKind, string> = {
  payment_succeeded: "Payment succeeded",
  payment_failed: "Payment failed",
  payment_canceled: "Payment canceled",
  payment_needs_review: "Needs review",
};

const PAYMENT_TONE: Record<InvoicePaymentKind, string> = {
  payment_succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  payment_failed: "bg-red-50 text-red-700 border-red-200",
  payment_canceled: "bg-red-50 text-red-700 border-red-200",
  payment_needs_review: "bg-amber-50 text-amber-800 border-amber-200",
};

const METHOD_LABEL: Record<string, string> = {
  card: "Card",
  tap_to_pay: "Tap to Pay",
  card_present: "Card in person",
  card_keyed: "Card typed by staff",
  card_online: "Card typed online",
  wallet: "Digital wallet",
  check: "Check",
  cash: "Cash",
  manual: "Marked paid",
  zero_total: "No charge (discount)",
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status: string): string {
  if (status === "failed" || status === "undelivered") {
    return "bg-red-50 text-red-700 border-red-200";
  }
  if (status === "delivered") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  return "bg-neutral-50 text-neutral-600 border-neutral-200";
}

function Chip({ tone, children, title }: { tone: string; children: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
    >
      {children}
    </span>
  );
}

function ContactRow({ entry }: { entry: InvoiceContactEntry }) {
  const Icon = CONTACT_ICON[entry.kind] ?? Mail;
  const message = entry.kind === "email" || entry.kind === "sms" || entry.kind === "mms";
  return (
    <li className="flex gap-2.5 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-neutral-800">
            {CONTACT_TITLE[entry.kind] ?? entry.kind}
          </span>
          {entry.status ? (
            <Chip tone={statusTone(entry.status)} title={entry.error ?? undefined}>
              {entry.status}
            </Chip>
          ) : null}
          {entry.inferred ? (
            <Chip
              tone="bg-sky-50 text-sky-700 border-sky-200"
              title="Sent before invoice linking existed. Matched by invoice number."
            >
              matched
            </Chip>
          ) : null}
        </div>
        {message && entry.to ? (
          <p className="truncate text-xs text-neutral-600">To {entry.to}</p>
        ) : null}
        {entry.subject ? (
          <p className="truncate text-xs text-neutral-700">{entry.subject}</p>
        ) : entry.preview ? (
          <p className="line-clamp-2 text-xs text-neutral-600">{entry.preview}</p>
        ) : null}
        {entry.error ? (
          <p className="text-xs text-red-700">{entry.error}</p>
        ) : null}
        <p className="text-[11px] text-neutral-400">
          {formatWhen(entry.createdAt)} · {entry.actorName}
        </p>
      </div>
    </li>
  );
}

const ENTRY_TITLE: Record<JourneyEntry, string> = {
  checkout: "Visited checkout",
  pay: "Visited the payment link",
  invoice_view: "Visited the invoice",
  complete: "Returned from payment",
};

const OUTCOME_LABEL: Record<JourneyVisitOutcome, string> = {
  paid: "paid",
  failed: "payment failed",
  error: "hit an error",
  redirected_to_square: "sent to Square",
  abandoned: "left",
  active: "on page now",
};

const OUTCOME_TONE: Record<JourneyVisitOutcome, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  error: "bg-red-50 text-red-700 border-red-200",
  redirected_to_square: "bg-sky-50 text-sky-700 border-sky-200",
  abandoned: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const STEP_LABEL: Record<string, string> = {
  page_opened: "Opened the page",
  link_resolved: "Link recognized",
  link_invalid: "Link did not work",
  cart_loaded: "Saw the balance",
  already_paid_shown: "Saw that everything is paid",
  invoice_loaded: "Invoice loaded",
  items_changed: "Changed what to pay",
  discount_applied: "Discount code accepted",
  discount_rejected: "Discount code rejected",
  pay_clicked: "Clicked Pay",
  redirect_to_square: "Sent to Square checkout",
  checkout_start_failed: "Checkout did not start",
  returned_from_square: "Came back from Square",
  confirm_pending: "Waiting for Square to confirm",
  payment_confirmed: "Payment confirmed",
  payment_failed_shown: "Shown payment failed",
  confirm_gave_up: "Stopped waiting for confirmation",
  confirm_error: "Confirmation error",
  pdf_download_clicked: "Clicked Download PDF",
  pdf_downloaded: "PDF downloaded",
  pdf_failed: "PDF download failed",
  snapshot_taken: "Picture of the screen",
};

const SNAPSHOT_STEP = /^snapshot_taken:\s*([a-f0-9]{24})(?:\s+(\S+))?/i;

function snapshotOf(event: JourneyVisitEvent): { id: string; step: string } | null {
  if (event.type !== "step") return null;
  const match = SNAPSHOT_STEP.exec(event.detail);
  return match ? { id: match[1], step: match[2] ?? "" } : null;
}

const ERROR_STEPS = new Set([
  "link_invalid",
  "checkout_start_failed",
  "discount_rejected",
  "confirm_error",
  "pdf_failed",
  "payment_failed_shown",
]);

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatOffset(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function describeEvent(event: JourneyVisitEvent): { text: string; extra: string; bad: boolean } {
  const snapshot = snapshotOf(event);
  if (snapshot) {
    const when = STEP_LABEL[snapshot.step] ?? snapshot.step.replace(/_/g, " ");
    return {
      text: STEP_LABEL.snapshot_taken,
      extra: when ? `When: ${when}` : "",
      bad: false,
    };
  }
  if (event.type === "step") {
    const name = event.detail.split(/[\s:]/)[0] ?? event.detail;
    const extra = event.detail.slice(name.length).replace(/^:\s*/, "").trim();
    return {
      text: STEP_LABEL[name] ?? name.replace(/_/g, " "),
      extra,
      bad: ERROR_STEPS.has(name),
    };
  }
  const status = event.meta?.status;
  const apiBad = event.type === "api" && status != null && (status === 0 || status >= 400);
  const extra = [
    status != null ? (status === 0 ? "no response" : String(status)) : "",
    event.meta?.durationMs != null ? `${event.meta.durationMs}ms` : "",
    apiBad && event.meta?.message ? event.meta.message : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    text: event.detail,
    extra,
    bad: event.type === "error" || apiBad,
  };
}

const EVENT_TYPE_LABEL: Record<JourneyVisitEvent["type"], string> = {
  step: "step",
  route: "page",
  click: "click",
  api: "request",
  console: "console",
  error: "error",
  lifecycle: "browser",
};

function SnapshotThumb({
  token,
  invoiceId,
  sessionId,
  snapshotId,
  label,
}: {
  token: string;
  invoiceId: string;
  sessionId: string;
  snapshotId: string;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getInvoiceVisitSnapshot(token, invoiceId, sessionId, snapshotId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, invoiceId, sessionId, snapshotId]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (failed) {
    return (
      <p className="ml-[3.25rem] text-neutral-500">
        The picture is no longer available.
      </p>
    );
  }
  if (!url) {
    return (
      <div className="ml-[3.25rem] mt-1 h-24 w-36 animate-pulse rounded border border-neutral-200 bg-neutral-100" />
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="ml-[3.25rem] mt-1 block overflow-hidden rounded border border-neutral-200 hover:border-neutral-400"
        aria-label={`Open ${label.toLowerCase()} full size`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={label} className="max-h-40 w-36 object-cover object-top" />
      </button>
      {expanded ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto bg-black/80 p-4"
          onClick={() => setExpanded(false)}
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="self-end rounded-md bg-white px-3 py-1 text-sm font-medium text-neutral-800"
          >
            Close
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label}
            className="max-w-full rounded shadow-lg"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}

function VisitTimeline({
  token,
  invoiceId,
  visit,
  showAll,
}: {
  token: string;
  invoiceId: string;
  visit: JourneyVisitDetail;
  showAll: boolean;
}) {
  const start = new Date(visit.startedAt).getTime();
  const events = showAll
    ? visit.events
    : visit.events.filter((event) => {
        if (event.type === "step" || event.type === "error" || event.type === "click") return true;
        return describeEvent(event).bad;
      });
  if (events.length === 0) {
    return <p className="text-xs text-neutral-500">No steps recorded.</p>;
  }
  return (
    <ol className="space-y-1 border-l border-neutral-200 pl-3">
      {events.map((event, index) => {
        const { text, extra, bad } = describeEvent(event);
        const snapshot = snapshotOf(event);
        return (
          <li key={`${event.t}:${index}`} className="text-xs">
            <div className="flex items-baseline gap-1.5">
              <span className="w-10 shrink-0 font-mono text-[10px] text-neutral-400">
                {formatOffset(new Date(event.t).getTime() - start)}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                {EVENT_TYPE_LABEL[event.type]}
              </span>
              <span
                className={`min-w-0 break-words ${
                  bad
                    ? "text-red-700"
                    : event.type === "step"
                      ? "font-medium text-neutral-800"
                      : "text-neutral-600"
                }`}
              >
                {text}
              </span>
            </div>
            {extra ? (
              <p className={`ml-[3.25rem] break-words ${bad ? "text-red-600" : "text-neutral-500"}`}>
                {extra}
              </p>
            ) : null}
            {snapshot ? (
              <SnapshotThumb
                token={token}
                invoiceId={invoiceId}
                sessionId={visit.sessionId}
                snapshotId={snapshot.id}
                label={extra ? `${text}, ${extra.toLowerCase()}` : text}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function VisitRow({
  token,
  invoiceId,
  visit,
}: {
  token: string;
  invoiceId: string;
  visit: JourneyVisitSummary;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [detail, setDetail] = useState<JourneyVisitDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || detail || loading) return;
    setLoading(true);
    setError(null);
    getInvoiceVisit(token, invoiceId, visit.sessionId)
      .then(setDetail)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Could not load this visit."),
      )
      .finally(() => setLoading(false));
  }

  const pages = visit.pages.filter((page) => page !== visit.entry);
  return (
    <li className="flex gap-2.5 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
        <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-neutral-800">
            {ENTRY_TITLE[visit.entry] ?? "Visited"}
          </span>
          <Chip tone={OUTCOME_TONE[visit.outcome]}>{OUTCOME_LABEL[visit.outcome]}</Chip>
        </div>
        <p className="text-xs text-neutral-600">
          {[visit.device, formatDuration(visit.durationMs)].filter(Boolean).join(" · ")}
          {pages.length > 0
            ? ` · also ${pages.map((page) => ENTRY_TITLE[page]?.toLowerCase() ?? page).join(", ")}`
            : ""}
        </p>
        {visit.lastError ? (
          <p className="text-xs text-red-700">{visit.lastError}</p>
        ) : null}
        <p className="text-[11px] text-neutral-400">
          {formatWhen(visit.startedAt)} · Customer
        </p>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-neutral-700 hover:text-neutral-900"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          {open ? "Hide steps" : `Show steps (${visit.eventCount})`}
        </button>
        {open ? (
          <div className="mt-2 space-y-2">
            {loading ? (
              <p className="text-xs text-neutral-500">Loading steps…</p>
            ) : error ? (
              <p className="text-xs text-red-700">{error}</p>
            ) : detail ? (
              <>
                <VisitTimeline
                  token={token}
                  invoiceId={invoiceId}
                  visit={detail}
                  showAll={showAll}
                />
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(event) => setShowAll(event.target.checked)}
                    className="h-3 w-3"
                  />
                  Show every request and page change
                </label>
                {detail.userAgent ? (
                  <p className="break-words text-[10px] text-neutral-400">{detail.userAgent}</p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

type ContactItem =
  | { at: string; key: string; contact: InvoiceContactEntry }
  | { at: string; key: string; visit: JourneyVisitSummary };

function contactItems(activity: InvoiceActivity): ContactItem[] {
  const items: ContactItem[] = [
    ...activity.contacts.map((contact) => ({
      at: contact.createdAt,
      key: contact.id,
      contact,
    })),
    ...(activity.visits ?? []).map((visit) => ({
      at: visit.startedAt,
      key: `visit:${visit.sessionId}`,
      visit,
    })),
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function PaymentRow({ entry }: { entry: InvoicePaymentEntry }) {
  const method = entry.method ? METHOD_LABEL[entry.method] ?? entry.method : null;
  const provider =
    entry.provider && entry.method !== "manual"
      ? entry.provider.charAt(0).toUpperCase() + entry.provider.slice(1)
      : null;
  const detail = entry.detail;
  const channel =
    detail?.channel === "in_person" ? "In person" : detail?.channel === "online" ? "Online" : null;
  return (
    <li className="flex gap-2.5 py-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
        <CreditCard className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={PAYMENT_TONE[entry.kind]}>{PAYMENT_TITLE[entry.kind]}</Chip>
          {entry.amountCents != null ? (
            <span className="text-sm font-medium text-neutral-800">
              {formatMoney(entry.amountCents)}
            </span>
          ) : null}
          {entry.inferred ? (
            <Chip
              tone="bg-sky-50 text-sky-700 border-sky-200"
              title="Recorded before the payment log existed."
            >
              earlier record
            </Chip>
          ) : null}
          {channel ? (
            <Chip tone="bg-neutral-50 text-neutral-600 border-neutral-200">{channel}</Chip>
          ) : null}
        </div>
        {detail ? (
          <p className="text-xs text-neutral-700">{detail.label}</p>
        ) : method || provider ? (
          <p className="text-xs text-neutral-600">
            {[method, provider].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {entry.payer ? <p className="text-xs text-neutral-600">{entry.payer}</p> : null}
        {detail?.receiptUrl ? (
          <a
            href={detail.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-medium text-brand-orange hover:underline"
          >
            Square receipt
          </a>
        ) : null}
        {entry.reason ? (
          <p
            className={`text-xs ${
              entry.kind === "payment_succeeded" ? "text-neutral-600" : "text-red-700"
            }`}
          >
            {entry.reason}
          </p>
        ) : null}
        {entry.providerPaymentId ? (
          <p className="truncate font-mono text-[10px] text-neutral-400">
            {entry.providerPaymentId}
          </p>
        ) : null}
        <p className="text-[11px] text-neutral-400">
          {formatWhen(entry.createdAt)} · {entry.actorName}
        </p>
      </div>
    </li>
  );
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
        <span className="font-normal normal-case text-neutral-400">{count}</span>
      </h3>
      {count === 0 ? (
        <p className="py-3 text-xs text-neutral-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-neutral-100">{children}</ul>
      )}
    </section>
  );
}

export default function InvoiceActivityPanel({
  token,
  invoiceId,
  refreshKey = 0,
  className,
}: Props) {
  const [loaded, setLoaded] = useState<{ key: string; activity: InvoiceActivity } | null>(
    null,
  );
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const requestKey = `${invoiceId}:${refreshKey}`;

  useEffect(() => {
    let cancelled = false;
    getInvoiceActivity(token, invoiceId)
      .then((activity) => {
        if (!cancelled) setLoaded({ key: requestKey, activity });
      })
      .catch((err) => {
        if (cancelled) return;
        setFailed({
          key: requestKey,
          message: err instanceof ApiError ? err.message : "Could not load activity.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [token, invoiceId, requestKey]);

  const activity = loaded?.activity ?? null;
  const error = failed?.key === requestKey ? failed.message : null;
  const loading = !activity && !error;
  const contacts = activity ? contactItems(activity) : [];

  return (
    <aside
      className={`rounded-lg border border-neutral-200 bg-white p-4 shadow-sm print:hidden ${
        className ?? ""
      }`}
    >
      <h2 className="text-sm font-semibold text-brand-dark">Contact and payment log</h2>
      {error && !activity ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : loading ? (
        <p className="mt-3 text-xs text-neutral-500">Loading activity…</p>
      ) : activity ? (
        <div className="mt-3 space-y-5">
          <Section
            title="Contact log"
            count={contacts.length}
            empty="No emails, texts, or visits recorded for this invoice yet."
          >
            {contacts.map((item) =>
              "visit" in item ? (
                <VisitRow
                  key={item.key}
                  token={token}
                  invoiceId={invoiceId}
                  visit={item.visit}
                />
              ) : (
                <ContactRow key={item.key} entry={item.contact} />
              ),
            )}
          </Section>
          <Section
            title="Payment log"
            count={activity.payments.length}
            empty="No payment attempts recorded yet."
          >
            {activity.payments.map((entry) => (
              <PaymentRow key={entry.id} entry={entry} />
            ))}
          </Section>
        </div>
      ) : null}
    </aside>
  );
}
