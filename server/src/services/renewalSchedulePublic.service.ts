import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { hashPayToken } from "../utils/payToken";
import {
  formatLocalDate,
  storedTicketDateKey,
} from "../utils/scheduleTime";
import { logNotificationAsync } from "./notification.service";
import {
  CONTRACT_SERVICE_SOURCE_TYPES,
  ensureRenewalWorkOrder,
} from "./renewalWorkOrder.service";
import {
  evaluateRenewalScheduleChoice,
  renewalOfferDateLabel,
} from "./renewalScheduleChoice";
import { recordWorkOrderActivity } from "./workOrderActivity.service";

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export class RenewalSchedulePublicError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RenewalSchedulePublicError";
    this.status = status;
  }
}

export type PublicRenewalDate = { date: string; label: string };

export type PublicRenewalSchedule =
  | { status: "invalid" }
  | { status: "expired"; firstName: string }
  | { status: "chosen"; firstName: string; date: string; label: string }
  | { status: "open"; firstName: string; dates: PublicRenewalDate[] };

function datesOf(values: string[] | undefined): PublicRenewalDate[] {
  return (values ?? [])
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .map((date) => ({ date, label: renewalOfferDateLabel(date) }));
}

async function firstNameFor(customerRef: Types.ObjectId | null | undefined): Promise<string> {
  if (!customerRef) return "";
  const [contact, customer] = await Promise.all([
    CustomerContact.findOne({ customerRef, ...activeContactFilter })
      .sort({ isPrimary: -1, createdAt: 1 })
      .select("first")
      .lean(),
    Customer.findById(customerRef).select("first").lean(),
  ]);
  return (contact?.first || customer?.first || "").trim();
}

function chosenDateOf(workOrder: {
  date?: Date | null;
  scheduledStart?: Date | null;
} | null): string | null {
  if (!workOrder) return null;
  return (
    storedTicketDateKey(workOrder.date) ||
    (workOrder.scheduledStart ? formatLocalDate(workOrder.scheduledStart) : null)
  );
}

export async function loadPublicRenewalSchedule(
  token: string,
): Promise<PublicRenewalSchedule> {
  const trimmed = token.trim();
  if (!TOKEN_RE.test(trimmed)) return { status: "invalid" };
  const invoice = await Invoice.findOne({
    renewalScheduleTokenHash: hashPayToken(trimmed),
    sourceType: { $in: [...CONTRACT_SERVICE_SOURCE_TYPES] },
  })
    .select(
      "customerRef renewalScheduleTokenExpiresAt renewalScheduleOfferedDates serviceWorkOrderRef",
    )
    .lean();
  if (!invoice) return { status: "invalid" };

  const firstName = await firstNameFor(invoice.customerRef);
  const expires = invoice.renewalScheduleTokenExpiresAt
    ? new Date(invoice.renewalScheduleTokenExpiresAt)
    : null;
  if (!expires || expires.getTime() < Date.now()) {
    return { status: "expired", firstName };
  }

  const workOrder = invoice.serviceWorkOrderRef
    ? await WorkOrder.findById(invoice.serviceWorkOrderRef)
        .select("date scheduledStart")
        .lean()
    : null;
  const chosen = chosenDateOf(workOrder);
  if (chosen) {
    return {
      status: "chosen",
      firstName,
      date: chosen,
      label: renewalOfferDateLabel(chosen),
    };
  }
  return {
    status: "open",
    firstName,
    dates: datesOf(invoice.renewalScheduleOfferedDates),
  };
}

export async function confirmPublicRenewalSchedule(
  token: string,
  requestedDate: string,
): Promise<{ date: string; label: string }> {
  const trimmed = token.trim();
  const date = requestedDate.trim();
  if (!TOKEN_RE.test(trimmed)) {
    throw new RenewalSchedulePublicError("This scheduling link is not valid.", 404);
  }
  const invoice = await Invoice.findOne({
    renewalScheduleTokenHash: hashPayToken(trimmed),
    sourceType: { $in: [...CONTRACT_SERVICE_SOURCE_TYPES] },
    status: "paid",
  });
  if (!invoice) {
    throw new RenewalSchedulePublicError("This scheduling link is not valid.", 404);
  }

  let workOrder = invoice.serviceWorkOrderRef
    ? await WorkOrder.findById(invoice.serviceWorkOrderRef)
    : null;
  if (!workOrder) {
    const created = await ensureRenewalWorkOrder(invoice);
    workOrder = created
      ? await WorkOrder.findById(created.workOrderId)
      : null;
  }
  if (!workOrder) {
    throw new RenewalSchedulePublicError(
      "We could not schedule this visit. Please call our office.",
      400,
    );
  }

  const decision = evaluateRenewalScheduleChoice({
    now: new Date(),
    expiresAt: invoice.renewalScheduleTokenExpiresAt ?? null,
    offeredDates: invoice.renewalScheduleOfferedDates ?? [],
    requestedDate: date,
    today: formatLocalDate(new Date()),
    workOrderScheduled: Boolean(workOrder.date || workOrder.scheduledStart),
  });
  if (!decision.ok) {
    if (decision.reason === "expired") {
      throw new RenewalSchedulePublicError(
        "This scheduling link has expired. Please call our office.",
        410,
      );
    }
    if (decision.reason === "already_scheduled") {
      throw new RenewalSchedulePublicError(
        "This visit already has a date. Call our office if you need to change it.",
        409,
      );
    }
    if (decision.reason === "past") {
      throw new RenewalSchedulePublicError(
        "That date has passed. Please call our office to schedule.",
        400,
      );
    }
    throw new RenewalSchedulePublicError("Choose one of the offered dates.", 400);
  }

  const scheduled = await WorkOrder.findOneAndUpdate(
    {
      _id: workOrder._id,
      date: null,
      scheduledStart: null,
    },
    { $set: { date: new Date(`${date}T00:00:00.000Z`) } },
    { new: true },
  );
  if (!scheduled) {
    throw new RenewalSchedulePublicError(
      "This visit already has a date. Call our office if you need to change it.",
      409,
    );
  }

  const label = renewalOfferDateLabel(date);
  await recordWorkOrderActivity({
    workOrderRef: scheduled._id,
    action: "scheduled",
    actor: { actorKind: "customer", actorName: "Customer" },
    summary: `Customer requested ${label}`,
    source: "job",
  });
  logNotificationAsync({
    entityType: "work_order",
    action: "updated",
    entityId: String(scheduled._id),
    customerRef: invoice.customerRef ?? null,
    summary: `Customer requested ${label} for a renewal visit`,
    actorType: "system",
    actorName: "Customer",
  });
  return { date, label };
}
