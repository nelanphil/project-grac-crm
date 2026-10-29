"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Download,
  Mail,
  MessageSquare,
  Receipt,
  RotateCcw,
  ScanSearch,
  Smartphone,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink from "@/components/dashboard/DashboardBackLink";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import InvoiceActivityPanel from "@/components/billing/InvoiceActivityPanel";
import {
  InvoiceSendEditor,
  InvoiceSendPreview,
  useInvoiceCustomerSend,
} from "@/components/billing/InvoiceCustomerSend";
import {
  canToggleInvoiceStatus,
  InvoiceStatusChangeWarning,
} from "@/components/billing/InvoiceStatusActions";
import { useTapToPay } from "@/components/billing/TapToPayButton";
import { PosChargeNotice, usePosChargeCheck } from "@/components/billing/PosChargeCheck";
import ActionsMenu, { type ActionsMenuItem } from "@/components/ui/ActionsMenu";
import { useAuthStore } from "@/store/useAuthStore";
import { isCustomerRole } from "@/lib/dashboard-role";
import {
  ApiError,
  getInvoice,
  InvoiceItem,
  type InvoiceStatus,
  markInvoicePaid,
  reopenInvoice,
  resendRenewalScheduleEmail,
  startInvoiceCheckout,
  updateInvoiceTax,
} from "@/lib/api";

const backLinkClass =
  "inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  open: "bg-sky-50 text-sky-800 ring-sky-200",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  void: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCalendarDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return formatDate(value);
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function InvoiceDetailPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="text-sm text-neutral-500 py-6">Loading invoice…</div>
        }
      >
        <InvoiceDetailContent />
      </Suspense>
    </AuthGuard>
  );
}

function PageMessage({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <DashboardBackLink
        fallbackHref="/dashboard/orders"
        fallbackLabel="Back to invoices"
        className={backLinkClass}
      />
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {message}
      </div>
    </div>
  );
}

function InvoiceDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hasRole = useAuthStore((s) => s.hasRole);
  const isCustomer = isCustomerRole(user);
  const canEmail = hasRole("admin", "super-admin");
  const canWrite = useAuthStore((s) => s.hasPermission("contracts:write"));
  const canEditTax = canWrite;

  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [taxDraft, setTaxDraft] = useState("");
  const [editingTax, setEditingTax] = useState(false);
  const [savingTax, setSavingTax] = useState(false);
  const [confirmingStatus, setConfirmingStatus] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [activityKey, setActivityKey] = useState(0);
  const [sendingSchedule, setSendingSchedule] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refreshActivity = () => setActivityKey((key) => key + 1);
  const send = useInvoiceCustomerSend(invoice, canEmail && !isCustomer, {
    onSendFinished: refreshActivity,
  });
  const tapToPay = useTapToPay({
    token: token ?? "",
    invoiceId: invoice?._id ?? "",
    onError: setError,
  });
  const squareCheck = usePosChargeCheck({
    token: token ?? "",
    invoice,
    onUpdated: (next) => {
      setInvoice((current) => (current ? { ...current, ...next } : next));
      refreshActivity();
    },
  });

  useEffect(() => {
    if (!token || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getInvoice(token, id)
      .then(({ invoice: inv }) => {
        setInvoice(inv);
        setTaxDraft(((inv.taxCents ?? 0) / 100).toFixed(2));
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load invoice.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  async function confirmStatusChange() {
    if (!token || !invoice) return;
    setStatusBusy(true);
    setError(null);
    try {
      const { invoice: updated } =
        invoice.status === "paid"
          ? await reopenInvoice(token, invoice._id)
          : await markInvoicePaid(token, invoice._id);
      setInvoice((current) => (current ? { ...current, ...updated } : updated));
      setConfirmingStatus(false);
      refreshActivity();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to update invoice status.",
      );
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleResendSchedule() {
    if (!token || !invoice) return;
    setSendingSchedule(true);
    setError(null);
    setNotice(null);
    try {
      const result = await resendRenewalScheduleEmail(token, invoice._id);
      setNotice(result.message);
      const { invoice: next } = await getInvoice(token, invoice._id);
      setInvoice(next);
      refreshActivity();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to send the scheduling email.",
      );
    } finally {
      setSendingSchedule(false);
    }
  }

  async function handlePay() {
    if (!token || !invoice) return;
    setPaying(true);
    setError(null);
    try {
      const { url } = await startInvoiceCheckout(token, invoice._id);
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to start checkout.",
      );
      setPaying(false);
    }
  }

  async function handleSaveTax() {
    if (!token || !invoice) return;
    const dollars = Number(taxDraft);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter a valid tax amount.");
      return;
    }
    setSavingTax(true);
    setError(null);
    try {
      const { invoice: next } = await updateInvoiceTax(token, invoice._id, {
        taxCents: Math.round(dollars * 100),
      });
      setInvoice(next);
      setTaxDraft(((next.taxCents ?? 0) / 100).toFixed(2));
      setEditingTax(false);
      refreshActivity();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update tax.",
      );
    } finally {
      setSavingTax(false);
    }
  }

  if (!id) return <PageMessage message="Missing invoice id." />;

  if (loading) {
    return (
      <div className="text-sm text-neutral-500 py-6">Loading invoice…</div>
    );
  }

  if (error && !invoice) return <PageMessage message={error} />;
  if (!invoice) return <PageMessage message="Invoice not found." />;

  const canPay = invoice.status === "open" || invoice.status === "failed";
  const canToggle = !isCustomer && canWrite && canToggleInvoiceStatus(invoice);
  const taxEditable =
    !isCustomer &&
    canEditTax &&
    (invoice.status === "open" ||
      invoice.status === "draft" ||
      invoice.status === "failed");
  const showActivity = !isCustomer && Boolean(token);
  const customerName = invoice.customer?.name || invoice.customerName || null;
  const dueDate = formatDate(invoice.dueDate);
  const paidDate = invoice.status === "paid" ? formatDate(invoice.paidAt) : null;
  const canResendSchedule =
    !isCustomer &&
    canWrite &&
    invoice.status === "paid" &&
    invoice.sourceType === "contract_renewal" &&
    Boolean(invoice.renewalVisit) &&
    !invoice.renewalVisit?.scheduled;
  const scheduledVisit =
    !isCustomer && invoice.renewalVisit?.scheduled ? invoice.renewalVisit : null;

  const actions: ActionsMenuItem[] = [];
  if (isCustomer && canPay) {
    actions.push({
      key: "pay-customer",
      group: "pay",
      label: "Pay now",
      icon: CreditCard,
      onSelect: () => router.push(`/dashboard/checkout/?invoiceId=${invoice._id}`),
    });
  }
  if (canResendSchedule && invoice.renewalVisit) {
    const sentAt = formatDate(invoice.renewalVisit.scheduleEmailSentAt);
    actions.push({
      key: "resend-schedule",
      group: "send",
      label: "Resend scheduling email",
      icon: CalendarDays,
      disabled: sendingSchedule,
      hint: sentAt ? `Last sent ${sentAt}` : "Not sent yet",
      onSelect: () => void handleResendSchedule(),
    });
  }
  if (!isCustomer && send.enabled) {
    actions.push(
      {
        key: "email",
        group: "send",
        label: "Email invoice",
        icon: Mail,
        active: send.channel === "email",
        disabled: Boolean(send.emailDisabledReason),
        hint: send.emailDisabledReason,
        onSelect: () => send.openChannel("email"),
      },
      {
        key: "text",
        group: "send",
        label: "Text invoice",
        icon: MessageSquare,
        active: send.channel === "text",
        disabled: Boolean(send.textDisabledReason),
        hint: send.textDisabledReason,
        onSelect: () => send.openChannel("text"),
      },
    );
  }
  if (!isCustomer && canPay && canWrite && token && tapToPay.supported) {
    actions.push({
      key: "tap-to-pay",
      group: "payment",
      label: "Take payment with Tap to Pay",
      icon: Smartphone,
      disabled: tapToPay.busy || paying || statusBusy,
      hint: "Opens Square Point of Sale on this phone.",
      onSelect: () => void tapToPay.start(),
    });
  }
  if (!isCustomer && canPay) {
    actions.push({
      key: "pay-online",
      group: "payment",
      label: "Open online checkout",
      icon: CreditCard,
      disabled: paying,
      hint: "Pay by card on Square's checkout page.",
      onSelect: () => void handlePay(),
    });
  }
  if (!isCustomer && canWrite && token && squareCheck.available) {
    actions.push({
      key: "check-square",
      group: "payment",
      label: "Check Square for payment",
      icon: ScanSearch,
      disabled: squareCheck.busy,
      hint: "Find a Square payment that wasn't recorded here.",
      onSelect: () => void squareCheck.check(),
    });
  }
  if (canToggle) {
    const paid = invoice.status === "paid";
    actions.push({
      key: "toggle-status",
      group: "payment",
      label: paid ? "Mark as unpaid" : "Mark as paid",
      icon: paid ? RotateCcw : CheckCircle2,
      disabled: statusBusy,
      onSelect: () => {
        setError(null);
        setConfirmingStatus(true);
      },
    });
  }
  if (taxEditable) {
    actions.push({
      key: "tax",
      group: "invoice",
      label: "Edit tax",
      icon: Receipt,
      hint: `Currently ${formatMoney(invoice.taxCents ?? 0)}`,
      onSelect: () => {
        setTaxDraft(((invoice.taxCents ?? 0) / 100).toFixed(2));
        setEditingTax(true);
      },
    });
  }
  actions.push({
    key: "pdf",
    group: "invoice",
    label: "Export to PDF",
    icon: Download,
    onSelect: () => window.print(),
  });

  const busyLabel = sendingSchedule
    ? "Sending scheduling email…"
    : tapToPay.busy
      ? "Opening Square…"
      : paying
        ? "Redirecting…"
        : squareCheck.busy
          ? "Checking Square…"
          : savingTax
            ? "Saving tax…"
            : null;

  const activityPanel =
    showActivity && token ? (
      <InvoiceActivityPanel
        token={token}
        invoiceId={invoice._id}
        refreshKey={activityKey}
        className={
          send.composerOpen
            ? undefined
            : "xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto"
        }
      />
    ) : null;

  return (
    <div
      className={`space-y-4 print:max-w-none print:space-y-0 ${
        send.composerOpen
          ? "w-full max-w-none"
          : showActivity
            ? "mx-auto w-full max-w-[1500px]"
            : "mx-auto w-full max-w-5xl"
      }`}
    >
      <header className="space-y-3 print:hidden">
        <DashboardBackLink
          fallbackHref="/dashboard/orders"
          fallbackLabel="Back to invoices"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-brand-dark sm:text-2xl">
                Invoice {invoice.number}
              </h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ${
                  STATUS_TONE[invoice.status] ?? STATUS_TONE.draft
                }`}
              >
                {invoice.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-neutral-500">
              {[
                customerName,
                formatMoney(invoice.amountCents),
                paidDate ? `Paid ${paidDate}` : dueDate ? `Due ${dueDate}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {scheduledVisit ? (
              <p className="mt-1 text-sm text-neutral-500">
                Renewal visit scheduled
                {scheduledVisit.date
                  ? ` for ${formatCalendarDate(scheduledVisit.date)}`
                  : ""}
                {scheduledVisit.workOrderId ? (
                  <>
                    {" "}
                    (
                    <Link
                      href={`/dashboard/work-orders/detail?id=${scheduledVisit.workOrderId}`}
                      className="font-medium text-brand-dark hover:text-brand-orange"
                    >
                      {scheduledVisit.workOrderNumber || "Work order"}
                    </Link>
                    )
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <ActionsMenu items={actions} busyLabel={busyLabel} className="w-full sm:w-auto" />
        </div>
      </header>

      {!isCustomer && canWrite && token ? (
        <PosChargeNotice invoice={invoice} check={squareCheck} showButton={false} />
      ) : null}

      {confirmingStatus && canToggle ? (
        <div className="print:hidden">
          <InvoiceStatusChangeWarning
            invoice={invoice}
            busy={statusBusy}
            error={error}
            onConfirm={() => void confirmStatusChange()}
            onCancel={() => {
              setConfirmingStatus(false);
              setError(null);
            }}
          />
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 print:hidden">
          {notice}
        </div>
      ) : null}

      {editingTax && taxEditable ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveTax();
          }}
        >
          <label className="font-medium text-neutral-700" htmlFor="invoice-tax-amount">
            Tax amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400">
              $
            </span>
            <input
              id="invoice-tax-amount"
              value={taxDraft}
              onChange={(e) => setTaxDraft(e.target.value)}
              inputMode="decimal"
              autoFocus
              className="w-28 rounded-md border border-neutral-300 py-1.5 pl-5 pr-2 text-right text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingTax}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {savingTax ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={savingTax}
              onClick={() => {
                setEditingTax(false);
                setTaxDraft(((invoice.taxCents ?? 0) / 100).toFixed(2));
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div
        className={
          send.composerOpen
            ? "grid items-start gap-4 print:block lg:grid-cols-2 2xl:grid-cols-3"
            : activityPanel
              ? "grid items-start gap-4 print:block xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]"
              : undefined
        }
      >
        <div
          className={
            send.composerOpen ? "min-w-0 lg:col-span-2 2xl:col-span-1" : "min-w-0"
          }
        >
          <InvoiceDocument invoice={invoice} isCustomer={isCustomer} />
        </div>
        {send.composerOpen ? (
          <>
            <InvoiceSendEditor send={send} />
            <InvoiceSendPreview send={send} />
          </>
        ) : (
          activityPanel
        )}
      </div>
      {send.composerOpen ? activityPanel : null}
    </div>
  );
}
