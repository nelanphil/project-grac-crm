"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  completeWorkOrder,
  getWorkOrderCompletionCheck,
  type WorkOrderChannelDelivery,
  type WorkOrderCompletionCheck,
  type WorkOrderCompletionContact,
  type WorkOrderCompletionResult,
  type WorkOrderListItem,
} from "@/lib/api";
import { formatUsPhoneInput, isValidUsPhone } from "@/lib/formatPhone";
import { hasValidContactEmail } from "@/lib/invoiceEmailHtml";

const badge =
  "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200";
const primaryButton =
  "complete-notice-primary rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-60";
const quietButton =
  "complete-notice-secondary rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-60";
const inputClass =
  "complete-notice-field w-full rounded-md border px-2.5 py-1.5 text-sm";

type Phase = "idle" | "loading" | "blocked" | "choose" | "send" | "done";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function reachableContacts(
  contacts: WorkOrderCompletionContact[],
): WorkOrderCompletionContact[] {
  return contacts.filter((contact) => contact.phoneValid || contact.emailValid);
}

function phoneFieldValue(phone: string): string {
  const raw = digits(phone);
  const ten = raw.length === 11 && raw.startsWith("1") ? raw.slice(1) : raw;
  return ten.length === 10 ? formatUsPhoneInput(ten) : phone;
}

function phoneWillSend(
  contact: WorkOrderCompletionContact,
  phone: string,
): boolean {
  const trimmed = phone.trim();
  if (!trimmed) return false;
  if (digits(trimmed) === digits(contact.phone)) return contact.phoneValid;
  return isValidUsPhone(trimmed);
}

function emailWillSend(
  contact: WorkOrderCompletionContact,
  email: string,
): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === contact.email.trim().toLowerCase()) {
    return contact.emailValid;
  }
  return hasValidContactEmail(trimmed);
}

function phoneFieldError(
  contact: WorkOrderCompletionContact,
  phone: string,
): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (digits(trimmed) === digits(contact.phone) && contact.phoneValid) return null;
  if (isValidUsPhone(trimmed)) return null;
  return "Enter a 10-digit phone number.";
}

function emailFieldError(
  contact: WorkOrderCompletionContact,
  email: string,
): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (
    trimmed.toLowerCase() === contact.email.trim().toLowerCase() &&
    contact.emailValid
  ) {
    return null;
  }
  if (hasValidContactEmail(trimmed)) return null;
  return "Enter a valid email address.";
}

function channelLine(text: boolean, email: boolean): string | null {
  if (text && email) return "This invoice will be sent by text and email.";
  if (text) return "This invoice will be sent by text.";
  if (email) return "This invoice will be sent by email.";
  return null;
}

function deliveryLine(label: string, delivery: WorkOrderChannelDelivery): string {
  if (delivery.status === "sent") return `${label} sent.`;
  if (delivery.status === "skipped") return `${label} not sent.`;
  return `${label} failed: ${delivery.error}`;
}

function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const ALREADY_COMPLETE_REASON = "This work order is already complete.";
const INVOICE_NOT_OPEN_REASON =
  "This invoice is no longer open, so it cannot be resent.";

function resendBlockedReason(check: WorkOrderCompletionCheck): string | null {
  if (
    check.blockedReason &&
    check.blockedReason !== ALREADY_COMPLETE_REASON
  ) {
    return check.blockedReason;
  }
  if (reachableContacts(check.contacts).length === 0) {
    return "This customer has no contact with a valid phone number or email. Add contact information before resending the invoice.";
  }
  return null;
}

export default function WorkOrderCompleteFlow({
  orderId,
  token,
  completed,
  autoStart,
  autoResend,
  onCompleted,
}: {
  orderId: string;
  token: string;
  completed: boolean;
  autoStart: boolean;
  autoResend: boolean;
  onCompleted: (order: WorkOrderListItem) => void;
}) {
  const [phase, setPhase] = useState<Phase>(
    (autoResend && completed) || (autoStart && !completed) ? "loading" : "idle",
  );
  const [resent, setResent] = useState(false);
  const [check, setCheck] = useState<WorkOrderCompletionCheck | null>(null);
  const [contactId, setContactId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkOrderCompletionResult | null>(null);

  function applyContact(contact: WorkOrderCompletionContact) {
    setContactId(contact._id);
    setPhone(phoneFieldValue(contact.phone));
    setEmail(contact.email.trim());
  }

  function openResend(next: WorkOrderCompletionCheck) {
    setCheck(next);
    const reason = resendBlockedReason(next);
    if (reason) {
      setError(reason);
      setPhase("blocked");
      return;
    }
    const nextContact =
      reachableContacts(next.contacts).find((row) => row.isPrimary) ??
      reachableContacts(next.contacts)[0];
    if (nextContact) applyContact(nextContact);
    setError(null);
    setPhase("send");
  }

  async function beginResend() {
    setBusy(true);
    setError(null);
    setResult(null);
    setResent(false);
    setPhase("loading");
    try {
      openResend(await getWorkOrderCompletionCheck(token, orderId));
    } catch (err) {
      setCheck(null);
      setError(failureMessage(err, "Failed to check this work order."));
      setPhase("blocked");
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    setBusy(true);
    setError(null);
    setResult(null);
    setPhase("loading");
    try {
      const next = await getWorkOrderCompletionCheck(token, orderId);
      setCheck(next);
      setPhase(next.blockedReason ? "blocked" : "choose");
    } catch (err) {
      setCheck(null);
      setError(failureMessage(err, "Failed to check this work order."));
      setPhase("blocked");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoResend || !completed) return;
    let cancelled = false;
    getWorkOrderCompletionCheck(token, orderId)
      .then((next) => {
        if (!cancelled) openResend(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCheck(null);
        setError(failureMessage(err, "Failed to check this work order."));
        setPhase("blocked");
      });
    return () => {
      cancelled = true;
    };
    // The card button remounts this flow when Resend is clicked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResend, completed, orderId, token]);

  useEffect(() => {
    if (!autoStart || completed) return;
    let cancelled = false;
    getWorkOrderCompletionCheck(token, orderId)
      .then((next) => {
        if (cancelled) return;
        setCheck(next);
        setPhase(next.blockedReason ? "blocked" : "choose");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCheck(null);
        setError(failureMessage(err, "Failed to check this work order."));
        setPhase("blocked");
      });
    return () => {
      cancelled = true;
    };
  }, [autoStart, orderId, completed, token]);

  async function finish(
    data:
      | { mode: "pay_now" }
      | {
          mode: "send" | "resend";
          contactId: string;
          phoneOverride?: string;
          emailOverride?: string;
        },
    fallback: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const next = await completeWorkOrder(token, orderId, data);
      setResent(data.mode === "resend");
      setResult(next);
      setPhase("done");
      onCompleted(next.workOrder);
    } catch (err) {
      setError(failureMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (completed && phase === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={badge}>Complete</span>
        <button
          type="button"
          onClick={() => void beginResend()}
          className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
        >
          Resend
        </button>
      </div>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="space-y-3">
        {resent ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={badge}>Complete</span>
            <button
              type="button"
              onClick={() => void beginResend()}
              className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
            >
              Resend
            </button>
          </div>
        ) : null}
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
        <p>
          {resent
            ? `Invoice ${result.invoice.number} was resent.`
            : `This work order is complete. Invoice ${result.invoice.number} for ${formatCents(result.invoice.amountCents)} is ready${result.payUrl ? " to pay" : ""}.`}
        </p>
        {result.payUrl ? (
          <a
            href={result.payUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryButton} mt-3 inline-flex`}
          >
            Open payment page
          </a>
        ) : null}
        {result.delivery ? (
          <ul className="mt-2 space-y-1">
            <li>{deliveryLine("Text", result.delivery.sms)}</li>
            <li>{deliveryLine("Email", result.delivery.email)}</li>
          </ul>
        ) : null}
      </div>
      </div>
    );
  }

  if (phase === "idle") {
    return (
      <button type="button" onClick={() => void begin()} className={primaryButton}>
        Mark complete
      </button>
    );
  }

  if (phase === "loading") {
    return <p className="text-sm text-[var(--staff-muted)]">Checking this work order…</p>;
  }

  const blockedReason =
    completed && error ? error : check?.blockedReason ?? error;
  if (phase === "blocked") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
        <p>{blockedReason ?? "This work order cannot be marked complete."}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setPhase("idle");
          }}
          className="mt-3 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-800 hover:bg-red-100"
        >
          Close
        </button>
      </div>
    );
  }

  const contacts = reachableContacts(check?.contacts ?? []);
  const contact = contacts.find((row) => row._id === contactId) ?? null;
  const amount = formatCents(check?.totalCents ?? 0);

  if (phase === "choose") {
    return (
      <div className="complete-notice rounded-md border px-3 py-3 text-sm">
        <p>
          Completing this work order will generate an invoice for {amount} to be
          paid by the customer.
        </p>
        {error ? <p className="complete-notice-error mt-2 text-sm">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void finish({ mode: "pay_now" }, "Failed to mark this job complete.")}
            className={primaryButton}
          >
            {busy ? "Saving…" : "Take payment on this device"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = contacts.find((row) => row.isPrimary) ?? contacts[0];
              if (next) applyContact(next);
              setError(null);
              setPhase("send");
            }}
            className={quietButton}
          >
            Send to customer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase("idle");
            }}
            className={quietButton}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const text = contact ? phoneWillSend(contact, phone) : false;
  const mail = contact ? emailWillSend(contact, email) : false;
  const phoneError = contact ? phoneFieldError(contact, phone) : null;
  const emailError = contact ? emailFieldError(contact, email) : null;
  const via = channelLine(text, mail);
  const invoiceClosed = completed && check?.invoiceOpen === false;
  const sendBlocked =
    !contact || Boolean(phoneError) || Boolean(emailError) || !via || invoiceClosed;

  return (
    <div className="complete-notice space-y-3 rounded-md border px-3 py-3 text-sm">
      <p>
        Invoice {amount} will be {completed ? "sent again" : "sent"} to the contact
        you choose. A phone or email you type here replaces the one on file for
        this message only.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
          Contact
        </span>
        <select
          value={contactId}
          onChange={(event) => {
            const next = contacts.find((row) => row._id === event.target.value);
            if (next) applyContact(next);
          }}
          className={inputClass}
        >
          {contacts.map((row) => (
            <option key={row._id} value={row._id}>
              {row.name}
              {row.isPrimary ? " (primary)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
          Phone
        </span>
        <input
          value={phone}
          inputMode="tel"
          autoComplete="off"
          onChange={(event) => setPhone(formatUsPhoneInput(event.target.value))}
          className={inputClass}
        />
        {phoneError ? <span className="complete-notice-error mt-1 block text-xs">{phoneError}</span> : null}
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
          Email
        </span>
        <input
          type="email"
          value={email}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
        {emailError ? <span className="complete-notice-error mt-1 block text-xs">{emailError}</span> : null}
      </label>
      {invoiceClosed ? <p className="complete-notice-error">{INVOICE_NOT_OPEN_REASON}</p> : null}
      {via ? <p>{via}</p> : <p className="complete-notice-error">Enter a valid phone number or email address.</p>}
      {error ? <p className="complete-notice-error">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || sendBlocked}
          onClick={() => {
            if (!contact) return;
            const phoneOverride = phone.trim()
              ? digits(phone) === digits(contact.phone)
                ? undefined
                : phone.trim()
              : "";
            const emailOverride = email.trim()
              ? email.trim().toLowerCase() === contact.email.trim().toLowerCase()
                ? undefined
                : email.trim()
              : "";
            void finish(
              {
                mode: completed ? "resend" : "send",
                contactId: contact._id,
                ...(phoneOverride !== undefined ? { phoneOverride } : {}),
                ...(emailOverride !== undefined ? { emailOverride } : {}),
              },
              completed
                ? "Failed to resend this invoice."
                : "Failed to send this invoice.",
            );
          }}
          className={primaryButton}
        >
          {busy ? "Sending…" : completed ? "Resend invoice" : "Send invoice"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            setPhase(completed ? "idle" : "choose");
          }}
          className={quietButton}
        >
          Back
        </button>
      </div>
    </div>
  );
}
