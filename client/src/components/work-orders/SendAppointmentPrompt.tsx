"use client";

import { useState } from "react";
import {
  ApiError,
  sendWorkOrderAppointment,
  type AppointmentNoticeResult,
  type WorkOrderListItem,
} from "@/lib/api";
import {
  appointmentNeedsNotice,
  appointmentNoticeKey,
  appointmentTechnicianLabel,
  appointmentWhenLabel,
} from "@/lib/appointmentNotice";

function channelLine(label: string, result: AppointmentNoticeResult): string {
  if (result.status === "sent") return `${label} sent to ${result.to}.`;
  const reason = result.error || "It was not sent.";
  return `${label} ${result.status}: ${reason}`;
}

export default function SendAppointmentPrompt({
  token,
  order,
  onSent,
}: {
  token: string;
  order: WorkOrderListItem;
  onSent: (order: WorkOrderListItem) => void;
}) {
  const scheduleKey = appointmentNoticeKey(order);
  const pending = appointmentNeedsNotice(order);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [phone, setPhone] = useState(order.customerPhone ?? "");
  const [email, setEmail] = useState(order.customerEmail ?? "");
  const [textOn, setTextOn] = useState(Boolean(order.customerPhone?.trim()));
  const [emailOn, setEmailOn] = useState(Boolean(order.customerEmail?.trim()));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ key: string; text: string } | null>(
    null,
  );
  const shownNotice = notice?.key === scheduleKey ? notice.text : null;

  if (order.deletedAt || order.completed) return null;
  if (!pending && !shownNotice) return null;
  if (dismissedKey === scheduleKey && !shownNotice) return null;

  const phoneReady = phone.trim().length > 0;
  const emailReady = email.trim().length > 0;
  const canSend = (textOn && phoneReady) || (emailOn && emailReady);

  async function send() {
    if (!canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendWorkOrderAppointment(token, order._id, {
        ...(textOn && phoneReady ? { sms: { phone: phone.trim() } } : {}),
        ...(emailOn && emailReady ? { email: { address: email.trim() } } : {}),
      });
      const lines = [
        result.sms ? channelLine("Text", result.sms) : "",
        result.email ? channelLine("Email", result.email) : "",
      ].filter(Boolean);
      setNotice({ key: scheduleKey, text: lines.join(" ") });
      if (result.sms?.status === "sent" || result.email?.status === "sent") {
        onSent(result.workOrder);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to send the appointment.",
      );
    } finally {
      setSending(false);
    }
  }

  const when = appointmentWhenLabel(order);
  const tech = appointmentTechnicianLabel(order);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 print:hidden">
      {pending ? (
        <>
          <p className="font-semibold">
            Appointment set for {when} with {tech}. Let the customer know.
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                checked={textOn && phoneReady}
                disabled={!phoneReady || sending}
                onChange={(event) => setTextOn(event.target.checked)}
                className="h-4 w-4"
              />
              <span className="w-12 font-medium">Text</span>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Phone number"
                className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-sm text-brand-dark"
              />
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                checked={emailOn && emailReady}
                disabled={!emailReady || sending}
                onChange={(event) => setEmailOn(event.target.checked)}
                className="h-4 w-4"
              />
              <span className="w-12 font-medium">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                className="min-w-0 flex-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-sm text-brand-dark"
              />
            </label>
          </div>
          {error ? <p className="mt-3 text-red-700">{error}</p> : null}
          {shownNotice ? <p className="mt-3">{shownNotice}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canSend || sending}
              onClick={() => void send()}
              className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {sending ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => setDismissedKey(scheduleKey)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-amber-900 hover:underline disabled:opacity-60"
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        <p>{shownNotice}</p>
      )}
    </div>
  );
}
