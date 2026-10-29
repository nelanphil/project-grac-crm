import { Types } from "mongoose";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { User } from "../models/mongo/User";
import { dispatchMessagingBatch } from "../controllers/messaging.controller";
import { sendRoleEmail } from "./email.service";
import { renderAutomatedBillingEmail } from "./paymentReceipt.service";
import {
  automatedEmailPauseReasonFor,
  resolveAutomatedMessage,
} from "./automatedMessage.service";
import {
  classifyReceiptEmail,
  classifyReceiptPhone,
} from "./invoiceReceipt.service";
import { applyInvoiceTokens } from "../utils/automatedMessageCopy";
import { renderMessageTemplate, stripInvoiceToken } from "../utils/messageTemplate";
import {
  getTwilioAccountForSend,
  sendSms,
  TwilioServiceError,
} from "./twilio.service";
import { isEmailChannelEnabled } from "../utils/emailPreferences";
import { isSmsEnabled } from "../utils/smsPreferences";
import { toE164 } from "../utils/messagingContext";
import { normalizePhoneLines } from "../utils/twilioPhoneLines";
import { listUnsubscribeHeaders } from "../utils/unsubscribeToken";
import { crewIdStrings } from "../utils/workOrderCrew";
import { formatScheduleClock } from "../utils/scheduleSms";
import {
  formatLocalDate,
  localDateToUtc,
  SCHEDULE_TIMEZONE,
  storedTicketDateKey,
} from "../utils/scheduleTime";

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type AppointmentChannelResult =
  | { status: "sent"; to: string }
  | { status: "skipped"; error: string }
  | { status: "failed"; error: string }
  | { status: "invalid"; error: string };

export type AppointmentNoticeDetails = {
  dateLabel: string;
  /** Leading space plus "at" or "between", or "" when no time is set. */
  timePhrase: string;
  technicianName: string;
  serviceAddress: string;
};

type ScheduleRef = { toString(): string } | string;

export type AppointmentScheduleInput = {
  date?: Date | string | null;
  scheduledStart?: Date | string | null;
  desiredStartTime?: string | null;
  desiredStartBy?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  assignedUserRefs?: ScheduleRef[] | null;
  assignedUserRef?: ScheduleRef | null;
  deletedAt?: Date | string | null;
  tech?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  customerRef?: Types.ObjectId | string | null;
  renewalInvoiceRef?: Types.ObjectId | string | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clockFromHm(value: string | null | undefined): string {
  const match = TIME_OF_DAY.exec((value ?? "").trim());
  if (!match) return "";
  const date = new Date(Date.UTC(2020, 0, 1, Number(match[1]), Number(match[2])));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\u202f/g, " ");
}

/** Calendar day of the visit, or "" when nothing is scheduled. */
export function appointmentDateKey(input: AppointmentScheduleInput): string {
  const date = toDate(input.date);
  const start = toDate(input.scheduledStart);
  return storedTicketDateKey(date) ?? (start ? formatLocalDate(start) : "");
}

/**
 * Changes when the visit date, dispatch time, or crew changes, so a
 * reschedule asks staff to tell the customer again.
 */
export function appointmentNoticeKey(input: AppointmentScheduleInput): string {
  const start = toDate(input.scheduledStart);
  const techs = [...crewIdStrings(input)].sort().join(",");
  return `${appointmentDateKey(input)}|${start ? start.toISOString() : ""}|${techs}`;
}

export function appointmentSendBlocker(
  input: AppointmentScheduleInput,
): string | null {
  if (toDate(input.deletedAt)) return "This work order is deleted.";
  if (!appointmentDateKey(input)) return "Set a date before telling the customer.";
  if (crewIdStrings(input).length === 0) {
    return "Assign a technician before telling the customer.";
  }
  return null;
}

export function formatAppointmentDateLabel(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const noon = localDateToUtc(dateKey, "12:00");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(noon)
    .replace(/\u202f/g, " ");
}

/** Clock time when the stop is dispatched, otherwise the arrival window. */
export function formatAppointmentTimePhrase(
  input: AppointmentScheduleInput,
): string {
  const start = toDate(input.scheduledStart);
  if (start) {
    const clock = formatScheduleClock(start);
    return clock ? ` at ${clock}` : "";
  }
  const earliest = clockFromHm(input.desiredStartTime);
  const latest = clockFromHm(input.desiredStartBy);
  const desiredStart = (input.desiredStartTime ?? "").trim();
  const desiredBy = (input.desiredStartBy ?? "").trim();
  if (earliest && latest && desiredBy > desiredStart) {
    return ` between ${earliest} and ${latest}`;
  }
  if (earliest) return ` at ${earliest}`;
  const windowStart = clockFromHm(input.startTime);
  const windowEnd = clockFromHm(input.endTime);
  if (windowStart && windowEnd) return ` between ${windowStart} and ${windowEnd}`;
  if (windowStart) return ` at ${windowStart}`;
  return "";
}

export function formatServiceAddress(input: AppointmentScheduleInput): string {
  const street = input.customerAddress?.trim() ?? "";
  const cityLine = [input.customerCity?.trim(), input.customerState?.trim()]
    .filter(Boolean)
    .join(", ");
  const place = [cityLine, input.customerZip?.trim()].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

export function fillAppointmentTokens(
  template: string,
  details: AppointmentNoticeDetails,
): string {
  return applyInvoiceTokens(template, {
    appointmentDate: details.dateLabel,
    appointmentTime: details.timePhrase,
    technicianName: details.technicianName,
    serviceAddress: details.serviceAddress,
  });
}

export async function loadAppointmentNoticeDetails(
  workOrder: AppointmentScheduleInput,
): Promise<AppointmentNoticeDetails> {
  const ids = crewIdStrings(workOrder);
  const users = ids.length
    ? await User.find({ _id: { $in: ids } })
        .select("first_name last_name")
        .lean()
    : [];
  const byId = new Map(
    users.map((user) => [
      String(user._id),
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim(),
    ]),
  );
  const names = ids
    .map((id) => byId.get(id))
    .filter((name): name is string => Boolean(name));
  const dateKey = appointmentDateKey(workOrder);
  return {
    dateLabel: dateKey ? formatAppointmentDateLabel(dateKey) : "",
    timePhrase: formatAppointmentTimePhrase(workOrder),
    technicianName: names.join(", ") || workOrder.tech?.trim() || "your technician",
    serviceAddress: formatServiceAddress(workOrder),
  };
}

async function smsFromNumber(): Promise<
  | { ok: true; account: Awaited<ReturnType<typeof getTwilioAccountForSend>>; from: string }
  | { ok: false; error: string }
> {
  try {
    const account = await getTwilioAccountForSend();
    const lines = normalizePhoneLines(account.phoneNumbers);
    const from = (lines.find((line) => line.sms) ?? lines[0])?.phoneNumber;
    if (!from) return { ok: false, error: "No texting number is configured." };
    return { ok: true, account, from };
  } catch (err) {
    const error =
      err instanceof TwilioServiceError
        ? err.message
        : err instanceof Error
          ? err.message
          : "No texting number is configured.";
    return { ok: false, error };
  }
}

export async function emailAppointmentNotice(input: {
  to: string;
  details: AppointmentNoticeDetails;
  customerRef?: Types.ObjectId | string | null;
  invoiceId?: string | null;
}): Promise<AppointmentChannelResult> {
  const classified = classifyReceiptEmail(input.to);
  if (classified.status === "missing") {
    return { status: "invalid", error: "Enter an email address." };
  }
  if (classified.status === "invalid") {
    return { status: "invalid", error: "Enter a valid email address." };
  }
  if (!(await isEmailChannelEnabled(classified.to, "billing"))) {
    return {
      status: "skipped",
      error: "This address is unsubscribed from billing emails.",
    };
  }
  const paused = await automatedEmailPauseReasonFor("appointmentConfirmationEmail");
  if (paused) return { status: "skipped", error: paused };

  try {
    const copy = await resolveAutomatedMessage("appointmentConfirmationEmail");
    const rendered = await renderAutomatedBillingEmail({
      subject: fillAppointmentTokens(copy.subject, input.details),
      body: fillAppointmentTokens(copy.body, input.details),
      emailChrome: copy.emailChrome,
      invoiceId: input.invoiceId?.trim() || "",
      customerRef: input.customerRef,
      recipient: classified.to,
    });
    await sendRoleEmail("billing_notifications", {
      to: classified.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: listUnsubscribeHeaders(classified.to, "billing"),
    });
    return { status: "sent", to: classified.to };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The email was not sent.",
    };
  }
}

export async function textAppointmentNotice(input: {
  phone: string;
  details: AppointmentNoticeDetails;
  customerRef?: Types.ObjectId | string | null;
  userId?: string | null;
  apiBase: string;
}): Promise<AppointmentChannelResult> {
  const phone = classifyReceiptPhone(input.phone);
  if (phone.status !== "ok") {
    return { status: "invalid", error: "Enter a 10-digit phone number." };
  }

  const copy = await resolveAutomatedMessage("appointmentConfirmationSms");
  const body = fillAppointmentTokens(copy.body, input.details);
  const line = await smsFromNumber();
  if (!line.ok) return { status: "failed", error: line.error };

  const customerRef = input.customerRef ? String(input.customerRef) : "";
  const contact =
    customerRef && Types.ObjectId.isValid(customerRef)
      ? await CustomerContact.findOne({
          customerRef,
          ...activeContactFilter,
        })
          .sort({ isPrimary: -1, createdAt: 1 })
          .select("_id")
      : null;

  try {
    if (contact) {
      const result = await dispatchMessagingBatch(
        {
          contactIds: [String(contact._id)],
          body,
          mediaUrls: [],
          twilioAccountId: String(line.account._id),
          fromNumber: line.from,
          includePaymentLink: false,
          toOverride: phone.phone,
        },
        { userId: input.userId ?? null, apiBase: input.apiBase },
      );
      const item = result.results[0];
      if (item?.status === "sent") return { status: "sent", to: phone.phone };
      if (item?.status === "skipped") {
        return {
          status: "skipped",
          error: item.error || "The text was not sent.",
        };
      }
      return { status: "failed", error: item?.error || "The text was not sent." };
    }

    const to = toE164(phone.phone);
    if (!to) return { status: "invalid", error: "Enter a 10-digit phone number." };
    if (!(await isSmsEnabled(phone.phone))) {
      return { status: "skipped", error: "Recipient opted out of text messages" };
    }
    await sendSms({
      account: line.account,
      from: line.from,
      to,
      body: stripInvoiceToken(renderMessageTemplate(body, { first_name: "" })),
    });
    return { status: "sent", to: phone.phone };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "The text was not sent.",
    };
  }
}
