"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ApiError,
  completeWorkOrder,
  getWorkOrderCompletionCheck,
  offlinePaymentLabel,
  sendWorkOrderReceipt,
  uploadWorkOrderPaymentProof,
  type InvoiceEmailReceipt,
  type WorkOrderChannelDelivery,
  type WorkOrderCompletionCheck,
  type WorkOrderCompletionContact,
  type WorkOrderCompletionResult,
  type WorkOrderListItem,
} from "@/lib/api";
import { formatUsPhoneInput, isValidUsPhone } from "@/lib/formatPhone";
import { hasValidContactEmail } from "@/lib/invoiceEmailHtml";
import TapToPayButton from "@/components/billing/TapToPayButton";
import SwipeToConfirm from "@/components/ui/SwipeToConfirm";

const badge =
  "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200";
const primaryButton =
  "complete-notice-primary rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-60";
const quietButton =
  "complete-notice-secondary rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-60";
const inputClass =
  "complete-notice-field w-full rounded-md border px-2.5 py-1.5 text-sm";

type Phase = "idle" | "loading" | "blocked" | "choose" | "offline" | "send" | "done";
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

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

function emailWarning(email: InvoiceEmailReceipt): string {
  if (email.status === "missing") return "The primary contact has no email on file.";
  if (email.status === "invalid") {
    return `The primary contact has an invalid email (${email.to}).`;
  }
  if (email.status === "skipped" || email.status === "failed") return email.error;
  return "";
}

function failureMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

const ALREADY_COMPLETE_REASON = "This work order is already complete.";
const INVOICE_NOT_OPEN_REASON =
  "This invoice is no longer open, so it cannot be resent.";
const INVOICE_ALREADY_CLOSED_REASON =
  "This invoice is already paid or closed.";

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
  paid,
  offlinePaid,
  autoStart,
  autoResend,
  onCompleted,
}: {
  orderId: string;
  token: string;
  completed: boolean;
  paid: boolean;
  offlinePaid: boolean;
  autoStart: boolean;
  autoResend: boolean;
  onCompleted: (order: WorkOrderListItem) => void;
}) {
  const [phase, setPhase] = useState<Phase>(
    (autoResend && completed) || (autoStart && !completed) ? "loading" : "idle",
  );
  const [changingPayment, setChangingPayment] = useState(false);
  const [resent, setResent] = useState(false);
  const [check, setCheck] = useState<WorkOrderCompletionCheck | null>(null);
  const [contactId, setContactId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkOrderCompletionResult | null>(null);
  const [method, setMethod] = useState<"check" | "cash">("check");
  const [checkNumber, setCheckNumber] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [canCapture, setCanCapture] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [saveReceiptEmail, setSaveReceiptEmail] = useState(true);
  const [emailDismissed, setEmailDismissed] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptPhone, setReceiptPhone] = useState("");
  const [textSentTo, setTextSentTo] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState<"email" | "sms" | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadedProof = useRef<{ file: File; url: string } | null>(null);

  function applyContact(contact: WorkOrderCompletionContact) {
    setContactId(contact._id);
    setPhone(phoneFieldValue(contact.phone));
    setEmail(contact.email.trim());
  }

  function openResend(next: WorkOrderCompletionCheck) {
    setChangingPayment(false);
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

  async function beginChangePayment() {
    setBusy(true);
    setError(null);
    setResult(null);
    setResent(false);
    setPhase("loading");
    try {
      const next = await getWorkOrderCompletionCheck(token, orderId);
      setCheck(next);
      if (!next.invoiceOpen && !next.offlinePayment) {
        setChangingPayment(false);
        setError(INVOICE_ALREADY_CLOSED_REASON);
        setPhase("blocked");
        return;
      }
      if (next.offlinePayment) setMethod(next.offlinePayment.method);
      setChangingPayment(true);
      setError(null);
      setPhase("choose");
    } catch (err) {
      setChangingPayment(false);
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
    setChangingPayment(false);
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
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCanCapture(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const proofPreviewRef = useRef<string | null>(null);
  proofPreviewRef.current = proofPreview;
  useEffect(() => {
    return () => {
      if (proofPreviewRef.current) URL.revokeObjectURL(proofPreviewRef.current);
    };
  }, []);

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

  function pickProof(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    const allowed =
      file.type.startsWith("image/") ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
    if (!allowed) {
      setError("Choose a JPEG, PNG, WebP, or HEIC photo.");
      return;
    }
    if (file.size > MAX_PROOF_BYTES) {
      setError("Photos must be 10 MB or smaller.");
      return;
    }
    setError(null);
    setProofFile(file);
    setProofPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
  }

  async function confirmOffline() {
    setError(null);
    let proofUrl: string | undefined;
    if (proofFile) {
      setBusy(true);
      try {
        if (uploadedProof.current?.file === proofFile) {
          proofUrl = uploadedProof.current.url;
        } else {
          const uploaded = await uploadWorkOrderPaymentProof(
            token,
            orderId,
            proofFile,
          );
          uploadedProof.current = { file: proofFile, url: uploaded.url };
          proofUrl = uploaded.url;
        }
      } catch (err) {
        setError(failureMessage(err, "Failed to upload the payment photo."));
        setBusy(false);
        return;
      }
    }
    const number = checkNumber.trim();
    await finish(
      {
        mode: "paid_offline",
        method,
        ...(method === "check" && number ? { checkNumber: number } : {}),
        ...(proofUrl ? { proofUrl } : {}),
      },
      completed
        ? "Failed to record this payment."
        : "Failed to mark this job complete.",
    );
  }

  async function finish(
    data:
      | { mode: "pay_now" }
      | {
          mode: "send" | "resend";
          contactId: string;
          phoneOverride?: string;
          emailOverride?: string;
        }
      | {
          mode: "paid_offline";
          method: "check" | "cash";
          checkNumber?: string;
          proofUrl?: string;
        },
    fallback: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const next = await completeWorkOrder(token, orderId, data);
      setResent(data.mode === "resend");
      setResult(next);
      const receipt = next.receipt;
      setReceiptPhone(receipt?.phone ? phoneFieldValue(receipt.phone) : "");
      setReceiptEmail(receipt?.email.status === "invalid" ? receipt.email.to : "");
      setEmailDismissed(false);
      setEmailSentTo(receipt?.email.status === "sent" ? receipt.email.to : null);
      setReceiptError(null);
      setTextSentTo(null);
      setTextError(null);
      setChangingPayment(false);
      setPhase("done");
      onCompleted(next.workOrder);
    } catch (err) {
      setError(failureMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function sendReceiptEmail() {
    const email = receiptEmail.trim();
    if (!hasValidContactEmail(email)) {
      setReceiptError("Enter a valid email address.");
      return;
    }
    setReceiptBusy("email");
    setReceiptError(null);
    try {
      const next = await sendWorkOrderReceipt(token, orderId, {
        channel: "email",
        email,
        saveToContact: saveReceiptEmail,
      });
      if (next.email?.status === "sent") {
        setEmailSentTo(next.email.to);
      } else if (next.email?.status === "skipped" || next.email?.status === "failed") {
        setReceiptError(next.email.error);
      } else {
        setReceiptError("Enter a valid email address.");
      }
    } catch (err) {
      setReceiptError(failureMessage(err, "The email was not sent."));
    } finally {
      setReceiptBusy(null);
    }
  }

  async function sendReceiptText() {
    if (!isValidUsPhone(receiptPhone)) {
      setTextError("Enter a 10-digit phone number.");
      return;
    }
    setReceiptBusy("sms");
    setTextError(null);
    try {
      const next = await sendWorkOrderReceipt(token, orderId, {
        channel: "sms",
        phone: receiptPhone.trim(),
      });
      if (next.text?.status === "sent") {
        setTextSentTo(next.text.to);
      } else if (next.text?.status === "failed") {
        setTextError(next.text.error);
      } else {
        setTextError("Enter a 10-digit phone number.");
      }
    } catch (err) {
      setTextError(failureMessage(err, "The text was not sent."));
    } finally {
      setReceiptBusy(null);
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
        {paid && !offlinePaid ? null : (
          <button
            type="button"
            onClick={() => void beginChangePayment()}
            className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
          >
            Change payment method
          </button>
        )}
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
            {(paid && !offlinePaid) || result.offlinePayment ? null : (
              <button
                type="button"
                onClick={() => void beginChangePayment()}
                className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                Change payment method
              </button>
            )}
          </div>
        ) : null}
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
        <p>
          {resent
            ? `Invoice ${result.invoice.number} was resent.`
            : result.offlinePayment
              ? `This work order is complete. Invoice ${result.invoice.number} for ${formatCents(result.invoice.amountCents)} was marked paid by ${offlinePaymentLabel(result.offlinePayment)}.`
              : `This work order is complete. Invoice ${result.invoice.number} for ${formatCents(result.invoice.amountCents)} is ready${result.payUrl ? " to pay" : ""}.`}
        </p>
        {result.offlinePayment?.proofUrl ? (
          <a
            href={result.offlinePayment.proofUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryButton} mt-3 inline-flex`}
          >
            View photo
          </a>
        ) : null}
        {result.payUrl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <TapToPayButton
              token={token}
              invoiceId={result.invoice._id}
              disabled={busy}
              onError={setError}
              className={`${primaryButton} inline-flex`}
            />
            <a
              href={result.payUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${primaryButton} inline-flex`}
            >
              Open payment page
            </a>
            {result.offlinePayment ? null : (
              <button
                type="button"
                onClick={() => void beginChangePayment()}
                className="inline-flex rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
              >
                Change payment method
              </button>
            )}
          </div>
        ) : null}
        {error ? <p className="complete-notice-error mt-2">{error}</p> : null}
        {result.delivery ? (
          <ul className="mt-2 space-y-1">
            <li>{deliveryLine("Text", result.delivery.sms)}</li>
            <li>{deliveryLine("Email", result.delivery.email)}</li>
          </ul>
        ) : null}
      </div>
      {result.offlinePayment && result.receipt ? (
        <div className="complete-notice space-y-3 rounded-md border px-3 py-3 text-sm">
          {emailSentTo ? (
            <p>Invoice emailed to {emailSentTo}.</p>
          ) : emailDismissed ? (
            <p>No invoice email will be sent.</p>
          ) : (
            <div className="space-y-3">
              <p className="complete-notice-error">{emailWarning(result.receipt.email)}</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
                  Email
                </span>
                <input
                  type="email"
                  value={receiptEmail}
                  autoComplete="off"
                  onChange={(event) => setReceiptEmail(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saveReceiptEmail}
                  onChange={(event) => setSaveReceiptEmail(event.target.checked)}
                />
                Save to primary contact
              </label>
              {receiptError ? <p className="complete-notice-error">{receiptError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={receiptBusy !== null}
                  onClick={() => void sendReceiptEmail()}
                  className={primaryButton}
                >
                  {receiptBusy === "email" ? "Sending…" : "Send email"}
                </button>
                <button
                  type="button"
                  disabled={receiptBusy !== null}
                  onClick={() => {
                    setReceiptError(null);
                    setEmailDismissed(true);
                  }}
                  className={quietButton}
                >
                  No email
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {textSentTo ? (
              <p>Link texted to {textSentTo}.</p>
            ) : (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
                    Text invoice link
                  </span>
                  <input
                    value={receiptPhone}
                    inputMode="tel"
                    autoComplete="off"
                    onChange={(event) =>
                      setReceiptPhone(formatUsPhoneInput(event.target.value))
                    }
                    className={inputClass}
                  />
                </label>
                {textError ? <p className="complete-notice-error">{textError}</p> : null}
                <button
                  type="button"
                  disabled={receiptBusy !== null}
                  onClick={() => void sendReceiptText()}
                  className={quietButton}
                >
                  {receiptBusy === "sms" ? "Sending…" : "Text invoice link"}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            disabled={receiptBusy !== null}
            onClick={() => setPhase("idle")}
            className={primaryButton}
          >
            Done
          </button>
        </div>
      ) : null}
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
  const contactSendBlocked = Boolean(check?.sendBlockedReason);

  if (phase === "choose") {
    return (
      <div className="complete-notice rounded-md border px-3 py-3 text-sm">
        <p>
          {completed
            ? check?.offlinePayment
              ? `Invoice for ${amount} is marked paid. Choose how the customer will pay.`
              : `Invoice for ${amount} is open. Choose how the customer will pay.`
            : `Completing this work order will generate an invoice for ${amount} to be paid by the customer.`}
        </p>
        {check?.offlinePayment ? (
          <p className="mt-2">
            This invoice is marked paid by {offlinePaymentLabel(check.offlinePayment)}.
            Choosing another option will mark it unpaid.
          </p>
        ) : null}
        {contactSendBlocked ? (
          <p className="complete-notice-error mt-2">{check?.sendBlockedReason}</p>
        ) : null}
        {error ? <p className="complete-notice-error mt-2 text-sm">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || contactSendBlocked}
            onClick={() =>
              void finish(
                { mode: "pay_now" },
                completed
                  ? "Failed to open the payment page."
                  : "Failed to mark this job complete.",
              )
            }
            className={primaryButton}
          >
            {busy ? "Saving…" : "Take payment on this device"}
          </button>
          <button
            type="button"
            disabled={busy || contactSendBlocked}
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
              setPhase("offline");
            }}
            className={quietButton}
          >
            Paid Check/Cash
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setChangingPayment(false);
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

  if (phase === "offline") {
    return (
      <div className="complete-notice space-y-3 rounded-md border px-3 py-3 text-sm">
        <p>Confirm that {amount} was received by check or cash.</p>
        {check?.offlinePayment ? (
          <p>
            This invoice is marked paid by {offlinePaymentLabel(check.offlinePayment)}.
            Choosing another option will mark it unpaid.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setMethod("check")}
            className={method === "check" ? primaryButton : quietButton}
          >
            Check
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMethod("cash")}
            className={method === "cash" ? primaryButton : quietButton}
          >
            Cash
          </button>
        </div>
        {method === "check" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
              Check number (optional)
            </span>
            <input
              value={checkNumber}
              autoComplete="off"
              onChange={(event) => setCheckNumber(event.target.value)}
              className={inputClass}
            />
          </label>
        ) : null}
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide">
            Photo (optional)
          </span>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={pickProof}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={pickProof}
          />
          <div className="flex flex-wrap gap-2">
            {canCapture ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => cameraInputRef.current?.click()}
                className={quietButton}
              >
                Take photo
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => uploadInputRef.current?.click()}
              className={quietButton}
            >
              Upload photo
            </button>
          </div>
          {proofPreview ? (
            <div className="mt-2 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={proofPreview}
                alt="Payment proof preview"
                className="h-24 w-24 rounded-md border object-cover"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  uploadedProof.current = null;
                  setProofFile(null);
                  setProofPreview((current) => {
                    if (current) URL.revokeObjectURL(current);
                    return null;
                  });
                }}
                className={quietButton}
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>
        {error ? <p className="complete-notice-error">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <SwipeToConfirm
            label={`Swipe to confirm ${amount}`}
            busyLabel="Saving…"
            busy={busy}
            onConfirm={() => void confirmOffline()}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase("choose");
            }}
            className={quietButton}
          >
            Back
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
  const invoiceClosed =
    completed && check?.invoiceOpen === false && !check?.offlinePayment;
  const sendBlocked =
    !contact || Boolean(phoneError) || Boolean(emailError) || !via || invoiceClosed;

  return (
    <div className="complete-notice space-y-3 rounded-md border px-3 py-3 text-sm">
      <p>
        Invoice {amount} will be {completed ? "sent again" : "sent"} to the contact
        you choose. A phone or email you type here replaces the one on file for
        this message only.
      </p>
      {check?.offlinePayment ? (
        <p>
          This invoice is marked paid by {offlinePaymentLabel(check.offlinePayment)}.
          Choosing another option will mark it unpaid.
        </p>
      ) : null}
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
            setPhase(completed && !changingPayment ? "idle" : "choose");
          }}
          className={quietButton}
        >
          Back
        </button>
      </div>
    </div>
  );
}
