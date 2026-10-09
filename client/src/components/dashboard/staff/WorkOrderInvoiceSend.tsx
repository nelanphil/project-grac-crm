"use client";

import { useEffect, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import {
  InvoiceSendEditor,
  InvoiceSendPreview,
  useInvoiceCustomerSend,
} from "@/components/billing/InvoiceCustomerSend";
import {
  ApiError,
  getInvoice,
  getInvoices,
  type InvoiceItem,
  type WorkOrderListItem,
} from "@/lib/api";
import { isCustomerRole } from "@/lib/dashboard-role";
import { useAuthStore } from "@/store/useAuthStore";

const sendButton =
  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none";

function pickInvoice(invoices: InvoiceItem[]): InvoiceItem | null {
  return invoices.find((invoice) => invoice.status !== "void") ?? null;
}

function SendControls({
  invoice,
  missingReason,
}: {
  invoice: InvoiceItem | null;
  missingReason: string | null;
}) {
  const send = useInvoiceCustomerSend(invoice, Boolean(invoice));
  const textReason = missingReason ?? send.textDisabledReason;
  const emailReason = missingReason ?? send.emailDisabledReason;

  return (
    <div className="min-w-0 space-y-3 border-t border-[var(--staff-border)] pt-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(textReason)}
          title={textReason ?? "Text this invoice"}
          aria-pressed={send.channel === "text"}
          onClick={() => send.openChannel("text")}
          className={`${sendButton} border border-[var(--staff-border)] text-[var(--staff-ink)] hover:bg-[var(--staff-cream)] ${
            send.channel === "text" ? "ring-2 ring-brand-orange" : ""
          }`}
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          Text Invoice
        </button>
        <button
          type="button"
          disabled={Boolean(emailReason)}
          title={emailReason ?? "Email this invoice"}
          aria-pressed={send.channel === "email"}
          onClick={() => send.openChannel("email")}
          className={`${sendButton} bg-brand-orange text-white hover:opacity-90 ${
            send.channel === "email" ? "ring-2 ring-brand-orange ring-offset-2" : ""
          }`}
        >
          <Mail className="h-4 w-4" aria-hidden />
          Email Invoice
        </button>
      </div>
      {missingReason ? (
        <p className="text-xs text-[var(--staff-muted)]">{missingReason}</p>
      ) : null}
      {send.composerOpen ? (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          <InvoiceSendEditor send={send} />
          <InvoiceSendPreview send={send} />
        </div>
      ) : null}
    </div>
  );
}

export default function WorkOrderInvoiceSend({
  order,
  token,
}: {
  order: WorkOrderListItem;
  token: string;
}) {
  const user = useAuthStore((s) => s.user);
  const canSend = useAuthStore((s) => s.hasPermission("messages:write"));
  const enabled = canSend && !isCustomerRole(user);
  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [loadedFor, setLoadedFor] = useState<WorkOrderListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getInvoices(token, { workOrderRef: order._id })
      .then(({ invoices }) => {
        const match = pickInvoice(invoices);
        return match ? getInvoice(token, match._id).then((res) => res.invoice) : null;
      })
      .then((next) => {
        if (cancelled) return;
        setInvoice(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setInvoice(null);
        setError(
          err instanceof ApiError ? err.message : "Failed to load this work order's invoice.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(order);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, token, order]);

  if (!enabled) return null;

  const loading = loadedFor === null || loadedFor._id !== order._id;
  const missingReason = loading
    ? "Loading invoice…"
    : error
      ? error
      : !invoice
        ? "Save a billable amount on this work order to create its invoice."
        : null;

  return (
    <SendControls
      key={invoice ? `${invoice._id}:${invoice.updatedAt}` : "none"}
      invoice={loading ? null : invoice}
      missingReason={missingReason}
    />
  );
}
